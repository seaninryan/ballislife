import React, { useCallback, useEffect, useRef, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import {
  loadCatalogue, readDrill, saveDrill, createDrill, deleteDrill, knownModifiedTime,
  loadSessions, saveSession, deleteSession,
} from "./lib/drive.js";
import { openEditor, reduce, shouldSave } from "./lib/editor.js";
import { emptySession, resolveBlocks, setBlock } from "./lib/sessions.js";
import { withSessionProgress } from "./lib/progress.js";
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
    status: "idle", // idle | dirty | saving | conflict | failed
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
    const status = error ? "failed" : conflicts.length ? "conflict" : pending.length ? "dirty" : "idle";
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
      status: cur.conflicts.length ? "conflict" : "dirty",
    });
    scheduleSessionsSave();
  }, [setSessionsState, scheduleSessionsSave]);

  // Resolves ONE plan's conflict: "Keep mine" writes one file, so it is always answered
  // about the plan the banner names, never about whatever else is conflicted too.
  const onKeepMineSessions = useCallback((id) => {
    const cur = sessionsStateRef.current;
    if (!cur.conflicts.includes(id)) return;
    // This id's baseline was already moved to Drive's current value when the conflict was
    // reported, so dropping it from `conflicts` is enough for the next flush to send our
    // plan and win.
    const conflicts = cur.conflicts.filter((c) => c !== id);
    setSessionsState({
      ...cur,
      dirty: cur.dirty.includes(id) ? cur.dirty : [...cur.dirty, id],
      conflicts,
      status: conflicts.length ? "conflict" : "dirty",
    });
    sessionsSaveTimer.current = setTimeout(flushSessionsSave, 0);
  }, [setSessionsState, flushSessionsSave]);

  // Reload drops local edits by definition, so a pending flush must not write them back
  // afterwards.
  const onReloadSessions = useCallback(async () => {
    clearTimeout(sessionsSaveTimer.current);
    const { sessions, meta, migrated, failed: unreadable } = await loadSessions(folderRef.current);
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
      //
      // Its own try/catch, deliberately: this ran inside the one below, so a single flaky
      // request during the one-time blob migration replaced the whole app — drills
      // included, all of them already loaded — with an error screen.
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
      status: conflicts.length ? cur.status : cur.status === "conflict" ? "idle" : cur.status,
    });
    setSelectedSessionId(null);
    location.hash = formatHash({ view: "sessions" });
    // A plan created and deleted before its first save has no file to trash.
    if (fileId) await deleteSession({ id, fileId });
  }, [selectedSessionId, setSessionsState]);

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
  // "Keep mine" writes ONE file, so the conflict banner belongs on the plan that actually
  // conflicted rather than on whichever plan happens to be open.
  const visibleSessionId = runSessionId ?? selectedSessionId;
  const sessionsStatus =
    sessionsState.status === "conflict" && !sessionsState.conflicts.includes(visibleSessionId)
      ? "idle"
      : sessionsState.status;
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
        sessionsStatus={sessionsStatus}
        sessionsError={sessionsState.error}
        sessionsMigrated={sessionsMigrated}
        sessionsFailed={sessionsFailed}
        sessionsUnmigrated={sessionsUnmigrated}
        sessionsLoadError={sessionsLoadError}
        onKeepMineSessions={() => onKeepMineSessions(visibleSessionId)}
        onReloadSessions={onReloadSessions}
        runSession={runSession}
        runTexts={runTexts}
        onOpenRun={openRun}
        onRunBack={onRunBack}
        onRunSwap={onRunSwap}
        onRunProgress={onRunProgress}
      />
    </div>
  );
}
