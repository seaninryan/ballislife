// src/components/Header.jsx
// The only chrome on screen everywhere: the way home, the two sections, and whether a
// session is under way. The section links used to live inside the browse view, so they
// disappeared exactly when they were most useful — inside a drill, mid-edit, mid-session.
import React from "react";
import AppMark from "./AppMark.jsx";

export default function Header({ mode = "drills", onModeChange, onHome, activeCount = 0, version }) {
  const running = activeCount > 0;
  return (
    <header className="app-header">
      <button type="button" className="app-home" onClick={onHome}>
        <AppMark size={26} />
        {/* Spans, not styled pseudo-elements or images: the separators are dimmed so the
            three syllables read as one word, but the name stays real text that selects
            and copies as "ball.is.life". */}
        <span className="app-name">
          ball<span className="app-name-sep">.</span>is<span className="app-name-sep">.</span>life
        </span>
      </button>

      <nav className="row app-nav">
        {/* `mode === "drills"`, never `mode !== "sessions"`: that held while there were
            two sections and quietly broke the moment there were three, lighting Drills up
            while the owner was standing in Squads. */}
        <button
          type="button"
          className={`chip-button${mode === "drills" ? " active" : ""}`}
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
        <button
          type="button"
          className={`chip-button${mode === "squads" ? " active" : ""}`}
          onClick={() => onModeChange?.("squads")}
        >
          Squads
        </button>
      </nav>

      <span className="dim app-version">v{version}</span>
    </header>
  );
}
