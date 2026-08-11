// src/components/Catalogue.jsx
// Presentational: given a status, render sign-in, the grid, or one drill. No Drive
// calls — App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import Grid from "./Grid.jsx";
import DrillView from "./DrillView.jsx";
import { friendlyError } from "../lib/errors.js";

// Re-exported for backward compatibility: existing tests and callers import
// friendlyError from here. The implementation lives in lib/errors.js so Editor.jsx can
// use it too without a circular import (Catalogue renders Editor).
export { friendlyError };

export default function Catalogue({
  status, drills = [], failed = [], error, onSignIn,
  filter = {}, onFilterChange, selected, drillStatus, drillText, drillError,
  onOpen, onBack, duplicateFolders,
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

  if (selected) {
    return (
      <DrillView
        drill={selected}
        status={drillStatus}
        text={drillText}
        message={friendlyError(drillError)}
        onBack={onBack}
      />
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
