// src/lib/sessions.js
// The session model: slots, durations, squad fitting, reordering and broken references.
// Pure — no React, no Drive.
//
// A block references a drill by SLUG rather than copying it, so correcting a drill
// retroactively fixes every session that used it. The cost is a dangling reference when a
// drill is deleted, which is why `resolveBlocks` reports `missing` instead of dropping
// the block: a plan that silently loses a slot is worse than one that says "this drill is
// gone".
export const SLOTS = ["warmup", "skill", "tactical", "match", "fun"];
const VERSION = 1;
export const EMPTY = Object.freeze({ version: VERSION, sessions: {} });

export function emptySession(id, date, squad = "") {
  return {
    id,
    date,
    squad,
    theme: "",
    length: 60,
    turnout: null,
    blocks: SLOTS.map((slot) => ({ slot, drill: null, minutes: null, note: "" })),
    // Filled in per day by a run (see lib/progress.js). Every reader tolerates its
    // absence, because sessions created before this existed do not have it.
    progress: {},
  };
}

// -> { ok: true, sessions } | { ok: false, reason }
//
// Separate from readSessions because "the blob holds no plans" and "the blob could not be
// read" must not answer the same thing. The migration acts on the answer: a truncated blob
// that reads as empty looked like a finished migration, so the only copy of every plan was
// renamed aside and could never be found by name again.
export function parseSessionsBlob(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "shape" };
  }
  if (parsed.version !== VERSION) return { ok: false, reason: "version" };
  if (!parsed.sessions || typeof parsed.sessions !== "object" || Array.isArray(parsed.sessions)) {
    return { ok: false, reason: "sessions" };
  }
  return { ok: true, sessions: parsed.sessions };
}

// Unlike index.json this file is authoritative — it is the only copy of the plans — so it
// is never rebuilt from anything. This only guards against a corrupt read. Callers that
// must act differently on a corrupt read use parseSessionsBlob instead.
export function readSessions(raw) {
  const parsed = parseSessionsBlob(raw);
  return parsed.ok ? { version: VERSION, sessions: parsed.sessions } : { version: VERSION, sessions: {} };
}

// A session's id is its file name, so it has to be safe as one. Ids are generated from a
// date plus a collision suffix today, but this is the only place that assumption is
// enforced rather than assumed — and `index` is reserved because index.json shares the
// folder.
const ID_OK = /^[a-z0-9][a-z0-9-]*$/i;
export const SESSIONS_FOLDER = "sessions";
export const SESSIONS_INDEX_NAME = "index.json";

export function sessionFileName(id) {
  const s = String(id ?? "");
  if (!ID_OK.test(s) || s.toLowerCase() === "index") {
    throw new Error(`unsafe session id: ${JSON.stringify(s)}`);
  }
  return `${s}.json`;
}

// -> the id, or null if this listing entry is not a session file (index.json included).
export function sessionIdFromFileName(name) {
  const s = String(name ?? "");
  if (!s.toLowerCase().endsWith(".json")) return null;
  const id = s.slice(0, -5);
  if (!ID_OK.test(id) || id.toLowerCase() === "index") return null;
  return id;
}

// A block's own minutes win; otherwise inherit the drill's, so a session picks up a
// drill's duration until you deliberately override it for one night.
export function blockMinutes(block, drill) {
  if (Number.isFinite(block?.minutes)) return block.minutes;
  const m = Number(drill?.minutes);
  return Number.isFinite(m) ? m : 0;
}

export function resolveBlocks(session, drills) {
  const bySlug = new Map((drills ?? []).map((d) => [d.slug, d]));
  return (session?.blocks ?? []).map((block) => {
    const drill = block.drill ? bySlug.get(block.drill) ?? null : null;
    return {
      ...block,
      drillRef: block.drill,
      drill,
      missing: Boolean(block.drill) && drill === null,
      minutes: blockMinutes(block, drill),
    };
  });
}

export const totalMinutes = (session, drills) =>
  resolveBlocks(session, drills).reduce((sum, b) => sum + b.minutes, 0);

export const emptySlots = (session) =>
  (session?.blocks ?? []).filter((b) => !b.drill).map((b) => b.slot);

// "8-12" -> {min,max}; "12+" -> open ended; "11" -> exact; anything else -> null.
export function squadRange(players) {
  const s = String(players ?? "").trim();
  let m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = s.match(/^(\d+)\+$/);
  if (m) return { min: Number(m[1]), max: Infinity };
  m = s.match(/^(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

// Unknown on either side means "fits". Hiding a drill because its players field is blank
// would quietly shrink the picker for no good reason.
export function fitsSquad(drill, turnout) {
  if (!Number.isFinite(turnout)) return true;
  const range = squadRange(drill?.players);
  if (!range) return true;
  return turnout >= range.min && turnout <= range.max;
}

export function setBlock(session, index, patch) {
  return {
    ...session,
    blocks: session.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
  };
}

export function moveBlock(session, from, to) {
  const blocks = [...session.blocks];
  if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return session;
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...session, blocks };
}
