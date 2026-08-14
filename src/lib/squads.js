// src/lib/squads.js
// A squad is a name and a list of players; a player is a name and an id. Pure — no Drive,
// no React.
//
// A player's ID IS FIXED AT CREATION and never derived again. Attendance records point at
// ids, so deriving the id from the name would mean that fixing a spelling, or a player
// changing their surname, orphaned every record of them ever turning up. The name is
// editable; the id is not.
import { slugify } from "./drills.js";

const VERSION = 1;
export const EMPTY_SQUADS = Object.freeze({ version: VERSION, squads: {} });

// -> {ok:true, squads} | {ok:false, reason}. Deliberately NOT "unreadable reads as empty":
// that mistake is how a corrupt sessions.json nearly lost every plan, because the caller
// could not tell "nothing here" from "I could not read it" and overwrote the file.
export function parseSquads(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "shape" };
    if (parsed.version !== VERSION) return { ok: false, reason: "version" };
    if (!parsed.squads || typeof parsed.squads !== "object" || Array.isArray(parsed.squads)) {
      return { ok: false, reason: "squads" };
    }
    return { ok: true, squads: parsed.squads };
  } catch {
    return { ok: false, reason: "parse" };
  }
}

export function playerId(name, taken = []) {
  const base = slugify(name);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export const emptySquad = (id, name) => ({ id, name, players: [] });

export function addPlayer(squad, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return squad;
  const id = playerId(clean, (squad.players ?? []).map((p) => p.id));
  return { ...squad, players: [...(squad.players ?? []), { id, name: clean }] };
}

export function renamePlayer(squad, id, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return squad;
  return {
    ...squad,
    players: (squad.players ?? []).map((p) => (p.id === id ? { ...p, name: clean } : p)),
  };
}

// Leaving is not deletion. Last month's session must still be able to say who was there,
// and that needs the name to survive — so the player stays in the list, marked.
export const removePlayer = (squad, id) => ({
  ...squad,
  players: (squad.players ?? []).map((p) => (p.id === id ? { ...p, left: true } : p)),
});

export const restorePlayer = (squad, id) => ({
  ...squad,
  players: (squad.players ?? []).map((p) => (p.id === id ? { ...p, left: false } : p)),
});

export const currentPlayers = (squad) => (squad?.players ?? []).filter((p) => !p.left);

export const playerName = (squad, id) =>
  (squad?.players ?? []).find((p) => p.id === id)?.name ?? null;

// A session names its squad by id. Sessions written before squads existed carry only free
// text, so match it to a squad NAME once and leave anything unmatched alone — a wrong
// guess would attach the wrong roster to a night's attendance.
export function linkSquadId(session, squads) {
  if (session?.squadId) return session;
  const text = String(session?.squad ?? "").trim().toLowerCase();
  if (!text) return session;
  const hit = Object.values(squads ?? {})
    .find((s) => String(s?.name ?? "").trim().toLowerCase() === text);
  return hit ? { ...session, squadId: hit.id } : session;
}
