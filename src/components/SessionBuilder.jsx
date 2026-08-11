// src/components/SessionBuilder.jsx
// One session: date, squad, theme and length; a row per block with a picker or the
// chosen drill; running total and warnings. Presentational except for the "show all"
// toggle per row and the turnout input, which are view-only UI state — App owns the
// session data itself and receives every change through onChange.
//
// All filtering, minutes and totals come from lib/sessions.js — this component decides
// nothing about what fits or what a block is worth.
import React, { useState } from "react";
import { SLOTS, resolveBlocks, totalMinutes, emptySlots, fitsSquad, setBlock, moveBlock } from "../lib/sessions.js";

function BlockRow({ block, index, count, drills, turnout, onChange, onMove }) {
  const [showAll, setShowAll] = useState(false);

  const candidates = (drills ?? []).filter((d) => {
    if (!showAll && d.category !== block.slot) return false;
    return fitsSquad(d, turnout);
  });

  return (
    <div className="card session-block">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{block.slot}</strong>
        <div className="row">
          {index > 0 ? (
            <button type="button" aria-label="Move up" onClick={() => onMove(index, index - 1)}>↑</button>
          ) : null}
          {index < count - 1 ? (
            <button type="button" aria-label="Move down" onClick={() => onMove(index, index + 1)}>↓</button>
          ) : null}
        </div>
      </div>

      {block.missing ? (
        <div className="banner err">
          Drill "{block.drillRef}" is missing — it may have been deleted.{" "}
          <button type="button" onClick={() => onChange(index, { drill: null, minutes: null })}>
            Clear
          </button>
        </div>
      ) : block.drill ? (
        <div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>{block.drill.title}</span>
            <span className="chip">{block.minutes}′</span>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="dim">
              Minutes:{" "}
              <input
                type="number"
                min="0"
                value={block.minutes ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange(index, { minutes: v === "" ? null : Number(v) });
                }}
                style={{ width: 64 }}
              />
            </label>
            <button type="button" onClick={() => onChange(index, { drill: null, minutes: null })}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div>
          <select
            value=""
            onChange={(e) => e.target.value && onChange(index, { drill: e.target.value, minutes: null })}
          >
            <option value="" disabled>Choose a drill…</option>
            {candidates.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.title} ({d.minutes ? `${d.minutes}′` : "no duration"})
              </option>
            ))}
          </select>
          <label className="dim" style={{ marginLeft: 10 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {" "}show all drills
          </label>
        </div>
      )}
    </div>
  );
}

export default function SessionBuilder({ session, drills = [], onChange, onBack, onDelete }) {
  const [turnout, setTurnout] = useState("");
  const turnoutNumber = turnout === "" ? undefined : Number(turnout);

  const blocks = resolveBlocks(session, drills);
  const total = totalMinutes(session, drills);
  const empty = emptySlots(session);
  const over = session.length && total > session.length;

  const patchBlock = (index, patch) => onChange?.(setBlock(session, index, patch));
  const move = (from, to) => onChange?.(moveBlock(session, from, to));

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" onClick={onBack}>← Back</button>
        {onDelete ? <button type="button" onClick={onDelete}>Delete</button> : null}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>{session.date}</strong>{" "}
            {session.squad ? <span className="chip">{session.squad}</span> : null}{" "}
            {session.theme ? <span className="chip">{session.theme}</span> : null}
          </div>
          <span className={`chip${over ? " warn-chip" : ""}`}>
            {total}′ of {session.length}′
          </span>
        </div>
        <label className="dim" style={{ marginTop: 6, display: "inline-block" }}>
          Turnout tonight:{" "}
          <input
            type="number"
            min="0"
            value={turnout}
            onChange={(e) => setTurnout(e.target.value)}
            style={{ width: 64 }}
          />
        </label>
      </div>

      {over ? (
        <div className="banner warn">
          This plan is over its {session.length}′ budget by {total - session.length}′.
        </div>
      ) : null}
      {empty.length ? (
        <div className="banner warn">
          Still empty: {empty.join(", ")}.
        </div>
      ) : null}

      {blocks.map((block, i) => (
        <BlockRow
          key={block.slot}
          block={block}
          index={i}
          count={blocks.length}
          drills={drills}
          turnout={turnoutNumber}
          onChange={patchBlock}
          onMove={move}
        />
      ))}
    </div>
  );
}
