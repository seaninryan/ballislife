// src/components/SessionList.jsx
// Presentational: every session, newest first, plus a "New session" control. No Drive
// calls — App owns the async wiring.
import React from "react";
import { resolveBlocks, totalMinutes, emptySlots } from "../lib/sessions.js";

function SessionRow({ session, drills, onOpen }) {
  const total = totalMinutes(session, drills);
  const empty = emptySlots(session);
  const broken = resolveBlocks(session, drills).filter((b) => b.missing);
  const over = session.length && total > session.length;

  return (
    <button type="button" className="card session-row" onClick={() => onOpen?.(session)}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{session.date}</strong>
        <span className={`chip${over ? " warn-chip" : ""}`}>
          {total}′ of {session.length}′
        </span>
      </div>
      <div className="row">
        {session.squad ? <span className="chip">{session.squad}</span> : null}
        {session.theme ? <span className="chip">{session.theme}</span> : null}
      </div>
      {empty.length ? (
        <div className="dim">{empty.length} slot{empty.length === 1 ? "" : "s"} still empty</div>
      ) : null}
      {broken.length ? (
        <div className="banner warn">
          Broken reference{broken.length === 1 ? "" : "s"}: {broken.map((b) => b.drillRef).join(", ")}
        </div>
      ) : null}
    </button>
  );
}

export default function SessionList({ sessions = [], drills = [], onOpen, onCreate }) {
  const sorted = [...sessions].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="primary" onClick={onCreate}>New session</button>
      </div>

      {sorted.length ? (
        sorted.map((s) => <SessionRow key={s.id} session={s} drills={drills} onOpen={onOpen} />)
      ) : (
        <div className="card">
          <p>No sessions yet.</p>
          <p className="dim">Plan tonight's training from your drill catalogue.</p>
        </div>
      )}
    </div>
  );
}
