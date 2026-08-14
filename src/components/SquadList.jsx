// src/components/SquadList.jsx
// Presentational: every squad, plus a "New squad" control. No Drive calls — App owns the
// async wiring, the same split as SessionList.
import React from "react";
import { currentPlayers } from "../lib/squads.js";

export default function SquadList({ squads = [], onOpen, onCreate }) {
  const sorted = [...squads].sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));

  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="primary" onClick={onCreate}>New squad</button>
      </div>

      {sorted.length ? (
        sorted.map((squad) => {
          // The players who actually turn up. A player who has left stays in the file so
          // last month's session can still name them, but counting them here would say the
          // squad is bigger than the group standing in front of you.
          const size = currentPlayers(squad).length;
          return (
            <button
              type="button"
              key={squad.id}
              className="card squad-row"
              onClick={() => onOpen?.(squad)}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{squad.name}</strong>
                <span className="chip">{size} player{size === 1 ? "" : "s"}</span>
              </div>
            </button>
          );
        })
      ) : (
        <div className="card">
          <p>No squads yet.</p>
          <p className="dim">A squad is a name and a list of players — who a session is for.</p>
        </div>
      )}
    </div>
  );
}
