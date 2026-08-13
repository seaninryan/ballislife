// src/lib/sessionsIndex.js
// The sessions/index.json cache: read, diff and repair. Pure — no network, no Drive
// knowledge beyond the {id, name, modifiedTime} shape a listing returns.
//
// INVARIANT: the index is disposable and never authoritative; the per-session files are.
// Every load diffs it against a real listing, so it cannot serve a stale plan after one is
// edited directly in the Drive web UI. Anything unparseable rebuilds from scratch.
import { sessionIdFromFileName } from "./sessions.js";

const VERSION = 1;
export const EMPTY_SESSIONS_INDEX = Object.freeze({ version: VERSION, entries: {} });

// -> a usable index, always. A cache that cannot be read is simply rebuilt.
export function readSessionsIndex(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    if (parsed.version !== VERSION) throw new Error("version");
    if (!parsed.entries || typeof parsed.entries !== "object") throw new Error("entries");
    return parsed;
  } catch {
    return { version: VERSION, entries: {} };
  }
}

// An entry is {name, modifiedTime, session}: the whole plan is cached, because that is what
// every view needs and a plan is small.
//
// index + live listing -> what to keep, what to refetch, what to drop.
// A changed NAME forces a refetch as well as a changed modifiedTime: Drive does not
// always bump modifiedTime on a rename, and the name is what the id comes from.
export function diffSessionsIndex(index, files) {
  const entries = index?.entries ?? {};
  const plans = (files ?? []).filter((f) => f && sessionIdFromFileName(f.name) !== null);
  const keep = {};
  const refetch = [];

  for (const file of plans) {
    const cached = entries[file.id];
    if (cached && cached.modifiedTime === file.modifiedTime && cached.name === file.name) {
      keep[file.id] = cached;
    } else {
      refetch.push(file);
    }
  }

  const live = new Set(plans.map((f) => f.id));
  const dropped = Object.keys(entries).filter((id) => !live.has(id));
  return { keep, refetch, dropped };
}

// kept entries + newly read entries -> the index to write back.
export function applySessionsDiff(keep, fetched) {
  return { version: VERSION, entries: { ...keep, ...fetched } };
}

// index -> { sessions: {id -> session}, meta: {id -> {fileId, modifiedTime}} }, the map the
// app renders plus the per-file conflict baselines.
//
// The FILE NAME decides a session's id, and the stored id is overwritten with it: a plan
// hand-edited so its stored id drifted must not shadow another file's plan. That rule also
// covers a plan with no stored id at all — the name still names it, and dropping it would
// make a file the owner can see in Drive vanish from the app. Only something that is not a
// session object at all (null, a string, an array) is skipped, having nothing to key.
export function sessionsFromIndex(index) {
  const sessions = {};
  const meta = {};
  for (const [fileId, entry] of Object.entries(index?.entries ?? {})) {
    const id = sessionIdFromFileName(entry?.name);
    const session = entry?.session;
    if (!id || !session || typeof session !== "object" || Array.isArray(session)) continue;
    sessions[id] = { ...session, id };
    meta[id] = { fileId, modifiedTime: entry.modifiedTime };
  }
  return { sessions, meta };
}
