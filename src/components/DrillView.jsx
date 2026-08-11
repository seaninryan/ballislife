// src/components/DrillView.jsx
// One drill, read-only. Presentational: App fetches the text and passes it in.
import React from "react";
import DrillPreview from "./DrillPreview.jsx";

export default function DrillView({ drill, status, text, message, onBack, today }) {
  // Reading a drill is exactly where you tick off its setup checklist, so this view
  // always renders interactively — `today` defaults to the real date but can be
  // overridden for a deterministic test.
  const day = today ?? new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={onBack}>← Back</button>
        <strong>{drill?.title}</strong>
      </div>
      {status === "loading" ? <div className="card">Loading…</div> : null}
      {status === "error" ? <div className="card banner err mono">{message}</div> : null}
      {status === "ready" ? (
        <DrillPreview source={text} interactive slug={drill?.slug} today={day} />
      ) : null}
    </div>
  );
}
