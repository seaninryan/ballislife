// src/lib/driveIndex.js
// The index.json cache: build, diff and repair. Pure — no network, no Drive knowledge
// beyond the {id, name, modifiedTime} shape a listing returns.
//
// INVARIANT: the index is disposable and never authoritative. Every load diffs it
// against a real listing, so it cannot serve stale data after a drill is edited
// directly in the Drive web UI. Anything unparseable rebuilds from scratch.
import { parseDoc } from "./frontmatter.js";
import { splitSegments } from "./markdown.js";

const VERSION = 1;
export const EMPTY_INDEX = Object.freeze({ version: VERSION, entries: {} });

const isDrill = (name) => typeof name === "string" && name.toLowerCase().endsWith(".md");

// -> a usable index, always. A cache that cannot be read is simply rebuilt.
export function readIndex(raw) {
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

// One drill file -> one cache entry. `thumb` is the FIRST pitch block only: the grid
// draws one thumbnail per drill, and caching every block would bloat a file a phone
// has to download.
export function entryFor(name, modifiedTime, text) {
  const doc = parseDoc(text);
  const firstPitch = splitSegments(doc.body).find((s) => s.kind === "pitch");
  return {
    name,
    modifiedTime,
    meta: doc.meta ?? {},
    thumb: firstPitch ? firstPitch.text : null,
    invalid: doc.error,
  };
}

// index + live listing -> what to keep, what to refetch, what to drop.
// A changed NAME forces a refetch as well as a changed modifiedTime: Drive does not
// always bump modifiedTime on a rename, and the entry caches the name.
export function diffIndex(index, files) {
  const entries = index?.entries ?? {};
  const drills = (files ?? []).filter((f) => isDrill(f.name));
  const keep = {};
  const refetch = [];

  for (const file of drills) {
    const cached = entries[file.id];
    if (cached && cached.modifiedTime === file.modifiedTime && cached.name === file.name) {
      keep[file.id] = cached;
    } else {
      refetch.push(file);
    }
  }

  const live = new Set(drills.map((f) => f.id));
  const dropped = Object.keys(entries).filter((id) => !live.has(id));
  return { keep, refetch, dropped };
}

// kept entries + newly built entries -> the index to write back.
export function applyDiff(keep, fetched) {
  return { version: VERSION, entries: { ...keep, ...fetched } };
}
