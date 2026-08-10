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

async function folderId(token) {
  return (await api.findFolder(token, FOLDER_NAME)) ?? api.createFolder(token, FOLDER_NAME);
}

// Loads the whole catalogue, revalidating the cache against Drive.
// -> { folderId, indexFileId, index, drills, fetched }
export async function loadCatalogue() {
  return withRetry(async () => {
    const token = getAccessToken();
    const folder = await folderId(token);
    const files = await api.listFiles(token, folder);

    const indexFile = files.find((f) => f.name === INDEX_NAME) ?? null;
    const cached = indexFile ? readIndex(await api.readFile(token, indexFile.id)) : readIndex(null);

    const { keep, refetch, dropped } = diffIndex(cached, files);

    const built = {};
    for (const file of refetch) {
      const text = await api.readFile(token, file.id);
      built[file.id] = entryFor(file.name, file.modifiedTime, text);
    }

    const index = applyDiff(keep, built);

    // Only rewrite the cache when it actually changed — a phone reload should not
    // cost a write.
    if (refetch.length || dropped.length || !indexFile) {
      const body = JSON.stringify(index);
      if (indexFile) await api.writeFile(token, indexFile.id, body);
      else await api.createFile(token, folder, INDEX_NAME, body);
    }

    return {
      folderId: folder,
      indexFileId: indexFile?.id ?? null,
      index,
      drills: drillsFromIndex(index),
      fetched: refetch.length,
    };
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

// -> { ok: true, modifiedTime } | { ok: false, conflict: true } | { ok: false, error }
//
// `baseModifiedTime` is what the editor loaded; `currentModifiedTime` is what Drive
// last reported. A mismatch means the file changed underneath us — from the Drive web
// UI, or another device — so we refuse rather than clobber.
export async function saveDrill({ id, text, baseModifiedTime, currentModifiedTime }) {
  if (baseModifiedTime !== currentModifiedTime) {
    return { ok: false, conflict: true };
  }
  pending.set(id, text);
  return enqueue(id, async () => {
    const latest = pending.get(id);
    if (latest === undefined) return { ok: true, skipped: true };
    pending.delete(id);
    try {
      await ensureFreshToken();
      const modifiedTime = await withRetry(() => api.writeFile(getAccessToken(), id, latest));
      return { ok: true, modifiedTime };
    } catch (error) {
      return { ok: false, error };
    }
  });
}
