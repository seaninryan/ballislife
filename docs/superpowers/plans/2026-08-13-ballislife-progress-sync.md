# Cross-Device Session Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marks made on the phone at the side of a pitch show up on the laptop later the same day, without a Done tap ever having to wait on the network.

**Architecture:** localStorage stays the immediate, never-fails write. On top of that, each session in `sessions.json` grows a `progress` map keyed by date, written through the existing debounced `saveSessions`. On opening a run view the two are reconciled by timestamp — newest wins for that session-day — and whichever side is behind is brought up to date.

**Tech Stack:** React 18, Vitest 2, no new dependencies.

---

## Why it works this way

**localStorage first, Drive second.** The owner's requirement when this view was built was that marking a drill done can never fail on bad signal. That still holds: `writeProgress` runs synchronously on the tap, and the Drive write is a debounced consequence. If the phone has no signal all evening, the session runs exactly as it does today and syncs when it next has signal — provided the app is still open, which is the honest limit of a client-only app with no service worker.

**Keyed by date, not just by session.** A session's id is its date today, but a session can be *run* on a different day from the one it was planned for, and re-running one next week must still start clean. `progress: { "2026-08-13": {…} }` gives both: finishing tonight's session on the laptop finds tonight's marks, and next week's run of the same plan finds nothing.

**Last-writer-wins per session-day, with a stored timestamp.** The alternative — merging mark-by-mark — cannot represent un-marking: "Not done" is the *absence* of a key, indistinguishable from "the other device never marked it". A whole-day timestamp comparison keeps "Not done" working, and the real-world contention here is one coach with two devices, sequentially, not two coaches at once.

**Timestamps are ISO strings.** The owner reads `sessions.json` by hand — that is how this requirement arose. `"2026-08-13T19:04:12.000Z"` tells him something; `1723575852000` does not.

---

## Data shapes

Local (`localStorage`, key `ballislife_progress`) — one extra field, and old entries without it must still load:

```json
{ "2026-08-13": { "date": "2026-08-13", "marks": { "0": "done" }, "updatedAt": "2026-08-13T19:04:12.000Z" } }
```

In `sessions.json`, per session — additive, so `readSessions`'s version check does not change:

```json
{ "id": "2026-08-13", "date": "2026-08-13", "blocks": [ "…" ],
  "progress": { "2026-08-13": { "marks": { "0": "done", "1": "skipped" },
                                "updatedAt": "2026-08-13T19:04:12.000Z" } } }
```

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/progress.js` (modify) | Owns both shapes and the reconciliation rule. Gains `updatedAt` on the local entry, plus `readStamp`, `sessionProgress`, `withSessionProgress`, `mergeProgress`, `sameMarks`. |
| `src/lib/sessions.js` (modify) | `emptySession` gains `progress: {}`. Nothing else — the session file's shape lives here, its progress semantics do not. |
| `src/components/SessionRun.jsx` (modify) | Reconciles local against the session's stored progress in an effect; reports marks upward via `onProgress`. |
| `src/components/Catalogue.jsx` (modify) | Thread `onRunProgress`; show the sessions save/conflict banner over the run view too. |
| `src/App.jsx` (modify) | `onRunProgress`: fold marks into the session and schedule the existing debounced save. |
| `test/progress.test.js` (modify) | The reconciliation rule and both shapes. |
| `test/sessions.test.js` (modify) | `emptySession` includes `progress`. |
| `test/sessionRun.test.jsx` (modify) | Reconciliation on open, reporting upward, no write loop. |
| `test/app.test.jsx` (modify) | A mark reaches `saveSessions`; a mark from another device shows on open. |

---

### Task 1: `progress.js` learns the second shape and the merge rule

**Files:**
- Modify: `src/lib/progress.js`
- Test: `test/progress.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/progress.test.js` (import the new names alongside the existing ones):

```js
describe("local entries carry a timestamp", () => {
  it("writeProgress records when the marks were made, and readStamp reads it back", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-13", { 0: DONE }, "2026-08-13T19:04:12.000Z");
    expect(readProgress(store, "s1", "2026-08-13")).toEqual({ 0: DONE });
    expect(readStamp(store, "s1", "2026-08-13")).toBe("2026-08-13T19:04:12.000Z");
  });

  it("an entry written before this feature existed still loads, with no stamp", () => {
    const store = fakeStorage();
    store.setItem("ballislife_progress", JSON.stringify({
      s1: { date: "2026-08-13", marks: { 0: DONE } },
    }));
    expect(readProgress(store, "s1", "2026-08-13")).toEqual({ 0: DONE });
    expect(readStamp(store, "s1", "2026-08-13")).toBe(null);
  });

  it("readStamp ignores another day's entry, exactly as readProgress does", () => {
    const store = fakeStorage();
    writeProgress(store, "s1", "2026-08-12", { 0: DONE }, "2026-08-12T19:00:00.000Z");
    expect(readStamp(store, "s1", "2026-08-13")).toBe(null);
  });
});

