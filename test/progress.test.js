import { describe, it, expect } from "vitest";
import {
  DONE, SKIPPED, readProgress, writeProgress, mark, reopen, currentIndex, counts,
  readStamp, sessionProgress, withSessionProgress, mergeProgress, sameMarks,
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

describe("local entries carry a timestamp", () => {
  it("writeProgress records when the marks were made, and readStamp reads it back", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-13", { 0: DONE }, "2026-08-13T19:04:12.000Z");
    expect(readProgress(store, "s1", "2026-08-13")).toEqual({ 0: DONE });
    expect(readStamp(store, "s1", "2026-08-13")).toBe("2026-08-13T19:04:12.000Z");
  });

  it("an entry written before this feature existed still loads, with no stamp", () => {
    const store = fakeStorage();
    store.setItem("ballislife_progress", JSON.stringify({
      s1: { date: "2026-08-13", marks: { 0: DONE } },
    }));
    expect(readProgress(store, "s1", "2026-08-13")).toEqual({ 0: DONE });
    expect(readStamp(store, "s1", "2026-08-13")).toBe(null);
  });

  it("readStamp ignores another day's entry, exactly as readProgress does", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-12", { 0: DONE }, "2026-08-12T19:00:00.000Z");
    expect(readStamp(store, "s1", "2026-08-13")).toBe(null);
  });
});

describe("progress stored on the session itself", () => {
  const session = (progress) => ({ id: "s1", date: "2026-08-13", blocks: [], progress });

  it("reads a day's marks and stamp out of a session", () => {
    const s = session({ "2026-08-13": { marks: { 1: SKIPPED }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    expect(sessionProgress(s, "2026-08-13")).toEqual({
      marks: { 1: SKIPPED }, updatedAt: "2026-08-13T19:00:00.000Z",
    });
  });

  it("a session with no progress at all, or none for this day, reads as nothing", () => {
    expect(sessionProgress(session(undefined), "2026-08-13")).toBe(null);
    expect(sessionProgress(session({}), "2026-08-13")).toBe(null);
    expect(sessionProgress(undefined, "2026-08-13")).toBe(null);
  });

  it("discards junk rather than trusting the file: bad marks, bad keys, bad states", () => {
    const s = session({ "2026-08-13": { marks: { 0: DONE, 1: "eaten", x: DONE }, updatedAt: 7 } });
    expect(sessionProgress(s, "2026-08-13")).toEqual({ marks: { 0: DONE }, updatedAt: null });
  });

  it("writes a day's marks into a session without touching another day or the blocks", () => {
    const s = session({ "2026-08-12": { marks: { 0: DONE }, updatedAt: "2026-08-12T19:00:00.000Z" } });
    const next = withSessionProgress(s, "2026-08-13", { 1: SKIPPED }, "2026-08-13T19:04:12.000Z");
    expect(next.progress["2026-08-12"]).toEqual(s.progress["2026-08-12"]);
    expect(next.progress["2026-08-13"]).toEqual({
      marks: { 1: SKIPPED }, updatedAt: "2026-08-13T19:04:12.000Z",
    });
    expect(next.blocks).toBe(s.blocks);
    expect(s.progress["2026-08-13"]).toBeUndefined(); // the input is not mutated
  });

  it("clearing every mark removes the day rather than storing an empty object", () => {
    const s = session({ "2026-08-13": { marks: { 0: DONE }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    const next = withSessionProgress(s, "2026-08-13", {}, "2026-08-13T20:00:00.000Z");
    expect(next.progress["2026-08-13"]).toBeUndefined();
  });

  it("works on a session that has no progress key yet", () => {
    const next = withSessionProgress(session(undefined), "2026-08-13", { 0: DONE }, "T");
    expect(next.progress["2026-08-13"].marks).toEqual({ 0: DONE });
  });
});

describe("mergeProgress", () => {
  const at = (t) => `2026-08-13T${t}:00.000Z`;

  it("takes whichever side was written later", () => {
    const local = { marks: { 0: DONE }, updatedAt: at("19:00") };
    const remote = { marks: { 0: DONE, 1: DONE }, updatedAt: at("20:00") };
    expect(mergeProgress(local, remote).marks).toEqual({ 0: DONE, 1: DONE });
    expect(mergeProgress(remote, local).marks).toEqual({ 0: DONE, 1: DONE });
  });

  it("keeps an un-marking done later, which a per-block merge could not", () => {
    // "Not done" is the ABSENCE of a key. A union would silently resurrect the mark.
    const local = { marks: {}, updatedAt: at("20:00") };
    const remote = { marks: { 0: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(local, remote).marks).toEqual({});
  });

  it("uses the side that has a stamp when the other does not", () => {
    const stamped = { marks: { 1: DONE }, updatedAt: at("19:00") };
    const unstamped = { marks: { 0: DONE }, updatedAt: null };
    expect(mergeProgress(unstamped, stamped).marks).toEqual({ 1: DONE });
    expect(mergeProgress(stamped, unstamped).marks).toEqual({ 1: DONE });
  });

  it("prefers local on a tie, so an equal timestamp does not cause a pointless write", () => {
    const local = { marks: { 0: DONE }, updatedAt: at("19:00") };
    const remote = { marks: { 1: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(local, remote).marks).toEqual({ 0: DONE });
  });

  it("handles one side, or neither, being absent", () => {
    const local = { marks: { 0: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(local, null)).toBe(local);
    expect(mergeProgress(null, local)).toBe(local);
    expect(mergeProgress(null, null)).toEqual({ marks: {}, updatedAt: null });
  });

  it("treats an unparseable stamp as no stamp rather than as the epoch", () => {
    const bad = { marks: { 0: DONE }, updatedAt: "whenever" };
    const good = { marks: { 1: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(bad, good).marks).toEqual({ 1: DONE });
  });
});

describe("sameMarks", () => {
  it("compares by value, so a reconciliation that changes nothing can be skipped", () => {
    expect(sameMarks({ 0: DONE }, { 0: DONE })).toBe(true);
    expect(sameMarks({}, {})).toBe(true);
    expect(sameMarks({ 0: DONE }, { 0: SKIPPED })).toBe(false);
    expect(sameMarks({ 0: DONE }, { 0: DONE, 1: DONE })).toBe(false);
    expect(sameMarks({ 0: DONE, 1: DONE }, { 0: DONE })).toBe(false);
  });

  it("does not care whether an index is a number or a string key", () => {
    // readProgress yields numeric keys; JSON round-tripping yields strings.
    expect(sameMarks({ 0: DONE }, { "0": DONE })).toBe(true);
  });
});
