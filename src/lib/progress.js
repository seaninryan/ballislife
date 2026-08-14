// src/lib/progress.js
// Tonight's progress through a session: which blocks are done, which were skipped, and
// therefore which one is current.
//
// A mark is keyed by its block's SLOT, not by the block's position in the plan. Position
// was the original key and was wrong: moveBlock reorders the blocks and leaves the marks
// alone, so moving a block moved its "Done" onto whichever drill took its place — and
// since the marks reached the session file, onto the coach's other device too. A session
// has exactly one block per slot and reordering only permutes them, so a slot names the
// same block for as long as the session exists. See blockKey and migrateMarks.
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

// Only ever trust two states, whichever store the marks came out of: both are
// hand-editable, and one is a JSON file the owner reads. Keys are NOT validated against
// the session's slots, because this function does not have the session — a mark for a slot
// that no longer exists is simply never read.
function cleanMarks(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    if ((v === DONE || v === SKIPPED) && k !== "") out[k] = v;
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
  const stamp = cleanStamp(updatedAt);
  // A stamped clear is kept as an empty entry, not deleted: "cleared at 20:00" has to
  // outrank the other device's "done at 19:00", and a missing entry cannot say when.
  // An unstamped clear has no time worth remembering, so it just forgets the day.
  if (Object.keys(clean).length === 0 && !stamp) delete store[sessionId];
  else store[sessionId] = { date: today, marks: clean, updatedAt: stamp };
  for (const [k, v] of Object.entries(store)) if (v?.date !== today) delete store[k];
  try {
    storage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private browsing refuses writes. Losing progress is acceptable; crashing is not.
  }
  return store;
}

// This device's side of the merge: null when it has nothing at all for the day, an entry
// with empty marks when the day was deliberately cleared here. The two must be told apart
// for the same reason sessionProgress tells them apart — otherwise the other device's
// older marks win and Not done undoes itself.
export function localProgress(storage, sessionId, today) {
  const entry = readAll(storage)[sessionId];
  if (!entry || entry.date !== today) return null;
  return { marks: cleanMarks(entry.marks), updatedAt: cleanStamp(entry.updatedAt) };
}

// The session-file half of the same information. Returns null rather than an empty entry
// when there is nothing for this day, so mergeProgress can tell "no marks yet" apart from
// "every mark was cleared" — which is the difference between Not done working and not. A
// day cleared everywhere is therefore kept as an empty stamped entry, never deleted.
export function sessionProgress(session, day) {
  const entry = session?.progress?.[day];
  if (!entry || typeof entry !== "object") return null;
  return { marks: cleanMarks(entry.marks), updatedAt: cleanStamp(entry.updatedAt) };
}

export function withSessionProgress(session, day, marks, updatedAt) {
  const progress = { ...(session?.progress ?? {}) };
  // An empty day is stored, not deleted — see sessionProgress. Deleting it made a clear
  // indistinguishable from an untouched day, so the other device re-uploaded its marks.
  progress[day] = { marks: cleanMarks(marks), updatedAt: cleanStamp(updatedAt) };
  return { ...session, progress };
}

// Whole-day last-writer-wins. Merging mark by mark is tempting and wrong: "Not done" is
// the ABSENCE of a key, so a union silently resurrects a mark you deliberately cleared on
// the other device. A stamped side always beats an unstamped one (an entry written before
// this feature existed has no stamp), and a tie prefers local so that opening a run view
// does not schedule a save that changes nothing.
//
// A stamp more than a day in the future is treated as no stamp: a phone whose clock is set
// to next year would otherwise win every comparison forever, silencing the other device
// with no way for the coach to notice. A day of slack is deliberate — clocks are routinely
// minutes or hours out, and this is a mitigation for the pathological case only, not an
// attempt to correct skew.
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

export function mergeProgress(local, remote, now = Date.now()) {
  if (!local && !remote) return { marks: {}, updatedAt: null };
  if (!local) return remote;
  if (!remote) return local;
  const limit = (Number.isFinite(now) ? now : Date.now()) + FUTURE_SLACK_MS;
  const at = (side) => {
    const t = Date.parse(side.updatedAt ?? "");
    return t <= limit ? t : NaN;
  };
  const l = at(local);
  const r = at(remote);
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

export const mark = (marks, key, state) => ({ ...marks, [key]: state });

export const reopen = (marks, key) => {
  const next = { ...marks };
  delete next[key];
  return next;
};

// A block's key in a marks map: its slot, which a reorder does not change — unlike its
// index, which used to be the key and meant that moving a block moved its mark onto
// whichever drill took its place. Every session has exactly one block per slot (asserted
// in test/sessions.test.js), so a slot identifies a block for as long as the session
// lives. The positional fallback is for a hand-edited session whose block has no slot: it
// keeps such blocks individually markable rather than collapsing them onto one key.
export const blockKey = (block, index) => {
  const slot = typeof block?.slot === "string" ? block.slot.trim() : "";
  return slot || `#${index}`;
};

// Index-keyed marks — every mark written before this change, in either store — to
// slot-keyed. Kept indefinitely rather than run once: it costs a pass over at most a
// handful of keys, and the alternative is a coach losing tonight's progress because a
// deploy landed between two drills.
export function migrateMarks(marks, blocks) {
  const clean = cleanMarks(marks);
  const out = {};
  // Slot keys first, then index keys only where that slot has nothing yet, so a map
  // holding both forms for one block resolves the same way whatever order its keys are in.
  for (const [k, v] of Object.entries(clean)) if (!/^\d+$/.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(clean)) {
    if (!/^\d+$/.test(k)) continue;
    const index = Number(k);
    const block = (blocks ?? [])[index];
    if (!block) continue; // a mark pointing past the end of the plan
    const key = blockKey(block, index);
    if (!(key in out)) out[key] = v;
  }
  return out;
}

// The block to show expanded: the first one not yet settled. Everything settled collapses
// but stays reopenable, so you can refer back to a drill you have already run.
export function currentIndex(marks, blocks) {
  const list = blocks ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (!marks[blockKey(list[i], i)]) return i;
  }
  return -1;
}

// Which plans are mid-run today: at least one block marked, at least one still to go. A
// plan merely DATED today is not under way (nothing has happened yet) and one whose every
// block is settled is finished, not under way.
//
// Reads the whole local store ONCE rather than per session: localStorage keeps only
// today's entry, but the session file's copy has to be checked for every plan, and this
// runs on every render of the header.
export function activeSessionIds(sessions, day, storage) {
  const store = readAll(storage);
  const active = [];
  for (const session of sessions ?? []) {
    const blocks = session?.blocks ?? [];
    if (!blocks.length) continue;
    const entry = store[session?.id];
    const local = entry && entry.date === day
      ? { marks: cleanMarks(entry.marks), updatedAt: cleanStamp(entry.updatedAt) }
      : null;
    const winner = mergeProgress(local, sessionProgress(session, day));
    const marks = migrateMarks(winner.marks, blocks);
    if (Object.keys(marks).length && currentIndex(marks, blocks) !== -1) {
      active.push(session.id);
    }
  }
  return active;
}

export function counts(marks, blocks) {
  const list = blocks ?? [];
  let done = 0;
  let skipped = 0;
  for (let i = 0; i < list.length; i += 1) {
    const state = marks[blockKey(list[i], i)];
    if (state === DONE) done += 1;
    else if (state === SKIPPED) skipped += 1;
  }
  return { done, skipped, remaining: list.length - done - skipped };
}
