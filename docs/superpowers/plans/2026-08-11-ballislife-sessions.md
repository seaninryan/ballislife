# ballislife Session Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a training session by filling slots — warmup, skill, tactical, match, fun — from your drill catalogue, with the picker filtered to what fits tonight's turnout, a running total against session length, and everything saved to Drive.

**Architecture:** The session model is a **pure module in `src/lib/sessions.js`** — slots, totals, squad fitting, reordering, broken-reference detection — unit-tested with no React and no Drive. Sessions are stored as one `sessions.json` in the same Drive folder. Components render; `App` owns the Drive calls.

**Tech Stack:** React 18, Vite 5, Vitest 2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-ballislife-design.md` (the "Deferred" section describes exactly this)
**Previous plans:** foundation, drive-layer, browse, editor — all complete, deployed at v0.3.1

---

## Environment

```bash
node -v   # must be v20; if v14: export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

**`grep` is broken in this sandbox** — it exits 1 with no output even for strings that are present. Never use it to verify anything; use the Grep tool or node.

Work from `/home/sean/workspace/ballislife`. **First create a branch: `git checkout -b sessions`.** Do not commit to `main`.

---

## What already exists

`npm test` is **309 passing across 24 files**.

| Module | Exports you will use |
| --- | --- |
| `lib/drive.js` | `loadCatalogue()`, `readDrill`, `saveDrill`, `createDrill`, `deleteDrill`, `knownModifiedTime`, `noteModifiedTime`, `FOLDER_NAME` |
| `lib/driveApi.js` | `listFiles`, `readFile`, `writeFile`, `createFile` |
| `lib/drills.js` | drills as `{id, slug, title, category, minutes, players, tags, thumb, invalid}` |
| `lib/route.js` | `parseHash`, `formatHash` |
| `lib/errors.js` | `friendlyError(error)` |
| `components/*` | `Grid`, `DrillCard`, `Filters`, `DrillView`, `Editor`, `PitchHelp`, `Catalogue` |

---

## Three decisions this plan makes, and why

**1. Reordering is by buttons, not drag-and-drop.** The spec's mockup showed dragging.
Buttons (`↑`/`↓`) are keyboard-reachable, work on a touch screen without a gesture
library, and are testable — drag is none of those. The model's `moveBlock` is
drag-ready, so a drag surface can be added later over the same function.

**2. `sessions.json` is authoritative, unlike `index.json`.** That is the important
difference. `index.json` is a disposable cache that is revalidated against Drive on every
load; `sessions.json` is the **only copy** of your session plans. A lost write loses real
work. So it is read with its `modifiedTime`, saved with conflict detection, and never
rebuilt from anything.

**3. Sessions reference drills by slug, not by copying them.** Correcting a drill
retroactively fixes every session that used it — the same "nothing derived is stored"
rule the rest of the project follows. The cost is that a deleted drill leaves a dangling
reference, so a broken reference is **shown in the plan**, never silently dropped.

---

## Data shapes

`sessions.json`, in `/BallIsLife`:

```js
{
  version: 1,
  sessions: {
    "2026-08-12-pressing": {
      id: "2026-08-12-pressing",
      date: "2026-08-12",
      squad: "U12s",
      theme: "pressing",
      length: 75,                       // minutes available
      blocks: [
        { slot: "warmup",   drill: "rondo-4v2", minutes: null, note: "" },
        { slot: "skill",    drill: "3v2",       minutes: 20,   note: "reds keep the ball" },
        { slot: "tactical", drill: null,        minutes: null, note: "" },
        { slot: "match",    drill: null,        minutes: null, note: "" },
        { slot: "fun",      drill: null,        minutes: null, note: "" },
      ],
    },
  },
}
```

