// src/components/DrillPicker.jsx
// Choose a drill for a slot. Presentational: it is handed the catalogue and what the
// slot wants, and reports the drill picked — it never touches a session or Drive.
//
// State here is only view state (search text, order, the two filter toggles) and is
// deliberately NOT lifted: closing the picker and reopening it should start clean rather
// than remember last night's search.
import React, { useState } from "react";
import { rankDrills, SORTS } from "../lib/picker.js";
import PitchDiagram from "./PitchDiagram.jsx";

export default function DrillPicker({
  drills = [], slot = null, tags = [], turnout, exclude = null, onPick, onCancel,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [sameCategoryOnly, setSameCategoryOnly] = useState(false);
  // On by default — sizing the list to who is actually here is the whole reason the swap
  // picker knows the turnout. But escapable, and labelled with the number it is using: the
  // turnout is derived from a register that may be being taken while this picker is open,
  // so it is allowed to be momentarily wrong, and a wrong one must never be able to leave
  // the coach staring at an empty list with no way out of it.
  const [fitsTurnoutOnly, setFitsTurnoutOnly] = useState(true);
  const hasTurnout = Number.isFinite(turnout);

  const entries = rankDrills(drills, {
    slot, tags, turnout: fitsTurnoutOnly ? turnout : undefined,
    query, exclude, sort, sameCategoryOnly,
  });

  return (
    <div className="drill-picker">
      <div className="row drill-picker-controls">
        <input
          type="search"
          className="drill-picker-search"
          value={query}
          placeholder="Search drills…"
          aria-label="Search drills"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="dim drill-picker-order">
          Order:{" "}
          <select value={sort} aria-label="Order" onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {slot ? (
          <label className="dim drill-picker-only">
            <input
              type="checkbox"
              checked={sameCategoryOnly}
              onChange={(e) => setSameCategoryOnly(e.target.checked)}
            />
            {" "}only {slot} drills
          </label>
        ) : null}
        {hasTurnout ? (
          <label className="dim drill-picker-fits">
            <input
              type="checkbox"
              checked={fitsTurnoutOnly}
              onChange={(e) => setFitsTurnoutOnly(e.target.checked)}
            />
            {" "}only drills that fit {turnout}
          </label>
        ) : null}
        {onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}
      </div>

      {entries.length === 0 ? (
        // Naming every filter that is on: an empty list otherwise reads as "there is no
        // such drill", and the toggle that would bring them back never gets looked for.
        <p className="dim">
          No drill matches{query ? ` “${query}”` : ""}
          {sameCategoryOnly && slot ? ` in ${slot}` : ""}
          {fitsTurnoutOnly && hasTurnout ? ` that fits ${turnout}` : ""}.
        </p>
      ) : (
        <ul className="drill-picker-list">
          {entries.map(({ drill, matched }) => (
            <li key={drill.slug}>
              <button
                type="button"
                className="drill-picker-option"
                onClick={() => onPick?.(drill)}
              >
                {/* Mid-swap you are looking for a shape you remember, not a name you
                    can spell. The placeholder keeps its box when there is no diagram so
                    the titles down the list stay on one line. */}
                <span className="drill-picker-thumb">
                  {drill.thumb
                    ? <PitchDiagram source={drill.thumb} />
                    : <span className="drill-picker-thumb-empty dim" aria-hidden="true">—</span>}
                </span>
                <span className="drill-picker-option-body">
                  <span className="block-title">{drill.title}</span>
                  <span
                    className={`chip drill-picker-category${drill.category === slot ? " ok-chip" : ""}`}
                  >
                    {drill.category ?? "no category"}
                  </span>
                  <span className="chip">
                    {drill.minutes != null && drill.minutes !== "" ? `${drill.minutes}′` : "no duration"}
                  </span>
                  {drill.players ? <span className="chip dim">{drill.players}</span> : null}
                  {matched.map((t) => <span key={t} className="chip ok-chip">{t}</span>)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
