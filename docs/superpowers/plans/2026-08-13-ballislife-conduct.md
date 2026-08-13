# ballislife Conduct-the-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a session like a conductor rather than a scroll — the current drill expanded, the rest collapsed but reopenable, each one markable **done** or **skipped**, and a drill swappable on the night when the numbers turn up wrong.

**Architecture:** Progress is a **pure module in `src/lib/progress.js`**, stored locally and keyed by session and day. Swapping edits the session and saves to Drive. The run view becomes an accordion whose first section is deliberately left open for attendance once squads exist.

**Tech Stack:** React 18, Vite 5, Vitest 2. No new dependencies.

**Previous plans:** foundation, drive-layer, browse, editor, sessions, run-session — all complete, deployed at v0.5.3.

---

## Where this came from

Sean ran a real session and reported back. His words: he wants "the current drill expanded… then mark it as done or skipped", the others "collapsed so you can refer back, reopen etc", because "skipping a drill happens often" — and to "swap a drill at short notice (e.g. if the numbers are small)". He also asked that, once squads exist, the **first collapsible section be the player list with attendance ticks**.

This plan is that, minus attendance, which needs a squad list first.

---

## Environment

```bash
node -v   # must be v20; if v14: export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

**`grep` is broken in this sandbox** — it exits 1 with no output even for present strings. Use the Grep tool or node.

Work from `/home/sean/workspace/ballislife`. **First create a branch: `git checkout -b conduct`.** Do not commit to `main`.

---

## What already exists

`npm test` is **441 passing across 30 files**.

| Module | Exports you will use |
| --- | --- |
| `lib/sessions.js` | `SLOTS`, `resolveBlocks`, `totalMinutes`, `emptySlots`, `setBlock`, `fitsSquad` |
| `lib/checklist.js` | `readTicks`, `writeTicks`, `toggle` — the pattern `progress.js` follows |
| `lib/drive.js` | `saveSessions({folder, fileId, data, baseModifiedTime})`, `readDrill` |
| `components/SessionRun.jsx` | the current run view: header, one card per block, `DrillPreview` per block |
| `components/SessionBuilder.jsx` | has the drill picker to reuse for swapping |

---

## Two decisions, and why

**1. Done and skipped are tonight's progress, not the plan.** Like ticks: `localStorage`,
keyed by session **and day**. So it survives a phone dying mid-session, and a session run
again next week starts clean without anyone resetting it. Nothing here writes to Drive,
which also means progress cannot fail on bad signal.

**2. Swapping a drill edits the saved session.** A session is one specific night's plan, so
adapting it when eight players turn up instead of fourteen *is* the record of what you did
— and it means the swap survives a reload, which matters when you are standing on a pitch.
It goes through the existing debounced `saveSessions`, so a failed save shows and retries
rather than being lost.

---

## Task 1: The progress model

**Files:**
- Create: `src/lib/progress.js`
- Test: `test/progress.test.js`

**This code is verified** — prototyped and run against all 14 assertions before this task
was written, including corrupt storage, private browsing, junk states and day eviction.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import {
  DONE, SKIPPED, readProgress, writeProgress, mark, reopen, currentIndex, counts,
} from "../src/lib/progress.js";

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe("currentIndex", () => {
  it("is the first block not yet settled", () => {
    expect(currentIndex({}, 5)).toBe(0);
    expect(currentIndex({ 0: DONE }, 5)).toBe(1);
    expect(currentIndex({ 0: DONE, 1: SKIPPED }, 5)).toBe(2);
  });

  it("finds the earliest gap when blocks are settled out of order", () => {
    expect(currentIndex({ 0: DONE, 2: DONE }, 5)).toBe(1);
  });

  it("is -1 once every block is settled", () => {
    expect(currentIndex({ 0: DONE, 1: SKIPPED }, 2)).toBe(-1);
  });
});

describe("mark and reopen", () => {
  it("marks done and skipped without mutating", () => {
    const before = {};
    const after = mark(before, 0, DONE);
    expect(after[0]).toBe(DONE);
    expect(before).toEqual({});
  });

  it("reopening makes a block current again", () => {
    const m = reopen(mark({}, 0, DONE), 0);
    expect(m[0]).toBeUndefined();
    expect(currentIndex(m, 5)).toBe(0);
  });
});

describe("counts", () => {
  it("counts done, skipped and remaining", () => {
    expect(counts({ 0: DONE, 1: SKIPPED }, 5)).toEqual({ done: 1, skipped: 1, remaining: 3 });
  });
});

describe("storage", () => {
  it("round-trips within a day", () => {
    const s = fakeStorage();
    writeProgress(s, "sess", "2026-08-13", { 0: DONE, 1: SKIPPED });
    expect(readProgress(s, "sess", "2026-08-13")).toEqual({ 0: DONE, 1: SKIPPED });
  });

  it("clears itself the next day, so a re-run starts clean", () => {
    const s = fakeStorage();
    writeProgress(s, "sess", "2026-08-13", { 0: DONE });
    expect(readProgress(s, "sess", "2026-08-14")).toEqual({});
  });

  it("evicts other days when it writes", () => {
    const s = fakeStorage();
    writeProgress(s, "old", "2026-08-01", { 0: DONE });
    writeProgress(s, "new", "2026-08-13", { 0: DONE });
    expect(readProgress(s, "old", "2026-08-01")).toEqual({});
  });

  it("removes the entry when nothing is marked", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "d", { 0: DONE });
    writeProgress(s, "x", "d", {});
    expect(readProgress(s, "x", "d")).toEqual({});
  });

  it("ignores states it does not recognise", () => {
    const s = fakeStorage();
    writeProgress(s, "x", "d", { 0: "weird", 1: DONE });
    expect(readProgress(s, "x", "d")).toEqual({ 1: DONE });
  });

  it("survives corrupt, absent and refusing storage", () => {
    const s = fakeStorage();
    s.setItem("ballislife_progress", "{{{ not json");
    expect(readProgress(s, "x", "d")).toEqual({});
    expect(readProgress(null, "x", "d")).toEqual({});
    expect(() => writeProgress(null, "x", "d", { 0: DONE })).not.toThrow();
    const throwing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeProgress(throwing, "x", "d", { 0: DONE })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/progress.test.js
```

