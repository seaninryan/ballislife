import React, { useCallback, useEffect, useRef, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import { loadCatalogue, readDrill } from "./lib/drive.js";

export default function App() {
  const [status, setStatus] = useState("starting");
  const [drills, setDrills] = useState([]);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState({});
  const [selected, setSelected] = useState(null);
  const [drillStatus, setDrillStatus] = useState("loading");
  const [drillText, setDrillText] = useState("");
  const [drillMessage, setDrillMessage] = useState("");
  const [failed, setFailed] = useState([]);
  const [duplicateFolders, setDuplicateFolders] = useState(false);
  const folderRef = useRef(null);
  // Which drill's fetch is the most recent one requested. Opening a drill, going back,
  // and opening a different one quickly starts two overlapping readDrill calls; without
  // this, whichever resolves last wins even if it is the stale one — showing one drill's
  // text under another's header. Guard every state update below on still being current.
  const requestRef = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      // The owner gate. Not a security boundary — see src/lib/owner.js — it stops a
      // stranger who finds this URL using this deployment against their own Drive.
      const email = await aboutEmail(getAccessToken());
      if (!(await isOwner(email))) {
        signOut();
        setStatus("not-owner");
        return;
      }
      startTokenKeepAlive();
      const { drills: loaded, failed: notLoaded, folderId, duplicateFolders: dupes } = await loadCatalogue();
      folderRef.current = folderId;
      setDrills(loaded);
      setFailed(notLoaded ?? []);
      setDuplicateFolders(Boolean(dupes));
      setStatus("ready");
    } catch (e) {
      setMessage(String(e?.message ?? e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    initAuth().then((ready) => {
      if (cancelled) return;
      if (!ready) { setMessage("Google sign-in failed to load"); setStatus("error"); return; }
      if (isSignedIn()) load();
      else setStatus("signed-out");
    });
    return () => { cancelled = true; };
  }, [load]);

  const onSignIn = useCallback(async () => {
    if (await signIn()) load();
  }, [load]);

  const openDrill = useCallback(async (drill) => {
    requestRef.current = drill.id;
    setSelected(drill);
    setDrillStatus("loading");
    setDrillText("");
    try {
      const { text } = await readDrill(drill.id, folderRef.current);
      if (requestRef.current !== drill.id) return; // a newer open superseded this one
      setDrillText(text);
      setDrillStatus("ready");
    } catch (e) {
      if (requestRef.current !== drill.id) return;
      setDrillMessage(String(e?.message ?? e));
      setDrillStatus("error");
    }
  }, []);

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
        message={message}
        onSignIn={onSignIn}
        filter={filter}
        onFilterChange={setFilter}
        selected={selected}
        drillStatus={drillStatus}
        drillText={drillText}
        drillMessage={drillMessage}
        onOpen={openDrill}
        onBack={() => setSelected(null)}
        duplicateFolders={duplicateFolders}
      />
    </div>
  );
}
