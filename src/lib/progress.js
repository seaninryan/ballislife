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
// Stored TWICE, deliberately — see lib/dayMarks.js, which owns both shapes and the rule
// for reconciling them, and which attendance shares. What is left here is what is actually
// about blocks and slots: the keys, the migration off index keys, which block is current,
// the tallies, and which plans are under way.
//
// Both shapes are keyed by DAY as well as by session, so running the same plan again next
// week starts clean without anyone resetting it.
import { createDayMarks, mergeSides, sameMarks } from "./dayMarks.js";

export const DONE = "done";
export const SKIPPED = "skipped";

const dayStore = createDayMarks({
  storageKey: "ballislife_progress",
  field: "progress",
  states: [DONE, SKIPPED],
});

// The store's vocabulary, under this module's long-standing names, so no caller changes.
export const readProgress = dayStore.readMarks;
export const readStamp = dayStore.readStamp;
export const writeProgress = dayStore.writeMarks;
export const localProgress = dayStore.localSide;
export const sessionProgress = dayStore.sessionSide;
export const withSessionProgress = dayStore.withSessionSide;
export const mergeProgress = mergeSides;
export { sameMarks };

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
  const clean = dayStore.cleanMarks(marks);
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
  const local = dayStore.localSides(storage, day);
  const active = [];
  for (const session of sessions ?? []) {
    const blocks = session?.blocks ?? [];
    if (!blocks.length) continue;
    const winner = mergeProgress(local[session?.id] ?? null, sessionProgress(session, day));
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
