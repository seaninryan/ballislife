import { describe, it, expect } from "vitest";
import {
  DONE, SKIPPED, readProgress, writeProgress, mark, reopen, currentIndex, counts,
  readStamp, localProgress, sessionProgress, withSessionProgress, mergeProgress, sameMarks,
  blockKey, migrateMarks,
} from "../src/lib/progress.js";

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

const B = (...slots) => slots.map((slot) => ({ slot }));
const five = B("warmup", "skill", "tactical", "match", "fun");

describe("blockKey", () => {
  it("is the block's slot, which survives a reorder", () => {
    expect(blockKey({ slot: "warmup" }, 3)).toBe("warmup");
  });

  it("falls back to a positional key for a block with no usable slot", () => {
    // Only reachable through a hand-edited sessions file. Each such block still gets its
    // own key, rather than all of them sharing one.
    expect(blockKey({ slot: "  " }, 3)).toBe("#3");
    expect(blockKey({}, 0)).toBe("#0");
    expect(blockKey(undefined, 2)).toBe("#2");
  });
});

describe("currentIndex", () => {
  it("is the first block not yet settled", () => {
    expect(currentIndex({}, five)).toBe(0);
    expect(currentIndex({ warmup: DONE }, five)).toBe(1);
    expect(currentIndex({ warmup: DONE, skill: SKIPPED }, five)).toBe(2);
  });

  it("does not skip a gap: an unsettled block before a settled one is still current", () => {
    expect(currentIndex({ warmup: DONE, tactical: DONE }, five)).toBe(1);
  });

  it("is -1 when every block is settled, or when there are no blocks", () => {
    expect(currentIndex({ warmup: DONE, skill: SKIPPED }, B("warmup", "skill"))).toBe(-1);
    expect(currentIndex({}, [])).toBe(-1);
    expect(currentIndex({}, undefined)).toBe(-1);
  });

  it("follows the drill, not the position: reordering does not move a mark", () => {
    // The bug this change exists to fix. warmup is done; moving skill to the front must
    // leave warmup done and make skill current, not resurrect warmup as current.
    const marks = { warmup: DONE };
    expect(currentIndex(marks, five)).toBe(1);
    expect(currentIndex(marks, B("skill", "warmup", "tactical", "match", "fun"))).toBe(0);
  });
});

describe("mark and reopen", () => {
  it("marks done and skipped without mutating", () => {
    const before = {};
    const after = mark(before, "warmup", DONE);
    expect(after.warmup).toBe(DONE);
    expect(before).toEqual({});
  });

  it("reopening makes a block current again", () => {
    const m = reopen(mark({}, "warmup", DONE), "warmup");
    expect(m.warmup).toBeUndefined();
    expect(currentIndex(m, five)).toBe(0);
  });
});

describe("counts", () => {
  it("counts by slot, so a reorder does not change the tally", () => {
    const marks = { warmup: DONE, skill: SKIPPED };
    expect(counts(marks, five)).toEqual({ done: 1, skipped: 1, remaining: 3 });
    expect(counts(marks, B("fun", "match", "tactical", "skill", "warmup")))
      .toEqual({ done: 1, skipped: 1, remaining: 3 });
  });

  it("handles no blocks", () => {
    expect(counts({}, [])).toEqual({ done: 0, skipped: 0, remaining: 0 });
  });
});

describe("migrateMarks", () => {
  it("maps an index-keyed mark onto the slot at that index", () => {
    expect(migrateMarks({ 0: DONE, 1: SKIPPED }, five)).toEqual({ warmup: DONE, skill: SKIPPED });
  });

  it("is a no-op on marks that are already slot-keyed, and is idempotent", () => {
    expect(migrateMarks({ warmup: DONE }, five)).toEqual({ warmup: DONE });
    const once = migrateMarks({ 0: DONE, 1: SKIPPED }, five);
    expect(migrateMarks(once, five)).toEqual(once);
  });

  it("prefers an existing slot key over the index that maps to it, in either key order", () => {
    expect(migrateMarks({ 0: DONE, warmup: SKIPPED }, five)).toEqual({ warmup: SKIPPED });
    expect(migrateMarks({ warmup: SKIPPED, 0: DONE }, five)).toEqual({ warmup: SKIPPED });
  });

  it("drops a mark that points past the end of the plan", () => {
    expect(migrateMarks({ 9: DONE }, five)).toEqual({});
  });

  it("drops an unknown state, and survives junk input", () => {
    expect(migrateMarks({ 0: "eaten", 1: DONE }, five)).toEqual({ skill: DONE });
    expect(migrateMarks(undefined, five)).toEqual({});
    expect(migrateMarks({ 0: DONE }, undefined)).toEqual({});
  });

  it("gives a slot-less block a positional key", () => {
    expect(migrateMarks({ 0: DONE }, B(""))).toEqual({ "#0": DONE });
  });
});

