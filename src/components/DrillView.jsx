// src/components/DrillView.jsx
// One drill, read-only. Presentational: App fetches the text and passes it in.
import React from "react";
import DrillPreview from "./DrillPreview.jsx";

export default function DrillView({ drill, status, text, message, onBack }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={onBack}>← Back</button>
        <strong>{drill?.title}</strong>
      </div>
      {status === "loading" ? <div className="card">Loading…</div> : null}
      {status === "error" ? <div className="card banner err mono">{message}</div> : null}
      {status === "ready" ? <DrillPreview source={text} /> : null}
    </div>
  );
}
