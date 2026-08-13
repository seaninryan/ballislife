// src/lib/drive.js
// Facade over driveAuth + driveApi. Owns exactly three things: one silent-reauth retry
// on 401, the catalogue load, and the per-file save queue.
import * as api from "./driveApi.js";
import { getAccessToken, ensureFreshToken } from "./driveAuth.js";
import { readIndex, entryFor, diffIndex, applyDiff } from "./driveIndex.js";
import { drillsFromIndex, fileNameFor } from "./drills.js";
import {
  parseSessionsBlob, sessionFileName, sessionIdFromFileName, SESSIONS_FOLDER, SESSIONS_INDEX_NAME,
} from "./sessions.js";
import {
  readSessionsIndex, diffSessionsIndex, applySessionsDiff, sessionsFromIndex,
} from "./sessionsIndex.js";

export const FOLDER_NAME = "BallIsLife";
export const INDEX_NAME = "index.json";
export const SESSIONS_NAME = "sessions.json";
// What the pre-split blob is renamed to. Deliberately still a name the owner can see in
// Drive: it is the only copy of every plan as it stood before the split, and only he
// should decide when to throw it away.
export const SESSIONS_BACKUP_NAME = "sessions-before-split.json";

// One silent-reauth retry, then give up. Ported from fancystats' saveWithRetry: an
// expired token is the common failure and is invisible to the user when it works.
async function withRetry(run) {
  try {
    return await run();
  } catch (e) {
    if (e?.code !== 401) throw e;
    await ensureFreshToken();
    return run();
  }
}

async function folders(token) {
  const found = await api.findAllFolders(token, FOLDER_NAME);
  if (found.length) return { folder: found[0], duplicateFolders: found.length > 1 };
  return { folder: await api.createFolder(token, FOLDER_NAME), duplicateFolders: false };
}

// Loads the whole catalogue, revalidating the cache against Drive.
// -> { folderId, indexFileId, index, drills, fetched, failed, duplicateFolders }
export async function loadCatalogue() {
  return withRetry(async () => {
    const token = getAccessToken();
    const { folder, duplicateFolders } = await folders(token);
    const files = await api.listFiles(token, folder);

    const indexFile = files.find((f) => f.name === INDEX_NAME) ?? null;
    const cached = indexFile ? readIndex(await api.readFile(token, indexFile.id)) : readIndex(null);

    const { keep, refetch, dropped } = diffIndex(cached, files);

    const built = {};
    const failed = [];
    for (const file of refetch) {
      try {
        const text = await api.readFile(token, file.id);
        built[file.id] = entryFor(file.name, file.modifiedTime, text);
      } catch (error) {
        // A 401 must still bubble to withRetry, which reauths and retries the whole
        // load — swallowing it here would turn an expired token into "every drill
        // failed".
        if (error?.code === 401) throw error;
        // Any other failure costs one drill, not the catalogue. This app is used on a
        // phone at the side of a pitch, where one flaky read is ordinary. Keep the
        // previous cached entry if there is one, so the drill still shows: its OLD
        // modifiedTime stays in the index, so the next load sees the mismatch and
        // retries by itself.
        failed.push({ id: file.id, name: file.name, error });
        const previous = cached.entries[file.id];
        if (previous) built[file.id] = previous;
      }
    }

    const index = applyDiff(keep, built);

    // Only rewrite the cache when it actually changed — a phone reload should not
    // cost a write.
    if (refetch.length || dropped.length || !indexFile) {
      const body = JSON.stringify(index);
      if (indexFile) await api.writeFile(token, indexFile.id, body);
      else await api.createFile(token, folder, INDEX_NAME, body);
    }

    // Seed the conflict baseline from what Drive just reported, so saveDrill can be
    // the authority on it rather than trusting the caller.
    for (const [id, entry] of Object.entries(index.entries)) known.set(id, entry.modifiedTime);

    return {
      folderId: folder,
      indexFileId: indexFile?.id ?? null,
      index,
      drills: drillsFromIndex(index),
      fetched: refetch.length,
      failed,
      duplicateFolders,
    };
  });
}

