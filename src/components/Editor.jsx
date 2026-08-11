// src/components/Editor.jsx
// Renders the editor state machine's state. Presentational: no Drive, no timers, no
// rules about when to save — App owns those.
import React from "react";
import DrillPreview from "./DrillPreview.jsx";
import PitchHelp from "./PitchHelp.jsx";
import { DIRTY, SAVING, CONFLICT, FAILED } from "../lib/editor.js";
import { friendlyError } from "../lib/errors.js";

function Status({ state }) {
  if (state.status === CONFLICT) return <span className="chip warn-chip">conflict</span>;
  if (state.status === FAILED) return <span className="chip err-chip">not saved</span>;
  if (state.status === SAVING) return <span className="chip dim">saving…</span>;
  if (state.status === DIRTY) return <span className="chip dim">unsaved</span>;
  return <span className="chip dim">saved</span>;
}

export default function Editor({ state, onEdit, onBack, onDelete, onKeepMine, onReload }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={onBack}>← Back</button>
        <Status state={state} />
        <span style={{ marginLeft: "auto" }} />
        <button type="button" onClick={onDelete}>Delete</button>
      </div>

      {state.status === CONFLICT ? (
        <div className="banner warn">
          This drill changed in Drive since you opened it. Your edit is safe and still
          below — choose which version to keep.
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="primary" onClick={onKeepMine}>Keep mine</button>
            <button type="button" onClick={onReload}>Reload Drive’s version</button>
          </div>
        </div>
      ) : null}

      {state.status === FAILED ? (
        <div className="banner err">
          Could not save: {friendlyError(state.error)} Your edit is still here and will be
          retried when you type again.
        </div>
      ) : null}

      <PitchHelp />

      <div className="split">
        <textarea
          className="mono editor-source"
          value={state.text}
          onChange={(e) => onEdit?.(e.target.value)}
          spellCheck={false}
        />
        <div className="editor-preview">
          <DrillPreview source={state.text} />
        </div>
      </div>
    </div>
  );
}
