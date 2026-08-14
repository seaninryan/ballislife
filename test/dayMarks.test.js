import { describe, it, expect } from "vitest";
import { createDayMarks, mergeSides, sameMarks } from "../src/lib/dayMarks.js";

// A made-up key, field and states, so the shared store is specified in its own right rather
// than only through progress or attendance.
const KEY = "test_marks";
const YES = "yes";
const NO = "no";
const store = createDayMarks({ storageKey: KEY, field: "register", states: [YES, NO] });

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe("local storage", () => {
  it("round-trips within a day", () => {
    const s = fakeStorage();
    store.writeMarks(s, "sess", "2026-08-13", { a: YES, b: NO });
    expect(store.readMarks(s, "sess", "2026-08-13")).toEqual({ a: YES, b: NO });
  });

  it("an entry for another day reads as nothing", () => {
    const s = fakeStorage();
    store.writeMarks(s, "sess", "2026-08-13", { a: YES });
    expect(store.readMarks(s, "sess", "2026-08-14")).toEqual({});
    expect(store.readStamp(s, "sess", "2026-08-14")).toBe(null);
  });

  it("writes under its own key, so two stores never collide", () => {
    const s = fakeStorage();
    const other = createDayMarks({ storageKey: "other_marks", field: "register", states: [YES] });
    store.writeMarks(s, "sess", "d", { a: YES });
    other.writeMarks(s, "sess", "d", { b: YES });
    expect(store.readMarks(s, "sess", "d")).toEqual({ a: YES });
    expect(other.readMarks(s, "sess", "d")).toEqual({ b: YES });
  });

  it("evicts other days when it writes: the local copy is a cache, not the record", () => {
    const s = fakeStorage();
    store.writeMarks(s, "old", "2026-08-01", { a: YES });
    store.writeMarks(s, "new", "2026-08-13", { a: YES });
    expect(store.readMarks(s, "old", "2026-08-01")).toEqual({});
  });

  it("keeps a stamped clear as a tombstone, so this device knows WHEN it was cleared", () => {
    const s = fakeStorage();
    store.writeMarks(s, "x", "d", { a: YES }, "2026-08-13T19:00:00.000Z");
    store.writeMarks(s, "x", "d", {}, "2026-08-13T20:00:00.000Z");
    expect(store.localSide(s, "x", "d")).toEqual({ marks: {}, updatedAt: "2026-08-13T20:00:00.000Z" });
  });

  it("an unstamped clear forgets the day entirely: there is no time worth remembering", () => {
    const s = fakeStorage();
    store.writeMarks(s, "x", "d", { a: YES }, "2026-08-13T19:00:00.000Z");
    store.writeMarks(s, "x", "d", {});
    expect(store.localSide(s, "x", "d")).toBe(null);
  });

  it("ignores states it does not recognise, and reads back a stamp", () => {
    const s = fakeStorage();
    store.writeMarks(s, "x", "d", { a: "maybe", b: YES }, "2026-08-13T19:04:12.000Z");
    expect(store.readMarks(s, "x", "d")).toEqual({ b: YES });
    expect(store.readStamp(s, "x", "d")).toBe("2026-08-13T19:04:12.000Z");
  });

  it("accepts any non-empty key, and drops an empty one on the way out", () => {
    const s = fakeStorage();
    store.writeMarks(s, "x", "d", { "player id with spaces": YES, "": YES });
    expect(store.readMarks(s, "x", "d")).toEqual({ "player id with spaces": YES });
  });

  it("survives corrupt, absent and refusing storage", () => {
    const s = fakeStorage();
    s.setItem(KEY, "{{{ not json");
    expect(store.readMarks(s, "x", "d")).toEqual({});
    expect(store.readMarks(null, "x", "d")).toEqual({});
    expect(() => store.writeMarks(null, "x", "d", { a: YES })).not.toThrow();
    const throwing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => store.writeMarks(throwing, "x", "d", { a: YES })).not.toThrow();
  });

  it("reads an entry written before stamps existed, with no stamp", () => {
    const s = fakeStorage();
    s.setItem(KEY, JSON.stringify({ x: { date: "d", marks: { a: YES } } }));
    expect(store.localSide(s, "x", "d")).toEqual({ marks: { a: YES }, updatedAt: null });
  });
});

