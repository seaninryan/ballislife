// src/components/Header.jsx
// The only chrome on screen everywhere: the way home, the two sections, and whether a
// session is under way. The section links used to live inside the browse view, so they
// disappeared exactly when they were most useful — inside a drill, mid-edit, mid-session.
import React from "react";
import BallIcon from "./BallIcon.jsx";

export default function Header({ mode = "drills", onModeChange, onHome, activeCount = 0, version }) {
  const running = activeCount > 0;
  return (
    <header className="app-header">
      <button type="button" className="app-home" onClick={onHome}>
        <BallIcon size={26} />
        <span className="app-name">ballislife</span>
      </button>

      <nav className="row app-nav">
        <button
          type="button"
          className={`chip-button${mode !== "sessions" ? " active" : ""}`}
          onClick={() => onModeChange?.("drills")}
        >
          Drills
        </button>
        <button
          type="button"
          className={`chip-button${mode === "sessions" ? " active" : ""}`}
          onClick={() => onModeChange?.("sessions")}
          aria-label={running ? "Sessions — a session is under way" : "Sessions"}
        >
          Sessions
          {running ? <span className="nav-dot" aria-hidden="true" /> : null}
        </button>
      </nav>

      <span className="dim app-version">v{version}</span>
    </header>
  );
}