describe("progress stored on the session itself", () => {
  const session = (progress) => ({ id: "s1", date: "2026-08-13", blocks: [], progress });

  it("reads a day's marks and stamp out of a session", () => {
    const s = session({ "2026-08-13": { marks: { 1: SKIPPED }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    expect(sessionProgress(s, "2026-08-13")).toEqual({
      marks: { 1: SKIPPED }, updatedAt: "2026-08-13T19:00:00.000Z",
    });
  });

  it("a session with no progress at all, or none for this day, reads as nothing", () => {
    expect(sessionProgress(session(undefined), "2026-08-13")).toBe(null);
    expect(sessionProgress(session({}), "2026-08-13")).toBe(null);
    expect(sessionProgress(undefined, "2026-08-13")).toBe(null);
  });

  it("discards junk rather than trusting the file: bad marks, bad keys, bad states", () => {
    const s = session({ "2026-08-13": { marks: { 0: DONE, 1: "eaten", x: DONE }, updatedAt: 7 } });
    expect(sessionProgress(s, "2026-08-13")).toEqual({ marks: { 0: DONE }, updatedAt: null });
  });

  it("writes a day's marks into a session without touching another day or the blocks", () => {
    const s = session({ "2026-08-12": { marks: { 0: DONE }, updatedAt: "2026-08-12T19:00:00.000Z" } });
    const next = withSessionProgress(s, "2026-08-13", { 1: SKIPPED }, "2026-08-13T19:04:12.000Z");
    expect(next.progress["2026-08-12"]).toEqual(s.progress["2026-08-12"]);
    expect(next.progress["2026-08-13"]).toEqual({
      marks: { 1: SKIPPED }, updatedAt: "2026-08-13T19:04:12.000Z",
    });
    expect(next.blocks).toBe(s.blocks);
    expect(s.progress["2026-08-13"]).toBeUndefined(); // the input is not mutated
  });

  it("clearing every mark removes the day rather than storing an empty object", () => {
    const s = session({ "2026-08-13": { marks: { 0: DONE }, updatedAt: "2026-08-13T19:00:00.000Z" } });
    const next = withSessionProgress(s, "2026-08-13", {}, "2026-08-13T20:00:00.000Z");
    expect(next.progress["2026-08-13"]).toBeUndefined();
  });

  it("works on a session that has no progress key yet", () => {
    const next = withSessionProgress(session(undefined), "2026-08-13", { 0: DONE }, "T");
    expect(next.progress["2026-08-13"].marks).toEqual({ 0: DONE });
  });
});

describe("mergeProgress", () => {
  const at = (t) => `2026-08-13T${t}:00.000Z`;

  it("takes whichever side was written later", () => {
    const local = { marks: { 0: DONE }, updatedAt: at("19:00") };
    const remote = { marks: { 0: DONE, 1: DONE }, updatedAt: at("20:00") };
    expect(mergeProgress(local, remote).marks).toEqual({ 0: DONE, 1: DONE });
    expect(mergeProgress(remote, local).marks).toEqual({ 0: DONE, 1: DONE });
  });

  it("keeps an un-marking done later, which a per-block merge could not", () => {
    // "Not done" is the ABSENCE of a key. A union would silently resurrect the mark.
    const local = { marks: {}, updatedAt: at("20:00") };
    const remote = { marks: { 0: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(local, remote).marks).toEqual({});
  });

  it("uses the side that has a stamp when the other does not", () => {
    const stamped = { marks: { 1: DONE }, updatedAt: at("19:00") };
    const unstamped = { marks: { 0: DONE }, updatedAt: null };
    expect(mergeProgress(unstamped, stamped).marks).toEqual({ 1: DONE });
    expect(mergeProgress(stamped, unstamped).marks).toEqual({ 1: DONE });
  });

  it("prefers local on a tie, so an equal timestamp does not cause a pointless write", () => {
    const local = { marks: { 0: DONE }, updatedAt: at("19:00") };
    const remote = { marks: { 1: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(local, remote).marks).toEqual({ 0: DONE });
  });

  it("handles one side, or neither, being absent", () => {
    const local = { marks: { 0: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(local, null)).toBe(local);
    expect(mergeProgress(null, local)).toBe(local);
    expect(mergeProgress(null, null)).toEqual({ marks: {}, updatedAt: null });
  });

  it("treats an unparseable stamp as no stamp rather than as the epoch", () => {
    const bad = { marks: { 0: DONE }, updatedAt: "whenever" };
    const good = { marks: { 1: DONE }, updatedAt: at("19:00") };
    expect(mergeProgress(bad, good).marks).toEqual({ 1: DONE });
  });
});

describe("sameMarks", () => {
  it("compares by value, so a reconciliation that changes nothing can be skipped", () => {
    expect(sameMarks({ 0: DONE }, { 0: DONE })).toBe(true);
    expect(sameMarks({}, {})).toBe(true);
    expect(sameMarks({ 0: DONE }, { 0: SKIPPED })).toBe(false);
    expect(sameMarks({ 0: DONE }, { 0: DONE, 1: DONE })).toBe(false);
    expect(sameMarks({ 0: DONE, 1: DONE }, { 0: DONE })).toBe(false);
  });

  it("does not care whether an index is a number or a string key", () => {
    // readProgress yields numeric keys; JSON round-tripping yields strings.
    expect(sameMarks({ 0: DONE }, { "0": DONE })).toBe(true);
  });
});
```

If `test/progress.test.js` has no `fakeStorage` helper, use whatever storage double the file already uses for `readProgress`/`writeProgress` — do not introduce a second one.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/progress.test.js`
Expected: FAIL — `readStamp` and the rest are not exported.

- [ ] **Step 3: Implement**

In `src/lib/progress.js`:

Rewrite the header comment — it currently states as a rule that progress "never touches Drive", which stops being true:

```js
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
```

Keep `KEY`, `DONE`, `SKIPPED`, `readAll`, `mark`, `reopen`, `currentIndex`, `counts` as they are. Extract the mark-cleaning that `readProgress` already does, since three functions now need it:

```js
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
```

Then `readProgress` becomes:

```js
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
```

`writeProgress` takes the stamp as a fourth argument. It stays optional so existing callers and tests keep working:

```js
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
```

Add the session-file shape and the merge rule:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/progress.test.js` then `npm test`.
Expected: PASS. Every pre-existing progress test must still pass — `writeProgress`'s new argument is optional precisely so they do.

- [ ] **Step 5: Commit**

```bash
git add src/lib/progress.js test/progress.test.js
git commit -m "feat: progress gains a timestamp and a session-file shape"
```

---

### Task 2: `emptySession` carries a progress map

**Files:**
- Modify: `src/lib/sessions.js:14-24`
- Test: `test/sessions.test.js`

- [ ] **Step 1: Write the failing test**

```js
  it("a new session has a progress map, so the shape is the same before and after a run", () => {
    expect(emptySession("s1", "2026-08-13").progress).toEqual({});
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/sessions.test.js`
Expected: FAIL — `undefined` is not `{}`.

- [ ] **Step 3: Implement**

Add to the object `emptySession` returns:

```js
    // Filled in per day by a run (see lib/progress.js). Every reader tolerates its
    // absence, because sessions created before this existed do not have it.
    progress: {},
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/sessions.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessions.js test/sessions.test.js
git commit -m "feat: a new session carries a progress map"
```

---

### Task 3: `SessionRun` reconciles and reports

**Files:**
- Modify: `src/components/SessionRun.jsx`
- Test: `test/sessionRun.test.jsx`

Behaviour:
- Marks still load from localStorage synchronously on mount and whenever the session-day changes, so there is no flicker and no dependence on the network.
- An effect then reconciles that against `sessionProgress(session, day)` via `mergeProgress`. If the reconciliation changes what is on screen, it updates state and writes the merged marks to localStorage. If local is the winner and differs from what the session holds, it reports upward through `onProgress(day, marks, updatedAt)` so Drive catches up.
- Every mark, skip and un-mark calls `onProgress(day, next, now())` as well as writing localStorage.
- `now` is an injectable prop (`() => new Date().toISOString()` by default) so tests are deterministic.
- Without `onProgress`, behaviour is exactly as today — the component stays usable standalone.
- **No write loop.** The effect compares by value with `sameMarks` before doing anything, and reporting upward changes the session prop, which re-runs the effect — by which point the two sides agree and it does nothing.

- [ ] **Step 1: Write the failing tests**

Add to `test/sessionRun.test.jsx`, using the file's existing interactive helpers:

```jsx
describe("SessionRun progress reconciliation", () => {
  const twoBlocks = () => [
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ];
  const at = (t) => `2026-08-13T${t}:00.000Z`;
  const now = () => at("21:00");

  it("shows marks that were made on another device", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    const blocks = container.querySelectorAll(".run-block");
    expect(blocks[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(blocks[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("writes those marks to this device too, so it works offline from then on", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ 0: DONE });
  });

  it("a newer local mark wins over the session's, and is reported so Drive catches up", () => {
    writeProgress(localStorage, "s1", "2026-08-13", { 0: SKIPPED }, at("20:00"));
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Skipped");
    expect(onProgress).toHaveBeenCalledWith("2026-08-13", { 0: SKIPPED }, at("20:00"));
  });

  it("reports nothing when both sides already agree", () => {
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE }, at("19:00"));
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("reports each mark, skip and un-mark upward with the time it happened", () => {
    const onProgress = vi.fn();
    const s = session(twoBlocks());
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    act(() => { findButton("Done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { 0: DONE }, at("21:00"));
    act(() => { findButton("Skip").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { 0: DONE, 1: SKIPPED }, at("21:00"));
    act(() => { findButton("Not done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { 1: SKIPPED }, at("21:00"));
  });

  it("settles rather than looping when the session prop comes back with what was reported", () => {
    // App writes the reported marks into the session, which re-renders this component.
    // The effect must then find both sides in agreement and do nothing.
    const onProgress = vi.fn();
    let s = session(twoBlocks());
    const root = mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    act(() => { findButton("Done").click(); });
    const [day, marks, stamp] = onProgress.mock.calls.at(-1);
    onProgress.mockClear();
    s = { ...s, progress: { [day]: { marks, updatedAt: stamp } } };
    act(() => { root.render(<SessionRun session={s} drills={runDrills()} texts={{}} today="2026-08-13" onProgress={onProgress} now={now} />); });
    expect(onProgress).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Done");
  });

  it("ignores another day's stored progress", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-12": { marks: { 0: DONE, 1: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("works with no onProgress at all, exactly as before", () => {
    const s = session(twoBlocks());
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13" });
    act(() => { findButton("Done").click(); });
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ 0: DONE });
  });
});
```

`runDrills()` stands for whatever drill fixture the file's swap tests already build — reuse it rather than adding another. `session(...)` is the file's existing helper (id `s1`). The mount helper must return the root so the last test can re-render into it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/sessionRun.test.jsx`
Expected: FAIL — nothing reads `session.progress`.

- [ ] **Step 3: Implement**

In `src/components/SessionRun.jsx`, extend the imports:

```jsx
import React, { useState, useEffect } from "react";
```

```jsx
import {
  DONE, SKIPPED, readProgress, readStamp, writeProgress, mark, reopen,
  currentIndex, counts, sessionProgress, mergeProgress, sameMarks,
} from "../lib/progress.js";
```

Extend the signature:

```jsx
export default function SessionRun({
  session, drills = [], texts = {}, onBack, onSwap, onProgress, today,
  now = () => new Date().toISOString(),
}) {
```

Replace `persist` so every mark reports upward as well as writing locally:

```jsx
  // localStorage first and synchronously: marking a drill done must never wait on signal
  // or be able to fail. Reporting upward is what eventually reaches Drive, on App's
  // existing debounce — a consequence of the tap, never a precondition for it.
  const persist = (next) => {
    const stamp = now();
    setMarks(next);
    writeProgress(storage(), session?.id, day, next, stamp);
    onProgress?.(day, next, stamp);
  };
```

Add the reconciliation effect after the existing state (and after the key-change adjustment that already resets `marks`, `opened` and `picking`):

```jsx
  // Reconcile this device against what the session file says, once the session data is in
  // hand. Runs as an effect rather than during render because it may write localStorage
  // and call onProgress, and it re-runs when the session's stored progress changes — which
  // matters because sessions.json loads AFTER the first render of this view.
  //
  // It cannot loop: reporting upward makes App write those same marks into the session,
  // which re-renders this component, at which point sameMarks finds the two sides in
  // agreement and nothing further happens.
  const remote = sessionProgress(session, day);
  const remoteKey = remote ? `${remote.updatedAt} ${JSON.stringify(remote.marks)}` : "";
  useEffect(() => {
    const local = {
      marks: readProgress(storage(), session?.id, day),
      updatedAt: readStamp(storage(), session?.id, day),
    };
    const winner = mergeProgress(local, remote);
    if (winner === remote) {
      // The other device is ahead. Adopt it here, including on this device's storage, so
      // the rest of tonight works with no signal at all.
      if (!sameMarks(winner.marks, local.marks)) {
        writeProgress(storage(), session?.id, day, winner.marks, winner.updatedAt);
      }
      if (!sameMarks(winner.marks, marks)) setMarks(winner.marks);
      return;
    }
    // This device is ahead (or the only one that has anything). Let Drive catch up.
    if (!sameMarks(winner.marks, remote?.marks ?? {})) {
      onProgress?.(day, winner.marks, winner.updatedAt ?? now());
    }
  }, [session?.id, day, remoteKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

Note the effect's dependency list is intentionally narrow: `marks` and `onProgress` are deliberately excluded, because including `marks` would re-run the reconciliation on every tap (where local has just won by construction) and including `onProgress` would re-run it whenever App re-creates the callback. If the repo has no eslint config, drop the disable comment but keep the explanation.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/sessionRun.test.jsx`, then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionRun.jsx test/sessionRun.test.jsx
git commit -m "feat: the run view reconciles progress with the session file"
```

---

### Task 4: `App` saves progress, and the run view can see a failed save

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/Catalogue.jsx`
- Test: `test/app.test.jsx`

Two parts. First the write path. Second: a save can now fail or conflict *while a session is being run*, and today the conflict and failure banners only render around `SessionBuilder` — so at the pitch side a failed save would be completely silent. The run view gets the same banners, using the same handlers.

- [ ] **Step 1: Write the failing tests**

Add to `describe("App session run mode", …)` in `test/app.test.jsx`:

```jsx
  it("a mark made during a run is saved into the session's progress", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      const saved = drive.saveSessions.mock.calls.at(-1)[0];
      const days = Object.keys(saved.data.sessions.s1.progress);
      expect(days).toHaveLength(1);
      expect(saved.data.sessions.s1.progress[days[0]].marks).toEqual({ 0: "done" });
      expect(saved.data.sessions.s1.progress[days[0]].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("progress made on another device shows when the run view opens", async () => {
    drive.loadSessions.mockResolvedValue({
      fileId: "sess",
      data: { version: 1, sessions: { s1: {
        ...runSessionFixture(),
        progress: { [new Date().toISOString().slice(0, 10)]: {
          marks: { 0: "done" }, updatedAt: new Date().toISOString(),
        } },
      } } },
      modifiedTime: "S1",
    });
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    const first = container.querySelectorAll(".run-block")[0];
    expect(first.querySelector(".run-block-summary").textContent).toContain("Done");
  });

  it("a failed save is visible from the run view, not only from the builder", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: false, error: new Error("offline") });
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(container.textContent).toMatch(/could not save/i);
      // And the mark itself is still on screen: localStorage took it regardless.
      expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
        .toContain("Done");
    } finally {
      vi.useRealTimers();
    }
  });
```

Check `saveSessions`'s real result contract in `src/lib/drive.js` before writing the mock returns above, and match it exactly — the existing session tests in this file are the reference.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/app.test.jsx`

- [ ] **Step 3: Implement the write path**

In `src/App.jsx`, import `withSessionProgress` from `./lib/progress.js`, and add beside `onRunSwap`:

```jsx
  // A mark from the run view. Same path as any other session edit — merge into the
  // sessions map, schedule the debounced save — so tonight's progress reaches Drive and
  // the laptop, while the run view's own localStorage write has already made it durable
  // on this device whether or not this succeeds.
  const onRunProgress = useCallback((day, marks, updatedAt) => {
    const sess = sessionsStateRef.current.data.sessions[runSessionId];
    if (!sess) return;
    onSessionChange(withSessionProgress(sess, day, marks, updatedAt));
  }, [runSessionId, onSessionChange]);
```

Pass `onRunProgress` to `Catalogue`.

- [ ] **Step 4: Implement the banners over the run view**

In `src/components/Catalogue.jsx`, the sessions conflict/failure banners are currently inside the `if (selectedSession)` branch only. Extract them into a small local component so the run branch can render the same thing without duplicating the markup:

```jsx
// The sessions file is saved from two places now — the builder and, via progress marks,
// the run view. A save that fails at the side of a pitch must say so there rather than
// only on the screen the coach is not looking at.
function SessionsSaveBanner({ status, error, onKeepMine, onReload }) {
  if (status === "conflict") {
    return (
      <div className="banner warn">
        This plan changed in Drive since you opened it. Your edit is safe and still
        below — choose which version to keep.
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="primary" onClick={onKeepMine}>Keep mine</button>
          <button type="button" onClick={onReload}>Reload Drive’s version</button>
        </div>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="banner err">
        Could not save: {friendlyError(error)} Your edit is still here and will be
        retried when you change something again.
      </div>
    );
  }
  return null;
}
```

Use it in both the `selectedSession` branch (replacing the inline blocks) and the `runSession` branch:

```jsx
  if (runSession) {
    return (
      <div>
        <SessionsSaveBanner
          status={sessionsStatus}
          error={sessionsError}
          onKeepMine={onKeepMineSessions}
          onReload={onReloadSessions}
        />
        <SessionRun
          session={runSession}
          drills={drills}
          texts={runTexts}
          onBack={onRunBack}
          onSwap={onRunSwap}
          onProgress={onRunProgress}
        />
      </div>
    );
  }
```

Add `onRunProgress` to Catalogue's destructured props.

- [ ] **Step 5: Run the tests and build**

Run: `npm test` then `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/Catalogue.jsx test/app.test.jsx
git commit -m "feat: session progress syncs through Drive"
```

---

### Task 5: Prove the round trip end to end

A test per layer can all pass while the whole path does not. This task adds one test that walks it.

**Files:**
- Test: `test/app.test.jsx`

- [ ] **Step 1: Write the test**

```jsx
  it("phone to laptop: marks made in one browser appear in another", async () => {
    // "The phone": mark a block, let the save land, and capture exactly what went to Drive.
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    vi.useFakeTimers();
    let sentToDrive;
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      sentToDrive = drive.saveSessions.mock.calls.at(-1)[0].data;
    } finally {
      vi.useRealTimers();
    }

    // "The laptop": a different browser is an empty localStorage, and Drive now returns
    // what the phone wrote. Tear the app down completely to be sure nothing in memory
    // carries the answer across.
    act(() => root.unmount());
    localStorage.clear();
    location.hash = "";
    drive.loadSessions.mockResolvedValue({ fileId: "sess", data: sentToDrive, modifiedTime: "S2" });
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    const blocks = container.querySelectorAll(".run-block");
    expect(blocks[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(blocks[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });
```

The `afterEach` in this file already unmounts `root`; make sure unmounting inside the test does not make that throw (assign a fresh root via `mount`, which it does).

- [ ] **Step 2: Run it**

Run: `npx vitest run test/app.test.jsx`
Expected: PASS. If it fails while Tasks 1-4's own tests pass, the defect is in the wiring between layers — which is exactly what this test exists to catch.

- [ ] **Step 3: Commit**

```bash
git add test/app.test.jsx
git commit -m "test: progress survives the trip from one browser to another"
```

---

## Deliberately not in this plan

- **Offline queueing across an app restart.** If the phone has no signal and the tab is then closed, the Drive write is lost (localStorage still has it, so that device is fine). Fixing that properly means a service worker, which this app does not have.
- **Merging two devices marking at once.** Last-writer-wins per session-day, as designed above. One coach with two devices does not need more.
- **Syncing checklist ticks.** They are within-drill setup state, cleared daily on purpose, and the owner did not ask.