`drill` is a **slug**, not a Drive id: slugs survive a re-index, and they are what a human
reads. `minutes: null` means "inherit the drill's own duration"; a number overrides it.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/sessions.js` | The session model: slots, totals, squad fitting, reorder, broken refs. Pure |
| `src/lib/drive.js` | Modified: `loadSessions()`, `saveSessions(data, baseModifiedTime)` |
| `src/components/SessionList.jsx` | Every session, newest first, plus "New session" |
| `src/components/SessionBuilder.jsx` | One session: slots, picker, totals, warnings |
| `src/components/Catalogue.jsx` | Modified: a Drills / Sessions switch |
| `src/App.jsx` | Modified: session state, Drive calls, routing |

---

## Task 1: The session model

**Files:**
- Create: `src/lib/sessions.js`
- Test: `test/sessions.test.js`

**This code is verified** — I prototyped it and ran all 23 assertions before writing this
task, including the broken-reference and squad-range cases.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import {
  SLOTS, EMPTY, emptySession, readSessions, blockMinutes, resolveBlocks,
  totalMinutes, emptySlots, squadRange, fitsSquad, setBlock, moveBlock,
} from "../src/lib/sessions.js";

const drills = [
  { slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8" },
  { slug: "3v2", title: "3v2 to end line", category: "skill", minutes: 15, players: "8-12" },
  { slug: "ssg", title: "SSG 6v6", category: "match", minutes: 25, players: "12+" },
  { slug: "nomins", title: "No minutes", category: "fun", minutes: null, players: null },
];

describe("emptySession", () => {
  it("starts with one empty block per slot, in template order", () => {
    const s = emptySession("s1", "2026-08-12", "U12s");
    expect(s.blocks.map((b) => b.slot)).toEqual(SLOTS);
    expect(totalMinutes(s, drills)).toBe(0);
    expect(emptySlots(s)).toEqual(SLOTS);
  });
});

describe("minutes", () => {
  it("inherits the drill's duration until overridden", () => {
    let s = emptySession("s1", "2026-08-12");
    s = setBlock(s, 0, { drill: "rondo-4v2" });
    s = setBlock(s, 1, { drill: "3v2" });
    expect(totalMinutes(s, drills)).toBe(25);
    s = setBlock(s, 1, { minutes: 20 });
    expect(totalMinutes(s, drills)).toBe(30);
  });

  it("counts a drill with no duration as zero rather than NaN", () => {
    expect(blockMinutes({ minutes: null }, { minutes: null })).toBe(0);
    let s = setBlock(emptySession("s", "d"), 4, { drill: "nomins" });
    expect(totalMinutes(s, drills)).toBe(0);
  });

  it("reports which slots are still empty", () => {
    let s = setBlock(emptySession("s", "d"), 0, { drill: "rondo-4v2" });
    expect(emptySlots(s)).toEqual(["skill", "tactical", "match", "fun"]);
  });
});

describe("broken references", () => {
  it("shows a deleted drill rather than silently dropping the block", () => {
    const s = setBlock(emptySession("s", "d"), 2, { drill: "deleted-drill" });
    const blocks = resolveBlocks(s, drills);
    expect(blocks).toHaveLength(5);
    expect(blocks[2].missing).toBe(true);
    expect(blocks[2].drillRef).toBe("deleted-drill");
    expect(blocks[2].drill).toBe(null);
  });

  it("counts a broken reference as zero minutes", () => {
    const s = setBlock(emptySession("s", "d"), 2, { drill: "deleted-drill" });
    expect(totalMinutes(s, drills)).toBe(0);
  });

  it("does not mark an empty slot as missing", () => {
    expect(resolveBlocks(emptySession("s", "d"), drills).every((b) => !b.missing)).toBe(true);
  });
});

describe("squadRange", () => {
  it("reads a range, an open end, and a single number", () => {
    expect(squadRange("8-12")).toEqual({ min: 8, max: 12 });
    expect(squadRange("12+").max).toBe(Infinity);
    expect(squadRange("11")).toEqual({ min: 11, max: 11 });
  });

  it("returns null for anything it cannot read", () => {
    for (const v of ["loads", "", null, undefined, "8 to 12"]) expect(squadRange(v)).toBe(null);
  });
});

describe("fitsSquad", () => {
  it("accepts a turnout inside the range", () => {
    expect(fitsSquad(drills[1], 9)).toBe(true);
  });

  it("rejects too few and too many", () => {
    expect(fitsSquad(drills[1], 6)).toBe(false);
    expect(fitsSquad(drills[0], 20)).toBe(false);
  });

  it("handles an open-ended minimum", () => {
    expect(fitsSquad(drills[2], 14)).toBe(true);
    expect(fitsSquad(drills[2], 9)).toBe(false);
  });

  it("never excludes a drill when either side is unknown", () => {
    // A missing players field or an unknown turnout must not hide a drill.
    expect(fitsSquad(drills[3], 3)).toBe(true);
    expect(fitsSquad(drills[1], NaN)).toBe(true);
    expect(fitsSquad(drills[1], undefined)).toBe(true);
  });
});

describe("moveBlock", () => {
  it("reorders the plan", () => {
    const s = moveBlock(emptySession("s", "d"), 0, 2);
    expect(s.blocks.map((b) => b.slot)).toEqual(["skill", "tactical", "warmup", "match", "fun"]);
  });

  it("is a no-op for an index out of range", () => {
    const s = emptySession("s", "d");
    expect(moveBlock(s, 0, 9)).toBe(s);
    expect(moveBlock(s, -1, 0)).toBe(s);
  });

  it("keeps the total unchanged", () => {
    let s = setBlock(setBlock(emptySession("s", "d"), 0, { drill: "rondo-4v2" }), 1, { drill: "3v2" });
    expect(totalMinutes(moveBlock(s, 0, 2), drills)).toBe(totalMinutes(s, drills));
  });
});

describe("readSessions", () => {
  it("reads a well-formed file", () => {
    const data = { version: 1, sessions: { a: { id: "a" } } };
    expect(readSessions(JSON.stringify(data))).toEqual(data);
  });

  it("falls back to empty for anything unusable", () => {
    for (const bad of ["", "x", "null", "[]", '{"version":9}', undefined, "{}"]) {
      expect(readSessions(bad)).toEqual({ version: 1, sessions: {} });
    }
  });

  it("returns a fresh object, never the shared EMPTY", () => {
    const a = readSessions("nope");
    a.sessions.x = 1;
    expect(readSessions("nope").sessions).toEqual({});
    expect(EMPTY.sessions).toEqual({});
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/sessions.test.js
```