describe("localSide", () => {
  it("is null when this device has nothing, which is not the same as no marks", () => {
    const s = fakeStorage();
    expect(store.localSide(s, "x", "d")).toBe(null);
    expect(store.localSide(null, "x", "d")).toBe(null);
    store.writeMarks(s, "x", "other-day", { a: YES }, "2026-08-12T19:00:00.000Z");
    expect(store.localSide(s, "x", "d")).toBe(null);
  });
});

describe("localSides", () => {
  it("reads every session's side for the day from one parse of storage", () => {
    const s = fakeStorage();
    s.setItem(KEY, JSON.stringify({
      a: { date: "d", marks: { x: YES }, updatedAt: "2026-08-13T19:00:00.000Z" },
      b: { date: "other", marks: { x: YES } },
    }));
    expect(store.localSides(s, "d"))
      .toEqual({ a: { marks: { x: YES }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    expect(store.localSides(s, "d").b).toBeUndefined();
    expect(store.localSides(null, "d")).toEqual({});
  });
});

describe("the session-embedded shape", () => {
  const session = (register) => ({ id: "s1", blocks: [], register });

  it("reads a day's marks and stamp out of its own field on the session", () => {
    const s = session({ d: { marks: { a: NO }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    expect(store.sessionSide(s, "d")).toEqual({ marks: { a: NO }, updatedAt: "2026-08-13T19:00:00.000Z" });
  });

  it("a session with nothing at all, or nothing for this day, reads as null", () => {
    expect(store.sessionSide(session(undefined), "d")).toBe(null);
    expect(store.sessionSide(session({}), "d")).toBe(null);
    expect(store.sessionSide(undefined, "d")).toBe(null);
  });

  it("discards junk rather than trusting the file: bad states, an empty key, a bad stamp", () => {
    const s = session({ d: { marks: { a: YES, b: "eaten", "": YES }, updatedAt: 7 } });
    expect(store.sessionSide(s, "d")).toEqual({ marks: { a: YES }, updatedAt: null });
  });

  it("writes a day without touching another day or the rest of the session", () => {
    const s = session({ old: { marks: { a: YES }, updatedAt: "2026-08-12T19:00:00.000Z" } });
    const next = store.withSessionSide(s, "d", { b: NO }, "2026-08-13T19:04:12.000Z");
    expect(next.register.old).toEqual(s.register.old);
    expect(next.register.d).toEqual({ marks: { b: NO }, updatedAt: "2026-08-13T19:04:12.000Z" });
    expect(next.blocks).toBe(s.blocks);
    expect(s.register.d).toBeUndefined(); // the input is not mutated
  });

  it("clearing every mark leaves a stamped empty entry, so the clear beats the other device", () => {
    const s = session({ d: { marks: { a: YES }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    const next = store.withSessionSide(s, "d", {}, "2026-08-13T20:00:00.000Z");
    expect(next.register.d).toEqual({ marks: {}, updatedAt: "2026-08-13T20:00:00.000Z" });
  });

  it("works on a session that has no such field yet", () => {
    const next = store.withSessionSide(session(undefined), "d", { a: YES }, "2026-08-13T19:04:12.000Z");
    expect(next.register.d).toEqual({ marks: { a: YES }, updatedAt: "2026-08-13T19:04:12.000Z" });
  });
});

describe("mergeSides", () => {
  const at = (t) => `2026-08-13T${t}:00.000Z`;

  it("takes whichever side was written later", () => {
    const local = { marks: { a: YES }, updatedAt: at("19:00") };
    const remote = { marks: { a: YES, b: YES }, updatedAt: at("20:00") };
    expect(mergeSides(local, remote).marks).toEqual({ a: YES, b: YES });
    expect(mergeSides(remote, local).marks).toEqual({ a: YES, b: YES });
  });

  it("keeps an un-marking done later, which a per-key merge could not", () => {
    const local = { marks: {}, updatedAt: at("20:00") };
    const remote = { marks: { a: YES }, updatedAt: at("19:00") };
    expect(mergeSides(local, remote).marks).toEqual({});
  });

  it("uses the side that has a stamp when the other does not", () => {
    const stamped = { marks: { b: YES }, updatedAt: at("19:00") };
    const unstamped = { marks: { a: YES }, updatedAt: null };
    expect(mergeSides(unstamped, stamped).marks).toEqual({ b: YES });
    expect(mergeSides(stamped, unstamped).marks).toEqual({ b: YES });
  });

  it("prefers local on a tie, so an equal timestamp causes no pointless write", () => {
    const local = { marks: { a: YES }, updatedAt: at("19:00") };
    const remote = { marks: { b: YES }, updatedAt: at("19:00") };
    expect(mergeSides(local, remote).marks).toEqual({ a: YES });
  });

  it("handles one side, or neither, being absent", () => {
    const local = { marks: { a: YES }, updatedAt: at("19:00") };
    expect(mergeSides(local, null)).toBe(local);
    expect(mergeSides(null, local)).toBe(local);
    expect(mergeSides(null, null)).toEqual({ marks: {}, updatedAt: null });
  });

  it("treats an unparseable stamp as no stamp rather than as the epoch", () => {
    const bad = { marks: { a: YES }, updatedAt: "whenever" };
    const good = { marks: { b: YES }, updatedAt: at("19:00") };
    expect(mergeSides(bad, good).marks).toEqual({ b: YES });
  });

  describe("a device with a badly wrong clock", () => {
    const now = Date.parse(at("21:00"));

    it("cannot silence the other device forever with a stamp far in the future", () => {
      const fast = { marks: { a: YES }, updatedAt: "2027-01-01T00:00:00.000Z" };
      const real = { marks: { b: YES }, updatedAt: at("21:00") };
      expect(mergeSides(fast, real, now).marks).toEqual({ b: YES });
      expect(mergeSides(real, fast, now).marks).toEqual({ b: YES });
    });

    it("still trusts a stamp only slightly ahead: clocks are routinely a little off", () => {
      const ahead = { marks: { a: YES }, updatedAt: "2026-08-14T02:00:00.000Z" };
      const real = { marks: { b: YES }, updatedAt: at("21:00") };
      expect(mergeSides(real, ahead, now).marks).toEqual({ a: YES });
    });

    it("falls back to local when both sides are impossible, rather than picking at random", () => {
      const fast = { marks: { a: YES }, updatedAt: "2027-01-01T00:00:00.000Z" };
      const faster = { marks: { b: YES }, updatedAt: "2028-01-01T00:00:00.000Z" };
      expect(mergeSides(fast, faster, now).marks).toEqual({ a: YES });
    });

    it("judges against the real clock when no time is given", () => {
      const fast = { marks: { a: YES }, updatedAt: "2999-01-01T00:00:00.000Z" };
      const real = { marks: { b: YES }, updatedAt: new Date().toISOString() };
      expect(mergeSides(fast, real).marks).toEqual({ b: YES });
    });
  });
});

describe("sameMarks", () => {
  it("compares by value, so a reconciliation that changes nothing can be skipped", () => {
    expect(sameMarks({ a: YES }, { a: YES })).toBe(true);
    expect(sameMarks({}, {})).toBe(true);
    expect(sameMarks({ a: YES }, { a: NO })).toBe(false);
    expect(sameMarks({ a: YES }, { a: YES, b: YES })).toBe(false);
    expect(sameMarks({ a: YES, b: YES }, { a: YES })).toBe(false);
    expect(sameMarks(null, undefined)).toBe(true);
  });

  it("does not care whether a key was written as a number or a string", () => {
    expect(sameMarks({ 0: YES }, { "0": YES })).toBe(true);
  });
});
