// src/components/Attendance.jsx
// Tonight's register: one row per player in the squad, tapped once each as they arrive.
// Presentational, like SessionRun and SessionBuilder — it holds no marks, reports every
// tap through onMark(playerId, state), and the run view decides where that goes.
//
// One control per row rather than three buttons per player: a register is fifteen taps
// held one-handed at the side of a pitch, and a row big enough to hit without looking
// leaves no width for three of anything. The row cycles unmarked -> present -> absent ->
// excused -> unmarked (lib/attendance.js owns the cycle).
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

  const { present, absent, excused, unmarked } = attendanceCounts(marks, players);

  return (
    <div className="attendance">
      <div className="attendance-summary dim">
        {present} present · {absent} absent · {excused} excused
        {unmarked ? ` · ${unmarked} to go` : ""}
      </div>
      {players.map((p) => {
        // Anything unrecognised (a hand-edited file, a state from a future version) reads
        // as unmarked rather than showing a word the coach cannot clear.
        const state = LABEL[marks?.[p.id]] ? marks[p.id] : undefined;
        return (
          <button
            type="button"
            key={p.id}
            className={`card attendance-row attendance-${state ?? "unmarked"}`}
            aria-label={`${p.name}: ${state ? LABEL[state] : "not marked"}`}
            onClick={() => onMark?.(p.id, nextState(state))}
          >
            <span className="attendance-name">{p.name}</span>
            {/* Unmarked is deliberately blank: before the register is taken nobody is
                anything, and a chip on all fifteen rows saying so is fifteen rows of
                noise between the coach and the one name he is looking for. */}
            {state ? <span className={`chip ${CHIP[state]}`}>{LABEL[state]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