// Full text of one drill, plus the modifiedTime the editor will need as its save
// baseline. The grid renders a cached thumbnail; this is what opening a drill fetches.
export async function readDrill(id, folder) {
  return withRetry(async () => {
    const token = getAccessToken();
    const files = await api.listFiles(token, folder);
    const file = files.find((f) => f.id === id) ?? null;
    const text = await api.readFile(token, id);
    const modifiedTime = file?.modifiedTime ?? null;
    if (modifiedTime) known.set(id, modifiedTime);
    return { text, modifiedTime };
  });
}

// -- per-file save queue -----------------------------------------------------
// One chain per fileId, latest-wins. Rapid keystrokes collapse to the newest text, and
// two different drills never block each other. Ported in shape from fancystats'
// saveLatest, but keyed by file rather than global.
const queues = new Map();

function enqueue(id, run) {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(run, run).finally(() => {
    if (queues.get(id) === next) queues.delete(id);
  });
  queues.set(id, next);
  return next;
}

const pending = new Map();

// What Drive last reported for each file. drive.js is the authority on this rather than
// the caller: an earlier design took BOTH the loaded and the current modifiedTime as
// arguments, which meant `saveDrill({ base: x, current: x })` — passing one variable
// twice, the easiest possible mistake — silently disabled the conflict guard entirely.
const known = new Map();

export function noteModifiedTime(id, modifiedTime) { known.set(id, modifiedTime); }
export function knownModifiedTime(id) { return known.get(id) ?? null; }

// Which file holds each session, so saveSession does not need the caller to tell it — the
// same reasoning as `known` above: one authority on a fact drive.js already learned.
const sessionFileIds = new Map();

// Drops every baseline, session file id and resolved folder. None of it survives a sign-out
// (another account's Drive shares none of it) and none of it should survive a test: a
// leftover baseline for a reused literal id made a test pass alone and fail in file order.
export function forgetDriveState() {
  known.clear();
  sessionFileIds.clear();
  sessionsFolders.clear();
}

// -> { ok: true, modifiedTime } | { ok: false, conflict: true, modifiedTime }
//    | { ok: false, error }
//
// `baseModifiedTime` is what the caller loaded. If Drive has since reported something
// different — an edit from the Drive web UI, or another device — we refuse rather than
// clobber, and hand back the current value so the caller can offer to reload.
export async function saveDrill({ id, text, baseModifiedTime }) {
  const current = known.get(id);
  if (current !== undefined && baseModifiedTime !== current) {
    return { ok: false, conflict: true, modifiedTime: current };
  }
  pending.set(id, text);
  return enqueue(id, async () => {
    const latest = pending.get(id);
    if (latest === undefined) {
      // A later save in this burst already wrote the newest text. Report the
      // modifiedTime that actually landed: returning nothing here left the newest edit
      // unable to refresh its own baseline, so its next save spuriously conflicted
      // against the user's own previous keystroke.
      return { ok: true, coalesced: true, modifiedTime: known.get(id) ?? null };
    }
    pending.delete(id);
    try {
      await ensureFreshToken();
      const modifiedTime = await withRetry(() => api.writeFile(getAccessToken(), id, latest));
      known.set(id, modifiedTime);
      return { ok: true, modifiedTime };
    } catch (error) {
      return { ok: false, error };
    }
  });
}

// A new drill starts from a template that parses cleanly, so the preview is a real
// diagram from the first keystroke rather than an error banner.
export const TEMPLATE = (title) => `---
title: ${title}
category: skill
minutes: 15
players: 8-12
tags: []
---

What the players do.

\`\`\`pitch
area: 30x20 plain
cone: 0,0 30,0 0,20 30,20
red: A@6,10 B@24,10
pass: A->B
label: "${title}"
\`\`\`
`;

// -> { id, modifiedTime }. `taken` is the filenames already in the folder, so the slug
// does not collide.
export async function createDrill(folder, title, taken = []) {
  return withRetry(async () => {
    const token = getAccessToken();
    const name = fileNameFor(title, taken);
    const created = await api.createFile(token, folder, name, TEMPLATE(title));
    known.set(created.id, created.modifiedTime);
    return created;
  });
}

// Trash rather than delete: a mis-tap should be recoverable from Drive's bin.
export async function deleteDrill(id) {
  await withRetry(async () => api.trashFile(getAccessToken(), id));
  known.delete(id);
}

// -- sessions: one file per plan ----------------------------------------------
// `sessions/<id>.json` is authoritative; `sessions/index.json` is a disposable cache,
// diffed against a real listing on every load exactly like the drill index. A conflict on
// tonight's plan therefore cannot block saving any other, and one corrupt file costs one
// plan.

