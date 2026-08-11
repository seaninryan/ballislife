import React, { useCallback, useEffect, useRef, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import {
  loadCatalogue, readDrill, saveDrill, createDrill, deleteDrill, knownModifiedTime,
} from "./lib/drive.js";
import { openEditor, reduce, shouldSave } from "./lib/editor.js";
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
  const folderRef = useRef(null);
  // A monotonic token, not the drill id: reopening the SAME drill starts a second
  // request that an id check cannot tell from the first, so the slower response won.
  const requestSeq = useRef(0);

  // Kept alongside the state so the debounce callback and the flush-on-close path read
  // the latest editor state without being re-created on every keystroke.
  const editorRef = useRef(null);
  const saveTimer = useRef(null);
  const routeRef = useRef(parseHash(currentHash()));

  const setEditorState = useCallback((next) => {
    editorRef.current = next;
    setEditor(next);
  }, []);

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
      setStatus("ready");
      return loaded;
    } catch (e) {
      setError(e);
      setStatus("error");
      return null;
    }
  }, []);

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

  // Resolves the current route against the loaded drills, once the catalogue is ready.
  // A slug that matches no drill falls back to browse rather than showing nothing.
  const resolveRoute = useCallback(() => {
    if (status !== "ready") return;
    const route = routeRef.current;
    if (route.view === "browse") return;
    const drill = drills.find((d) => d.slug === route.slug);
    if (!drill) { location.hash = formatHash({ view: "browse" }); return; }
    if (route.view === "edit") {
      if (editorRef.current?.id !== drill.id) openEdit(drill);
    } else if (selected?.id !== drill.id) {
      openDrill(drill);
    }
  }, [status, drills, selected, openEdit, openDrill]);

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
      />
    </div>
  );
}
