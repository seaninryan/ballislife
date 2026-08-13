// src/components/Catalogue.jsx
// Presentational: given a status, render sign-in, the grid, or one drill. No Drive
// calls — App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import Grid from "./Grid.jsx";
import DrillView from "./DrillView.jsx";
import Editor from "./Editor.jsx";
import SessionList from "./SessionList.jsx";
import SessionBuilder from "./SessionBuilder.jsx";
import SessionRun from "./SessionRun.jsx";
import { friendlyError } from "../lib/errors.js";

// Re-exported for backward compatibility: existing tests and callers import
// friendlyError from here. The implementation lives in lib/errors.js so Editor.jsx can
// use it too without a circular import (Catalogue renders Editor).
export { friendlyError };

// The sessions file is saved from two places now — the builder and, via progress marks,
// the run view. A save that fails at the side of a pitch must say so there rather than
// only on the screen the coach is not looking at.
function SessionsSaveBanner({ status, error, onKeepMine, onReload }) {
  if (status === "conflict") {
    return (
      <div className="banner warn">
        This plan changed in Drive since you opened it. Your edit is safe and still
        below — choose which version to keep.
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="primary" onClick={onKeepMine}>Keep mine</button>
          <button type="button" onClick={onReload}>Reload Drive’s version</button>
        </div>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="banner err">
        Could not save: {friendlyError(error)} Your edit is still here and will be
        retried when you change something again.
      </div>
    );
  }
  return null;
}

export default function Catalogue({
  status, drills = [], failed = [], error, onSignIn,
  filter = {}, onFilterChange, selected, drillStatus, drillText, drillError,
  onOpen, onBack, duplicateFolders,
  editor, onEdit, onEditBack, onDelete, onKeepMine, onReload,
  onStartEdit, onCreate,
  mode = "drills", onModeChange,
  sessions = [], selectedSession, onOpenSession, onCreateSession,
  onSessionChange, onSessionBack, onDeleteSession,
  sessionsStatus, sessionsError, onKeepMineSessions, onReloadSessions,
  runSession, runTexts, onOpenRun, onRunBack, onRunSwap, onRunProgress,
}) {
  if (status === "signed-out") {
    return (
      <div className="card">
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

  // The run view takes over the whole view too, and wins over the builder below: once
  // a session is opened to run, that is the only thing on screen until "Back to plan".
  if (runSession) {
    return (
      <div>
        <SessionsSaveBanner
          status={sessionsStatus}
          error={sessionsError}
          onKeepMine={onKeepMineSessions}
          onReload={onReloadSessions}
        />
        <SessionRun
          session={runSession}
          drills={drills}
          texts={runTexts}
          onBack={onRunBack}
          onSwap={onRunSwap}
          onProgress={onRunProgress}
        />
      </div>
    );
  }

  // The session builder takes over the whole view, the same way the drill editor does,
  // and wins regardless of the Drills/Sessions switch: opening a session (e.g. via its
  // URL) should show it even if `mode` has not caught up yet.
  if (selectedSession) {
    return (
      <div>
        <SessionsSaveBanner
          status={sessionsStatus}
          error={sessionsError}
          onKeepMine={onKeepMineSessions}
          onReload={onReloadSessions}
        />
        <SessionBuilder
          session={selectedSession}
          drills={drills}
          onChange={onSessionChange}
          onBack={onSessionBack}
          onDelete={onDeleteSession}
          onRun={onOpenRun}
        />
      </div>
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

      <div className="row">
        <button
          type="button"
          className={`chip-button${mode !== "sessions" ? " active" : ""}`}
          onClick={() => onModeChange?.("drills")}
        >
          Drills
        </button>
        <button
          type="button"
          className={`chip-button${mode === "sessions" ? " active" : ""}`}
          onClick={() => onModeChange?.("sessions")}
        >
          Sessions
        </button>
      </div>

      {mode === "sessions" ? (
        <SessionList
          sessions={sessions}
          drills={drills}
          onOpen={onOpenSession}
          onCreate={onCreateSession}
          onRun={onOpenRun}
        />
      ) : (
        <>
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
      )}
    </>
  );
}
