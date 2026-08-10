// src/components/Grid.jsx
// The browse view: filters, then a card per drill. Filtering is delegated to
// lib/drills.js — this component decides nothing about what matches.
import React from "react";
import DrillCard from "./DrillCard.jsx";
import Filters from "./Filters.jsx";
import { filterDrills } from "../lib/drills.js";

export default function Grid({ drills, filter, onFilterChange, onOpen, failed = [] }) {
  const shown = filterDrills(drills, filter);
  const filtering = Boolean(filter.category || filter.tag || (filter.query ?? "").trim());

  if (!drills.length) {
    return (
      <div className="card">
        <p>No drills yet.</p>
        <p className="dim">
          Add markdown files to the <strong>BallIsLife</strong> folder in your Google
          Drive and reload.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Filters drills={drills} filter={filter} onChange={onFilterChange} />

      {failed.length ? (
        <div className="banner warn">
          {failed.length} drill{failed.length === 1 ? "" : "s"} could not be loaded:{" "}
          {failed.map((f) => f.name).join(", ")}. They will be retried next time you reload.
        </div>
      ) : null}

      <div className="dim" style={{ margin: "0 0 8px" }}>
        {shown.length} drill{shown.length === 1 ? "" : "s"}
        {filtering && shown.length !== drills.length ? ` of ${drills.length}` : ""}
      </div>

      {shown.length ? (
        <div className="grid">
          {shown.map((d) => <DrillCard key={d.id} drill={d} onOpen={onOpen} />)}
        </div>
      ) : (
        <div className="card">
          <p>No drills match.</p>
          <button type="button" onClick={() => onFilterChange?.({})}>Clear filters</button>
        </div>
      )}
    </div>
  );
}