- [ ] **Step 3: Write the implementation**

```js
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

export function counts(marks, blockCount) {
  let done = 0;
  let skipped = 0;
  for (let i = 0; i < blockCount; i += 1) {
    if (marks[i] === DONE) done += 1;
    else if (marks[i] === SKIPPED) skipped += 1;
  }
  return { done, skipped, remaining: blockCount - done - skipped };
}
```

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run test/progress.test.js    # expect 12 passed
git add src/lib/progress.js test/progress.test.js
git commit -m "feat: track tonight's progress through a session"
```

---

## Task 2: The run view becomes an accordion

**Files:**
- Modify: `src/components/SessionRun.jsx`, `test/sessionRun.test.jsx`, `src/styles.css`

- [ ] Required behaviour, each a test:
  - only the current block is expanded; the rest render collapsed to a one-line summary
    (slot, drill title, duration, and its state if settled)
  - a collapsed block can be opened to refer back, without changing what is marked
  - the current block offers **Done** and **Skip**
  - marking either collapses it and expands the next unsettled block
  - a settled block shows which it was, and offers **Reopen**
  - reopening makes it current again
  - when every block is settled, the view says the session is finished and offers to start over
  - a header summary shows done / skipped / remaining
  - progress survives a remount on the same day, and is clear on a new day
  - the empty-slot and broken-reference cases still behave as they do now

- [ ] **The first section is left open for attendance.** Structure the accordion so an
  extra section can be prepended above the blocks later without restructuring — Sean asked
  for the squad list with attendance ticks to live there once squads exist. Leave a comment
  saying so; do **not** build a placeholder.

- [ ] Tap targets for Done / Skip / Reopen sized for a thumb, like `.chip-button`. These
  get pressed with cold hands.

- [ ] Commit as `feat: conduct a session one drill at a time`.

---

## Task 3: Swap a drill on the night

**Files:**
- Modify: `src/components/SessionRun.jsx`, `test/sessionRun.test.jsx`, `src/App.jsx`, `test/app.test.jsx`

- [ ] The expanded block offers **Swap**, revealing the same picker the builder uses:
  drills matching the block's slot, filtered by `fitsSquad` against the session's turnout,
  with a "show all drills" escape hatch. Reuse `lib/sessions.js` — do not reimplement
  matching.

- [ ] Choosing a drill calls back to `App`, which applies `setBlock` and saves through the
  existing debounced `saveSessions`. The swapped drill's text is fetched if not already
  cached, reusing the run view's existing per-drill cache and its stale-request guard.

- [ ] Swapping does **not** clear progress on other blocks.

- [ ] Turnout is editable from the run view too — the reason to swap is usually that the
  numbers changed, so being able to type tonight's turnout here is the point. It already
  persists on the session.

- [ ] Tests: the picker respects slot and turnout; choosing a drill updates the session and
  triggers a save; a save failure surfaces without losing the swap; progress elsewhere is
  untouched.

- [ ] Commit as `feat: swap a drill during a session`.

---

## Task 4: Look at it

- [ ] Render the run view at 390px in each state: nothing started, mid-session with two
  done and one skipped, a collapsed block reopened, the swap picker open, and everything
  finished. Screenshot each.
- [ ] Judge as a coach mid-session, one-handed, in the cold: is the current drill obviously
  the current one? Are Done and Skip reachable without hunting? Is the collapsed summary
  enough to recognise a drill you want to reopen? Does the swap picker fit?
- [ ] Report concrete defects with what you would change; delete throwaway files.

---

## Task 5: Manual verification — Sean's

- [ ] Run a real session. Mark a drill done — does the next one open where you expect?
- [ ] Skip one. Does the summary reflect it?
- [ ] Reopen a finished drill to refer back, then leave it — progress should be unchanged.
- [ ] Lock the phone mid-session and come back: progress and ticks both still there.
- [ ] Swap a drill because the numbers are down. Check the session in Drive afterwards —
  the swap should be saved.
- [ ] Next week, open the same session: progress clear, the swap still in place.

---

## Done when

- The current drill is expanded, the rest collapsed and reopenable
- Done and Skip advance the session; Reopen returns to a drill
- A drill can be swapped on the night and the change is saved
- Progress survives a phone dying and clears the next day
- `npm test` passes, `npm run build` clean, Sean has run Task 5

## Next, and explicitly not now

- **Squads and attendance.** Sean asked for the player list as the first collapsible
  section with attendance ticks. That needs a squad list to exist first — its own project,
  and the accordion is built so it can slot in above the blocks.
- Visual diagram editing, drag-and-drop reordering, renaming, offline support — all still
  recorded in the spec with their reasons.