// The sessions subfolder, keyed by the BallIsLife folder it lives in. Remembered so a save
// does not spend a request rediscovering what the load already resolved.
const sessionsFolders = new Map();

async function sessionsFolderFor(token, folder) {
  const cached = sessionsFolders.get(folder);
  if (cached) return cached;
  const found = (await api.findChildFolder(token, folder, SESSIONS_FOLDER))
    ?? (await api.createFolder(token, SESSIONS_FOLDER, folder));
  sessionsFolders.set(folder, found);
  return found;
}

// One session file -> one cache entry. Anything that is not a JSON object caches
// `session: null`, which sessionsFromIndex skips: a hand-edit that broke one plan's JSON
// costs that plan, not the load.
function sessionEntry(name, modifiedTime, text) {
  let session = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) session = parsed;
  } catch { /* not JSON: leave session null */ }
  return { name, modifiedTime, session };
}

const sessionBody = (id, session) => JSON.stringify({ ...session, id }, null, 2);

// The pre-split blob, split into one file per plan. -> { migrated, entries, failed } where
// entries are ready-made index entries, since the plans are already in memory and reading
// back what we just wrote would be a wasted request.
//
// Only a session with NO file yet is written, never an overwrite: a migration interrupted
// halfway (or retried by withRetry after a 401) resumes rather than clobbering a per-file
// edit made since. The blob is then renamed aside, so it is no longer found by name and the
// migration does not repeat.
async function migrateBlob(token, folder, sessionsFolder, parentFiles, listing) {
  const blob = parentFiles.find((f) => f.name === SESSIONS_NAME) ?? null;
  if (!blob) return { migrated: 0, entries: {}, failed: [] };

  // A blob we cannot read is NOT an empty one. Either way nothing is written and nothing is
  // renamed, so the blob stays findable by name and a later load — after the owner repairs
  // it, or the signal comes back — migrates it for real. Reporting it is the other half:
  // an empty session list with no explanation reads as "my plans are gone".
  let raw;
  try {
    raw = await api.readFile(token, blob.id);
  } catch (error) {
    // A 401 must still reach withRetry, which reauths and retries the whole load.
    if (error?.code === 401) throw error;
    return { migrated: 0, entries: {}, failed: [{ id: blob.id, name: SESSIONS_NAME, error, reason: "blob" }] };
  }
  const parsed = parseSessionsBlob(raw);
  if (!parsed.ok) {
    return {
      migrated: 0,
      entries: {},
      failed: [{
        id: blob.id,
        name: SESSIONS_NAME,
        error: new Error(`sessions.json is unreadable (${parsed.reason})`),
        reason: "blob",
      }],
    };
  }
  const sessions = parsed.sessions;
  const haveFile = new Set(listing.map((f) => sessionIdFromFileName(f.name)).filter(Boolean));
  const entries = {};
  let unmigrated = 0;

  for (const [id, session] of Object.entries(sessions)) {
    if (haveFile.has(id)) continue;
    let name;
    try {
      name = sessionFileName(id);
    } catch {
      // An id the blob accepted that cannot be a file name. Nothing can be written for it,
      // so the blob must stay: see the rename guard below.
      unmigrated += 1;
      continue;
    }
    const created = await api.createFile(token, sessionsFolder, name, sessionBody(id, session));
    known.set(created.id, created.modifiedTime);
    entries[created.id] = {
      name,
      modifiedTime: created.modifiedTime,
      session: { ...session, id },
    };
  }

  // Keep the blob findable while any plan still lives only in it — a repeated read costs one
  // request, whereas renaming it away would hide a plan the app cannot show.
  if (!unmigrated) {
    try {
      await api.renameFile(token, blob.id, SESSIONS_BACKUP_NAME);
    } catch {
      // Every plan is safely in its own file; the rename is only tidying. Failing the load
      // over it would be worse, and the next load migrates nothing and retries the rename.
    }
  }

  return { migrated: Object.keys(entries).length, entries, failed: [] };
}

