// src/lib/drive.js
// Facade over driveAuth + driveApi. Owns exactly three things: one silent-reauth retry
// on 401, the catalogue load, and the per-file save queue.
import * as api from "./driveApi.js";
import { getAccessToken, ensureFreshToken } from "./driveAuth.js";
import { readIndex, entryFor, diffIndex, applyDiff } from "./driveIndex.js";
import { drillsFromIndex } from "./drills.js";

export const FOLDER_NAME = "BallIsLife";
export const INDEX_NAME = "index.json";

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
