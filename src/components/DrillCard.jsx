// src/components/DrillCard.jsx
// One drill in the grid. The diagram is the thumbnail — it is how a drill is
// recognised at a glance, which is why the grid exists at all.
import React from "react";
import PitchDiagram from "./PitchDiagram.jsx";

export default function DrillCard({ drill, onOpen }) {
  const chips = [
    drill.category,
    drill.minutes ? `${drill.minutes}′` : null,
    drill.players,
  ].filter(Boolean).concat(drill.tags ?? []);

  return (
    <button type="button" className="card drill-card" onClick={() => onOpen?.(drill)}>
      <div className="drill-card-thumb">
        {drill.thumb ? (
          <PitchDiagram source={drill.thumb} />
        ) : (
          <div className="drill-card-empty dim">no diagram</div>
        )}
      </div>
      <div className="drill-card-title">{drill.title}</div>
      <div className="row">
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>
      {drill.invalid ? <div className="banner warn mono">needs fixing</div> : null}
    </button>
  );
}
