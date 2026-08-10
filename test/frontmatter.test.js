import { describe, it, expect } from "vitest";
import { parseDoc } from "../src/lib/frontmatter.js";

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
});
