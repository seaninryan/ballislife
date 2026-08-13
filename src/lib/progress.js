// src/lib/progress.js
// Tonight's progress through a session: which blocks are done, which were skipped, and
// therefore which one is current.
//
// Stored TWICE, deliberately. localStorage is written synchronously on the tap, so
// marking a drill done never waits on signal and never fails — the original requirement
// for this view, unchanged. The same marks are also folded into the session in
// sessions.json on the usual debounce, so a session started on a phone can be finished
// on a laptop later the same day. This module owns both shapes and the rule for
// reconciling them; it performs no I/O of its own beyond the storage object handed in.
//
// Both shapes are keyed by DAY as well as by session, so running the same plan again next
// week starts clean without anyone resetting it.
const KEY = "ballislife_progress";
export const DONE = "done";
export const SKIPPED = "skipped";

const readAll = (storage) => {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Only ever trust two states and integer indices, whichever file the marks came out of:
// both stores are hand-editable — one is a JSON file the owner reads.
function cleanMarks(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    if ((v === DONE || v === SKIPPED) && /^\d+$/.test(k)) out[Number(k)] = v;
  }
  return out;
}

const cleanStamp = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

export function readProgress(storage, sessionId, today) {
  const entry = readAll(storage)[sessionId];
  if (!entry || entry.date !== today) return {};
  return cleanMarks(entry.marks);
}

export function readStamp(storage, sessionId, today) {
  const entry = readAll(storage)[sessionId];
  if (!entry || entry.date !== today) return null;
  return cleanStamp(entry.updatedAt);
}

export function writeProgress(storage, sessionId, today, marks, updatedAt = null) {
  const store = readAll(storage);
  const clean = {};
  for (const [k, v] of Object.entries(marks ?? {})) {
    if (v === DONE || v === SKIPPED) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) delete store[sessionId];
  else store[sessionId] = { date: today, marks: clean, updatedAt: cleanStamp(updatedAt) };
  for (const [k, v] of Object.entries(store)) if (v?.date !== today) delete store[k];
  try {
    storage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private browsing refuses writes. Losing progress is acceptable; crashing is not.
  }
  return store;
}

// The session-file half of the same information. Returns null rather than an empty entry
// when there is nothing for this day, so mergeProgress can tell "no marks yet" apart from
// "every mark was cleared" — which is the difference between Not done working and not.
export function sessionProgress(session, day) {
  const entry = session?.progress?.[day];
  if (!entry || typeof entry !== "object") return null;
  return { marks: cleanMarks(entry.marks), updatedAt: cleanStamp(entry.updatedAt) };
}

export function withSessionProgress(session, day, marks, updatedAt) {
  const progress = { ...(session?.progress ?? {}) };
  const clean = cleanMarks(marks);
  if (Object.keys(clean).length === 0) delete progress[day];
  else progress[day] = { marks: clean, updatedAt: cleanStamp(updatedAt) };
  return { ...session, progress };
}

// Whole-day last-writer-wins. Merging mark by mark is tempting and wrong: "Not done" is
// the ABSENCE of a key, so a union silently resurrects a mark you deliberately cleared on
// the other device. A stamped side always beats an unstamped one (an entry written before
// this feature existed has no stamp), and a tie prefers local so that opening a run view
// does not schedule a save that changes nothing.
export function mergeProgress(local, remote) {
  if (!local && !remote) return { marks: {}, updatedAt: null };
  if (!local) return remote;
  if (!remote) return local;
  const l = Date.parse(local.updatedAt ?? "");
  const r = Date.parse(remote.updatedAt ?? "");
  if (!Number.isFinite(l) && !Number.isFinite(r)) return local;
  if (!Number.isFinite(l)) return remote;
  if (!Number.isFinite(r)) return local;
  return r > l ? remote : local;
}

export function sameMarks(a, b) {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

export const mark = (marks, index, state) => ({ ...marks, [index]: state });

export const reopen = (marks, index) => {
  const next = { ...marks };
  delete next[index];
  return next;
};

// The block to show expanded: the first one not yet settled. Everything settled collapses
// but stays reopenable, so you can refer back to a drill you have already run.
export function currentIndex(marks, blockCount) {
  for (let i = 0; i < blockCount; i += 1) if (!marks[i]) return i;
  return -1;
}

export function counts(marks, blockCount) {
  let done = 0;
  let skipped = 0;
  for (let i = 0; i < blockCount; i += 1) {
    if (marks[i] === DONE) done += 1;
    else if (marks[i] === SKIPPED) skipped += 1;
  }
  return { done, skipped, remaining: blockCount - done - skipped };
}
