import React, { useCallback, useEffect, useRef, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import { loadCatalogue, readDrill } from "./lib/drive.js";

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
  const folderRef = useRef(null);
  // A monotonic token, not the drill id: reopening the SAME drill starts a second
  // request that an id check cannot tell from the first, so the slower response won.
  const requestSeq = useRef(0);

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
      setError(e);
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
        error={error}
        onSignIn={onSignIn}
        filter={filter}
        onFilterChange={setFilter}
        selected={selected}
        drillStatus={drillStatus}
        drillText={drillText}
        drillError={drillError}
        onOpen={openDrill}
        onBack={() => setSelected(null)}
        duplicateFolders={duplicateFolders}
      />
    </div>
  );
}
