# Slot-Keyed Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mark stays attached to the drill it was made against, even after the plan's blocks are reordered.

**Architecture:** Marks move from being keyed by a block's position in the plan to being keyed by its slot, which reordering does not change. A migration maps existing index-keyed marks through the session's blocks, and is kept indefinitely so a deploy landing mid-session cannot lose the night's progress.

**Tech Stack:** React 18, Vitest 2, no new dependencies.

---

## The bug

`marks` is keyed by a block's index: `{ "0": "done" }`. `moveBlock` (`src/lib/sessions.js:99`) reorders `session.blocks` and leaves `session.progress` alone. So: run a session, go back to the plan, move a block, run it again — and "Done" is now attached to whichever drill moved into position 0. Since v0.9.0 that mis-attribution also propagates to the coach's other device.

A block's **slot** is the right key. Every session has exactly one block per slot (`emptySession` builds them from `SLOTS`, and nothing in the app adds or duplicates a block), and `moveBlock` only permutes them — so a slot identifies a block for as long as the session exists, through any number of reorderings.

**The invariant this depends on:** one block per slot within a session. It is true today and Task 1 adds a test asserting it, so that if a future feature ever allows two "skill" blocks, that test fails and says why rather than progress quietly mis-attributing again.

**The fallback:** a hand-edited session could contain a block with no slot at all. `blockKey` gives such a block a positional key (`#3`) so it is still individually markable, rather than every slot-less block sharing one key.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/progress.js` (modify) | Gains `blockKey` and `migrateMarks`. `currentIndex` and `counts` take the blocks rather than a count. `cleanMarks` stops requiring numeric keys. |
| `src/components/SessionRun.jsx` (modify) | Marks by slot; migrates whatever it reads from either store. |
| `src/lib/sessions.js` | Unchanged. The one-block-per-slot invariant is asserted in its test file. |
| `test/progress.test.js` (modify) | The new functions; existing `currentIndex`/`counts` tests move to the new signature. |
| `test/sessions.test.js` (modify) | One test for the invariant. |
| `test/sessionRun.test.jsx` (modify) | The reorder case end to end, and that an index-keyed store still loads. |
| `test/app.test.jsx` (modify) | A mark made before a reorder is still on its own drill after one. |

---

### Task 1: `progress.js` keys by slot

**Files:**
- Modify: `src/lib/progress.js`
- Test: `test/progress.test.js`, `test/sessions.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/progress.test.js`, import `blockKey` and `migrateMarks` alongside the rest. **The existing `currentIndex` and `counts` describes must be rewritten** to the new signature — they currently pass a block count. Replace them with:

```js
const B = (...slots) => slots.map((slot) => ({ slot }));
const five = B("warmup", "skill", "tactical", "match", "fun");

describe("blockKey", () => {
  it("is the block's slot, which survives a reorder", () => {
    expect(blockKey({ slot: "warmup" }, 3)).toBe("warmup");
  });

  it("falls back to a positional key for a block with no usable slot", () => {
    // Only reachable through a hand-edited sessions file. Each such block still gets its
    // own key, rather than all of them sharing one.
    expect(blockKey({ slot: "  " }, 3)).toBe("#3");
    expect(blockKey({}, 0)).toBe("#0");
    expect(blockKey(undefined, 2)).toBe("#2");
  });
});

describe("currentIndex", () => {
  it("is the first block not yet settled", () => {
    expect(currentIndex({}, five)).toBe(0);
    expect(currentIndex({ warmup: DONE }, five)).toBe(1);
    expect(currentIndex({ warmup: DONE, skill: SKIPPED }, five)).toBe(2);
  });

  it("does not skip a gap: an unsettled block before a settled one is still current", () => {
    expect(currentIndex({ warmup: DONE, tactical: DONE }, five)).toBe(1);
  });

  it("is -1 when every block is settled, or when there are no blocks", () => {
    expect(currentIndex({ warmup: DONE, skill: SKIPPED }, B("warmup", "skill"))).toBe(-1);
    expect(currentIndex({}, [])).toBe(-1);
    expect(currentIndex({}, undefined)).toBe(-1);
  });

  it("follows the drill, not the position: reordering does not move a mark", () => {
    // The bug this change exists to fix. warmup is done; moving skill to the front must
    // leave warmup done and make skill current, not resurrect warmup as current.
    const marks = { warmup: DONE };
    expect(currentIndex(marks, five)).toBe(1);
    expect(currentIndex(marks, B("skill", "warmup", "tactical", "match", "fun"))).toBe(0);
  });
});

