import { describe, it, expect } from "vitest";
import { EMPTY_INDEX, readIndex, entryFor, diffIndex, applyDiff } from "../src/lib/driveIndex.js";

const DRILL = `---
title: 3v2 to end line
category: skill
minutes: 15
tags: [transition]
---

Reds attack.

\`\`\`pitch
area: 40x25 half
red: A@10,20
\`\`\`

More prose.

\`\`\`pitch
area: 10x10
\`\`\`
`;

describe("readIndex", () => {
  it("parses a well-formed index", () => {
    const idx = { version: 1, entries: { a: { name: "a.md", modifiedTime: "T" } } };
    expect(readIndex(JSON.stringify(idx))).toEqual(idx);
  });

  it("falls back to empty for anything unusable, rather than throwing", () => {
    for (const bad of ["", "not json", "null", "[]", '{"version":99}', undefined, null, "{}"]) {
      expect(readIndex(bad)).toEqual(EMPTY_INDEX);
    }
  });

  it("returns a fresh object each time, never the shared EMPTY_INDEX", () => {
    const a = readIndex("nope");
    a.entries.x = 1;
    expect(readIndex("nope").entries).toEqual({});
  });
});

describe("entryFor", () => {
  it("captures name, modifiedTime, metadata and the first pitch block", () => {
    const e = entryFor("3v2.md", "T1", DRILL);
    expect(e.name).toBe("3v2.md");
    expect(e.modifiedTime).toBe("T1");
    expect(e.meta.title).toBe("3v2 to end line");
    expect(e.meta.tags).toEqual(["transition"]);
    expect(e.thumb).toBe("area: 40x25 half\nred: A@10,20\n");
    expect(e.invalid).toBe(null);
  });

  it("records a null thumb when the drill has no diagram", () => {
    expect(entryFor("x.md", "T", "---\ntitle: T\n---\n\njust prose\n").thumb).toBe(null);
  });

  it("flags broken frontmatter but still builds an entry", () => {
    const e = entryFor("x.md", "T", "---\ntitle: [oops\n---\n\nbody\n");
    expect(e.invalid).toMatch(/yaml/i);
    expect(e.meta).toEqual({});
  });
});

describe("diffIndex", () => {
  const index = {
    version: 1,
    entries: {
      keep: { name: "keep.md", modifiedTime: "T1", meta: {}, thumb: null, invalid: null },
      stale: { name: "stale.md", modifiedTime: "T1", meta: {}, thumb: null, invalid: null },
      gone: { name: "gone.md", modifiedTime: "T1", meta: {}, thumb: null, invalid: null },
    },
  };
  const files = [
    { id: "keep", name: "keep.md", modifiedTime: "T1" },
    { id: "stale", name: "stale.md", modifiedTime: "T2" },
    { id: "new", name: "new.md", modifiedTime: "T1" },
  ];

  it("keeps entries whose modifiedTime still matches", () => {
    expect(Object.keys(diffIndex(index, files).keep)).toEqual(["keep"]);
  });

  it("refetches changed and unknown files", () => {
    expect(diffIndex(index, files).refetch.map((f) => f.id).sort()).toEqual(["new", "stale"]);
  });

  it("drops entries for files no longer in Drive", () => {
    expect(diffIndex(index, files).dropped).toEqual(["gone"]);
  });

  it("refetches an entry whose name changed even if modifiedTime did not", () => {
    const renamed = [{ id: "keep", name: "renamed.md", modifiedTime: "T1" }];
    expect(diffIndex(index, renamed).refetch.map((f) => f.id)).toEqual(["keep"]);
  });

  it("ignores index.json itself and anything that is not markdown", () => {
    const noise = [
      { id: "idx", name: "index.json", modifiedTime: "T" },
      { id: "img", name: "photo.png", modifiedTime: "T" },
      { id: "keep", name: "keep.md", modifiedTime: "T1" },
    ];
    const d = diffIndex(index, noise);
    expect(d.refetch).toEqual([]);
    expect(Object.keys(d.keep)).toEqual(["keep"]);
  });

  it("treats an empty index as everything needing a fetch", () => {
    const d = diffIndex(EMPTY_INDEX, files);
    expect(d.refetch.map((f) => f.id).sort()).toEqual(["keep", "new", "stale"]);
    expect(d.keep).toEqual({});
    expect(d.dropped).toEqual([]);
  });
});

describe("applyDiff", () => {
  it("merges kept entries with freshly built ones", () => {
    const keep = { k: { name: "k.md", modifiedTime: "T", meta: {}, thumb: null, invalid: null } };
    const fetched = { n: entryFor("n.md", "T", "---\ntitle: N\n---\n") };
    const next = applyDiff(keep, fetched);
    expect(Object.keys(next.entries).sort()).toEqual(["k", "n"]);
    expect(next.version).toBe(1);
  });
});