describe("storage", () => {
  it("round-trips within a day", () => {
    const s = fakeStorage();
    writeProgress(s, "sess", "2026-08-13", { warmup: DONE, skill: SKIPPED });
    expect(readProgress(s, "sess", "2026-08-13")).toEqual({ warmup: DONE, skill: SKIPPED });
  });

  it("clears itself the next day, so a re-run starts clean", () => {
    const s = fakeStorage();
    writeProgress(s, "sess", "2026-08-13", { warmup: DONE });
    expect(readProgress(s, "sess", "2026-08-14")).toEqual({});
  });

  it("evicts other days when it writes", () => {
    const s = fakeStorage();
    writeProgress(s, "old", "2026-08-01", { warmup: DONE });
    writeProgress(s, "new", "2026-08-13", { warmup: DONE });
    expect(readProgress(s, "old", "2026-08-01")).toEqual({});
  });

  it("removes the entry when nothing is marked", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "d", { warmup: DONE });
    writeProgress(s, "x", "d", {});
    expect(readProgress(s, "x", "d")).toEqual({});
  });

  it("a stamped clear stays as an empty entry, so this device knows WHEN it was cleared", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "2026-08-13", { warmup: DONE }, "2026-08-13T19:00:00.000Z");
    writeProgress(s, "x", "2026-08-13", {}, "2026-08-13T20:00:00.000Z");
    expect(localProgress(s, "x", "2026-08-13"))
      .toEqual({ marks: {}, updatedAt: "2026-08-13T20:00:00.000Z" });
  });

  it("an unstamped clear forgets the day entirely: there is no time worth remembering", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "2026-08-13", { warmup: DONE }, "2026-08-13T19:00:00.000Z");
    writeProgress(s, "x", "2026-08-13", {});
    expect(localProgress(s, "x", "2026-08-13")).toBe(null);
  });

  it("ignores states it does not recognise", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "d", { warmup: "weird", skill: DONE });
    expect(readProgress(s, "x", "d")).toEqual({ skill: DONE });
  });

  it("survives corrupt, absent and refusing storage", () => {
    const s = fakeStorage();
    s.setItem("ballislife_progress", "{{{ not json");
    expect(readProgress(s, "x", "d")).toEqual({});
    expect(readProgress(null, "x", "d")).toEqual({});
    expect(() => writeProgress(null, "x", "d", { warmup: DONE })).not.toThrow();
    const throwing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeProgress(throwing, "x", "d", { warmup: DONE })).not.toThrow();
  });
});

describe("local entries carry a timestamp", () => {
  it("writeProgress records when the marks were made, and readStamp reads it back", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-13", { warmup: DONE }, "2026-08-13T19:04:12.000Z");
    expect(readProgress(store, "s1", "2026-08-13")).toEqual({ warmup: DONE });
    expect(readStamp(store, "s1", "2026-08-13")).toBe("2026-08-13T19:04:12.000Z");
  });

  it("an entry written before this feature existed still loads, with no stamp", () => {
    const store = fakeStorage();
    store.setItem("ballislife_progress", JSON.stringify({
      s1: { date: "2026-08-13", marks: { warmup: DONE } },
    }));
    expect(readProgress(store, "s1", "2026-08-13")).toEqual({ warmup: DONE });
    expect(readStamp(store, "s1", "2026-08-13")).toBe(null);
  });

  it("readStamp ignores another day's entry, exactly as readProgress does", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-12", { warmup: DONE }, "2026-08-12T19:00:00.000Z");
    expect(readStamp(store, "s1", "2026-08-13")).toBe(null);
  });
});

describe("localProgress", () => {
  it("reads one session-day as a merge-ready side", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-13", { warmup: DONE }, "2026-08-13T19:00:00.000Z");
    expect(localProgress(store, "s1", "2026-08-13"))
      .toEqual({ marks: { warmup: DONE }, updatedAt: "2026-08-13T19:00:00.000Z" });
  });

  it("is null when this device has nothing for the day, so the other side can simply win", () => {
    const store = fakeStorage();
    expect(localProgress(store, "s1", "2026-08-13")).toBe(null);
    writeProgress(store, "s1", "2026-08-12", { warmup: DONE }, "2026-08-12T19:00:00.000Z");
    expect(localProgress(store, "s1", "2026-08-13")).toBe(null);
    expect(localProgress(null, "s1", "2026-08-13")).toBe(null);
  });

  it("distinguishes a cleared day from an untouched one", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-13", {}, "2026-08-13T20:00:00.000Z");
    expect(localProgress(store, "s1", "2026-08-13"))
      .toEqual({ marks: {}, updatedAt: "2026-08-13T20:00:00.000Z" });
  });

  it("reads an entry written before stamps existed, with no stamp", () => {
    const store = fakeStorage();
    store.setItem("ballislife_progress", JSON.stringify({
      s1: { date: "2026-08-13", marks: { warmup: DONE } },
    }));
    expect(localProgress(store, "s1", "2026-08-13")).toEqual({ marks: { warmup: DONE }, updatedAt: null });
  });
});

