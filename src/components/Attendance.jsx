// src/components/Attendance.jsx
// Tonight's register: one row per player in the squad, tapped once each as they arrive.
// Presentational, like SessionRun and SessionBuilder — it holds no marks, reports every
// tap through onMark(playerId, state), and the run view decides where that goes.
//
// One control per row rather than three buttons per player: a register is fifteen taps
// held one-handed at the side of a pitch, and a row big enough to hit without looking
// leaves no width for three of anything. The row cycles absent -> present -> excused ->
// absent (lib/attendance.js owns the cycle).
//
// Everyone starts absent — the register is taken by exception, so the coach ticks the
// arrivals and the excuses and leaves the rest. A row with no mark is therefore drawn
// exactly like one marked absent: the screen shows the working assumption rather than
// leaving fifteen blank rows to be read as "nothing decided yet". Nothing is stored for
// those rows (see lib/attendance.js).
//
// Every state is spelled out in words. Colour carries it too, but colour alone is no use
// in bright sun, which is the only light this screen is ever read in.
import React from "react";
import { currentPlayers } from "../lib/squads.js";
import { PRESENT, ABSENT, EXCUSED, attendanceCounts, nextState } from "../lib/attendance.js";

const LABEL = { [PRESENT]: "Present", [ABSENT]: "Absent", [EXCUSED]: "Excused" };
// Reusing the chip recipe the run view already uses for Done/Skipped, so a state reads
// the same way wherever it appears.
const CHIP = { [PRESENT]: "ok-chip", [ABSENT]: "err-chip", [EXCUSED]: "warn-chip" };

export default function Attendance({ squad, marks = {}, onMark }) {
  if (!squad) {
    return (
      <p className="dim attendance-empty">
        No squad for this plan yet, so there is nobody to tick. Choose one under Squad,
        back on the plan.
      </p>
    );
  }

  // Only the CURRENT players: a player who has left is not at training tonight. Their
  // marks stay in the data untouched — this component never removes anything — because
  // last month's register still has to be able to say they were there.
  const players = currentPlayers(squad);
  if (!players.length) {
    return (
      <p className="dim attendance-empty">
        Nobody is in {squad.name} yet — add players to it under Squads.
      </p>
    );
  }

  const { present, absent, excused } = attendanceCounts(marks, players);

  return (
    <div className="attendance">
      {/* All three, and they add up to the squad — so the line is checkable against a
          number the coach already knows, without anything having to say "N to go". */}
      <div className="attendance-summary dim">
        {present} present · {absent} absent · {excused} excused
      </div>
      {players.map((p) => {
        // No mark reads as absent, and so does anything unrecognised (a hand-edited file, a
        // state from a future version) — the row must never show a word the coach cannot
        // clear, and absent is the assumption every untouched row is already under.
        const state = LABEL[marks?.[p.id]] ? marks[p.id] : ABSENT;
        return (
          <button
            type="button"
            key={p.id}
            className={`card attendance-row attendance-${state}`}
            aria-label={`${p.name}: ${LABEL[state]}`}
            onClick={() => onMark?.(p.id, nextState(state))}
          >
            <span className="attendance-name">{p.name}</span>
            {/* Every row says its state in words. Fifteen Absent chips is not noise here —
                it is the register's answer until he changes it, and the eye is scanning for
                the few rows that are NOT absent. */}
            <span className={`chip ${CHIP[state]}`}>{LABEL[state]}</span>
          </button>
        );
      })}
    </div>
  );
}
