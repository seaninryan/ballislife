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
import SquadList from "./SquadList.jsx";
import SquadEditor from "./SquadEditor.jsx";
import { friendlyError } from "../lib/errors.js";

// Re-exported for backward compatibility: existing tests and callers import
// friendlyError from here. The implementation lives in lib/errors.js so Editor.jsx can
// use it too without a circular import (Catalogue renders Editor).
export { friendlyError };

// The sessions file is saved from two places now — the builder and, via progress marks,
// the run view. A save that fails at the side of a pitch must say so there rather than
// only on the screen the coach is not looking at.
//
// A conflict is per plan, and unresolved until the owner answers it, so it is shown
// WHEREVER he is rather than only on the plan it belongs to — a conflict he cannot see is
// one he can never resolve, and the plan stays unsaved meanwhile. What used to make the
// prompt safe (only offering it on the plan on screen) is kept by naming the plan in the
// banner and on both buttons: "Keep mine" writes one file, and it must be obvious which.
// `resolving` is the plans whose Reload is still on the wire. Both buttons go dead for that
// plan while it is, and say so: a round trip on a bad connection looks like nothing happened,
// and answering the same conflict twice writes one version and then displays another.
function SessionsSaveBanner({ status, error, conflicts = [], resolving = [], onKeepMine, onReload }) {
  return (
    <>
      {conflicts.map((c) => {
        const busy = resolving.includes(c.id);
        return (
          <div className="banner warn" key={c.id}>
            The plan for <strong>{c.label}</strong> changed in Drive since you opened it. Your
            edit to it is safe and has not been overwritten — choose which version to keep.
            <div className="row" style={{ marginTop: 6 }}>
              <button type="button" className="primary" disabled={busy} onClick={() => onKeepMine?.(c.id)}>
                Keep mine ({c.label})
              </button>
              <button type="button" disabled={busy} onClick={() => onReload?.(c.id)}>
                Reload Drive’s version ({c.label})
              </button>
              {busy ? <span className="dim">Fetching Drive’s version…</span> : null}
            </div>
          </div>
        );
      })}
      {status === "failed" ? (
        <div className="banner err">
          Could not save: {friendlyError(error)} Your edit is still here and will be
          retried when you change something again.
        </div>
      ) : null}
    </>
  );
}

// Squads live in one file, so there is one conflict and one save state for the lot —
// unlike a plan, which owns its own file. `blocked` is the load saying squads.json exists
// but could not be read: every save is held while it is set, because writing over a file
// we could not read is exactly how a corrupt sessions.json nearly lost every plan.
function SquadsSaveBanner({ status, error, conflict, resolving, blocked, loadError, onKeepMine, onReload }) {
  return (
    <>
      {loadError ? (
        // A load that threw and a file that would not parse are both "we must not write
        // over what we cannot see", but only one of them knows a squads.json is there — so
        // the failed load says the true thing about itself rather than inventing a file.
        <div className="banner err">
          Your squads could not be loaded: {friendlyError(loadError)} Nothing in Drive has
          been changed, and everything else here still works — but saving squads is held
          until they load, because writing without having read them could destroy every
          player in the list. Anything you change here is kept on this device only. Reload
          to try again.
        </div>
      ) : null}
      {blocked && !loadError ? (
        <div className="banner err">
          Your <strong>squads.json</strong> in Drive exists but could not be read
          ({blocked.reason}), so saving squads is blocked — writing over a file we could not
          read could destroy every player in it. Anything you change here is kept on this
          device only. Fix or delete that file in Drive, then reload.
        </div>
      ) : null}
      {conflict ? (
        <div className="banner warn">
          Your squads changed in Drive since you opened them. Your edit is safe and has not
          been overwritten — choose which version to keep.
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="primary" disabled={resolving} onClick={onKeepMine}>
              Keep mine
            </button>
            <button type="button" disabled={resolving} onClick={onReload}>
              Reload Drive’s version
            </button>
            {resolving ? <span className="dim">Fetching Drive’s version…</span> : null}
          </div>
        </div>
      ) : null}
      {status === "failed" ? (
        <div className="banner err">
          Could not save your squads: {friendlyError(error)} Your edit is still here and will
          be retried when you change something again.
        </div>
      ) : null}
    </>
  );
}

