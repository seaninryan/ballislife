import { describe, it, expect } from "vitest";
import { parseHash, formatHash } from "../src/lib/route.js";

describe("parseHash", () => {
  it("reads the browse view by default", () => {
    for (const h of ["", "#", "#/", undefined, null, "#/nonsense"]) {
      expect(parseHash(h)).toEqual({ view: "browse", slug: null });
    }
  });

  it("reads a drill to read", () => {
    expect(parseHash("#/drill/rondo-4v2")).toEqual({ view: "read", slug: "rondo-4v2" });
  });

  it("reads a drill to edit", () => {
    expect(parseHash("#/drill/rondo-4v2/edit")).toEqual({ view: "edit", slug: "rondo-4v2" });
  });

  it("decodes a percent-encoded slug", () => {
    expect(parseHash("#/drill/a%20b")).toEqual({ view: "read", slug: "a b" });
  });

  it("survives a malformed escape rather than throwing", () => {
    expect(() => parseHash("#/drill/%E0%A4%A")).not.toThrow();
    expect(parseHash("#/drill/%E0%A4%A").view).toBe("read");
  });

  it("ignores a trailing slash", () => {
    expect(parseHash("#/drill/x/")).toEqual({ view: "read", slug: "x" });
  });

  it("treats an empty slug as browse, not as a drill named edit", () => {
    // filter(Boolean) collapsed the empty segment and read "edit" as the slug.
    expect(parseHash("#/drill//edit")).toEqual({ view: "browse", slug: null });
    expect(parseHash("#/drill/")).toEqual({ view: "browse", slug: null });
  });
});

describe("formatHash", () => {
  it("formats each view", () => {
    expect(formatHash({ view: "browse" })).toBe("#/");
    expect(formatHash({ view: "read", slug: "rondo-4v2" })).toBe("#/drill/rondo-4v2");
    expect(formatHash({ view: "edit", slug: "rondo-4v2" })).toBe("#/drill/rondo-4v2/edit");
  });

  it("encodes a slug that needs it", () => {
    expect(formatHash({ view: "read", slug: "a b" })).toBe("#/drill/a%20b");
  });

  it("falls back to browse without a slug", () => {
    expect(formatHash({ view: "read", slug: null })).toBe("#/");
  });

  it("round-trips every view", () => {
    for (const route of [
      { view: "browse", slug: null },
      { view: "read", slug: "rondo-4v2" },
      { view: "edit", slug: "a b" },
    ]) {
      expect(parseHash(formatHash(route))).toEqual(route);
    }
  });
});
