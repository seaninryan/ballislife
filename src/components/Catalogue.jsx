// src/components/Catalogue.jsx
// Presentational: given a status and a list of drills, render them. No Drive calls —
// App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import PitchDiagram from "./PitchDiagram.jsx";

function DrillRow({ drill }) {
  const chips = [drill.category, drill.minutes ? `${drill.minutes}′` : null, drill.players]
    .filter(Boolean)
    .concat(drill.tags);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{drill.title}</strong>
        <span className="dim mono">{drill.slug}.md</span>
      </div>
      <div className="row" style={{ margin: "6px 0" }}>
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>
      {drill.invalid ? <div className="banner warn mono">{drill.invalid}</div> : null}
      {drill.thumb ? <PitchDiagram source={drill.thumb} /> : null}
    </div>
  );
}

export default function Catalogue({ status, drills = [], message, onSignIn }) {
  if (status === "signed-out") {
    return (
      <div className="card">
        <p>Your drills live in your own Google Drive. Nothing is stored on this site.</p>
        <button className="primary" onClick={onSignIn}>Sign in with Google</button>
      </div>
    );
  }
  if (status === "loading") return <div className="card">Loading your drills…</div>;
  if (status === "not-owner") {
    return <div className="card banner err">This app is for its owner only. You have been signed out.</div>;
  }
  if (status === "error") return <div className="card banner err mono">{message}</div>;
  if (!drills.length) {
    return (
      <div className="card">
        <p>No drills yet.</p>
        <p className="dim">
          Add markdown files to the <strong>BallIsLife</strong> folder in your Google Drive
          and reload.
        </p>
      </div>
    );
  }
  return <div>{drills.map((d) => <DrillRow key={d.id} drill={d} />)}</div>;
}
