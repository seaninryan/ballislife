// src/components/Catalogue.jsx
// Presentational: given a status, render sign-in, the grid, or one drill. No Drive
// calls — App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import Grid from "./Grid.jsx";
import DrillView from "./DrillView.jsx";

// Raw exception text like "drive 403" tells a coach nothing about what to do next.
// Classify on the numeric code driveApi already attaches; only sniff the text for the
// network case, which has no code. Regexing the message for digits would misread a drill
// named "500 Cones" as a server error.
export function friendlyError(error) {
  if (!error) return "";
  const code = typeof error === "object" ? error.code : undefined;
  const text = String((typeof error === "object" ? error.message : error) ?? "");
  if (code === 401) return "Your Google sign-in expired. Reload to sign in again.";
  if (code === 403) return "Google is rate-limiting requests. Try again in a minute.";
  if (code === 404) return "That drill is no longer in your Drive folder.";
  if (code >= 500 && code < 600) return "Google Drive is having trouble. Try again shortly.";
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return "No connection to Google Drive. Check your signal and try again.";
  }
  return text || "Something went wrong.";
}

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