// -> { sessions, meta, migrated, failed }
//    sessions: { [id]: session }                    the map the app renders
//    meta:     { [id]: { fileId, modifiedTime } }   per-file conflict baselines
//    migrated: how many plans came out of the old blob this load
//    failed:   [{ id, name, error, reason }] — everything that could not be read, for the
//              same reporting as drills. `reason` is "read" for a flaky download and
//              "blob" for a sessions.json that could not be read at all.
export async function loadSessions(folder) {
  return withRetry(async () => {
    const token = getAccessToken();
    const parentFiles = await api.listFiles(token, folder);
    const sessionsFolder = await sessionsFolderFor(token, folder);
    const files = await api.listFiles(token, sessionsFolder);

    const indexFile = files.find((f) => f.name === SESSIONS_INDEX_NAME) ?? null;
    const cached = indexFile
      ? readSessionsIndex(await api.readFile(token, indexFile.id))
      : readSessionsIndex(null);

    const { migrated, entries: fromBlob, failed: blobFailed } = await migrateBlob(
      token, folder, sessionsFolder, parentFiles, files,
    );

    const { keep, refetch, dropped } = diffSessionsIndex(cached, files);

    const built = { ...fromBlob };
    const failed = [...blobFailed];
    for (const file of refetch) {
      try {
        const text = await api.readFile(token, file.id);
        built[file.id] = sessionEntry(file.name, file.modifiedTime, text);
      } catch (error) {
        // A 401 must still bubble to withRetry, which reauths and retries the whole load —
        // swallowing it here would turn an expired token into "every plan failed".
        if (error?.code === 401) throw error;
        // Any other failure costs one plan, not the lot. Keep the previous cached entry if
        // there is one, so the plan still shows: its OLD modifiedTime stays in the index, so
        // the next load sees the mismatch and retries by itself.
        failed.push({ id: file.id, name: file.name, error });
        const previous = cached.entries[file.id];
        if (previous) built[file.id] = previous;
      }
    }

    const index = applySessionsDiff(keep, built);

    // Only rewrite the cache when it actually changed — opening the app on a phone with
    // nothing new must not cost a write.
    if (refetch.length || dropped.length || migrated || !indexFile) {
      const body = JSON.stringify(index);
      if (indexFile) await api.writeFile(token, indexFile.id, body);
      else await api.createFile(token, sessionsFolder, SESSIONS_INDEX_NAME, body);
    }

    const { sessions, meta } = sessionsFromIndex(index);
    // A load is a full statement of what exists, so it replaces rather than adds to what we
    // knew: a plan deleted on another device must not leave a file id behind to save into.
    sessionFileIds.clear();
    for (const [id, m] of Object.entries(meta)) {
      known.set(m.fileId, m.modifiedTime);
      sessionFileIds.set(id, m.fileId);
    }

    return { sessions, meta, migrated, failed };
  });
}

// -> { ok: true, id, fileId, modifiedTime } | { ok: false, conflict: true, id, modifiedTime }
//    | { ok: false, id, error }
//
// `baseModifiedTime` is what the caller loaded for THIS plan. If Drive has since reported
// something else for its file, we refuse rather than clobber and hand back the current
// value, so the caller can offer to reload — but only for that one plan.
export async function saveSession({ folder, id, session, baseModifiedTime }) {
  const fileId = sessionFileIds.get(id) ?? null;
  const current = fileId ? known.get(fileId) : undefined;
  if (current !== undefined && baseModifiedTime !== current) {
    return { ok: false, conflict: true, id, modifiedTime: current };
  }
  try {
    const body = sessionBody(id, session);
    return await withRetry(async () => {
      const token = getAccessToken();
      if (!fileId) {
        const sessionsFolder = await sessionsFolderFor(token, folder);
        const created = await api.createFile(token, sessionsFolder, sessionFileName(id), body);
        known.set(created.id, created.modifiedTime);
        sessionFileIds.set(id, created.id);
        return { ok: true, id, fileId: created.id, modifiedTime: created.modifiedTime };
      }
      const modifiedTime = await api.writeFile(token, fileId, body);
      known.set(fileId, modifiedTime);
      return { ok: true, id, fileId, modifiedTime };
    });
  } catch (error) {
    return { ok: false, id, error };
  }
}

// Trash rather than delete, as for a drill: a mis-tap should be recoverable from Drive's
// bin. The index still lists the file, but the next load diffs it away.
export async function deleteSession({ id, fileId }) {
  await withRetry(async () => api.trashFile(getAccessToken(), fileId));
  known.delete(fileId);
  sessionFileIds.delete(id);
}
