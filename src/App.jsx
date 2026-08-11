import React, { useCallback, useEffect, useRef, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import {
  loadCatalogue, readDrill, saveDrill, createDrill, deleteDrill, knownModifiedTime,
  loadSessions, saveSessions,
} from "./lib/drive.js";
import { openEditor, reduce, shouldSave } from "./lib/editor.js";
import { emptySession, resolveBlocks } from "./lib/sessions.js";
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
  // The whole sessions.json blob is one save unit — unlike drills there is no per-file
  // id to key state by, so status/error/fileId/baseModifiedTime travel together with
  // the data itself, the same shape the editor uses for one drill.
  const [sessionsState, setSessionsStateRaw] = useState({
    data: { version: 1, sessions: {} },
    fileId: null,
    baseModifiedTime: null,
    status: "idle", // idle | dirty | saving | conflict | failed
    error: null,
  });
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

  // Writes the whole sessions.json blob if it is currently dirty. Mirrors flushSave's
  // contract: conflict-checked, never overwrites silently, and adopts the returned
  // modifiedTime on every success.
  const flushSessionsSave = useCallback(async () => {
    const state = sessionsStateRef.current;
    if (state.status !== "dirty") return;
    const sent = state.data;
    setSessionsState({ ...state, status: "saving" });
    const result = await saveSessions({
      folder: folderRef.current,
      fileId: state.fileId,
      data: sent,
      baseModifiedTime: state.baseModifiedTime,
    });
    const latest = sessionsStateRef.current;
    if (result.ok) {
      // The data may have moved on again while this save was in flight — that's still
      // dirty and needs another save, the same way a coalesced drill save can be.
      const stillCurrent = latest.data === sent;
      setSessionsState({
        ...latest,
        fileId: result.fileId ?? latest.fileId,
        baseModifiedTime: result.modifiedTime,
        status: stillCurrent ? "idle" : "dirty",
        error: null,
      });
      if (!stillCurrent) sessionsSaveTimer.current = setTimeout(flushSessionsSave, SAVE_DEBOUNCE_MS);
    } else if (result.conflict) {
      // Never touch `data`: the user's plan is the one thing that must survive.
      setSessionsState({ ...latest, baseModifiedTime: result.modifiedTime, status: "conflict" });
    } else {
      setSessionsState({ ...latest, status: "failed", error: result.error });
    }
  }, [setSessionsState]);

  const scheduleSessionsSave = useCallback(() => {
    clearTimeout(sessionsSaveTimer.current);
    sessionsSaveTimer.current = setTimeout(flushSessionsSave, SAVE_DEBOUNCE_MS);
  }, [flushSessionsSave]);

  // A block/date/theme/etc change from the builder: merge it into the sessions map by
  // id and mark the whole file dirty. A conflict is not cleared by editing further —
  // Drive is still ahead of us — only keepMine or reload resolves it, same as the
  // drill editor.
  const onSessionChange = useCallback((updatedSession) => {
    const cur = sessionsStateRef.current;
    const nextData = {
      ...cur.data,
      sessions: { ...cur.data.sessions, [updatedSession.id]: updatedSession },
    };
    setSessionsState({ ...cur, data: nextData, status: cur.status === "conflict" ? "conflict" : "dirty" });
    scheduleSessionsSave();
  }, [setSessionsState, scheduleSessionsSave]);

  const onKeepMineSessions = useCallback(() => {
    const cur = sessionsStateRef.current;
    if (cur.status !== "conflict") return;
    // baseModifiedTime was already updated to Drive's current value when the conflict
    // was reported, so this save now passes the conflict check while keeping our data.
    setSessionsState({ ...cur, status: "dirty" });
    sessionsSaveTimer.current = setTimeout(flushSessionsSave, 0);
  }, [setSessionsState, flushSessionsSave]);

  const onReloadSessions = useCallback(async () => {
    const { fileId, data, modifiedTime } = await loadSessions(folderRef.current);
    setSessionsState({ data, fileId, baseModifiedTime: modifiedTime, status: "idle", error: null });
  }, [setSessionsState]);

  useEffect(() => () => clearTimeout(sessionsSaveTimer.current), []);

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
      // resolving a session needs the catalogue to still be loading.
      const { fileId, data, modifiedTime } = await loadSessions(folderId);
      setSessionsState({ data, fileId, baseModifiedTime: modifiedTime, status: "idle", error: null });
      setStatus("ready");
      return loaded;
    } catch (e) {
      setError(e);
      setStatus("error");
      return null;
    }
  }, [setSessionsState]);

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

    for (const drill of toFetch) {
      readDrill(drill.id, folderRef.current).then(
        ({ text }) => {
          const entry = { status: "ready", text };
          drillTextCache.current.set(drill.slug, entry);
          if (runRequestSeq.current !== mine) return; // this run view has been left
          setRunTexts((prev) => ({ ...prev, [drill.slug]: entry }));
        },
        (error) => {
          // Deliberately not cached: a flaky read is ordinary on a phone at the side
          // of a pitch (same reasoning as loadCatalogue's per-drill failure), and the
          // next visit should try again rather than remembering the failure forever.
          if (runRequestSeq.current !== mine) return;
          setRunTexts((prev) => ({ ...prev, [drill.slug]: { status: "error", error } }));
        },
      );
    }
  }, [drills, closeEditor, closeSessionBuilder]);

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

  const onModeChange = useCallback((next) => {
    runRequestSeq.current++; // leaving run mode, if it was open, stales any in-flight fetch
    setRunSessionId(null);
    if (next === "sessions") {
      closeEditor();
      setSelected(null);
      setSelectedSessionId(null);
      setMode("sessions");
      location.hash = formatHash({ view: "sessions" });
    } else {
      closeSessionBuilder();
      setMode("drills");
      location.hash = formatHash({ view: "browse" });
    }
  }, [closeEditor, closeSessionBuilder]);

  // Makes an id from the date and theme (2026-08-12-pressing), guarding against a
  // collision with an existing session, then opens the builder on it.
  const onCreateSession = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const date = window.prompt("Date for this session? (YYYY-MM-DD)", today);
    if (!date || !date.trim()) return;
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

  const onDeleteSession = useCallback(() => {
    const id = selectedSessionId;
    if (!id) return;
    if (!window.confirm("Delete this session plan?")) return;
    const cur = sessionsStateRef.current;
    const rest = { ...cur.data.sessions };
    delete rest[id];
    setSessionsState({ ...cur, data: { ...cur.data, sessions: rest }, status: "dirty" });
    setSelectedSessionId(null);
    location.hash = formatHash({ view: "sessions" });
    clearTimeout(sessionsSaveTimer.current);
    sessionsSaveTimer.current = setTimeout(flushSessionsSave, 0);
  }, [selectedSessionId, setSessionsState, flushSessionsSave]);

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
  }, [status, drills, selected, mode, selectedSessionId, runSessionId, openEdit, openDrill, openRun, closeEditor, closeSessionBuilder]);

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
  const selectedSession = selectedSessionId ? sessionsState.data.sessions[selectedSessionId] ?? null : null;
  const runSession = runSessionId ? sessionsState.data.sessions[runSessionId] ?? null : null;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: "10px 0" }}>ballislife</h1>
        <span className="dim">v{__APP_VERSION__}</span>
      </div>
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
        onModeChange={onModeChange}
        sessions={sessionsList}
        selectedSession={selectedSession}
        onOpenSession={onOpenSession}
        onCreateSession={onCreateSession}
        onSessionChange={onSessionChange}
        onSessionBack={onSessionBack}
        onDeleteSession={onDeleteSession}
        sessionsStatus={sessionsState.status}
        sessionsError={sessionsState.error}
        onKeepMineSessions={onKeepMineSessions}
        onReloadSessions={onReloadSessions}
        runSession={runSession}
        runTexts={runTexts}
        onOpenRun={openRun}
        onRunBack={onRunBack}
      />
    </div>
  );
}