describe("progress stored on the session itself", () => {
  const session = (progress) => ({ id: "s1", date: "2026-08-13", blocks: [], progress });

  it("reads a day's marks and stamp out of a session", () => {
    const s = session({ "2026-08-13": { marks: { skill: SKIPPED }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    expect(sessionProgress(s, "2026-08-13")).toEqual({
      marks: { skill: SKIPPED }, updatedAt: "2026-08-13T19:00:00.000Z",
    });
  });

  it("a session with no progress at all, or none for this day, reads as nothing", () => {
    expect(sessionProgress(session(undefined), "2026-08-13")).toBe(null);
    expect(sessionProgress(session({}), "2026-08-13")).toBe(null);
    expect(sessionProgress(undefined, "2026-08-13")).toBe(null);
  });

  it("discards junk rather than trusting the file: bad marks, bad states, an empty key", () => {
    // A key is NOT checked against the session's slots — this function does not have the
    // session, and a mark for a slot that no longer exists is simply never read.
    const s = session({ "2026-08-13": { marks: { warmup: DONE, skill: "eaten", "": DONE }, updatedAt: 7 } });
    expect(sessionProgress(s, "2026-08-13")).toEqual({ marks: { warmup: DONE }, updatedAt: null });
  });

  it("writes a day's marks into a session without touching another day or the blocks", () => {
    const s = session({ "2026-08-12": { marks: { warmup: DONE }, updatedAt: "2026-08-12T19:00:00.000Z" } });
    const next = withSessionProgress(s, "2026-08-13", { skill: SKIPPED }, "2026-08-13T19:04:12.000Z");
    expect(next.progress["2026-08-12"]).toEqual(s.progress["2026-08-12"]);
    expect(next.progress["2026-08-13"]).toEqual({
      marks: { skill: SKIPPED }, updatedAt: "2026-08-13T19:04:12.000Z",
    });
    expect(next.blocks).toBe(s.blocks);
    expect(s.progress["2026-08-13"]).toBeUndefined(); // the input is not mutated
  });

  it("clearing every mark leaves a stamped empty entry, so the clear can beat the other device", () => {
    // A deleted day and a day nobody has touched are indistinguishable, and the other
    // device's older marks would then win the merge and come back.
    const s = session({ "2026-08-13": { marks: { warmup: DONE }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    const next = withSessionProgress(s, "2026-08-13", {}, "2026-08-13T20:00:00.000Z");
    expect(next.progress["2026-08-13"]).toEqual({ marks: {}, updatedAt: "2026-08-13T20:00:00.000Z" });
  });

  it("works on a session that has no progress key yet", () => {
    const next = withSessionProgress(session(undefined), "2026-08-13", { warmup: DONE }, "2026-08-13T19:04:12.000Z");
    expect(next.progress["2026-08-13"])
      .toEqual({ marks: { warmup: DONE }, updatedAt: "2026-08-13T19:04:12.000Z" });
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

  describe("a device with a badly wrong clock", () => {
    const now = Date.parse(at("21:00"));

    it("cannot silence the other device forever with a stamp far in the future", () => {
      // Otherwise the fast device's marks win every reconcile, permanently, and the coach
      // has no way to notice — so a wild stamp counts as no stamp at all.
      const fast = { marks: { 0: DONE }, updatedAt: "2027-01-01T00:00:00.000Z" };
      const real = { marks: { 1: DONE }, updatedAt: at("21:00") };
      expect(mergeProgress(fast, real, now).marks).toEqual({ 1: DONE });
      expect(mergeProgress(real, fast, now).marks).toEqual({ 1: DONE });
    });

    it("still trusts a stamp only slightly ahead: clocks are routinely a little off", () => {
      const ahead = { marks: { 0: DONE }, updatedAt: "2026-08-14T02:00:00.000Z" };
      const real = { marks: { 1: DONE }, updatedAt: at("21:00") };
      expect(mergeProgress(real, ahead, now).marks).toEqual({ 0: DONE });
    });

    it("falls back to local when both sides are impossible, rather than picking at random", () => {
      const fast = { marks: { 0: DONE }, updatedAt: "2027-01-01T00:00:00.000Z" };
      const faster = { marks: { 1: DONE }, updatedAt: "2028-01-01T00:00:00.000Z" };
      expect(mergeProgress(fast, faster, now).marks).toEqual({ 0: DONE });
    });

    it("judges against the real clock when no time is given", () => {
      const fast = { marks: { 0: DONE }, updatedAt: "2999-01-01T00:00:00.000Z" };
      const real = { marks: { 1: DONE }, updatedAt: new Date().toISOString() };
      expect(mergeProgress(fast, real).marks).toEqual({ 1: DONE });
    });
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

  it("does not care whether a key was written as a number or a string", () => {
    // An index-keyed entry left by an older version is compared against one that has been
    // through JSON, where every key is a string.
    expect(sameMarks({ 0: DONE }, { "0": DONE })).toBe(true);
  });
});
