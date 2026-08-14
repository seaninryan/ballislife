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
    return { ok: true, squads: repairSquads(parsed.squads) };
  } catch {
    return { ok: false, reason: "parse" };
  }
}

const isId = (id) => typeof id === "string" && id !== "";

// Everything downstream — the editor's rows, the mutators below, attendance — assumes a
// player is {id, name} with a UNIQUE id. These files are read and edited by hand, though,
// so a player written the obvious way (just the name) is a plausible thing to find, and
// `p.id === undefined` then matched `undefined === undefined` in every mutator: the string
// was spread into an object and {"0":"S","1":"e",…} went to Drive on the first keystroke.
//
// So repair on the way in, where it is one place instead of everywhere. A bare name becomes
// a proper player; a broken or repeated id is replaced by one made from the name, which is
// how a new player would have got theirs; anything with no name at all is dropped, because
// a player who cannot be pointed at is not a record of anybody.
function repairPlayers(players) {
  if (!Array.isArray(players)) return [];
  const out = [];
  const taken = [];
  for (const p of players) {
    const raw = typeof p === "string" ? { name: p } : p;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = String(raw.name ?? "").trim();
    if (!name) continue;
    // A repeated id is not a small problem: renaming one row renamed both people.
    const id = isId(raw.id) && !taken.includes(raw.id) ? raw.id : playerId(name, taken);
    taken.push(id);
    out.push({ ...raw, id, name });
  }
  return out;
}

const repairSquads = (squads) => Object.fromEntries(
  Object.entries(squads).map(([key, squad]) => [
    key,
    squad && typeof squad === "object" && !Array.isArray(squad)
      ? { ...squad, players: repairPlayers(squad.players) }
      : squad,
  ]),
);

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

// Every change to one player goes through here, so the two rules hold everywhere.
//
// An id that is not a real id matches NOBODY, rather than matching whatever is malformed:
// `p.id === undefined` was true of a player written as a bare string, and the editor passes
// `p.id`, so a hand-edited file corrupted itself on the first keystroke. parseSquads repairs
// those on read; this makes it impossible even for a player built anywhere else.
//
// And only the FIRST match changes. Duplicate ids should not survive parseSquads, but if
// one ever does, renaming one row must not rename two people at once.
function changePlayer(squad, id, change) {
  if (!isId(id)) return squad;
  const players = squad?.players ?? [];
  const at = players.findIndex((p) => p?.id === id);
  if (at === -1) return squad;
  return { ...squad, players: players.map((p, i) => (i === at ? change(p) : p)) };
}

export function renamePlayer(squad, id, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return squad;
  return changePlayer(squad, id, (p) => ({ ...p, name: clean }));
}

// Leaving is not deletion. Last month's session must still be able to say who was there,
// and that needs the name to survive — so the player stays in the list, marked.
export const removePlayer = (squad, id) => changePlayer(squad, id, (p) => ({ ...p, left: true }));

export const restorePlayer = (squad, id) => changePlayer(squad, id, (p) => ({ ...p, left: false }));

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
