// src/lib/attendance.js
// Who turned up tonight. A day-keyed map of player id -> state, stored on the session
// exactly as progress is — see lib/dayMarks.js, whose store both share so that a tick never
// waits on signal, survives the app closing, reaches the other device, and does not come
// back after being cleared.
//
// Keys are player ids, which squads.js fixes at creation precisely so a record survives a
// player being renamed.
//
// Unlike progress, the session's copy is a RECORD: progress is meant to start clean when a
// plan is run again next week, whereas keeping every date is the entire point of taking a
// register. The local copy is still pruned to today, because it is only a cache.
import { createDayMarks, mergeSides, sameMarks } from "./dayMarks.js";

export const PRESENT = "present";
export const ABSENT = "absent";
// They let me know. No reason is recorded, deliberately: the coach asked for the fact, not
// the story behind it.
export const EXCUSED = "excused";
export const STATES = [PRESENT, ABSENT, EXCUSED];

// The register is taken BY EXCEPTION: everyone starts absent and is ticked as they arrive or
// send word, which for fifteen players is a handful of taps instead of fifteen. So an
// unmarked player is not a state of his own — he is absent, and the screen says so.
//
// Two things this deliberately does NOT do. It does not write those absences: only taps are
// stored, so the night's entry existing still means "the register was taken", and a session
// he never touched still records nothing — which is what lets history tell "never took it"
// apart from "nobody came". And it does not change what a stored mark means: a stored
// `absent` is still an absence he stood over.

const store = createDayMarks({
  storageKey: "ballislife_attendance",
  field: "attendance",
  states: STATES,
});

export const readAttendance = store.readMarks;
export const readStamp = store.readStamp;
export const writeAttendance = store.writeMarks;
export const localAttendance = store.localSide;
export const sessionAttendance = store.sessionSide;
export const withSessionAttendance = store.withSessionSide;
export const mergeAttendance = mergeSides;
export { sameMarks };

// Counts only the players passed in, so someone who has since left the squad does not
// inflate tonight's numbers. Everything that is not a present or an excused mark — no mark,
// or a state from a hand-edited file that this version does not know — counts as absent,
// which is what the row shows. Three numbers that always add up to the squad: a line that
// checks itself at a glance.
export function attendanceCounts(marks, players) {
  const counts = { present: 0, absent: 0, excused: 0 };
  for (const player of players ?? []) {
    const state = marks?.[player?.id];
    if (state === PRESENT) counts.present += 1;
    else if (state === EXCUSED) counts.excused += 1;
    else counts.absent += 1;
  }
  return counts;
}

// How many are actually on the pitch, which is what the drill picker means by turnout. Not
// bounded by the squad list: a mark says someone was here tonight regardless of what the
// list says afterwards.
export const turnout = (marks) =>
  Object.values(marks ?? {}).filter((state) => state === PRESENT).length;

// The turnout a PLAN can be said to have, for a screen that is looking at one rather than
// running it: the present count from the last register taken against it. The builder has no
// "tonight" to key off — a plan is edited days before and days after it is run — so the most
// recent night is the only honest answer. ISO dates sort lexically, so that is the last key.
//
// Null when NOTHING was ever recorded — which is not zero, and callers must not confuse the
// two. A night whose register was cleared is skipped: an empty register says nothing about
// how many were there. A night where everybody was marked absent is NOT skipped, because
// that register was taken and its answer is nobody: walking past it to reach an older night
// reported last season's fifteen as this plan's turnout, with nothing saying how old it was.
// Zero is the honest answer here; what to do with a useless suggestion is the caller's call.
export function recordedTurnout(session) {
  const days = Object.keys(session?.attendance ?? {}).sort();
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const side = sessionAttendance(session, days[i]);
    if (side && Object.keys(side.marks).length) return turnout(side.marks);
  }
  return null;
}

// One control per player, cycling absent -> present -> excused -> absent. One tappable row
// beats three buttons per row on a phone held in one hand at the side of a pitch.
//
// Three stops, not four: unmarked used to be the fourth, and it cannot be one any more
// because an unmarked row is already showing Absent — a stop that looks identical to the
// one before it is a tap that appears to do nothing. It also always returns a state, so a
// tap always stores something, which is what keeps "he took the register and everyone was
// out" distinguishable from "he never opened it".
//
// An unmarked row is showing absent, so it moves off absent like an absent one: to present,
// which is the tap that matters — someone arrived. Anything unrecognised does the same
// rather than trapping the row on a state it cannot leave.
const CYCLE = [ABSENT, PRESENT, EXCUSED];
export function nextState(state) {
  const index = CYCLE.indexOf(state);
  return index === -1 ? PRESENT : CYCLE[(index + 1) % CYCLE.length];
}
