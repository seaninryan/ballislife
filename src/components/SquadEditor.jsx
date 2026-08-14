// src/components/SquadEditor.jsx
// One squad: its name, the players in it, and the ones who have left. Presentational —
// every change is reported through onChange and the component holds no copy of the squad,
// so the squad on screen is always the one App would save.
import React, { useRef, useState } from "react";
import { addPlayer, currentPlayers, removePlayer, renamePlayer, restorePlayer } from "../lib/squads.js";

export default function SquadEditor({ squad, onChange, onBack, onDelete }) {
  // The name being typed into the "Add player" field, and any half-typed rename. Both are
  // in-progress text rather than squad data — the same kind of view-only state as the
  // builder's "show all drills" toggle.
  const [adding, setAdding] = useState("");
  // renamePlayer refuses a blank name (a player with no name cannot be pointed at), so an
  // input bound straight to the model snapped back the instant the last character was
  // deleted — making "clear it and retype" impossible, which is how you fix a name on a
  // phone. The half-typed text lives here until it is a name again.
  const [drafts, setDrafts] = useState({});
  const addField = useRef(null);

  const players = currentPlayers(squad);
  const departed = (squad?.players ?? []).filter((p) => p.left);

  const submitAdd = (e) => {
    e.preventDefault();
    if (!adding.trim()) return; // addPlayer would ignore it anyway; do not report a no-op
    onChange?.(addPlayer(squad, adding));
    setAdding("");
    addField.current?.focus();
  };

  const rename = (id, value) => {
    setDrafts((d) => ({ ...d, [id]: value }));
    onChange?.(renamePlayer(squad, id, value));
  };

  // Once the field is left, whatever the model actually holds is the truth again — so a
  // name that was cleared and never retyped shows itself rather than staying blank.
  const settle = (id) => setDrafts((d) => {
    const { [id]: _gone, ...rest } = d;
    return rest;
  });

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" onClick={onBack}>← Back</button>
        {onDelete ? <button type="button" onClick={onDelete}>Delete</button> : null}
      </div>

      <div className="card">
        <label className="dim">
          Squad name:{" "}
          <input
            className="squad-name"
            value={squad?.name ?? ""}
            onChange={(e) => onChange?.({ ...squad, name: e.target.value })}
          />
        </label>
      </div>

      {players.map((p) => (
        <div className="card squad-player" key={p.id}>
          <input
            value={drafts[p.id] !== undefined ? drafts[p.id] : p.name}
            onChange={(e) => rename(p.id, e.target.value)}
            onBlur={() => settle(p.id)}
            aria-label={`Name of ${p.name}`}
          />
          <button type="button" onClick={() => onChange?.(removePlayer(squad, p.id))}>Remove</button>
        </div>
      ))}

      <form className="card squad-add" onSubmit={submitAdd}>
        <input
          ref={addField}
          value={adding}
          placeholder="Add player"
          aria-label="Add player"
          onChange={(e) => setAdding(e.target.value)}
        />
        <button type="submit" className="primary">Add</button>
      </form>

      {departed.length ? (
        // Collapsed, and last: they are still named in past attendance, so they must be
        // reachable — but they are not who is training tonight.
        <details className="card squad-departed">
          <summary>Left the squad ({departed.length})</summary>
          {departed.map((p) => (
            <div className="row squad-player-gone" key={p.id}>
              <span>{p.name}</span>
              <button type="button" onClick={() => onChange?.(restorePlayer(squad, p.id))}>Restore</button>
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}
