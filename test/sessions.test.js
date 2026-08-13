import { describe, it, expect } from "vitest";
import {
  SLOTS, EMPTY, emptySession, readSessions, blockMinutes, resolveBlocks,
  totalMinutes, emptySlots, squadRange, fitsSquad, setBlock, moveBlock,
} from "../src/lib/sessions.js";

const drills = [
  { slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8" },
  { slug: "3v2", title: "3v2 to end line", category: "skill", minutes: 15, players: "8-12" },
  { slug: "ssg", title: "SSG 6v6", category: "match", minutes: 25, players: "12+" },
  { slug: "nomins", title: "No minutes", category: "fun", minutes: null, players: null },
];

describe("emptySession", () => {
  it("starts with one empty block per slot, in template order", () => {
    const s = emptySession("s1", "2026-08-12", "U12s");
    expect(s.blocks.map((b) => b.slot)).toEqual(SLOTS);
    expect(totalMinutes(s, drills)).toBe(0);
    expect(emptySlots(s)).toEqual(SLOTS);
    expect(s.turnout).toBe(null);
  });

  it("defaults length to 60 minutes — a guideline, editable afterwards, not a hard total", () => {
    expect(emptySession("s1", "2026-08-12", "U12s").length).toBe(60);
  });

  it("a new session has a progress map, so the shape is the same before and after a run", () => {
    expect(emptySession("s1", "2026-08-13").progress).toEqual({});
  });

  it("has exactly one block per slot, which is what makes a slot a stable key for progress", () => {
    // lib/progress.js keys marks by slot so that reordering blocks cannot move a mark to
    // another drill. If a future feature ever allows two blocks in one slot, this fails
    // first and points at why.
    const blocks = emptySession("s1", "2026-08-13").blocks;
    const slots = blocks.map((b) => b.slot);
    expect(new Set(slots).size).toBe(blocks.length);
    expect(slots).toEqual(SLOTS);
  });
});

describe("fitsSquad with session turnout", () => {
  it("filters using turnout stored on the session rather than local UI state", () => {
    const s = { ...emptySession("s1", "2026-08-12"), turnout: 20 };
    // rondo-4v2 needs 6-8 players: doesn't fit a turnout of 20.
    expect(fitsSquad(drills[0], s.turnout)).toBe(false);
    // a session with no turnout set (null) must not filter anything out.
    expect(fitsSquad(drills[0], emptySession("s2", "d").turnout)).toBe(true);
  });
});

describe("minutes", () => {
  it("inherits the drill's duration until overridden", () => {
    let s = emptySession("s1", "2026-08-12");
    s = setBlock(s, 0, { drill: "rondo-4v2" });
    s = setBlock(s, 1, { drill: "3v2" });
    expect(totalMinutes(s, drills)).toBe(25);
    s = setBlock(s, 1, { minutes: 20 });
    expect(totalMinutes(s, drills)).toBe(30);
  });

  it("counts a drill with no duration as zero rather than NaN", () => {
    expect(blockMinutes({ minutes: null }, { minutes: null })).toBe(0);
    let s = setBlock(emptySession("s", "d"), 4, { drill: "nomins" });
    expect(totalMinutes(s, drills)).toBe(0);
  });

  it("reports which slots are still empty", () => {
    let s = setBlock(emptySession("s", "d"), 0, { drill: "rondo-4v2" });
    expect(emptySlots(s)).toEqual(["skill", "tactical", "match", "fun"]);
  });
});

describe("broken references", () => {
  it("shows a deleted drill rather than silently dropping the block", () => {
    const s = setBlock(emptySession("s", "d"), 2, { drill: "deleted-drill" });
    const blocks = resolveBlocks(s, drills);
    expect(blocks).toHaveLength(5);
    expect(blocks[2].missing).toBe(true);
    expect(blocks[2].drillRef).toBe("deleted-drill");
    expect(blocks[2].drill).toBe(null);
  });

  it("counts a broken reference as zero minutes", () => {
    const s = setBlock(emptySession("s", "d"), 2, { drill: "deleted-drill" });
    expect(totalMinutes(s, drills)).toBe(0);
  });

  it("does not mark an empty slot as missing", () => {
    expect(resolveBlocks(emptySession("s", "d"), drills).every((b) => !b.missing)).toBe(true);
  });
});

describe("squadRange", () => {
  it("reads a range, an open end, and a single number", () => {
    expect(squadRange("8-12")).toEqual({ min: 8, max: 12 });
    expect(squadRange("12+").max).toBe(Infinity);
    expect(squadRange("11")).toEqual({ min: 11, max: 11 });
  });

  it("returns null for anything it cannot read", () => {
    for (const v of ["loads", "", null, undefined, "8 to 12"]) expect(squadRange(v)).toBe(null);
  });
});

describe("fitsSquad", () => {
  it("accepts a turnout inside the range", () => {
    expect(fitsSquad(drills[1], 9)).toBe(true);
  });

  it("rejects too few and too many", () => {
    expect(fitsSquad(drills[1], 6)).toBe(false);
    expect(fitsSquad(drills[0], 20)).toBe(false);
  });

  it("handles an open-ended minimum", () => {
    expect(fitsSquad(drills[2], 14)).toBe(true);
    expect(fitsSquad(drills[2], 9)).toBe(false);
  });

  it("never excludes a drill when either side is unknown", () => {
    // A missing players field or an unknown turnout must not hide a drill.
    expect(fitsSquad(drills[3], 3)).toBe(true);
    expect(fitsSquad(drills[1], NaN)).toBe(true);
    expect(fitsSquad(drills[1], undefined)).toBe(true);
  });
});

describe("moveBlock", () => {
  it("reorders the plan", () => {
    const s = moveBlock(emptySession("s", "d"), 0, 2);
    expect(s.blocks.map((b) => b.slot)).toEqual(["skill", "tactical", "warmup", "match", "fun"]);
  });

  it("is a no-op for an index out of range", () => {
    const s = emptySession("s", "d");
    expect(moveBlock(s, 0, 9)).toBe(s);
    expect(moveBlock(s, -1, 0)).toBe(s);
  });

  it("keeps the total unchanged", () => {
    let s = setBlock(setBlock(emptySession("s", "d"), 0, { drill: "rondo-4v2" }), 1, { drill: "3v2" });
    expect(totalMinutes(moveBlock(s, 0, 2), drills)).toBe(totalMinutes(s, drills));
  });
});

describe("readSessions", () => {
  it("reads a well-formed file", () => {
    const data = { version: 1, sessions: { a: { id: "a" } } };
    expect(readSessions(JSON.stringify(data))).toEqual(data);
  });

  it("falls back to empty for anything unusable", () => {
    for (const bad of ["", "x", "null", "[]", '{"version":9}', undefined, "{}"]) {
      expect(readSessions(bad)).toEqual({ version: 1, sessions: {} });
    }
  });

  it("returns a fresh object, never the shared EMPTY", () => {
    const a = readSessions("nope");
    a.sessions.x = 1;
    expect(readSessions("nope").sessions).toEqual({});
    expect(EMPTY.sessions).toEqual({});
  });
});
