import { describe, it, expect } from "vitest";
import {
  DONE, SKIPPED, readProgress, writeProgress, mark, reopen, currentIndex, counts, soFarMinutes,
} from "../src/lib/progress.js";

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe("currentIndex", () => {
  it("is the first block not yet settled", () => {
    expect(currentIndex({}, 5)).toBe(0);
    expect(currentIndex({ 0: DONE }, 5)).toBe(1);
    expect(currentIndex({ 0: DONE, 1: SKIPPED }, 5)).toBe(2);
  });

  it("finds the earliest gap when blocks are settled out of order", () => {
    expect(currentIndex({ 0: DONE, 2: DONE }, 5)).toBe(1);
  });

  it("is -1 once every block is settled", () => {
    expect(currentIndex({ 0: DONE, 1: SKIPPED }, 2)).toBe(-1);
  });
});

describe("mark and reopen", () => {
  it("marks done and skipped without mutating", () => {
    const before = {};
    const after = mark(before, 0, DONE);
    expect(after[0]).toBe(DONE);
    expect(before).toEqual({});
  });

  it("reopening makes a block current again", () => {
    const m = reopen(mark({}, 0, DONE), 0);
    expect(m[0]).toBeUndefined();
    expect(currentIndex(m, 5)).toBe(0);
  });
});

describe("counts", () => {
  it("counts done, skipped and remaining", () => {
    expect(counts({ 0: DONE, 1: SKIPPED }, 5)).toEqual({ done: 1, skipped: 1, remaining: 3 });
  });
});

describe("soFarMinutes", () => {
  const blocks = [{ minutes: 3 }, { minutes: 10 }, { minutes: 20 }, { minutes: 25 }];

  it("sums planned minutes when nothing is settled yet", () => {
    expect(soFarMinutes(blocks, {})).toEqual([3, 13, 33, 58]);
  });

  it("a skipped block contributes zero, so later totals reflect only what actually ran", () => {
    // warmup done, skill skipped, tactical current, match to come — the owner's common
    // case: skipping a 10' drill must not inflate the running total for what follows.
    expect(soFarMinutes(blocks, { 0: DONE, 1: SKIPPED })).toEqual([3, null, 23, 48]);
  });

  it("a skipped block's own slot is null, not a duplicate of the previous total", () => {
    const result = soFarMinutes(blocks, { 1: SKIPPED });
    expect(result[1]).toBeNull();
    expect(result[0]).toBe(3);
    expect(result[2]).toBe(23);
  });

  it("multiple skips in a row still exclude each of their minutes", () => {
    expect(soFarMinutes(blocks, { 1: SKIPPED, 2: SKIPPED })).toEqual([3, null, null, 28]);
  });
});

describe("storage", () => {
  it("round-trips within a day", () => {
    const s = fakeStorage();
    writeProgress(s, "sess", "2026-08-13", { 0: DONE, 1: SKIPPED });
    expect(readProgress(s, "sess", "2026-08-13")).toEqual({ 0: DONE, 1: SKIPPED });
  });

  it("clears itself the next day, so a re-run starts clean", () => {
    const s = fakeStorage();
    writeProgress(s, "sess", "2026-08-13", { 0: DONE });
    expect(readProgress(s, "sess", "2026-08-14")).toEqual({});
  });

  it("evicts other days when it writes", () => {
    const s = fakeStorage();
    writeProgress(s, "old", "2026-08-01", { 0: DONE });
    writeProgress(s, "new", "2026-08-13", { 0: DONE });
    expect(readProgress(s, "old", "2026-08-01")).toEqual({});
  });

  it("removes the entry when nothing is marked", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "d", { 0: DONE });
    writeProgress(s, "x", "d", {});
    expect(readProgress(s, "x", "d")).toEqual({});
  });

  it("ignores states it does not recognise", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "d", { 0: "weird", 1: DONE });
    expect(readProgress(s, "x", "d")).toEqual({ 1: DONE });
  });

  it("survives corrupt, absent and refusing storage", () => {
    const s = fakeStorage();
    s.setItem("ballislife_progress", "{{{ not json");
    expect(readProgress(s, "x", "d")).toEqual({});
    expect(readProgress(null, "x", "d")).toEqual({});
    expect(() => writeProgress(null, "x", "d", { 0: DONE })).not.toThrow();
    const throwing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeProgress(throwing, "x", "d", { 0: DONE })).not.toThrow();
  });
});
