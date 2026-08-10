// src/components/Catalogue.jsx
// Presentational: given a status, render sign-in, the grid, or one drill. No Drive
// calls — App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import Grid from "./Grid.jsx";
import DrillView from "./DrillView.jsx";

// Raw exception text like "drive 403" tells a coach nothing about what to do next.
export function friendlyError(message) {
  const text = String(message ?? "");
  if (/\b401\b/.test(text)) return "Your Google sign-in expired. Reload to sign in again.";
  if (/\b403\b/.test(text)) return "Google is rate-limiting requests. Try again in a minute.";
  if (/\b404\b/.test(text)) return "That drill is no longer in your Drive folder.";
  if (/\b5\d\d\b/.test(text)) return "Google Drive is having trouble. Try again shortly.";
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return "No connection to Google Drive. Check your signal and try again.";
  }
  return text || "Something went wrong.";
}

export default function Catalogue({
  status, drills = [], failed = [], message, onSignIn,
  filter = {}, onFilterChange, selected, drillStatus, drillText, drillMessage,
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
  if (status === "error") return <div className="card banner err">{friendlyError(message)}</div>;

  if (selected) {
    return (
      <DrillView
        drill={selected}
        status={drillStatus}
        text={drillText}
        message={friendlyError(drillMessage)}
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
