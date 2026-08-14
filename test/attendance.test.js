import { describe, it, expect } from "vitest";
import {
  PRESENT, ABSENT, EXCUSED, STATES, attendanceCounts, turnout, nextState,
  readAttendance, writeAttendance, localAttendance, sessionAttendance, withSessionAttendance,
} from "../src/lib/attendance.js";

const P = (...ids) => ids.map((id) => ({ id, name: id }));

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe("states", () => {
  it("has three, and unmarked is not one of them", () => {
    expect(STATES).toEqual([PRESENT, ABSENT, EXCUSED]);
  });
});

describe("attendanceCounts", () => {
  it("counts each state, with everyone unmarked to begin with", () => {
    expect(attendanceCounts({}, P("a", "b", "c")))
      .toEqual({ present: 0, absent: 0, excused: 0, unmarked: 3 });
  });

  it("counts a player missing from the map as unmarked, not as absent", () => {
    // The whole reason unmarked is a fourth thing: a register nobody took must not read as
    // twenty absences.
    expect(attendanceCounts({ a: PRESENT, b: ABSENT }, P("a", "b", "c")))
      .toEqual({ present: 1, absent: 1, excused: 0, unmarked: 1 });
  });

  it("ignores a mark for someone not in the list, so a player who left cannot inflate it", () => {
    expect(attendanceCounts({ a: PRESENT, gone: PRESENT }, P("a")))
      .toEqual({ present: 1, absent: 0, excused: 0, unmarked: 0 });
  });

  it("ignores a state it does not recognise, counting that player as unmarked", () => {
    expect(attendanceCounts({ a: "injured" }, P("a")))
      .toEqual({ present: 0, absent: 0, excused: 0, unmarked: 1 });
  });

  it("survives junk: no marks, no players, null", () => {
    expect(attendanceCounts(null, null)).toEqual({ present: 0, absent: 0, excused: 0, unmarked: 0 });
    expect(attendanceCounts(undefined, P("a")))
      .toEqual({ present: 0, absent: 0, excused: 0, unmarked: 1 });
    expect(attendanceCounts({ a: PRESENT }, [])).toEqual({ present: 0, absent: 0, excused: 0, unmarked: 0 });
    expect(attendanceCounts({ a: PRESENT }, [null, undefined]))
      .toEqual({ present: 0, absent: 0, excused: 0, unmarked: 2 });
  });
});

describe("turnout", () => {
  it("is the number marked present — the others are not on the pitch", () => {
    expect(turnout({ a: PRESENT, b: PRESENT, c: ABSENT, d: EXCUSED })).toBe(2);
    expect(turnout({})).toBe(0);
    expect(turnout(null)).toBe(0);
  });

  it("counts every present mark, including one for a player no longer in the squad", () => {
    // Someone who turned up tonight counts towards tonight's numbers whatever the squad
    // list says afterwards; attendanceCounts is the squad-bounded view.
    expect(turnout({ gone: PRESENT })).toBe(1);
  });

  it("ignores states it does not recognise", () => {
    expect(turnout({ a: "here-ish" })).toBe(0);
  });
});

describe("nextState", () => {
  it("cycles through the register with one control per player", () => {
    // Twenty taps to take a register, so one control per row beats three buttons.
    expect(nextState(undefined)).toBe(PRESENT);
    expect(nextState(PRESENT)).toBe(ABSENT);
    expect(nextState(ABSENT)).toBe(EXCUSED);
    expect(nextState(EXCUSED)).toBe(undefined); // back to unmarked
  });

  it("starts an unknown or junk state at present, rather than getting stuck", () => {
    expect(nextState("injured")).toBe(PRESENT);
    expect(nextState(null)).toBe(PRESENT);
    expect(nextState(7)).toBe(PRESENT);
  });
});

describe("the store", () => {
  it("round-trips locally under its own key, separately from progress", () => {
    const s = fakeStorage();
    writeAttendance(s, "sess", "2026-08-14", { a: PRESENT, b: EXCUSED }, "2026-08-14T18:58:04.000Z");
    expect(readAttendance(s, "sess", "2026-08-14")).toEqual({ a: PRESENT, b: EXCUSED });
    expect(s.getItem("ballislife_attendance")).toBeTruthy();
    expect(s.getItem("ballislife_progress")).toBe(null);
  });

  it("rejects a state that is not one of the three", () => {
    const s = fakeStorage();
    writeAttendance(s, "sess", "d", { a: PRESENT, b: "done" });
    expect(readAttendance(s, "sess", "d")).toEqual({ a: PRESENT });
  });

  it("is null locally when this device has nothing for the day", () => {
    expect(localAttendance(fakeStorage(), "sess", "d")).toBe(null);
  });

  it("lives in the session's `attendance` field, per date, beside progress", () => {
    const session = { id: "s1", progress: { d: { marks: {}, updatedAt: null } } };
    const next = withSessionAttendance(session, "2026-08-14", { a: PRESENT }, "2026-08-14T18:58:04.000Z");
    expect(next.attendance["2026-08-14"])
      .toEqual({ marks: { a: PRESENT }, updatedAt: "2026-08-14T18:58:04.000Z" });
    expect(next.progress).toBe(session.progress);
    expect(sessionAttendance(next, "2026-08-14").marks).toEqual({ a: PRESENT });
  });

  it("keeps every date on the session — attendance is a record, not tonight's cache", () => {
    const session = withSessionAttendance({ id: "s1" }, "2026-08-07", { a: PRESENT }, "2026-08-07T18:00:00.000Z");
    const next = withSessionAttendance(session, "2026-08-14", { a: ABSENT }, "2026-08-14T18:00:00.000Z");
    expect(Object.keys(next.attendance)).toEqual(["2026-08-07", "2026-08-14"]);
  });
});