describe("counts", () => {
  it("counts by slot, so a reorder does not change the tally", () => {
    const marks = { warmup: DONE, skill: SKIPPED };
    expect(counts(marks, five)).toEqual({ done: 1, skipped: 1, remaining: 3 });
    expect(counts(marks, B("fun", "match", "tactical", "skill", "warmup")))
      .toEqual({ done: 1, skipped: 1, remaining: 3 });
  });

  it("handles no blocks", () => {
    expect(counts({}, [])).toEqual({ done: 0, skipped: 0, remaining: 0 });
  });
});

describe("migrateMarks", () => {
  it("maps an index-keyed mark onto the slot at that index", () => {
    expect(migrateMarks({ 0: DONE, 1: SKIPPED }, five)).toEqual({ warmup: DONE, skill: SKIPPED });
  });

  it("is a no-op on marks that are already slot-keyed, and is idempotent", () => {
    expect(migrateMarks({ warmup: DONE }, five)).toEqual({ warmup: DONE });
    const once = migrateMarks({ 0: DONE, 1: SKIPPED }, five);
    expect(migrateMarks(once, five)).toEqual(once);
  });

  it("prefers an existing slot key over the index that maps to it, in either key order", () => {
    expect(migrateMarks({ 0: DONE, warmup: SKIPPED }, five)).toEqual({ warmup: SKIPPED });
    expect(migrateMarks({ warmup: SKIPPED, 0: DONE }, five)).toEqual({ warmup: SKIPPED });
  });

  it("drops a mark that points past the end of the plan", () => {
    expect(migrateMarks({ 9: DONE }, five)).toEqual({});
  });

  it("drops an unknown state, and survives junk input", () => {
    expect(migrateMarks({ 0: "eaten", 1: DONE }, five)).toEqual({ skill: DONE });
    expect(migrateMarks(undefined, five)).toEqual({});
    expect(migrateMarks({ 0: DONE }, undefined)).toEqual({});
  });

  it("gives a slot-less block a positional key", () => {
    expect(migrateMarks({ 0: DONE }, B(""))).toEqual({ "#0": DONE });
  });
});
```

Also check the existing store tests (`readProgress`/`writeProgress`/`localProgress`/`sessionProgress`/`withSessionProgress`): several use `{ 0: DONE }` as a marks fixture. Those must keep passing — the stores stay agnostic about what a key means — but where a test's *intent* is "a realistic marks map", switch it to a slot key so the file does not read as if indices were still the format. Do not change assertions, only fixtures, and only where it does not weaken the test.

In `test/sessions.test.js`:

```js
  it("has exactly one block per slot, which is what makes a slot a stable key for progress", () => {
    // lib/progress.js keys marks by slot so that reordering blocks cannot move a mark to
    // another drill. If a future feature ever allows two blocks in one slot, this fails
    // first and points at why.
    const blocks = emptySession("s1", "2026-08-13").blocks;
    const slots = blocks.map((b) => b.slot);
    expect(new Set(slots).size).toBe(blocks.length);
    expect(slots).toEqual(SLOTS);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/progress.test.js test/sessions.test.js`
Expected: FAIL — `blockKey` and `migrateMarks` are not exported, and the rewritten `currentIndex`/`counts` tests fail against the count-based signature.

- [ ] **Step 3: Implement**

In `src/lib/progress.js`:

`cleanMarks` must stop requiring numeric keys — that filter is what currently makes slot keys impossible:

```js
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
```

Add, near `currentIndex`:

```js
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
```

Rewrite `currentIndex` and `counts` to take the blocks. They still return an index, because the accordion needs one to decide which block is current:

```js
// The block to show expanded: the first one not yet settled. Everything settled collapses
// but stays reopenable, so you can refer back to a drill you have already run.
export function currentIndex(marks, blocks) {
  const list = blocks ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (!marks[blockKey(list[i], i)]) return i;
  }
  return -1;
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
```

Update the module header comment: it describes marks as being about "which blocks" — make it say what the key is and why.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/progress.test.js test/sessions.test.js`, then `npm test` (`SessionRun` still calls the old signatures, so failures there are expected until Task 2 — note them and move on).

- [ ] **Step 5: Commit**

```bash
git add src/lib/progress.js test/progress.test.js test/sessions.test.js
git commit -m "feat: key progress by slot, not by block position"
```

---

### Task 2: `SessionRun` marks by slot

**Files:**
- Modify: `src/components/SessionRun.jsx`
- Test: `test/sessionRun.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `test/sessionRun.test.jsx`, using the file's existing interactive helpers:

```jsx
describe("SessionRun marks follow the drill, not the position", () => {
  const at = (t) => `2026-08-13T${t}:00.000Z`;
  const now = () => at("21:00");
  const ordered = (...slots) => slots.map((slot, i) => ({
    slot, drill: slot === "warmup" ? "a" : "b", minutes: null, note: "",
  }));

  it("a reordered plan keeps each mark on its own drill", () => {
    const s = { ...session([
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: "b", minutes: null, note: "" },
    ]), progress: { "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("19:00") } } };
    // Same session, blocks swapped — exactly what moveBlock produces.
    const swapped = { ...s, blocks: [s.blocks[1], s.blocks[0]] };
    mount({ session: swapped, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    const rows = container.querySelectorAll(".run-block");
    // Row 0 is now the skill block, and it is the one to do next.
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("skill");
    expect(rows[0].querySelector(".run-block-now-badge")).not.toBeNull();
    // Row 1 is the warmup, still Done.
    expect(rows[1].querySelector(".run-block-summary").textContent).toContain("Done");
  });

  it("marks are stored by slot", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: "b", minutes: null, note: "" },
    ]);
    const onProgress = vi.fn();
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    act(() => { findButton("Done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { warmup: DONE }, at("21:00"));
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ warmup: DONE });
  });

  it("an index-keyed mark left by the previous version still loads, onto the right drill", () => {
    // A deploy can land between two drills. Tonight's progress must not evaporate.
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE }, at("19:00"));
    const s = session([
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: "b", minutes: null, note: "" },
    ]);
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    const rows = container.querySelectorAll(".run-block");
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(rows[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("an index-keyed mark in the session file loads too", () => {
    const s = { ...session([
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: "b", minutes: null, note: "" },
    ]), progress: { "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") } } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Done");
  });
});
```

Delete the unused `ordered` helper above if you do not need it — do not leave dead code in the test file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/sessionRun.test.jsx`

- [ ] **Step 3: Implement**

In `src/components/SessionRun.jsx`:

Import `blockKey` and `migrateMarks` from `../lib/progress.js`.

Every read of either store must be migrated through the resolved blocks. `blocks` is already computed at the top of the component (`resolveBlocks(session, drills)`), so wrap each read:

- the `useState` initialiser for `marks`
- the render-time reset when `progressKey` changes
- the `local` side in the reconcile effect (`localProgress` returns `{marks, updatedAt}` or null — migrate `marks` and keep `updatedAt`)
- the `remote` side from `sessionProgress`

Do this with one small local helper so the migration cannot be forgotten at one of the four sites, e.g.:

```jsx
  // Every read of either store goes through this: marks written before v0.10 are keyed by
  // block index, and a mark must land on the drill it was made against even if the plan
  // has been reordered since.
  const readLocalMarks = () => migrateMarks(readProgress(storage(), session?.id, day), blocks);
```

Update the calls that changed signature:

```jsx
  const current = currentIndex(marks, blocks);
  const { done, skipped, remaining } = counts(marks, blocks);
```

`handleMark`, `handleReopen` and the row props need the block's key as well as its index — the index still drives `opened`/`picking` and the accordion, the key drives `marks`:

```jsx
  const handleMark = (index, key, state) => {
    persist(mark(marks, key, state));
    collapse(index);
    stopPicking(index);
  };

  const handleReopen = (index, key) => {
    persist(reopen(marks, key));
    collapse(index);
    stopPicking(index);
  };
```

and in the `rows` map:

```jsx
    const key = blockKey(block, index);
```
```jsx
        state={marks[key]}
        onDone={() => handleMark(index, key, DONE)}
        onSkip={() => handleMark(index, key, SKIPPED)}
        onReopen={() => handleReopen(index, key)}
```

Check `stopPicking` and `collapse`'s real names and signatures in the file before using them — the snippets above assume what is currently there.

**Also check the swap path.** `handlePick` clears the block's mark with `reopen(marks, index)`; it must now use the block's key. A swap replaces the drill in a slot, and the slot keeps its key, so a swapped block's mark must still be cleared.

- [ ] **Step 4: Run the tests**

Run: `npm test` — the whole suite, then `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionRun.jsx test/sessionRun.test.jsx
git commit -m "feat: the run view marks blocks by slot"
```

---

### Task 3: Prove it through the app, the way it actually happens

**Files:**
- Test: `test/app.test.jsx`

The bug is only reachable through a sequence of real navigation: run, back to plan, reorder, run again. A test at that level is the one that would have caught it.

- [ ] **Step 1: Write the test**

Add to `describe("App session run mode", …)`, using the file's existing helpers. `runSessionFixture` has `warmup` → drill `a` and `skill` → drill `b`; the builder's per-row "Move up"/"Move down" controls have `aria-label`s (see `src/components/SessionBuilder.jsx`).

```jsx
  it("a mark survives reordering the plan: it stays on its own drill", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, fileId: "sess", modifiedTime: "S2" });
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    // Mark the warm-up (drill a) done.
    await act(async () => { findButton("Done").click(); });
    // Back to the plan, move the skill block above the warm-up, and run it again.
    await act(async () => { findButton("Back to plan").click(); });
    const moveUp = [...container.querySelectorAll("button")]
      .filter((b) => b.getAttribute("aria-label") === "Move up");
    await act(async () => { moveUp[0].click(); });
    await act(async () => { findButton("Run this session").click(); });

    const rows = container.querySelectorAll(".run-block");
    // The skill block is first now, and is the one to do next — the warm-up stays done.
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("skill");
    expect(rows[0].querySelector(".run-block-now-badge")).not.toBeNull();
    expect(rows[1].querySelector(".run-block-summary").textContent).toContain("Done");
  });
```

Verify the "Move up" control's `aria-label` and which row index moves what before relying on the selector above; if the first row has no "Move up" (it does not — index 0 has no up control), `moveUp[0]` belongs to row 1, which is the skill block. Confirm that against the component rather than assuming.

- [ ] **Step 2: Run it**

Run: `npx vitest run test/app.test.jsx`
Expected: PASS. Then **verify it is load-bearing**: temporarily revert `blockKey` to `String(index)`, confirm this test fails, and revert your revert.

- [ ] **Step 3: Commit**

```bash
git add test/app.test.jsx
git commit -m "test: a mark survives reordering the plan"
```

---

## Deliberately not in this plan

- **Giving every block a generated id.** More robust than a slot if a session could ever hold two blocks in the same slot — but it cannot, and an id needs either a random source (which these pure functions deliberately do not have) or a migration that invents ids for every existing session. The invariant test in Task 1 is the guard.
- **Rewriting existing stored marks in Drive.** `migrateMarks` converts on read and the next write persists the new form. A migration pass over every session file would be more work, and would risk more, than a function that has to exist anyway.
- **Splitting `sessions.json` into per-session files.** The owner asked for this in the same breath, and it is the next plan — kept separate because it changes the Drive layer rather than the progress model, and each is easier to review alone.
