// src/lib/progress.js
// Tonight's progress through a session: which blocks are done, which were skipped, and
// therefore which one is current.
//
// Local and keyed by day, exactly like lib/checklist.js and for the same reason: this is
// what happened tonight, not part of the plan. It survives a phone dying mid-session, a
// session run again next week starts clean without anyone resetting it, and marking a
// drill done can never fail on bad signal because it never touches Drive.
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

export function readProgress(storage, sessionId, today) {
  const entry = readAll(storage)[sessionId];
  if (!entry || entry.date !== today) return {};
  const marks = entry.marks && typeof entry.marks === "object" ? entry.marks : {};
  const out = {};
  for (const [k, v] of Object.entries(marks)) {
    if ((v === DONE || v === SKIPPED) && /^\d+$/.test(k)) out[Number(k)] = v;
  }
  return out;
}

export function writeProgress(storage, sessionId, today, marks) {
  const store = readAll(storage);
  const clean = {};
  for (const [k, v] of Object.entries(marks ?? {})) {
    if (v === DONE || v === SKIPPED) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) delete store[sessionId];
  else store[sessionId] = { date: today, marks: clean };
  for (const [k, v] of Object.entries(store)) if (v?.date !== today) delete store[k];
  try {
    storage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private browsing refuses writes. Losing progress is acceptable; crashing is not.
  }
  return store;
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

// The running "so far" total shown beside each block. A skipped block spent none of the
// session, so it contributes zero minutes to everything after it — otherwise skipping a
// 10' drill (the owner says this happens often) inflates the total for every block that
// follows, making the coach think more time has passed than actually has. The skipped
// block's own slot is `null` rather than the running number, because that number would
// just repeat the previous block's total and read as a duplicate/glitch rather than as
// "this contributed nothing" — the component shows a dash for `null`.
export function soFarMinutes(blocks, marks) {
  let sum = 0;
  return (blocks ?? []).map((block, i) => {
    const skipped = marks[i] === SKIPPED;
    if (!skipped) sum += block.minutes;
    return skipped ? null : sum;
  });
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
