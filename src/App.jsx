import React, { useCallback, useEffect, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import { loadCatalogue } from "./lib/drive.js";

export default function App() {
  const [status, setStatus] = useState("starting");
  const [drills, setDrills] = useState([]);
  const [message, setMessage] = useState("");

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
      const { drills: loaded } = await loadCatalogue();
      setDrills(loaded);
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

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: "10px 0" }}>ballislife</h1>
        <span className="dim">v{__APP_VERSION__}</span>
      </div>
      <Catalogue
        status={status === "starting" ? "loading" : status}
        drills={drills}
        message={message}
        onSignIn={onSignIn}
      />
    </div>
  );
}
