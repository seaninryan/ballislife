// src/components/SessionBuilder.jsx
// One session: date, squad, theme and length; a row per block with a picker or the
// chosen drill; running total and warnings. Presentational except for the "show all"
// toggle per row, which is view-only UI state. Turnout lives on the session itself
// (not local state) so it survives closing and reopening the session, and every
// change — including turnout — is reported through onChange; App owns the data.
//
// All filtering, minutes and totals come from lib/sessions.js — this component decides
// nothing about what fits or what a block is worth.
import React, { useState } from "react";
import { SLOTS, resolveBlocks, totalMinutes, emptySlots, fitsSquad, setBlock, moveBlock } from "../lib/sessions.js";
import { recordedTurnout } from "../lib/attendance.js";

function BlockRow({ block, index, count, drills, turnout, onChange, onMove }) {
  const [showAll, setShowAll] = useState(false);

  const candidates = (drills ?? []).filter((d) => {
    if (!showAll && d.category !== block.slot) return false;
    return fitsSquad(d, turnout);
  });

  return (
    <div className="card session-block">
      <strong className="block-slot">{block.slot}</strong>

      <div className="block-body">
        {block.missing ? (
          <div className="banner err">
            Drill "{block.drillRef}" is missing — it may have been deleted.{" "}
            <button type="button" onClick={() => onChange(index, { drill: null, minutes: null })}>
              Clear
            </button>
          </div>
        ) : block.drill ? (
          <>
            <span className="block-title">{block.drill.title}</span>
            <span className="chip">{block.minutes}′</span>
            <label className="dim">
              Minutes:{" "}
              <input
                type="number"
                min="0"
                value={block.rawMinutes ?? ""}
                placeholder={block.drill?.minutes != null ? String(block.drill.minutes) : ""}
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
          </>
        ) : (
          <>
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
            <label className="dim">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              {" "}show all drills
            </label>
          </>
        )}
      </div>

      <div className="block-controls">
        {index > 0 ? (
          <button type="button" aria-label="Move up" onClick={() => onMove(index, index - 1)}>↑</button>
        ) : null}
        {index < count - 1 ? (
          <button type="button" aria-label="Move down" onClick={() => onMove(index, index + 1)}>↓</button>
        ) : null}
      </div>
    </div>
  );
}

export default function SessionBuilder({ session, drills = [], squads = [], onChange, onBack, onDelete, onRun }) {
  const turnout = session.turnout ?? "";
  // What the register says, if one has been taken against this plan. It is the input's
  // PLACEHOLDER rather than its value, so it is obvious both where the number came from and
  // that typing over it wins — and clearing the field falls back to it rather than to
  // nothing, which is why the same fallback drives the picker below.
  const derivedTurnout = recordedTurnout(session);
  const turnoutNumber = session.turnout ?? derivedTurnout ?? undefined;

  // rawMinutes carries the block's own (possibly null) minutes through resolveBlocks,
  // which overwrites `minutes` with the resolved figure — the input needs the raw value
  // to tell "inherited" apart from "explicitly set".
  const blocks = resolveBlocks(session, drills).map((block, i) => ({
    ...block,
    rawMinutes: session.blocks[i]?.minutes ?? null,
  }));
  const total = totalMinutes(session, drills);
  const empty = emptySlots(session);
  const over = session.length && total > session.length;

  const patchBlock = (index, patch) => onChange?.(setBlock(session, index, patch));
  const move = (from, to) => onChange?.(moveBlock(session, from, to));
  // The id is what attendance will point at; the free-text name is what every existing
  // display already reads. Both are set together so they can never drift apart, and both
  // are cleared together — "no squad" means no squad, not a name with nothing behind it.
  const setSquad = (id) => {
    // Re-picking the deleted squad's own option is choosing what is already chosen. Without
    // this it fell through to "no squad" and cleared BOTH fields, erasing the only surviving
    // record of who that night was for.
    if (id && id === session.squadId) return;
    const squad = squads.find((s) => s.id === id);
    onChange?.(squad
      ? { ...session, squadId: squad.id, squad: squad.name }
      : { ...session, squadId: null, squad: "" });
  };
  // A squad deleted since this plan was written. It is still named rather than dropped:
  // an empty picker would silently re-point a night's plan at whatever squad sorts first.
  const missingSquad = session.squadId && !squads.some((s) => s.id === session.squadId);
  const setTurnout = (v) => onChange?.({ ...session, turnout: v === "" ? null : Number(v) });
  const setLength = (v) => onChange?.({ ...session, length: v === "" ? null : Number(v) });

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" onClick={onBack}>← Back</button>
        <div className="row">
          {onRun ? (
            <button type="button" className="primary" onClick={() => onRun(session)}>Run this session</button>
          ) : null}
          {onDelete ? <button type="button" onClick={onDelete}>Delete</button> : null}
        </div>
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
        <div className="row" style={{ marginTop: 6 }}>
          <label className="dim">
            Turnout tonight:{" "}
            <input
              type="number"
              min="0"
              value={turnout}
              placeholder={derivedTurnout != null ? String(derivedTurnout) : ""}
              onChange={(e) => setTurnout(e.target.value)}
              style={{ width: 64 }}
            />
          </label>
          <label className="dim">
            Squad:{" "}
            <select value={session.squadId ?? ""} onChange={(e) => setSquad(e.target.value)}>
              <option value="">No squad</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {missingSquad ? (
                <option value={session.squadId}>
                  {session.squad || session.squadId} (no longer one of your squads)
                </option>
              ) : null}
            </select>
          </label>
          <label className="dim">
            Session length (minutes):{" "}
            <input
              type="number"
              min="0"
              value={session.length ?? ""}
              onChange={(e) => setLength(e.target.value)}
              style={{ width: 64 }}
            />
          </label>
        </div>
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
