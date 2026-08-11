// src/components/Catalogue.jsx
// Presentational: given a status, render sign-in, the grid, or one drill. No Drive
// calls — App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import Grid from "./Grid.jsx";
import DrillView from "./DrillView.jsx";
import Editor from "./Editor.jsx";
import { friendlyError } from "../lib/errors.js";

// Re-exported for backward compatibility: existing tests and callers import
// friendlyError from here. The implementation lives in lib/errors.js so Editor.jsx can
// use it too without a circular import (Catalogue renders Editor).
export { friendlyError };

export default function Catalogue({
  status, drills = [], failed = [], error, onSignIn,
  filter = {}, onFilterChange, selected, drillStatus, drillText, drillError,
  onOpen, onBack, duplicateFolders,
  editor, onEdit, onEditBack, onDelete, onKeepMine, onReload,
  onStartEdit, onCreate,
}) {
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
  if (status === "error") return <div className="card banner err">{friendlyError(error)}</div>;

  // The editor takes over the whole view when open — it is not a peer of the grid or
  // the read view, and rendering both at once would mean two sources of truth for the
  // same drill's text.
  if (editor) {
    return (
      <Editor
        state={editor}
        onEdit={onEdit}
        onBack={onEditBack}
        onDelete={onDelete}
        onKeepMine={onKeepMine}
        onReload={onReload}
      />
    );
  }

  if (selected) {
    return (
      <div>
        <DrillView
          drill={selected}
          status={drillStatus}
          text={drillText}
          message={friendlyError(drillError)}
          onBack={onBack}
        />
        {drillStatus === "ready" ? (
          <div className="row">
            <button type="button" onClick={() => onStartEdit?.(selected)}>Edit</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {duplicateFolders ? (
        <div className="banner warn">
          There is more than one <strong>BallIsLife</strong> folder in your Drive. Drills
          may be split between them — merge them in Drive to be safe.
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="primary" onClick={onCreate}>New drill</button>
      </div>
      <Grid
        drills={drills}
        failed={failed}
        filter={filter}
        onFilterChange={onFilterChange}
        onOpen={onOpen}
      />
    </>
  );
}
