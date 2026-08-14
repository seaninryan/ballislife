import React, { useCallback, useEffect, useRef, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import Header from "./components/Header.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import {
  loadCatalogue, readDrill, saveDrill, createDrill, deleteDrill, knownModifiedTime,
  loadSessions, saveSession, deleteSession, loadSquads, saveSquads,
} from "./lib/drive.js";
import { openEditor, reduce, shouldSave } from "./lib/editor.js";
import { emptySession, resolveBlocks, setBlock } from "./lib/sessions.js";
import { emptySquad, linkSquadId } from "./lib/squads.js";
import { slugify } from "./lib/drills.js";
import { withSessionProgress, activeSessionIds } from "./lib/progress.js";
import { localStore, todayIso } from "./lib/browser.js";
import { parseHash, formatHash } from "./lib/route.js";

const SAVE_DEBOUNCE_MS = 900;

const currentHash = () => (typeof location !== "undefined" ? location.hash : "");

export default function App() {
  const [status, setStatus] = useState("starting");
  const [drills, setDrills] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({});
  const [selected, setSelected] = useState(null);
  const [drillStatus, setDrillStatus] = useState("loading");
  const [drillText, setDrillText] = useState("");
  const [drillError, setDrillError] = useState(null);
  const [failed, setFailed] = useState([]);
  const [duplicateFolders, setDuplicateFolders] = useState(false);
  const [editor, setEditor] = useState(null);
  const [mode, setMode] = useState("drills");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  // Each plan is its own Drive file, so the save state is per session: `meta` holds each
  // one's file and conflict baseline and `dirty` the ids still awaiting a write. `data`
  // stays the id-keyed map every session view already renders — only loading and saving
  // are per file.
  const [sessionsState, setSessionsStateRaw] = useState({
    data: { version: 1, sessions: {} },
    meta: {},       // id -> { fileId, modifiedTime }: the per-file conflict baseline
    dirty: [],      // ids awaiting a save, in the order they were touched
    // Ids Drive refused because it has moved on. Per id, not one `conflictId`: one flush
    // can conflict on two plans, and a conflicted plan must stay unsent — with its edit
    // kept — until the owner resolves THAT plan, while the others go on saving.
    conflicts: [],
    // Save state for the batch, not for any one plan: a conflict is per id (above), so a
    // failure on one plan is still reported while another is waiting to be resolved.
    status: "idle", // idle | dirty | saving | failed
    error: null,
  });
  // Reported once after the load that did the work: the blob split is invisible in Drive
  // otherwise, and the owner should know his plans moved and where the backup is.
  const [sessionsMigrated, setSessionsMigrated] = useState(0);
  const [sessionsFailed, setSessionsFailed] = useState([]);
  // Plans read out of the old blob that have no file of their own yet, and a sessions load
  // that failed entirely. Both are reported next to the drills rather than as an error
  // screen: the catalogue is already loaded by then, and hiding it costs more than it saves.
  const [sessionsUnmigrated, setSessionsUnmigrated] = useState([]);
  const [sessionsLoadError, setSessionsLoadError] = useState(null);
  // Every squad lives in ONE file, so unlike the plans there is one baseline, one dirty
  // flag and one conflict for the lot — the pre-split sessions shape, which is right here
  // for the reasons the plan gives: a handful of squads, edited a few times a season.
  const [squadsState, setSquadsStateRaw] = useState({
    data: {},            // id -> squad
    fileId: null,        // null until squads.json exists; the first save creates it
    modifiedTime: null,  // the conflict baseline Drive last reported
    dirty: false,
    // Drive has moved on. The edit is kept and NOT re-sent — the baseline has been moved to
    // what Drive reported, so re-sending would silently win — until the owner answers.
    conflict: false,
    // The load found a squads.json it could not read. Every save is held while this is set:
    // writing over a file we could not read is how a corrupt sessions.json nearly lost every
    // plan. Only a reload, after the file is fixed in Drive, clears it.
    blocked: null,       // null | { reason }
    status: "idle",      // idle | dirty | saving | failed
    error: null,
  });
  const [squadsLoadError, setSquadsLoadError] = useState(null);
  const [squadsResolving, setSquadsResolving] = useState(false);
  const [selectedSquadId, setSelectedSquadId] = useState(null);
  const folderRef = useRef(null);
  // A monotonic token, not the drill id: reopening the SAME drill starts a second
  // request that an id check cannot tell from the first, so the slower response won.
  const requestSeq = useRef(0);

  // Run mode: which session is being run, and each referenced drill's full text.
  const [runSessionId, setRunSessionId] = useState(null);
  const [runTexts, setRunTexts] = useState({});
  // Same stale-request problem as requestSeq, applied to a whole batch of parallel
  // fetches: leaving the run view and reopening it (the same session or a different
  // one) must not let an in-flight fetch from the abandoned visit land here.
  const runRequestSeq = useRef(0);
  // Keyed by drill slug rather than by session, so two sessions sharing a drill also
  // benefit — but the guarantee the plan asks for is narrower: reopening the SAME
  // session's run view within this app session must not refetch anything it already
  // has. Only successes are cached; a failed fetch is retried on the next visit.
  const drillTextCache = useRef(new Map());

  // Kept alongside the state so the debounce callback and the flush-on-close path read
  // the latest editor state without being re-created on every keystroke.
  const editorRef = useRef(null);
  const saveTimer = useRef(null);
  const routeRef = useRef(parseHash(currentHash()));

  const setEditorState = useCallback((next) => {
    editorRef.current = next;
    setEditor(next);
  }, []);

  // Same pattern as editorRef: the debounce callback and hashchange listener read the
  // latest sessions state without being re-created on every keystroke.
  const sessionsStateRef = useRef(sessionsState);
  const setSessionsState = useCallback((next) => {
    sessionsStateRef.current = next;
    setSessionsStateRaw(next);
  }, []);
  const sessionsSaveTimer = useRef(null);

  const dispatch = useCallback((action) => {
    if (!editorRef.current) return;
    setEditorState(reduce(editorRef.current, action));
  }, [setEditorState]);

  // Writes whatever is pending for the CURRENTLY open editor, if anything is. Called
  // both by the debounce timer and whenever the editor is about to close or switch
  // drills, so the last keystrokes before a navigation are never silently dropped.
  const flushSave = useCallback(async () => {
    const state = editorRef.current;
    if (!state || !shouldSave(state)) return;
    const text = state.text;
    dispatch({ type: "saveStarted" });
    const result = await saveDrill({
      id: state.id,
      text,
      baseModifiedTime: state.baseModifiedTime,
    });
    if (!editorRef.current || editorRef.current.id !== state.id) return; // moved on
    if (result.ok) {
      // Adopt the modifiedTime from every success, coalesced included — that is the
      // Drive layer's contract, and skipping it makes the next save conflict with the
      // user's own keystroke.
      dispatch({ type: "saveSucceeded", savedText: text, modifiedTime: result.modifiedTime });
    } else if (result.conflict) {
      dispatch({ type: "saveConflicted", modifiedTime: result.modifiedTime });
    } else {
      dispatch({ type: "saveFailed", error: result.error });
    }
  }, [dispatch]);

  const onEditChange = useCallback((text) => {
    dispatch({ type: "edit", text });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [dispatch, flushSave]);

  // Closes whatever editor is open, flushing any unsaved text first. Synchronous up to
  // the point flushSave awaits Drive, so it captures the outgoing editor's state before
  // this function clears it — the save call itself is not cancelled by closing.
  const closeEditor = useCallback(() => {
    clearTimeout(saveTimer.current);
    flushSave();
    editorRef.current = null;
    setEditor(null);
  }, [flushSave]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Guards against two flushes overlapping and writing the same file twice with the same
  // baseline, which Drive would report as a conflict against ourselves. The flush in
  // flight rechecks `dirty` when it ends, so nothing is stranded by the early return.
  const sessionsSaving = useRef(false);

  // Writes every dirty plan, one file each, against that plan's own baseline. Each result
  // is applied to its own id: a conflict or a failure on tonight's plan must leave every
  // other plan's pending edit exactly where it was, which is the whole point of the split.
  const flushSessionsSave = useCallback(async () => {
    if (sessionsSaving.current) return;
    const start = sessionsStateRef.current;
    // A conflicted plan is deliberately NOT sent: its baseline has been moved to what Drive
    // reported, so re-sending it would succeed and overwrite the other device's version
    // without the owner ever choosing. Only Keep mine or Reload clears it.
    const ids = start.dirty.filter((id) => !start.conflicts.includes(id));
    if (!ids.length) return;
    sessionsSaving.current = true;
    setSessionsState({ ...start, status: "saving" });

    const metaUpdates = {};
    const done = new Set();
    const conflicted = [];
    let error = null;

    try {
      for (const id of ids) {
        // Read at the moment of sending, not from a snapshot taken before the loop: an
        // earlier plan's save is awaited here, and this one may have been deleted (saving
        // it would re-create the file) or edited (below) in the meantime.
        const session = sessionsStateRef.current.data.sessions[id];
        // Deleted while it was waiting for its write. Saving it would resurrect the file.
        if (!session) { done.add(id); continue; }
        const result = await saveSession({
          folder: folderRef.current,
          id,
          session,
          baseModifiedTime: sessionsStateRef.current.meta[id]?.modifiedTime ?? null,
        });
        if (result.ok) {
          // The fileId only arrives with the save that created the file, so keep the known
          // one otherwise: it is what a later delete has to trash.
          metaUpdates[id] = {
            fileId: result.fileId ?? sessionsStateRef.current.meta[id]?.fileId ?? null,
            modifiedTime: result.modifiedTime,
          };
          // Identity, not equality: an edit made WHILE this save was in flight leaves a new
          // object here, and that edit has not reached Drive — so the id stays dirty and is
          // saved again rather than being reported as the one that was written.
          if (sessionsStateRef.current.data.sessions[id] === session) done.add(id);
        } else if (result.conflict) {
          // Adopt what Drive reports so "Keep mine" can write over it, and leave the id
          // dirty: never touch `data`, since the owner's plan is what must survive.
          metaUpdates[id] = {
            ...sessionsStateRef.current.meta[id],
            modifiedTime: result.modifiedTime,
          };
          conflicted.push(id);
        } else {
          error = result.error;
        }
      }
    } finally {
      sessionsSaving.current = false;
    }

    const latest = sessionsStateRef.current;
    const meta = { ...latest.meta };
    for (const [id, m] of Object.entries(metaUpdates)) {
      // A plan deleted mid-flush must not get its file id back.
      if (latest.data.sessions[id]) meta[id] = m;
    }
    const dirty = latest.dirty.filter((id) => !done.has(id));
    // Conflicts survive a flush that did not include them, and a plan deleted meanwhile has
    // nothing left to resolve.
    const conflicts = [...new Set([...latest.conflicts, ...conflicted])]
      .filter((id) => latest.data.sessions[id]);
    // What is still worth retrying: a conflicted plan is not, until the owner chooses.
    const pending = dirty.filter((id) => !conflicts.includes(id));
    // A failure stops the automatic retry — it waits for the next edit, the same terms the
    // drill editor offers. A conflict on one plan stops only that plan.
    const status = error ? "failed" : pending.length ? "dirty" : "idle";
    setSessionsState({ ...latest, meta, dirty, conflicts, status, error: error ?? null });
    if (pending.length && !error) sessionsSaveTimer.current = setTimeout(flushSessionsSave, SAVE_DEBOUNCE_MS);
  }, [setSessionsState]);

  const scheduleSessionsSave = useCallback(() => {
    clearTimeout(sessionsSaveTimer.current);
    sessionsSaveTimer.current = setTimeout(flushSessionsSave, SAVE_DEBOUNCE_MS);
  }, [flushSessionsSave]);

  // A block/date/theme/etc change from the builder: merge it into the sessions map by id
  // and mark THAT id dirty. A conflict is not cleared by editing further — Drive is still
  // ahead of us — only keepMine or reload resolves it, same as the drill editor.
  const onSessionChange = useCallback((updatedSession) => {
    const cur = sessionsStateRef.current;
    const nextData = {
      ...cur.data,
      sessions: { ...cur.data.sessions, [updatedSession.id]: updatedSession },
    };
    setSessionsState({
      ...cur,
      data: nextData,
      dirty: cur.dirty.includes(updatedSession.id) ? cur.dirty : [...cur.dirty, updatedSession.id],
      status: "dirty",
    });
    scheduleSessionsSave();
  }, [setSessionsState, scheduleSessionsSave]);

  // Plans with a Reload on the wire. Both resolutions write — Keep mine writes to Drive,
  // Reload writes Drive's version over what is on this device — so answering one plan twice
  // while the first answer is still travelling makes the app show a version Drive does not
  // have, or overwrites the one it has just taken. Only one answer per plan is accepted at a
  // time, and the banner says which plan is working rather than looking inert.
  const [sessionsResolving, setSessionsResolving] = useState([]);
  const resolving = useRef(new Set());
  const beginResolve = useCallback((id) => {
    if (resolving.current.has(id)) return false;
    resolving.current.add(id);
    setSessionsResolving([...resolving.current]);
    return true;
  }, []);
  const endResolve = useCallback((id) => {
    resolving.current.delete(id);
    setSessionsResolving([...resolving.current]);
  }, []);

  // Resolves ONE plan's conflict: "Keep mine" writes one file, so it is always answered
  // about the plan the banner names, never about whatever else is conflicted too.
  const onKeepMineSessions = useCallback((id) => {
    const cur = sessionsStateRef.current;
    if (!cur.conflicts.includes(id)) return;
    // Answering this plan's conflict is already in progress; that answer wins.
    if (resolving.current.has(id)) return;
    // This id's baseline was already moved to Drive's current value when the conflict was
    // reported, so dropping it from `conflicts` is enough for the next flush to send our
    // plan and win.
    const conflicts = cur.conflicts.filter((c) => c !== id);
    setSessionsState({
      ...cur,
      dirty: cur.dirty.includes(id) ? cur.dirty : [...cur.dirty, id],
      conflicts,
      status: "dirty",
    });
    sessionsSaveTimer.current = setTimeout(flushSessionsSave, 0);
  }, [setSessionsState, flushSessionsSave]);

  // Takes Drive's version of ONE plan, dropping this device's unsaved edit to it — which is
  // what Reload means — and only to it. With a file per plan there is no reason for the
  // answer about tonight's session to discard an edit to next week's that has not landed
  // yet. The whole set is refetched because that is the only read the Drive layer offers,
  // but only the named plan is applied.
  const onReloadSessions = useCallback(async (id) => {
    if (!id) return;
    // Also what stops a double tap issuing two concurrent loads, each rewriting the index and
    // each landing into the state after the other.
    if (!beginResolve(id)) return;
    let loaded;
    try {
      loaded = await loadSessions(folderRef.current);
    } finally {
      endResolve(id);
    }
    const { sessions, meta, migrated, failed: unreadable, unmigrated } = loaded;
    const cur = sessionsStateRef.current;
    const nextSessions = { ...cur.data.sessions };
    const nextMeta = { ...cur.meta };
    // Gone from Drive is an answer too: the plan was deleted on the other device.
    if (sessions[id]) nextSessions[id] = sessions[id]; else delete nextSessions[id];
    if (meta?.[id]) nextMeta[id] = meta[id]; else delete nextMeta[id];
    setSessionsState({
      ...cur,
      data: { ...cur.data, sessions: nextSessions },
      meta: nextMeta,
      // This plan has nothing left to save and nothing left to resolve. Every other plan's
      // pending edit, conflict and failure is exactly as it was.
      dirty: cur.dirty.filter((d) => d !== id),
      conflicts: cur.conflicts.filter((c) => c !== id),
    });
    setSessionsMigrated(migrated ?? 0);
    setSessionsFailed(unreadable ?? []);
    // The load reported these too, so leaving them from the previous load would keep a
    // banner on screen about a state this read has just replaced.
    setSessionsUnmigrated(unmigrated ?? []);
    setSessionsLoadError(null);
  }, [setSessionsState, beginResolve, endResolve]);

  useEffect(() => () => clearTimeout(sessionsSaveTimer.current), []);

  // Same ref-beside-state pattern as the plans: the debounce callback reads the latest
  // squads without being re-created on every keystroke.
  const squadsStateRef = useRef(squadsState);
  const setSquadsState = useCallback((next) => {
    squadsStateRef.current = next;
    setSquadsStateRaw(next);
  }, []);
  const squadsSaveTimer = useRef(null);
  // Two flushes overlapping would write the same file twice against the same baseline, and
  // Drive would report the second as a conflict against our own first write.
  const squadsSaving = useRef(false);

  // Writes the whole squad list, one file, against the one baseline.
  const flushSquadsSave = useCallback(async () => {
    if (squadsSaving.current) return;
    const start = squadsStateRef.current;
    // Nothing to send; already refused by Drive and waiting for an answer; or held because
    // the file in Drive could not be read and must not be written over.
    if (!start.dirty || start.conflict || start.blocked) return;
    squadsSaving.current = true;
    setSquadsState({ ...start, status: "saving" });

    const sent = start.data;
    let result;
    try {
      result = await saveSquads({
        folder: folderRef.current,
        fileId: start.fileId,
        data: sent,
        baseModifiedTime: start.modifiedTime,
      });
    } catch (error) {
      // saveSquads reports rather than throws, but a rejection here must still not take the
      // app down with it — the edit is in memory and the next change retries.
      result = { ok: false, error };
    } finally {
      squadsSaving.current = false;
    }

    const latest = squadsStateRef.current;
    if (result.ok) {
      // Identity, not equality: an edit made WHILE this save was in flight has not reached
      // Drive, so the list stays dirty and is written again rather than reported as saved.
      const stillDirty = latest.data !== sent;
      setSquadsState({
        ...latest,
        // The fileId only arrives with the save that created the file.
        fileId: result.fileId ?? latest.fileId,
        modifiedTime: result.modifiedTime,
        dirty: stillDirty,
        status: stillDirty ? "dirty" : "idle",
        error: null,
      });
      if (stillDirty) squadsSaveTimer.current = setTimeout(flushSquadsSave, SAVE_DEBOUNCE_MS);
    } else if (result.conflict) {
      // Adopt what Drive reports so "Keep mine" can write over it, and never touch `data`:
      // the owner's version is what must survive until he chooses.
      setSquadsState({ ...latest, modifiedTime: result.modifiedTime, conflict: true, status: "dirty" });
    } else {
      // A failure stops the automatic retry — it waits for the next edit, the same terms
      // the drill editor and the plans offer.
      setSquadsState({ ...latest, status: "failed", error: result.error });
    }
  }, [setSquadsState]);

  const scheduleSquadsSave = useCallback(() => {
    clearTimeout(squadsSaveTimer.current);
    squadsSaveTimer.current = setTimeout(flushSquadsSave, SAVE_DEBOUNCE_MS);
  }, [flushSquadsSave]);

  // One squad changed: merge it in by id and mark the file dirty. A conflict is not cleared
  // by editing further — Drive is still ahead of us — only Keep mine or Reload resolves it.
  const onSquadChange = useCallback((squad) => {
    const cur = squadsStateRef.current;
    setSquadsState({
      ...cur,
      data: { ...cur.data, [squad.id]: squad },
      dirty: true,
      status: "dirty",
    });
    scheduleSquadsSave();
  }, [setSquadsState, scheduleSquadsSave]);

  // Closes the squad on screen, flushing any unsaved change first — the squads equivalent
  // of closeEditor and closeSessionBuilder.
  const closeSquadEditor = useCallback(() => {
    clearTimeout(squadsSaveTimer.current);
    flushSquadsSave();
    setSelectedSquadId(null);
  }, [flushSquadsSave]);

  const onSquadBack = useCallback(() => {
    closeSquadEditor();
    location.hash = formatHash({ view: "squads" });
  }, [closeSquadEditor]);

  const onOpenSquad = useCallback((squad) => {
    setSelectedSquadId(squad.id);
    location.hash = formatHash({ view: "squad", slug: squad.id });
  }, []);

  // The baseline was already moved to Drive's current value when the conflict was reported,
  // so clearing the flag is enough for the next flush to send our version and win.
  const onKeepMineSquads = useCallback(() => {
    const cur = squadsStateRef.current;
    if (!cur.conflict) return;
    if (squadsResolving) return; // a Reload is on the wire; that answer wins
    setSquadsState({ ...cur, conflict: false, dirty: true, status: "dirty" });
    squadsSaveTimer.current = setTimeout(flushSquadsSave, 0);
  }, [setSquadsState, flushSquadsSave, squadsResolving]);

  // Takes Drive's squads, dropping this device's unsaved edit to them — which is what
  // Reload means. Also what stops a double tap issuing two concurrent loads.
  const onReloadSquads = useCallback(async () => {
    if (squadsResolving) return;
    setSquadsResolving(true);
    let loaded;
    try {
      loaded = await loadSquads(folderRef.current);
    } catch (e) {
      setSquadsResolving(false);
      setSquadsLoadError(e);
      return;
    }
    setSquadsResolving(false);
    setSquadsState({
      ...squadsStateRef.current,
      data: loaded.squads ?? {},
      fileId: loaded.fileId ?? null,
      modifiedTime: loaded.modifiedTime ?? null,
      dirty: false,
      conflict: false,
      blocked: loaded.failed ?? null,
      status: "idle",
      error: null,
    });
    setSquadsLoadError(null);
  }, [setSquadsState, squadsResolving]);

  useEffect(() => () => clearTimeout(squadsSaveTimer.current), []);

  // Whether the plans have had their one automatic load. They are loaded once, with the
  // first catalogue, and never again by a later one: `load` also runs on New drill and
  // Delete drill, and replacing the sessions state there threw away every unsaved edit and
  // unresolved conflict along with it. For a conflicted plan — held back from Drive on
  // purpose until the owner answers — that in-memory copy is the ONLY copy, so a drill-side
  // action must not reach into session state at all. Set before the load rather than after,
  // so even a failed one is not retried behind a plan the owner has since typed into; the
  // banner asks him to reload the page instead. Reload (per plan) is the other way in.
  const sessionsLoaded = useRef(false);
  // The same one-automatic-load rule, for the same reason: a drill-side action must not
  // reach into squad state, where an unsaved edit may be the only copy.
  const squadsLoaded = useRef(false);

  // Gives every plan that names its squad only in free text the id of the squad of that
  // name. IN MEMORY ONLY, deliberately: this is a change to a session, so marking them
  // dirty would be honest — and would fire one write per plan the moment the app opens, on
  // the connection least able to take it, for a link that costs nothing to recompute next
  // time. The next real edit to a plan carries its link to Drive with it.
  const linkSessionsToSquads = useCallback((squads) => {
    if (!Object.keys(squads).length) return;
    const cur = sessionsStateRef.current;
    const linked = {};
    let changed = false;
    for (const [id, sess] of Object.entries(cur.data.sessions)) {
      const next = linkSquadId(sess, squads);
      linked[id] = next;
      if (next !== sess) changed = true;
    }
    // `dirty` is untouched on purpose — see above.
    if (changed) setSessionsState({ ...cur, data: { ...cur.data, sessions: linked } });
  }, [setSessionsState]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      // The owner gate. Not a security boundary — see src/lib/owner.js — it stops a
      // stranger who finds this URL using this deployment against their own Drive.
      const email = await aboutEmail(getAccessToken());
      if (!(await isOwner(email))) {
        signOut();
        setStatus("not-owner");
        return null;
      }
      startTokenKeepAlive();
      const { drills: loaded, failed: notLoaded, folderId, duplicateFolders: dupes } = await loadCatalogue();
      folderRef.current = folderId;
      setDrills(loaded);
      setFailed(notLoaded ?? []);
      setDuplicateFolders(Boolean(dupes));
      // Sessions load after drills: they reference drills by slug, so nothing about
      // resolving a session needs the catalogue to still be loading. Once only — see
      // `sessionsLoaded` above.
      //
      // Its own try/catch, deliberately: this ran inside the one below, so a single flaky
      // request during the one-time blob migration replaced the whole app — drills
      // included, all of them already loaded — with an error screen.
      if (!sessionsLoaded.current) {
        sessionsLoaded.current = true;
        try {
          const { sessions, meta, migrated, failed: unreadable, unmigrated } =
            await loadSessions(folderId);
          setSessionsState({
            data: { version: 1, sessions },
            meta: meta ?? {},
            dirty: [],
            conflicts: [],
            status: "idle",
            error: null,
          });
          setSessionsMigrated(migrated ?? 0);
          setSessionsFailed(unreadable ?? []);
          setSessionsUnmigrated(unmigrated ?? []);
          setSessionsLoadError(null);
        } catch (e) {
          // Nothing in Drive has been changed by a failed load, so the plans are still there
          // to find on the next one. Say so, and leave the drills usable meanwhile.
          setSessionsLoadError(e);
        }
      }
      // Squads load after the plans, because linking a plan to its squad needs both. Its
      // own try/catch for the same reason the sessions load has one — and its OWN error
      // state rather than the sessions one, so a failure here cannot report "your session
      // plans could not be loaded" about plans that loaded perfectly well. Once only, for
      // the same reason: `load` also runs on New drill and Delete drill, and replacing the
      // squads state there would throw away an unsaved edit or an unanswered conflict.
      if (!squadsLoaded.current) {
        squadsLoaded.current = true;
        try {
          const { squads, fileId, modifiedTime, failed: unreadable } = await loadSquads(folderId);
          setSquadsState({
            data: squads ?? {},
            fileId: fileId ?? null,
            modifiedTime: modifiedTime ?? null,
            dirty: false,
            conflict: false,
            // A squads.json that exists but could not be read. Holding every save is the
            // whole point of the load reporting it separately from "there are no squads".
            blocked: unreadable ?? null,
            status: "idle",
            error: null,
          });
          setSquadsLoadError(null);
          linkSessionsToSquads(squads ?? {});
        } catch (e) {
          // Nothing in Drive has been changed by a failed load, and everything else on
          // screen still works. Say so rather than blanking the app.
          //
          // And hold every save: a load that threw tells us NOTHING about squads.json —
          // not even whether there is one. Leaving the state at its initial value is
          // byte-identical to "there is no file yet", so the next save takes the create
          // path and writes a SECOND squads.json, which loadSquads then picks between at
          // random. Unknown gets the same answer as unreadable.
          setSquadsState({ ...squadsStateRef.current, blocked: { reason: "load" } });
          setSquadsLoadError(e);
        }
      }
      setStatus("ready");
      return loaded;
    } catch (e) {
      setError(e);
      setStatus("error");
      return null;
    }
  }, [setSessionsState, setSquadsState, linkSessionsToSquads]);

  useEffect(() => {
    let cancelled = false;
    initAuth().then((ready) => {
      if (cancelled) return;
      if (!ready) { setError("Google sign-in failed to load"); setStatus("error"); return; }
      if (isSignedIn()) load();
      else setStatus("signed-out");
    });
    return () => { cancelled = true; };
  }, [load]);

  const onSignIn = useCallback(async () => {
    if (await signIn()) load();
  }, [load]);

  const openDrill = useCallback(async (drill) => {
    closeEditor();
    location.hash = formatHash({ view: "read", slug: drill.slug });
    const mine = ++requestSeq.current;
    setSelected(drill);
    setDrillStatus("loading");
    setDrillText("");
    try {
      const { text } = await readDrill(drill.id, folderRef.current);
      if (requestSeq.current !== mine) return; // superseded
      setDrillText(text);
      setDrillStatus("ready");
    } catch (e) {
      if (requestSeq.current !== mine) return;
      setDrillError(e);
      setDrillStatus("error");
    }
  }, [closeEditor]);

  const goBrowse = useCallback(() => {
    closeEditor();
    setSelected(null);
    location.hash = formatHash({ view: "browse" });
  }, [closeEditor]);

  const openEdit = useCallback(async (drill) => {
    if (editorRef.current?.id === drill.id) return; // already editing this one
    closeEditor();
    location.hash = formatHash({ view: "edit", slug: drill.slug });
    const mine = ++requestSeq.current;
    try {
      const { text, modifiedTime } = await readDrill(drill.id, folderRef.current);
      if (requestSeq.current !== mine) return; // superseded
      setSelected(drill);
      setEditorState(openEditor(drill.id, text, modifiedTime));
    } catch (e) {
      if (requestSeq.current !== mine) return;
      setDrillError(e);
      setDrillStatus("error");
      setSelected(drill);
    }
  }, [closeEditor, setEditorState]);

  const onKeepMine = useCallback(() => {
    if (!editorRef.current) return;
    dispatch({ type: "keepMine", modifiedTime: knownModifiedTime(editorRef.current.id) });
    saveTimer.current = setTimeout(flushSave, 0);
  }, [dispatch, flushSave]);

  const onReloadDrive = useCallback(async () => {
    const state = editorRef.current;
    if (!state) return;
    const { text, modifiedTime } = await readDrill(state.id, folderRef.current);
    if (!editorRef.current || editorRef.current.id !== state.id) return;
    dispatch({ type: "reloaded", text, modifiedTime });
  }, [dispatch]);

  const onDeleteDrill = useCallback(async () => {
    const state = editorRef.current;
    const id = state ? state.id : selected?.id;
    if (!id) return;
    if (!window.confirm("Delete this drill? It goes to Drive's bin, not destroyed.")) return;
    clearTimeout(saveTimer.current);
    editorRef.current = null; // do not let a stray flush resurrect a deleted file
    setEditor(null);
    await deleteDrill(id);
    setSelected(null);
    location.hash = formatHash({ view: "browse" });
    await load();
  }, [selected, load]);

  const onCreate = useCallback(async () => {
    const title = window.prompt("Title for the new drill?");
    if (!title || !title.trim()) return;
    const taken = drills.map((d) => `${d.slug}.md`);
    const created = await createDrill(folderRef.current, title.trim(), taken);
    const loaded = await load();
    const drill = loaded?.find((d) => d.id === created.id);
    if (drill) openEdit(drill);
  }, [drills, load, openEdit]);

  // Closes the builder, flushing any unsaved change first — the sessions equivalent of
  // closeEditor.
  const closeSessionBuilder = useCallback(() => {
    clearTimeout(sessionsSaveTimer.current);
    flushSessionsSave();
    setSelectedSessionId(null);
  }, [flushSessionsSave]);

  // Leaving the builder must move the URL too, not just the state. closeSessionBuilder
  // is also a helper for openRun and onModeChange, which write their own hash, so the
  // navigation lives here rather than inside it: without this the route resolver re-read
  // the unchanged #/session/<id> and re-opened the builder that had just been closed.
  const onSessionBack = useCallback(() => {
    closeSessionBuilder();
    location.hash = formatHash({ view: "sessions" });
  }, [closeSessionBuilder]);

  const onOpenSession = useCallback((sess) => {
    setRunSessionId(null);
    setSelectedSessionId(sess.id);
    location.hash = formatHash({ view: "session", slug: sess.id });
  }, []);

  // Slugs with a read in flight, each recorded under the run-visit token it was issued
  // under. Narrower than it looks: openRun never consults this, so re-entering a run
  // view while a read is pending does start a second read for the same slug. What it
  // guarantees is that a swap does not add a read for a drill THIS visit is already
  // fetching — and, because the token is recorded, that a leftover entry from a visit
  // that has been left never suppresses a swap's read (that reply would be dropped).
  const runFetching = useRef(new Map());

  // A read counts as in flight only if the visit that issued it is still the one on
  // screen. An entry left over from a visit that has been left is worthless — its reply
  // will be dropped by the token guard below — so it must not suppress a fresh read.
  const runFetchInFlight = (slug) => runFetching.current.get(slug) === runRequestSeq.current;

  // Settling clears the entry only if it is still this fetch's own: a stale read landing
  // after a newer one was issued for the same slug must not un-track the newer one.
  const runFetchSettled = (slug, token) => {
    if (runFetching.current.get(slug) === token) runFetching.current.delete(slug);
  };

  // Fetches one drill's text into runTexts, tagged with the run-visit token so a reply
  // landing after the run view has been left is dropped. Shared by openRun's opening
  // batch and by a mid-session swap.
  const fetchRunText = useCallback((drill, token) => {
    runFetching.current.set(drill.slug, token);
    readDrill(drill.id, folderRef.current).then(
      ({ text }) => {
        const entry = { status: "ready", text };
        drillTextCache.current.set(drill.slug, entry);
        runFetchSettled(drill.slug, token);
        if (runRequestSeq.current !== token) return; // this run view has been left
        setRunTexts((prev) => ({ ...prev, [drill.slug]: entry }));
      },
      (error) => {
        // Deliberately not cached: a flaky read is ordinary on a phone at the side of a
        // pitch (same reasoning as loadCatalogue's per-drill failure), and the next
        // visit should try again rather than remembering the failure forever.
        runFetchSettled(drill.slug, token);
        if (runRequestSeq.current !== token) return;
        setRunTexts((prev) => ({ ...prev, [drill.slug]: { status: "error", error } }));
      },
    );
  }, []);

  // Opens run mode for a session: fetches each referenced drill's full text ONCE, in
  // parallel, reusing whatever this app session already fetched for it. Mirrors
  // openDrill's stale-request guard, but the token guards a whole batch rather than
  // one request, since running a session issues one fetch per block.
  const openRun = useCallback((sess) => {
    closeEditor();
    closeSessionBuilder();
    setSelected(null);
    setRunSessionId(sess.id);
    location.hash = formatHash({ view: "run", slug: sess.id });
    const mine = ++runRequestSeq.current;

    const wanted = new Map();
    for (const block of resolveBlocks(sess, drills)) {
      if (block.drill) wanted.set(block.drill.slug, block.drill);
    }

    const seeded = {};
    const toFetch = [];
    for (const drill of wanted.values()) {
      const cached = drillTextCache.current.get(drill.slug);
      if (cached) seeded[drill.slug] = cached;
      else { seeded[drill.slug] = { status: "loading" }; toFetch.push(drill); }
    }
    setRunTexts(seeded);

    for (const drill of toFetch) fetchRunText(drill, mine);
  }, [drills, closeEditor, closeSessionBuilder, fetchRunText]);

  // A mid-session swap is a real edit to the plan, not a run-only override: if ten
  // players turn up and the 11v11 becomes a 5v5, that is what the session WAS. So it
  // goes through onSessionChange like any builder edit and saves with the same debounce.
  // The block's own minutes are cleared so the new drill's duration applies rather than
  // the one it replaced.
  const onRunSwap = useCallback((index, slug) => {
    const sess = sessionsStateRef.current.data.sessions[runSessionId];
    if (!sess) return;
    onSessionChange(setBlock(sess, index, { drill: slug, minutes: null }));

    const drill = drills.find((d) => d.slug === slug);
    if (!drill) return;
    const cached = drillTextCache.current.get(drill.slug);
    if (cached) { setRunTexts((prev) => ({ ...prev, [drill.slug]: cached })); return; }
    if (runFetchInFlight(drill.slug)) return;
    setRunTexts((prev) => ({ ...prev, [drill.slug]: { status: "loading" } }));
    fetchRunText(drill, runRequestSeq.current);
  }, [runSessionId, drills, onSessionChange, fetchRunText]);

  // A mark from the run view. Same path as any other session edit — merge into the
  // sessions map, schedule the debounced save — so tonight's progress reaches Drive and
  // the laptop. The run view's own localStorage write has already made it durable on
  // this device whether or not this succeeds.
  const onRunProgress = useCallback((day, marks, updatedAt) => {
    const sess = sessionsStateRef.current.data.sessions[runSessionId];
    if (!sess) return;
    onSessionChange(withSessionProgress(sess, day, marks, updatedAt));
  }, [runSessionId, onSessionChange]);

  // Back to the plan = the builder for the session that was just being run, not the
  // session list — running is a detour from editing, not a replacement for it.
  const onRunBack = useCallback(() => {
    const id = runSessionId;
    runRequestSeq.current++; // any fetch still in flight for this visit is now stale
    setRunSessionId(null);
    if (id) {
      setSelectedSessionId(id);
      location.hash = formatHash({ view: "session", slug: id });
    } else {
      location.hash = formatHash({ view: "sessions" });
    }
  }, [runSessionId]);

  // Both directions now leave EVERY view, not just the one the other section could be
  // reached from. These used to be reachable only from the browse view, so "Drills" never
  // had to close a drill or an editor and "Sessions" never had a builder edit to flush;
  // from the header they are one tap away from inside the editor, the builder and the run
  // view, and each of those closes through the path that flushes its pending save.
  const onModeChange = useCallback((next) => {
    runRequestSeq.current++; // leaving run mode, if it was open, stales any in-flight fetch
    setRunSessionId(null);
    closeEditor();
    setSelected(null);
    closeSessionBuilder();
    // A squad is edited in place with a debounced save, exactly like a plan, so leaving it
    // for another section has to go through the path that flushes it — otherwise the last
    // name typed before the tap is dropped.
    closeSquadEditor();
    if (next === "sessions") {
      setMode("sessions");
      location.hash = formatHash({ view: "sessions" });
    } else if (next === "squads") {
      setMode("squads");
      location.hash = formatHash({ view: "squads" });
    } else {
      setMode("drills");
      location.hash = formatHash({ view: "browse" });
    }
  }, [closeEditor, closeSessionBuilder, closeSquadEditor]);

  // A new squad: a name, and an id made from it that no existing squad already has.
  const onCreateSquad = useCallback(() => {
    const name = window.prompt("Name for the new squad? (e.g. U14A Boys)");
    if (!name || !name.trim()) return;
    const base = slugify(name.trim());
    const existing = squadsStateRef.current.data;
    let id = base;
    for (let n = 2; existing[id]; n++) id = `${base}-${n}`;
    onSquadChange(emptySquad(id, name.trim()));
    setSelected(null);
    setMode("squads");
    setSelectedSquadId(id);
    location.hash = formatHash({ view: "squad", slug: id });
  }, [onSquadChange]);

  // Deleting a squad rewrites the one file, so it goes through the ordinary save path. The
  // plans that named it keep their `squadId`: it is the only record of who a night was for,
  // and blanking it would rewrite history the squad list has no business rewriting.
  const onDeleteSquad = useCallback(() => {
    const id = selectedSquadId;
    if (!id) return;
    if (!window.confirm("Delete this squad? The plans that name it keep their record of it.")) return;
    const cur = squadsStateRef.current;
    const rest = { ...cur.data };
    delete rest[id];
    setSquadsState({ ...cur, data: rest, dirty: true, status: "dirty" });
    scheduleSquadsSave();
    setSelectedSquadId(null);
    location.hash = formatHash({ view: "squads" });
  }, [selectedSquadId, setSquadsState, scheduleSquadsSave]);

  // Makes an id from the date and theme (2026-08-12-pressing), guarding against a
  // collision with an existing session, then opens the builder on it.
  const onCreateSession = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const date = window.prompt("Date for this session? (YYYY-MM-DD)", today);
    if (!date || !date.trim()) return;
    // The id becomes the session's file name, so a date the file-name rule would reject
    // (13/08/2026, say) has to be refused here rather than thrown out of sessionFileName
    // on the first save.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      window.alert("Use a date like 2026-08-13.");
      return;
    }
    const squad = window.prompt("Squad? (optional)") ?? "";
    const theme = window.prompt("Theme? (optional)") ?? "";
    const themeSlug = theme.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const base = themeSlug ? `${date.trim()}-${themeSlug}` : date.trim();
    const existing = sessionsStateRef.current.data.sessions;
    let id = base;
    for (let n = 2; existing[id]; n++) id = `${base}-${n}`;
    const created = emptySession(id, date.trim(), squad.trim());
    created.theme = theme.trim();
    onSessionChange(created);
    setSelected(null);
    setMode("sessions");
    setSelectedSessionId(id);
    location.hash = formatHash({ view: "session", slug: id });
  }, [onSessionChange]);

  // Deleting a plan is now trashing one file, not rewriting the rest. The id leaves
  // `dirty` with it, so a flush already scheduled cannot re-create what was just deleted.
  const onDeleteSession = useCallback(async () => {
    const id = selectedSessionId;
    if (!id) return;
    // A plan the old blob still holds has no file of its own to trash, and nothing here
    // rewrites the blob — so the next load migrated it straight back. Refusing with a reason
    // beats a delete that appears to work and then undoes itself. Once its own file exists
    // (its next save writes one) and the app has been reloaded, this plan deletes normally.
    if (sessionsUnmigrated.some((u) => u.id === id)) {
      window.alert(
        "This plan is still only in your old sessions.json, so deleting it here would not "
        + "stick — it would come back the next time the app loads. Save it first so it gets "
        + "its own file, reload, then delete it. Or remove it from sessions.json in Drive.",
      );
      return;
    }
    if (!window.confirm("Delete this session plan?")) return;
    const cur = sessionsStateRef.current;
    const rest = { ...cur.data.sessions };
    delete rest[id];
    const meta = { ...cur.meta };
    const fileId = meta[id]?.fileId ?? null;
    delete meta[id];
    // A deleted plan has no edit left to save and no conflict left to resolve, so it leaves
    // `dirty`, `meta` and `conflicts` together — otherwise a flush already scheduled would
    // re-create what was just deleted, or a banner would offer to resolve a plan that is gone.
    const conflicts = cur.conflicts.filter((c) => c !== id);
    setSessionsState({
      ...cur,
      data: { ...cur.data, sessions: rest },
      meta,
      dirty: cur.dirty.filter((d) => d !== id),
      conflicts,
    });
    setSelectedSessionId(null);
    location.hash = formatHash({ view: "sessions" });
    // A plan created and deleted before its first save has no file to trash.
    if (fileId) await deleteSession({ id, fileId });
  }, [selectedSessionId, sessionsUnmigrated, setSessionsState]);

  // Resolves the current route against the loaded drills and sessions, once the
  // catalogue is ready. A slug/id that matches nothing falls back to browse/sessions
  // rather than showing nothing.
  const resolveRoute = useCallback(() => {
    if (status !== "ready") return;
    const route = routeRef.current;

    // Every branch below is a route that is NOT run mode, so leaving one stale
    // runSessionId behind (e.g. the URL was hand-edited away from #/session/x/run)
    // must not leave the run view showing regardless of what Catalogue would render.
    if (route.view !== "run" && runSessionId) { runRequestSeq.current++; setRunSessionId(null); }

    // Leaving the squad section by URL has to flush the squad on screen, the same way
    // leaving it by the header does.
    if (route.view !== "squads" && route.view !== "squad" && selectedSquadId) closeSquadEditor();

    if (route.view === "sessions") {
      closeEditor();
      setSelected(null);
      if (mode !== "sessions") setMode("sessions");
      if (selectedSessionId) setSelectedSessionId(null);
      return;
    }
    if (route.view === "session") {
      const sess = sessionsStateRef.current.data.sessions[route.slug];
      if (!sess) { location.hash = formatHash({ view: "sessions" }); return; }
      closeEditor();
      setSelected(null);
      if (mode !== "sessions") setMode("sessions");
      if (selectedSessionId !== sess.id) setSelectedSessionId(sess.id);
      return;
    }
    if (route.view === "run") {
      const sess = sessionsStateRef.current.data.sessions[route.slug];
      if (!sess) { location.hash = formatHash({ view: "sessions" }); return; }
      if (mode !== "sessions") setMode("sessions");
      if (runSessionId !== sess.id) openRun(sess);
      return;
    }
    if (route.view === "squads") {
      closeEditor();
      setSelected(null);
      closeSessionBuilder();
      if (mode !== "squads") setMode("squads");
      if (selectedSquadId) setSelectedSquadId(null);
      return;
    }
    if (route.view === "squad") {
      const squad = squadsStateRef.current.data[route.slug];
      // A squad that is gone — deleted here or on the other device — falls back to the
      // list rather than showing an empty editor.
      if (!squad) { location.hash = formatHash({ view: "squads" }); return; }
      closeEditor();
      setSelected(null);
      closeSessionBuilder();
      if (mode !== "squads") setMode("squads");
      if (selectedSquadId !== squad.id) setSelectedSquadId(squad.id);
      return;
    }
    if (route.view === "browse") {
      if (mode !== "drills") { closeSessionBuilder(); setMode("drills"); }
      return;
    }

    const drill = drills.find((d) => d.slug === route.slug);
    if (!drill) { location.hash = formatHash({ view: "browse" }); return; }
    if (mode !== "drills") { closeSessionBuilder(); setMode("drills"); }
    if (route.view === "edit") {
      if (editorRef.current?.id !== drill.id) openEdit(drill);
    } else if (selected?.id !== drill.id) {
      openDrill(drill);
    }
  }, [status, drills, selected, mode, selectedSessionId, runSessionId, selectedSquadId,
    openEdit, openDrill, openRun, closeEditor, closeSessionBuilder, closeSquadEditor]);

  // A ref so the hashchange listener (registered once) always calls the CURRENT
  // resolveRoute rather than the stale one captured when the listener was attached.
  const resolveRouteRef = useRef(resolveRoute);
  resolveRouteRef.current = resolveRoute;

  // Hash routing: on mount and whenever the URL hash changes, resolve it to a route.
  useEffect(() => {
    const onHashChange = () => { routeRef.current = parseHash(location.hash); resolveRouteRef.current(); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    routeRef.current = parseHash(currentHash());
    resolveRoute();
  }, [status, drills, resolveRoute]);

  const sessionsList = Object.values(sessionsState.data.sessions);
  // Computed here rather than in either consumer: the header and the session list must
  // never disagree about which plan is under way, and this is the render that owns both.
  const activeIds = activeSessionIds(sessionsList, todayIso(), localStore());
  // "Keep mine" writes ONE file, so every conflict is offered with the name of the plan it
  // is about — on whatever screen the owner is on, since a conflict he never sees is a plan
  // that never saves.
  const sessionsConflicts = sessionsState.conflicts.map((id) => {
    const sess = sessionsState.data.sessions[id];
    const theme = sess?.theme?.trim();
    return { id, label: sess?.date ? (theme ? `${sess.date} · ${theme}` : sess.date) : id };
  });
  const squadsList = Object.values(squadsState.data);
  const selectedSquad = selectedSquadId ? squadsState.data[selectedSquadId] ?? null : null;
  const selectedSession = selectedSessionId ? sessionsState.data.sessions[selectedSessionId] ?? null : null;
  const runSession = runSessionId ? sessionsState.data.sessions[runSessionId] ?? null : null;

  // Nothing but the button before sign-in. The header is deliberately outside this
  // return: its way home, its sections and the version are all about a catalogue that
  // has not been loaded yet, and the version being invisible here is the accepted cost.
  if (status === "signed-out") return <Catalogue status="signed-out" onSignIn={onSignIn} />;

  return (
    <div className="page">
      <Header
        mode={mode}
        onModeChange={onModeChange}
        // Home is the Drills path, not goBrowse: goBrowse only closes the drill editor, so
        // from the run view or a half-edited plan it would change the URL and leave the
        // builder or the run view on screen with its edit unflushed. onModeChange("drills")
        // closes all three and flushes both saves on the way out.
        onHome={() => onModeChange("drills")}
        activeCount={activeIds.length}
        version={__APP_VERSION__}
      />
      <Catalogue
        status={status === "starting" ? "loading" : status}
        drills={drills}
        failed={failed}
        error={error}
        onSignIn={onSignIn}
        filter={filter}
        onFilterChange={setFilter}
        selected={selected}
        drillStatus={drillStatus}
        drillText={drillText}
        drillError={drillError}
        onOpen={openDrill}
        onBack={goBrowse}
        duplicateFolders={duplicateFolders}
        editor={editor}
        onEdit={onEditChange}
        onEditBack={goBrowse}
        onDelete={onDeleteDrill}
        onKeepMine={onKeepMine}
        onReload={onReloadDrive}
        onStartEdit={openEdit}
        onCreate={onCreate}
        mode={mode}
        sessions={sessionsList}
        activeSessionIds={activeIds}
        selectedSession={selectedSession}
        onOpenSession={onOpenSession}
        onCreateSession={onCreateSession}
        onSessionChange={onSessionChange}
        onSessionBack={onSessionBack}
        onDeleteSession={onDeleteSession}
        sessionsStatus={sessionsState.status}
        sessionsConflicts={sessionsConflicts}
        sessionsError={sessionsState.error}
        sessionsMigrated={sessionsMigrated}
        sessionsFailed={sessionsFailed}
        sessionsUnmigrated={sessionsUnmigrated}
        sessionsLoadError={sessionsLoadError}
        sessionsResolving={sessionsResolving}
        onKeepMineSessions={onKeepMineSessions}
        onReloadSessions={onReloadSessions}
        runSession={runSession}
        runTexts={runTexts}
        onOpenRun={openRun}
        onRunBack={onRunBack}
        onRunSwap={onRunSwap}
        onRunProgress={onRunProgress}
        squads={squadsList}
        selectedSquad={selectedSquad}
        onOpenSquad={onOpenSquad}
        onCreateSquad={onCreateSquad}
        onSquadChange={onSquadChange}
        onSquadBack={onSquadBack}
        onDeleteSquad={onDeleteSquad}
        squadsStatus={squadsState.status}
        squadsError={squadsState.error}
        squadsConflict={squadsState.conflict}
        squadsResolving={squadsResolving}
        squadsBlocked={squadsState.blocked}
        squadsLoadError={squadsLoadError}
        onKeepMineSquads={onKeepMineSquads}
        onReloadSquads={onReloadSquads}
      />
    </div>
  );
}
