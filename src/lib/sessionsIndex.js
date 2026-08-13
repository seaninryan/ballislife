// src/lib/sessionsIndex.js
// The sessions/index.json cache: read, diff and repair. Pure — no network, no Drive
// knowledge beyond the {id, name, modifiedTime} shape a listing returns.
//
// INVARIANT: the index is disposable and never authoritative; the per-session files are.
// Every load diffs it against a real listing, so it cannot serve a stale plan after one is
// edited directly in the Drive web UI. Anything unparseable rebuilds from scratch.
import { sessionIdFromFileName, SESSIONS_INDEX_NAME } from "./sessions.js";

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
// index + live listing -> what to keep, what to refetch, what to drop, and what looked
// like a plan but could not be one.
// A changed NAME forces a refetch as well as a changed modifiedTime: Drive does not
// always bump modifiedTime on a rename, and the name is what the id comes from.
//
// `unnamed` is the .json files in the sessions folder whose name yields no id — Drive's own
// "Copy of a.json" is the reachable case. They cannot be loaded, but they are reported
// rather than only filtered out: a file the owner can see in Drive must not simply not
// exist in the app. index.json is the cache and a non-.json file was never meant to be a
// plan, so neither counts.
export function diffSessionsIndex(index, files) {
  const entries = index?.entries ?? {};
  const listing = (files ?? []).filter(Boolean);
  const plans = listing.filter((f) => sessionIdFromFileName(f.name) !== null);
  const unnamed = listing.filter((f) => {
    const name = String(f.name ?? "").toLowerCase();
    return name.endsWith(".json")
      && name !== SESSIONS_INDEX_NAME.toLowerCase()
      && sessionIdFromFileName(f.name) === null;
  });
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
  return { keep, refetch, dropped, unnamed };
}

// kept entries + newly read entries -> the index to write back.
export function applySessionsDiff(keep, fetched) {
  return { version: VERSION, entries: { ...keep, ...fetched } };
}

// index -> { sessions: {id -> session}, meta: {id -> {fileId, modifiedTime}}, duplicates },
// the map the app renders, the per-file conflict baselines, and any id more than one file
// claims.
//
// The FILE NAME decides a session's id, and the stored id is overwritten with it: a plan
// hand-edited so its stored id drifted must not shadow another file's plan. That rule also
// covers a plan with no stored id at all — the name still names it, and dropping it would
// make a file the owner can see in Drive vanish from the app. Only something that is not a
// session object at all (null, a string, an array) is skipped, having nothing to key.
//
// Drive allows duplicate names, so two files can claim one id — reachable by creating the
// same-dated plan on two devices. The newest is shown, because hiding the plan is worse than
// showing one of two versions of it, but the collision is REPORTED and the caller must
// refuse to save into that id: silently writing to whichever file won would edit a file the
// owner may not be looking at. Ordering breaks a modifiedTime tie on fileId, so which file
// wins never depends on key order — a reload must not swap the plan underneath him.
export function sessionsFromIndex(index) {
  const claimed = new Map();
  for (const [fileId, entry] of Object.entries(index?.entries ?? {})) {
    const id = sessionIdFromFileName(entry?.name);
    const session = entry?.session;
    if (!id || !session || typeof session !== "object" || Array.isArray(session)) continue;
    if (!claimed.has(id)) claimed.set(id, []);
    claimed.get(id).push({ fileId, entry });
  }

  const sessions = {};
  const meta = {};
  const duplicates = [];
  for (const [id, files] of claimed) {
    const ordered = [...files].sort((a, b) =>
      String(b.entry.modifiedTime ?? "").localeCompare(String(a.entry.modifiedTime ?? ""))
      || String(a.fileId).localeCompare(String(b.fileId)));
    const winner = ordered[0];
    sessions[id] = { ...winner.entry.session, id };
    meta[id] = { fileId: winner.fileId, modifiedTime: winner.entry.modifiedTime };
    if (ordered.length > 1) {
      duplicates.push({
        id,
        files: ordered.map(({ fileId, entry }) => ({
          fileId, name: entry.name, modifiedTime: entry.modifiedTime,
        })),
      });
    }
  }
  return { sessions, meta, duplicates };
}