export default function Catalogue({
  status, drills = [], failed = [], error, onSignIn,
  filter = {}, onFilterChange, selected, drillStatus, drillText, drillError,
  onOpen, onBack, duplicateFolders,
  editor, onEdit, onEditBack, onDelete, onKeepMine, onReload,
  onStartEdit, onCreate,
  // Which section to render. The Drills/Sessions switch itself moved to the header, which
  // is on screen everywhere; this only decides what goes under it.
  mode = "drills",
  sessions = [], selectedSession, onOpenSession, onCreateSession,
  // The plans that are mid-run today, computed once in App so the header and this list
  // cannot disagree about which one it is.
  activeSessionIds = [],
  onSessionChange, onSessionBack, onDeleteSession,
  sessionsStatus, sessionsError, sessionsConflicts = [], sessionsResolving = [],
  onKeepMineSessions, onReloadSessions,
  sessionsMigrated = 0, sessionsFailed = [], sessionsUnmigrated = [], sessionsLoadError,
  runSession, runTexts, onOpenRun, onRunBack, onRunSwap, onRunProgress,
  squads = [], selectedSquad, onOpenSquad, onCreateSquad, onSquadChange, onSquadBack,
  onDeleteSquad, squadsStatus, squadsError, squadsConflict = false, squadsResolving = false,
  squadsBlocked = null, squadsLoadError, onKeepMineSquads, onReloadSquads,
}) {
  // The sign-in screen is the button and nothing else, centred in the viewport rather
  // than in the page flow — App renders this one outside `.page`, so only the body's
  // safe-area padding has to be taken off the height.
  if (status === "signed-out") {
    return (
      <div className="signin-screen">
        <button className="primary" onClick={onSignIn}>Sign in with Google</button>
      </div>
    );
  }
  if (status === "loading") return <div className="card">Loading your drills…</div>;
  if (status === "not-owner") {
    return <div className="card banner err">This app is for its owner only. You have been signed out.</div>;
  }
  if (status === "error") return <div className="card banner err">{friendlyError(error)}</div>;

  // The old blob failing to read is not "one plan failed": no plan was lost, and counting
  // it as one would tell the owner a plan is missing that never existed as a file.
  const blobUnreadable = sessionsFailed.some((f) => f.reason === "blob");
  // Split by whether reloading can help. A flaky download will fix itself; a file whose
  // JSON or whose name is broken will not, and telling the owner to wait would be a lie.
  const needsDrive = new Set(["parse", "unnamed"]);
  const unloadable = sessionsFailed.filter(
    (f) => f.reason !== "blob" && f.reason !== "duplicate" && !needsDrive.has(f.reason),
  );
  const unfixable = sessionsFailed.filter((f) => needsDrive.has(f.reason));
  // A plan two files claim. It IS shown, so it does not belong with the unreadable ones.
  const duplicated = sessionsFailed.filter((f) => f.reason === "duplicate");
  // A plan still in the blob but shown from it: its file will be written by its next save.
  const notMoved = sessionsUnmigrated.filter(
    (u) => u.reason !== "unsafe-id" && u.reason !== "unreadable-file",
  );
  const unnameable = sessionsUnmigrated.filter((u) => u.reason === "unsafe-id");
  // Shown from the blob too, but saving it is refused rather than pending: a file already
  // claims its name, so writing one now would leave two claiming the plan.
  const fileUnreadable = sessionsUnmigrated.filter((u) => u.reason === "unreadable-file");

  // Rendered on every view below except the drill editor, which has a conflict prompt of
  // its own for the drill being typed into: two identically shaped "Keep mine" offers about
  // two different files on one screen is precisely the wrong, destructive prompt. Leaving
  // that editor lands on the grid, where this is shown.
  const sessionsBanner = (
    <SessionsSaveBanner
      status={sessionsStatus}
      error={sessionsError}
      conflicts={sessionsConflicts}
      resolving={sessionsResolving}
      onKeepMine={onKeepMineSessions}
      onReload={onReloadSessions}
    />
  );

  // Shown wherever the sessions one is, and for the same reason: a conflict — or a squad
  // list that cannot be saved at all — that the owner never sees is one he can never act on.
  const squadsBanner = (
    <SquadsSaveBanner
      status={squadsStatus}
      error={squadsError}
      conflict={squadsConflict}
      resolving={squadsResolving}
      blocked={squadsBlocked}
      loadError={squadsLoadError}
      onKeepMine={onKeepMineSquads}
      onReload={onReloadSquads}
    />
  );

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
        {sessionsBanner}
        {squadsBanner}
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
        {sessionsBanner}
        {squadsBanner}
        <SessionBuilder
          session={selectedSession}
          drills={drills}
          squads={squads}
          onChange={onSessionChange}
          onBack={onSessionBack}
          onDelete={onDeleteSession}
          onRun={onOpenRun}
        />
      </div>
    );
  }

  // One squad takes over the view the way the builder does, and for the same reason: the
  // squad on screen is the one being edited, and there is nothing else to look at.
  if (selectedSquad) {
    return (
      <div>
        {sessionsBanner}
        {squadsBanner}
        {/* Keyed by squad, so switching squads is a new editor rather than the same one
            handed different data. Its half-typed names live in state keyed by player id,
            and ids are made from names — so two squads sharing a player id showed one
            squad's cleared draft on the other's row: a wrong name, in an editable field,
            one keystroke from being saved. Back, forward and a pasted #/squad/<id> all
            change the squad without unmounting. */}
        <SquadEditor
          key={selectedSquad.id}
          squad={selectedSquad}
          onChange={onSquadChange}
          onBack={onSquadBack}
          onDelete={onDeleteSquad}
        />
      </div>
    );
  }

  if (selected) {
    return (
      <div>
        {sessionsBanner}
        {squadsBanner}
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
      {sessionsBanner}
      {squadsBanner}

      {duplicateFolders ? (
        <div className="banner warn">
          There is more than one <strong>BallIsLife</strong> folder in your Drive. Drills
          may be split between them — merge them in Drive to be safe.
        </div>
      ) : null}

      {sessionsMigrated ? (
        <div className="banner warn">
          Moved {sessionsMigrated} session plan{sessionsMigrated === 1 ? "" : "s"} into
          their own files in the <strong>sessions</strong> folder. The old file is kept as{" "}
          <strong>sessions-before-split.json</strong> until you delete it.
        </div>
      ) : null}

      {blobUnreadable ? (
        <div className="banner err">
          Your old <strong>sessions.json</strong> could not be read, so nothing has been
          moved out of it and nothing has been renamed. Any plan still only in that file is
          not listed below yet. It will be tried again next time you reload — if it keeps
          failing, check the file in Drive.
        </div>
      ) : null}

      {sessionsLoadError ? (
        <div className="banner err">
          Your session plans could not be loaded: {friendlyError(sessionsLoadError)} Your
          drills are below, and nothing in Drive has been changed. Reload to try again.
        </div>
      ) : null}

      {notMoved.length ? (
        <div className="banner warn">
          {notMoved.length} session plan{notMoved.length === 1 ? " has" : "s have"} not
          moved into {notMoved.length === 1 ? "its" : "their"} own
          file{notMoved.length === 1 ? "" : "s"} yet
          ({notMoved.map((u) => u.id).join(", ")}). They are still listed here and nothing
          has been lost — it will be tried again when you next save them or reload.
        </div>
      ) : null}

      {fileUnreadable.length ? (
        <div className="banner err">
          {fileUnreadable.length === 1 ? "A plan is" : `${fileUnreadable.length} plans are`} still
          only in your old <strong>sessions.json</strong>
          ({fileUnreadable.map((u) => u.id).join(", ")}), because the file that should hold
          {fileUnreadable.length === 1 ? " it" : " them"} in your <strong>sessions</strong> folder
          could not be read. {fileUnreadable.length === 1 ? "It is" : "They are"} listed here and
          nothing has been lost, but saving {fileUnreadable.length === 1 ? "it" : "them"} is
          blocked so a second file cannot end up claiming the same plan — fix or delete that
          file in Drive, then reload.
        </div>
      ) : null}

      {unloadable.length ? (
        <div className="banner warn">
          {unloadable.length} session plan{unloadable.length === 1 ? "" : "s"} could
          not be loaded: {unloadable.map((f) => f.name).join(", ")}. They will be
          retried next time you reload.
        </div>
      ) : null}

      {unfixable.length ? (
        <div className="banner err">
          {unfixable.length} file{unfixable.length === 1 ? "" : "s"} in your{" "}
          <strong>sessions</strong> folder could not be read as a plan:{" "}
          {unfixable.map((f) => f.name).join(", ")}. Nothing has been changed or deleted, but
          reloading will not help — fix or rename {unfixable.length === 1 ? "it" : "them"} in
          Drive.
        </div>
      ) : null}

      {duplicated.length ? (
        <div className="banner err">
          {duplicated.length === 1 ? "A plan is" : `${duplicated.length} plans are`} claimed
          by more than one file in your <strong>sessions</strong> folder:{" "}
          {duplicated.map((f) => f.name).join("; ")}. The newest of each is shown, and saving
          {duplicated.length === 1 ? " it" : " them"} is blocked so nothing is written into
          the wrong file. Delete or rename the spare in Drive, then reload.
        </div>
      ) : null}

      {unnameable.length ? (
        <div className="banner err">
          {unnameable.length} plan{unnameable.length === 1 ? "" : "s"} in your old{" "}
          <strong>sessions.json</strong> cannot be given a file name
          ({unnameable.map((u) => u.id).join(", ")}), so {unnameable.length === 1 ? "it is" : "they are"}{" "}
          not listed here. That file has been left exactly where it is — rename those ids in
          Drive to look like <strong>2026-08-13</strong> and reload.
        </div>
      ) : null}

      {mode === "squads" ? (
        <SquadList squads={squads} onOpen={onOpenSquad} onCreate={onCreateSquad} />
      ) : mode === "sessions" ? (
        <SessionList
          sessions={sessions}
          drills={drills}
          onOpen={onOpenSession}
          onCreate={onCreateSession}
          onRun={onOpenRun}
          activeIds={activeSessionIds}
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
