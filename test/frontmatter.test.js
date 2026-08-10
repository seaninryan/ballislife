import { describe, it, expect } from "vitest";
import { parseDoc, serialiseDoc } from "../src/lib/frontmatter.js";

describe("parseDoc", () => {
  it("splits frontmatter from body", () => {
    const src = "---\ntitle: Rondo 4v2\nminutes: 10\n---\n\nKeep the ball.\n";
    const doc = parseDoc(src);
    expect(doc.meta).toEqual({ title: "Rondo 4v2", minutes: 10 });
    expect(doc.body).toBe("Keep the ball.\n");
    expect(doc.error).toBe(null);
  });

  it("treats a document with no frontmatter as all body", () => {
    const doc = parseDoc("Just some notes.\n");
    expect(doc.meta).toEqual({});
    expect(doc.body).toBe("Just some notes.\n");
    expect(doc.error).toBe(null);
  });

  it("reports broken yaml but still returns the body", () => {
    const src = "---\ntitle: [unclosed\n---\n\nBody survives.\n";
    const doc = parseDoc(src);
    expect(doc.meta).toEqual({});
    expect(doc.body).toBe("Body survives.\n");
    expect(doc.error).toMatch(/yaml/i);
  });

  it("parses list and range fields", () => {
    const src = "---\ntags: [transition, finishing]\nplayers: 8-12\n---\nx\n";
    const doc = parseDoc(src);
    expect(doc.meta.tags).toEqual(["transition", "finishing"]);
    expect(doc.meta.players).toBe("8-12");
  });

  it("handles a document that ends at the closing fence", () => {
    const doc = parseDoc("---\ntitle: Stub\n---");
    expect(doc.meta).toEqual({ title: "Stub" });
    expect(doc.body).toBe("");
    expect(doc.error).toBe(null);
  });

  it("consumes every blank line between the fence and the body", () => {
    expect(parseDoc("---\ntitle: T\n---\n\n\n\nBody.\n").body).toBe("Body.\n");
  });

  it("tolerates trailing whitespace on the fence lines", () => {
    expect(parseDoc("---   \ntitle: T\n---   \n\nBody.\n")).toEqual({
      meta: { title: "T" },
      body: "Body.\n",
      error: null,
    });
  });

  it("rejects frontmatter that is not a mapping, keeping the body", () => {
    expect(parseDoc("---\n5\n---\nbody\n").error).toBe("yaml: frontmatter must be a mapping");
    expect(parseDoc("---\n- a\n- b\n---\nbody\n").error).toBe("yaml: frontmatter must be a mapping");
    expect(parseDoc("---\n5\n---\nbody\n").body).toBe("body\n");
  });

  it("includes a line number in a yaml error so the editor can point at it", () => {
    const doc = parseDoc("---\ntitle: T\nbad: [unclosed\n---\n\nBody.\n");
    expect(doc.error).toMatch(/line \d+/);
    expect(doc.body).toBe("Body.\n");
  });

  it("reports a non-string argument instead of coercing it", () => {
    expect(parseDoc({ foo: 1 })).toEqual({ meta: {}, body: "", error: "expected a string" });
    expect(parseDoc(123).error).toBe("expected a string");
  });

  it("never throws, whatever the argument", () => {
    for (const v of [undefined, null, "", 0, 123, {}, [], true, () => {}]) {
      expect(() => parseDoc(v)).not.toThrow();
    }
  });

  it("leaves a --- rule in the body alone when real frontmatter is present", () => {
    const doc = parseDoc("---\ntitle: T\n---\n\nIntro.\n\n---\n\nOutro.\n");
    expect(doc.meta).toEqual({ title: "T" });
    expect(doc.body).toBe("Intro.\n\n---\n\nOutro.\n");
  });

  it("documents the leading-rule ambiguity every frontmatter parser shares", () => {
    // A document with NO frontmatter whose first line is a `---` rule has the text up
    // to the next `---` read as frontmatter. Intended, matching Jekyll/Hugo/gray-matter
    // — pinned here so a refactor cannot change it silently.
    const doc = parseDoc("---\n\nkey: value\n\n---\n\nMore text.\n");
    expect(doc.meta).toEqual({ key: "value" });
    expect(doc.body).toBe("More text.\n");
  });
});

describe("serialiseDoc", () => {
  it("writes frontmatter then body", () => {
    const out = serialiseDoc({ meta: { title: "Rondo 4v2", minutes: 10 }, body: "Keep the ball.\n" });
    expect(out).toBe("---\ntitle: Rondo 4v2\nminutes: 10\n---\n\nKeep the ball.\n");
  });

  it("omits the fence when there is no metadata", () => {
    expect(serialiseDoc({ meta: {}, body: "notes\n" })).toBe("notes\n");
  });

  it("round-trips a document through parse and serialise", () => {
    const src = "---\ntitle: Rondo 4v2\nminutes: 10\ntags:\n  - possession\n---\n\nKeep the ball.\n";
    const once = serialiseDoc(parseDoc(src));
    expect(serialiseDoc(parseDoc(once))).toBe(once);
    expect(parseDoc(once).meta).toEqual({ title: "Rondo 4v2", minutes: 10, tags: ["possession"] });
  });
});
