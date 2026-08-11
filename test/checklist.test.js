import { describe, it, expect } from "vitest";
import { readStore, readTicks, writeTicks, toggle } from "../src/lib/checklist.js";

const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

describe("readTicks / writeTicks", () => {
  it("starts empty and round-trips what was written", () => {
    const s = fakeStorage();
    expect(readTicks(s, "a", "2026-08-11").size).toBe(0);
    writeTicks(s, "a", "2026-08-11", new Set([0, 2]));
    expect([...readTicks(s, "a", "2026-08-11")]).toEqual([0, 2]);
  });

  it("clears itself on a new day", () => {
    // The point of keying by day: last week's ticks must not greet you at the next
    // session, and nobody should have to clear them by hand.
    const s = fakeStorage();
    writeTicks(s, "a", "2026-08-11", new Set([0]));
    expect(readTicks(s, "a", "2026-08-12").size).toBe(0);
  });

  it("keeps drills separate", () => {
    const s = fakeStorage();
    writeTicks(s, "a", "d", new Set([0, 1]));
    writeTicks(s, "b", "d", new Set([1]));
    expect(readTicks(s, "a", "d").size).toBe(2);
    expect(readTicks(s, "b", "d").size).toBe(1);
  });

  it("removes an entry once everything is unticked", () => {
    const s = fakeStorage();
    writeTicks(s, "a", "d", new Set([0]));
    writeTicks(s, "a", "d", new Set());
    expect(readStore(s).a).toBeUndefined();
  });

  it("evicts other days when it writes, so it cannot grow without bound", () => {
    const s = fakeStorage();
    writeTicks(s, "old", "2026-08-01", new Set([0]));
    writeTicks(s, "new", "2026-08-11", new Set([0]));
    expect(Object.keys(readStore(s))).toEqual(["new"]);
  });

  it("ignores indices that are not sane", () => {
    const s = fakeStorage();
    writeTicks(s, "a", "d", new Set([1, -1, "x", 2.5]));
    expect([...readTicks(s, "a", "d")]).toEqual([1]);
  });
});

describe("robustness", () => {
  it("survives corrupt storage", () => {
    const s = fakeStorage();
    s.setItem("ballislife_ticks", "{{{ not json");
    expect(readTicks(s, "a", "d").size).toBe(0);
  });

  it("survives storage being absent or refusing writes", () => {
    // Private browsing throws on setItem. Losing ticks is acceptable; crashing is not.
    expect(readTicks(null, "a", "d").size).toBe(0);
    expect(() => writeTicks(null, "a", "d", new Set([1]))).not.toThrow();
    const throwing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeTicks(throwing, "a", "d", new Set([1]))).not.toThrow();
  });
});

describe("toggle", () => {
  it("adds and removes", () => {
    expect([...toggle(new Set([1]), 2)]).toEqual([1, 2]);
    expect([...toggle(new Set([1, 2]), 1)]).toEqual([2]);
  });

  it("does not mutate the set it was given", () => {
    const original = new Set([1]);
    toggle(original, 2);
    expect([...original]).toEqual([1]);
  });
});