- [ ] **Step 3: Write the implementation**

```js
// src/lib/sessions.js
// The session model: slots, durations, squad fitting, reordering and broken references.
// Pure — no React, no Drive.
//
// A block references a drill by SLUG rather than copying it, so correcting a drill
// retroactively fixes every session that used it. The cost is a dangling reference when a
// drill is deleted, which is why `resolveBlocks` reports `missing` instead of dropping
// the block: a plan that silently loses a slot is worse than one that says "this drill is
// gone".
export const SLOTS = ["warmup", "skill", "tactical", "match", "fun"];
const VERSION = 1;
export const EMPTY = Object.freeze({ version: VERSION, sessions: {} });

export function emptySession(id, date, squad = "") {
  return {
    id,
    date,
    squad,
    theme: "",
    length: 75,
    blocks: SLOTS.map((slot) => ({ slot, drill: null, minutes: null, note: "" })),
  };
}

// Unlike index.json this file is authoritative — it is the only copy of the plans — so it
// is never rebuilt from anything. This only guards against a corrupt read.
export function readSessions(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    if (parsed.version !== VERSION) throw new Error("version");
    if (!parsed.sessions || typeof parsed.sessions !== "object") throw new Error("sessions");
    return parsed;
  } catch {
    return { version: VERSION, sessions: {} };
  }
}

// A block's own minutes win; otherwise inherit the drill's, so a session picks up a
// drill's duration until you deliberately override it for one night.
export function blockMinutes(block, drill) {
  if (Number.isFinite(block?.minutes)) return block.minutes;
  const m = Number(drill?.minutes);
  return Number.isFinite(m) ? m : 0;
}

export function resolveBlocks(session, drills) {
  const bySlug = new Map((drills ?? []).map((d) => [d.slug, d]));
  return (session?.blocks ?? []).map((block) => {
    const drill = block.drill ? bySlug.get(block.drill) ?? null : null;
    return {
      ...block,
      drillRef: block.drill,
      drill,
      missing: Boolean(block.drill) && drill === null,
      minutes: blockMinutes(block, drill),
    };
  });
}

export const totalMinutes = (session, drills) =>
  resolveBlocks(session, drills).reduce((sum, b) => sum + b.minutes, 0);

export const emptySlots = (session) =>
  (session?.blocks ?? []).filter((b) => !b.drill).map((b) => b.slot);

// "8-12" -> {min,max}; "12+" -> open ended; "11" -> exact; anything else -> null.
export function squadRange(players) {
  const s = String(players ?? "").trim();
  let m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = s.match(/^(\d+)\+$/);
  if (m) return { min: Number(m[1]), max: Infinity };
  m = s.match(/^(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

// Unknown on either side means "fits". Hiding a drill because its players field is blank
// would quietly shrink the picker for no good reason.
export function fitsSquad(drill, turnout) {
  if (!Number.isFinite(turnout)) return true;
  const range = squadRange(drill?.players);
  if (!range) return true;
  return turnout >= range.min && turnout <= range.max;
}

export function setBlock(session, index, patch) {
  return {
    ...session,
    blocks: session.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
  };
}

export function moveBlock(session, from, to) {
  const blocks = [...session.blocks];
  if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return session;
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...session, blocks };
}
```

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run test/sessions.test.js    # expect 19 passed
git add src/lib/sessions.js test/sessions.test.js
git commit -m "feat: the session model with slots, totals and squad fitting"
```

---

## Task 2: Load and save sessions

**Files:**
- Modify: `src/lib/drive.js`, `test/drive.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/drive.test.js`, extending the import with `loadSessions`, `saveSessions`
and `SESSIONS_NAME`:

```js
describe("sessions storage", () => {
  it("reads sessions.json and remembers its modifiedTime", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([{ id: "sess", name: SESSIONS_NAME, modifiedTime: "T5" }]);
    api.readFile.mockResolvedValue(JSON.stringify({ version: 1, sessions: { a: { id: "a" } } }));
    const r = await loadSessions("F1");
    expect(r.data.sessions.a.id).toBe("a");
    expect(r.modifiedTime).toBe("T5");
    expect(r.fileId).toBe("sess");
  });

  it("reports an empty set when the file does not exist yet", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    const r = await loadSessions("F1");
    expect(r.data).toEqual({ version: 1, sessions: {} });
    expect(r.fileId).toBe(null);
    expect(api.readFile).not.toHaveBeenCalled();
  });

  it("falls back to empty rather than throwing on a corrupt file", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([{ id: "sess", name: SESSIONS_NAME, modifiedTime: "T5" }]);
    api.readFile.mockResolvedValue("{{{ not json");
    expect((await loadSessions("F1")).data).toEqual({ version: 1, sessions: {} });
  });

  it("creates the file on first save", async () => {
    api.createFile.mockResolvedValue({ id: "sess", modifiedTime: "T1" });
    const r = await saveSessions({ folder: "F1", fileId: null, data: { version: 1, sessions: {} }, baseModifiedTime: null });
    expect(r).toMatchObject({ ok: true, fileId: "sess", modifiedTime: "T1" });
    expect(api.createFile.mock.calls[0][2]).toBe(SESSIONS_NAME);
  });

  it("writes an existing file and returns the new modifiedTime", async () => {
    api.writeFile.mockResolvedValue("T6");
    const r = await saveSessions({ folder: "F1", fileId: "sess", data: { version: 1, sessions: {} }, baseModifiedTime: "T5" });
    expect(r).toMatchObject({ ok: true, modifiedTime: "T6" });
    expect(api.writeFile).toHaveBeenCalledWith("tok", "sess", expect.any(String));
  });

  it("refuses to overwrite when the file moved underneath it", async () => {
    // sessions.json is the only copy of the plans, so a blind overwrite would destroy
    // work done on another device.
    noteModifiedTime("sess", "T9");
    const r = await saveSessions({ folder: "F1", fileId: "sess", data: { version: 1, sessions: {} }, baseModifiedTime: "T5" });
    expect(r).toMatchObject({ ok: false, conflict: true, modifiedTime: "T9" });
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("retries once on a 401", async () => {
    api.writeFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue("T7");
    noteModifiedTime("sess", "T5");
    const r = await saveSessions({ folder: "F1", fileId: "sess", data: { version: 1, sessions: {} }, baseModifiedTime: "T5" });
    expect(r.ok).toBe(true);
    expect(api.writeFile).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Write the implementation**

Append to `src/lib/drive.js`:

```js
export const SESSIONS_NAME = "sessions.json";

// -> { fileId, data, modifiedTime }. Unlike the drill index this file is AUTHORITATIVE:
// it is the only copy of the session plans, so it is never rebuilt from anything and a
// save is conflict-checked before it overwrites.
export async function loadSessions(folder) {
  return withRetry(async () => {
    const token = getAccessToken();
    const files = await api.listFiles(token, folder);
    const file = files.find((f) => f.name === SESSIONS_NAME) ?? null;
    if (!file) return { fileId: null, data: readSessions(null), modifiedTime: null };
    const text = await api.readFile(token, file.id);
    known.set(file.id, file.modifiedTime);
    return { fileId: file.id, data: readSessions(text), modifiedTime: file.modifiedTime };
  });
}

// -> { ok: true, fileId, modifiedTime } | { ok: false, conflict: true, modifiedTime }
//    | { ok: false, error }
export async function saveSessions({ folder, fileId, data, baseModifiedTime }) {
  const current = fileId ? known.get(fileId) : undefined;
  if (current !== undefined && baseModifiedTime !== current) {
    return { ok: false, conflict: true, modifiedTime: current };
  }
  try {
    const body = JSON.stringify(data, null, 2);
    return await withRetry(async () => {
      const token = getAccessToken();
      if (!fileId) {
        const created = await api.createFile(token, folder, SESSIONS_NAME, body);
        known.set(created.id, created.modifiedTime);
        return { ok: true, fileId: created.id, modifiedTime: created.modifiedTime };
      }
      const modifiedTime = await api.writeFile(token, fileId, body);
      known.set(fileId, modifiedTime);
      return { ok: true, fileId, modifiedTime };
    });
  } catch (error) {
    return { ok: false, error };
  }
}
```

Add `readSessions` to the imports from `./sessions.js`.

- [ ] **Step 3: Run the tests, then commit**

```bash
npm test
git add -A
git commit -m "feat: load and save sessions.json with conflict detection"
```

---

## Task 3: The session list

**Files:**
- Create: `src/components/SessionList.jsx`
- Test: `test/sessionList.test.jsx`

Presentational. Sessions newest first by date, each showing its date, squad, theme, the
total against its length, and how many slots are still empty. Plus a "New session"
control.

- [ ] Tests to write (SSR, no jsdom needed — no prose):
  - renders one row per session, newest date first
  - shows the total and the session length (`53′ of 75′`)
  - flags a session with empty slots
  - flags a session containing a broken drill reference
  - offers "New session"
  - explains an empty list rather than rendering nothing

- [ ] Implement, style, run, commit as `feat: the session list`.

---

## Task 4: The session builder

**Files:**
- Create: `src/components/SessionBuilder.jsx`
- Test: `test/sessionBuilder.test.jsx`

The heart of it. One session: its date, squad, theme and length; then a row per block
showing the slot, the chosen drill (or a picker), its minutes, and `↑`/`↓` to reorder;
then the running total and warnings.

The picker for a block offers drills whose `category` matches the block's `slot`, filtered
by `fitsSquad` against tonight's turnout. It must also offer a way to pick a drill from
**another** category — the slots are a guide, not a cage — so include a "show all drills"
toggle.

- [ ] Tests to write (`// @vitest-environment jsdom`, since a chosen drill renders a preview):
  - renders a row per block, in order, labelled with its slot
  - shows the chosen drill's title, and a picker where the slot is empty
  - the picker offers drills matching the slot's category
  - with a turnout set, a drill that does not fit is not offered
  - the "show all" toggle offers drills from other categories
  - shows the running total against the session length
  - warns when the total exceeds the length
  - warns which slots are still empty
  - shows a broken reference as broken, with the missing slug, and offers to clear it
  - `↑` is absent on the first block and `↓` on the last

- [ ] Implement, style, run, commit as `feat: the session builder`.

---

## Task 5: Wire it up

**Files:**
- Modify: `src/components/Catalogue.jsx`, `test/catalogue.test.jsx`, `src/lib/route.js`, `test/route.test.js`, `src/App.jsx`, `test/app.test.jsx`

- [ ] **Step 1: Extend routing** with `#/sessions` and `#/session/<id>`, keeping the
  existing drill routes. Add round-trip tests for the two new views.

- [ ] **Step 2: A Drills / Sessions switch** in `Catalogue`, defaulting to Drills.

- [ ] **Step 3: `App` loads sessions** after the catalogue, holds the session data, and
  saves on change. Reuse the editor's debounce shape: mutate in state, save after a pause,
  adopt the returned `modifiedTime`. Surface a conflict the same way the editor does — with
  the user's version kept and both resolutions offered.

- [ ] **Step 4: Creating a session** makes an id from the date and theme (`2026-08-12-pressing`),
  guarding against a collision, then opens the builder.

- [ ] **Step 5: Extend `test/app.test.jsx`** to cover: sessions load after drills; editing a
  session saves once after the debounce rather than per change; a conflict keeps the local
  version and shows both options; deleting a session confirms first.

- [ ] Run everything, commit as `feat: plan training sessions from the drill catalogue`.

---

## Task 6: Look at it

**Files:** none — verification.

Rendering has caught defects in this project that no test did — cropped diagrams, giant
arrowheads, a ragged grid, run-on reference text. Do the same here.

- [ ] Render the session list and the builder at 1100px and 390px, with: a full session, a
  half-empty one, one over its time budget, one with a broken reference, and a turnout set
  so the picker is filtered.
- [ ] Judge as a coach: is the running total obvious? Are the warnings noticeable without
  shouting? At 390px, is a block row usable, and do the reorder buttons have real tap
  targets? Does a long drill title break a row?
- [ ] Report concrete defects with what you would change; delete throwaway files.

---

## Task 7: Manual verification — Sean's

This writes a **new authoritative file** to Drive. Every test above mocks the network.

- [ ] Create a session. `sessions.json` appears in the **BallIsLife** folder.
- [ ] Fill a slot from the picker. Reload — the choice is still there.
- [ ] Set a turnout smaller than a drill needs; confirm that drill stops being offered.
- [ ] Override a block's minutes; confirm the total changes and survives a reload.
- [ ] Reorder two blocks; confirm the order survives a reload.
- [ ] Delete a drill that a session uses. Open the session: it should show the reference as
  broken, **not** silently drop the slot.
- [ ] Open the session on your phone and confirm it is readable pitch-side.
- [ ] Edit `sessions.json` in Drive while a session is open in the app, then change
  something in the app — you should get a conflict rather than a silent overwrite.

Report which steps passed. Any failure here is real regardless of a green suite.

---

## Done when

- `npm test` passes and `npm run build` is clean
- A session can be created, filled from the catalogue, reordered and saved
- The picker respects the slot's category and tonight's turnout, and can be overridden
- A broken drill reference is shown, never silently dropped
- A conflict on `sessions.json` never overwrites work done elsewhere
- Sean has run Task 7 and reported

## Still deliberately not built

- **Drag-and-drop reordering.** `moveBlock` is drag-ready; buttons work everywhere and are
  testable.
- **Attendance and squads.** The spec anticipated these living on a session; they need a
  squad list first, which is its own project.
- **A printable session plan.** Worth doing once a real session exists to print.
- **Visual diagram editing**, offline support, a configurable slot template, and renaming —
  all still recorded in the spec with their reasons.
