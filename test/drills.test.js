import { describe, it, expect } from "vitest";
import { drillsFromIndex, slugify, fileNameFor, filterDrills } from "../src/lib/drills.js";

const index = {
  version: 1,
  entries: {
    a: { name: "rondo-4v2.md", modifiedTime: "T", thumb: "area: 20x20", invalid: null,
         meta: { title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8", tags: ["possession"] } },
    b: { name: "3v2-to-end-line.md", modifiedTime: "T", thumb: null, invalid: null,
         meta: { title: "3v2 to end line", category: "skill", minutes: 15, tags: ["transition", "finishing"] } },
    c: { name: "broken.md", modifiedTime: "T", thumb: null, invalid: "yaml: bad", meta: {} },
  },
};

describe("drillsFromIndex", () => {
  it("maps entries to drills sorted by title, case-insensitively", () => {
    // localeCompare, so "broken" sorts before "Rondo 4v2" — which is what someone
    // reading an alphabetical list expects, rather than ASCII order putting all the
    // capitals first.
    expect(drillsFromIndex(index).map((d) => d.title)).toEqual([
      "3v2 to end line",
      "broken",
      "Rondo 4v2",
    ]);
  });

  it("falls back to the slug when there is no title", () => {
    const d = drillsFromIndex(index).find((x) => x.id === "c");
    expect(d.title).toBe("broken");
    expect(d.slug).toBe("broken");
  });

  it("always gives tags as an array", () => {
    const d = drillsFromIndex(index).find((x) => x.id === "c");
    expect(d.tags).toEqual([]);
  });

  it("keeps an invalid drill in the list, flagged", () => {
    // The spec is explicit: an invalid drill must appear and be openable, never hidden.
    const d = drillsFromIndex(index).find((x) => x.id === "c");
    expect(d.invalid).toBe("yaml: bad");
  });

  it("carries null rather than undefined for absent fields", () => {
    const d = drillsFromIndex(index).find((x) => x.id === "b");
    expect(d.players).toBe(null);
    expect(d.thumb).toBe(null);
  });

  it("returns an empty array for an empty index", () => {
    expect(drillsFromIndex({ version: 1, entries: {} })).toEqual([]);
    expect(drillsFromIndex(null)).toEqual([]);
  });

  it("coerces a non-string title instead of crashing the catalogue", () => {
    // A drill titled 2024 is legitimate YAML, not a broken file, but a number reaching
    // localeCompare threw and took down the whole list — and toLowerCase did the same
    // to search. Both must survive it.
    const idx = { version: 1, entries: {
      a: { name: "a.md", meta: { title: "Alpha" }, thumb: null, invalid: null },
      b: { name: "b.md", meta: { title: 2024 }, thumb: null, invalid: null },
      c: { name: "c.md", meta: { title: true }, thumb: null, invalid: null },
      d: { name: "d.md", meta: { title: "Delta" }, thumb: null, invalid: null },
    } };
    const drills = drillsFromIndex(idx);
    expect(drills.map((d) => d.title)).toEqual(["2024", "Alpha", "Delta", "true"]);
    expect(filterDrills(drills, { query: "20" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("still falls back to the slug for a falsy title", () => {
    const entry = (id, title) => [id, { name: `${id}.md`, meta: { title }, thumb: null, invalid: null }];
    const idx = { version: 1, entries: Object.fromEntries([entry("x", ""), entry("y", false), entry("z", 0)]) };
    expect(drillsFromIndex(idx).map((d) => d.title)).toEqual(["x", "y", "z"]);
  });

  it("skips a null entry rather than throwing", () => {
    expect(drillsFromIndex({ version: 1, entries: { a: null } })).toEqual([]);
  });
});

describe("slugify", () => {
  it("lower-cases and hyphenates", () => {
    expect(slugify("3v2 To End Line")).toBe("3v2-to-end-line");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Rondo: 4v2 (two touch)!")).toBe("rondo-4v2-two-touch");
    expect(slugify("  spaced   out  ")).toBe("spaced-out");
  });

  it("never returns an empty slug", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify(null)).toBe("untitled");
  });

  it("is idempotent", () => {
    expect(slugify(slugify("Rondo: 4v2"))).toBe(slugify("Rondo: 4v2"));
  });
});

describe("fileNameFor", () => {
  it("appends .md to the slug", () => {
    expect(fileNameFor("Rondo 4v2")).toBe("rondo-4v2.md");
  });

  it("avoids colliding with an existing name", () => {
    expect(fileNameFor("Rondo 4v2", ["rondo-4v2.md"])).toBe("rondo-4v2-2.md");
    expect(fileNameFor("Rondo 4v2", ["rondo-4v2.md", "rondo-4v2-2.md"])).toBe("rondo-4v2-3.md");
  });
});

describe("filterDrills", () => {
  const drills = drillsFromIndex(index);

  it("returns everything with no filter", () => {
    expect(filterDrills(drills, {})).toHaveLength(3);
  });

  it("filters by category", () => {
    expect(filterDrills(drills, { category: "skill" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("filters by tag", () => {
    expect(filterDrills(drills, { tag: "possession" }).map((d) => d.id)).toEqual(["a"]);
  });

  it("searches title and tags, case-insensitively", () => {
    expect(filterDrills(drills, { query: "RONDO" }).map((d) => d.id)).toEqual(["a"]);
    expect(filterDrills(drills, { query: "finishing" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("combines filters", () => {
    expect(filterDrills(drills, { category: "warmup", query: "rondo" })).toHaveLength(1);
    expect(filterDrills(drills, { category: "skill", query: "rondo" })).toHaveLength(0);
  });

  it("ignores an empty or whitespace query", () => {
    expect(filterDrills(drills, { query: "   " })).toHaveLength(3);
  });
});
