import { describe, it, expect } from "vitest";
import { parseHash, formatHash } from "../src/lib/route.js";

describe("parseHash", () => {
  it("reads the browse view by default", () => {
    for (const h of ["", "#", "#/", undefined, null, "#/nonsense"]) {
      expect(parseHash(h)).toEqual({ view: "browse", slug: null });
    }
  });

  it("reads the session list", () => {
    expect(parseHash("#/sessions")).toEqual({ view: "sessions", slug: null });
  });

  it("reads a single session", () => {
    expect(parseHash("#/session/2026-08-12-pressing")).toEqual({
      view: "session", slug: "2026-08-12-pressing",
    });
  });

  it("treats a session route with no id as the session list", () => {
    expect(parseHash("#/session/")).toEqual({ view: "sessions", slug: null });
    expect(parseHash("#/session")).toEqual({ view: "sessions", slug: null });
  });

  it("decodes a percent-encoded session id", () => {
    expect(parseHash("#/session/a%20b")).toEqual({ view: "session", slug: "a b" });
  });

  it("reads a session's run view", () => {
    expect(parseHash("#/session/2026-08-12-pressing/run")).toEqual({
      view: "run", slug: "2026-08-12-pressing",
    });
  });

  it("decodes a percent-encoded run slug", () => {
    expect(parseHash("#/session/a%20b/run")).toEqual({ view: "run", slug: "a b" });
  });

  it("treats an unrecognised third segment as the plain session view, not run", () => {
    expect(parseHash("#/session/x/nonsense")).toEqual({ view: "session", slug: "x" });
  });

  it("reads the squad list", () => {
    expect(parseHash("#/squads")).toEqual({ view: "squads", slug: null });
  });

  it("reads a single squad", () => {
    expect(parseHash("#/squad/u14a")).toEqual({ view: "squad", slug: "u14a" });
  });

  it("treats a squad route with no id as the squad list", () => {
    expect(parseHash("#/squad/")).toEqual({ view: "squads", slug: null });
    expect(parseHash("#/squad")).toEqual({ view: "squads", slug: null });
  });

  it("decodes a percent-encoded squad id", () => {
    expect(parseHash("#/squad/a%20b")).toEqual({ view: "squad", slug: "a b" });
  });

  it("ignores anything after a squad's id", () => {
    expect(parseHash("#/squad/u14a/nonsense")).toEqual({ view: "squad", slug: "u14a" });
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
    expect(formatHash({ view: "sessions" })).toBe("#/sessions");
    expect(formatHash({ view: "session", slug: "2026-08-12-pressing" }))
      .toBe("#/session/2026-08-12-pressing");
    expect(formatHash({ view: "run", slug: "2026-08-12-pressing" }))
      .toBe("#/session/2026-08-12-pressing/run");
    expect(formatHash({ view: "squads" })).toBe("#/squads");
    expect(formatHash({ view: "squad", slug: "u14a" })).toBe("#/squad/u14a");
  });

  it("falls back to the squad list for a squad view without a slug", () => {
    expect(formatHash({ view: "squad", slug: null })).toBe("#/squads");
  });

  it("falls back to the session list for a run view without a slug", () => {
    expect(formatHash({ view: "run", slug: null })).toBe("#/sessions");
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
      { view: "sessions", slug: null },
      { view: "session", slug: "2026-08-12-pressing" },
      { view: "session", slug: "a b" },
      { view: "run", slug: "2026-08-12-pressing" },
      { view: "run", slug: "a b" },
      { view: "squads", slug: null },
      { view: "squad", slug: "u14a" },
      { view: "squad", slug: "a b" },
    ]) {
      expect(parseHash(formatHash(route))).toEqual(route);
    }
  });
});
