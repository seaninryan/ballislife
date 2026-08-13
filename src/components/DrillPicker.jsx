// src/components/DrillPicker.jsx
// Choose a drill for a slot. Presentational: it is handed the catalogue and what the
// slot wants, and reports the drill picked — it never touches a session or Drive.
//
// State here is only view state (search text, order, category toggle) and is deliberately
// NOT lifted: closing the picker and reopening it should start clean rather than remember
// last night's search.
import React, { useState } from "react";
import { rankDrills, SORTS } from "../lib/picker.js";

export default function DrillPicker({
  drills = [], slot = null, tags = [], turnout, exclude = null, onPick, onCancel,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [sameCategoryOnly, setSameCategoryOnly] = useState(false);

  const entries = rankDrills(drills, {
    slot, tags, turnout, query, exclude, sort, sameCategoryOnly,
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
        {onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}
      </div>

      {entries.length === 0 ? (
        <p className="dim">
          No drill matches{query ? ` “${query}”` : ""}
          {sameCategoryOnly && slot ? ` in ${slot}` : ""}.
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
