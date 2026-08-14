# Squads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a squad of players, and let a session say which squad it is for — the foundation attendance is taken against.

**Architecture:** A squad is a name and a list of players; a player is a name and an id fixed at creation. All squads live in one `squads.json`, authoritative, conflict-checked, with an unreadable file never mistaken for an empty one. Squads get a third header section. A session gains `squadId`, linked from its existing free-text `squad` name where they match.

**Tech Stack:** React 18, Vitest 2, no new dependencies.

---

## Why it works this way

**One file, not one per squad.** Sessions went per-file because they arrive at two a week and every Done tap rewrote all of them. Neither pressure applies to squads: there will be a handful, each a page of names, edited a few times a season. What does carry over is the lesson that cost us most — `parseSquads` returns `{ok:false, reason}` rather than an empty object, so a truncated file is never silently treated as "no squads" and overwritten.

**A player's id is fixed at creation and never derived again.** Attendance records point at ids. If the id were derived from the name, then fixing a spelling — or a player changing their surname — would orphan every record that names them. The name is editable; the id is not.

**Leaving is not deletion.** Removing a player marks them `left`, so they drop out of future attendance while last month's session can still say who was actually there. A squad list that quietly rewrites history is worse than one with a few greyed-out names.

**Linking is matched once, never guessed twice.** Existing sessions carry a free-text squad name. On load, a session with no `squadId` whose text matches a squad's name (case- and space-insensitively) gets linked. A session that already has a `squadId` is left alone, and an unmatched name is left as text rather than guessed at.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/squads.js` (create) | The model: parse, ids, add/rename/remove/restore, current players, linking. Pure. |
| `src/lib/drive.js` (modify) | `loadSquads(folder)`, `saveSquads({folder, fileId, data, baseModifiedTime})`. |
| `src/lib/route.js` (modify) | `#/squads` and `#/squad/<id>`. |
| `src/components/SquadList.jsx` (create) | Every squad, plus "New squad". |
| `src/components/SquadEditor.jsx` (create) | One squad: rename it, add/rename/remove/restore players. |
| `src/components/Header.jsx` (modify) | A third section. |
| `src/components/Catalogue.jsx` (modify) | Render the squad views. |
| `src/components/SessionBuilder.jsx` (modify) | Choose the session's squad. |
| `src/App.jsx` (modify) | Load/save squads, squad routes, linking on load. |
| `src/styles.css` (modify) | Squad list and player row rules. |
| Tests | `test/squads.test.js`, `test/squadList.test.jsx`, `test/squadEditor.test.jsx` (create); `test/route.test.js`, `test/drive.test.js`, `test/header.test.jsx`, `test/sessionBuilder.test.jsx`, `test/app.test.jsx` (modify). |

---

### Task 1: `src/lib/squads.js`

Pure. **This module was prototyped and every assertion below verified against a working implementation** — if a test fails, suspect the implementation.

**Files:**
- Create: `src/lib/squads.js`
- Test: `test/squads.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// The squad model: who is in a squad, and which squad a session is for. Pure — no Drive,
// no React.
import { describe, it, expect } from "vitest";
import {
  EMPTY_SQUADS, parseSquads, playerId, emptySquad, addPlayer, renamePlayer,
  removePlayer, restorePlayer, currentPlayers, playerName, linkSquadId,
} from "../src/lib/squads.js";

describe("parseSquads", () => {
  it("reads a well-formed file", () => {
    expect(parseSquads('{"version":1,"squads":{}}')).toEqual({ ok: true, squads: {} });
  });

  it("says WHY it could not be read, rather than answering 'empty'", () => {
    // Mistaking unreadable for empty is how a corrupt sessions.json nearly lost every
    // plan: the migration saw nothing to move and renamed the file away.
    for (const bad of [null, "", "{", "[]", '{"version":9,"squads":{}}', '{"version":1}', '{"version":1,"squads":[]}']) {
      expect(parseSquads(bad).ok).toBe(false);
    }
    expect(parseSquads("{").reason).toBe("parse");
    expect(parseSquads('{"version":9,"squads":{}}').reason).toBe("version");
  });
});

describe("playerId", () => {
  it("is a slug of the name, made unique within the squad", () => {
    expect(playerId("Sean Ryan")).toBe("sean-ryan");
    expect(playerId("Sean Ryan", ["sean-ryan"])).toBe("sean-ryan-2");
    expect(playerId("Sean Ryan", ["sean-ryan", "sean-ryan-2"])).toBe("sean-ryan-3");
  });

  it("always produces something, even from nothing", () => {
    expect(playerId("")).toBe("untitled");
  });
});

describe("a squad's players", () => {
  const squad = () => {
    let s = emptySquad("u14a", "U14A Boys");
    s = addPlayer(s, "Sean Ryan");
    s = addPlayer(s, "  Ali Khan  ");
    s = addPlayer(s, "Sean Ryan"); // two players really can share a name
    return s;
  };

  it("adds players in order, trimming the name and keeping ids unique", () => {
    const s = squad();
    expect(s.players.map((p) => p.id)).toEqual(["sean-ryan", "ali-khan", "sean-ryan-2"]);
    expect(s.players.map((p) => p.name)).toEqual(["Sean Ryan", "Ali Khan", "Sean Ryan"]);
  });

  it("adds nobody for a blank name", () => {
    expect(addPlayer(squad(), "   ").players).toHaveLength(3);
  });

  it("renames a player WITHOUT changing their id", () => {
    // The id is what attendance points at. If it followed the name, fixing a spelling
    // would orphan every record of that player ever turning up.
    const renamed = renamePlayer(squad(), "sean-ryan", "Seán Ryan");
    expect(renamed.players[0]).toEqual({ id: "sean-ryan", name: "Seán Ryan" });
  });

  it("ignores a blank rename", () => {
    expect(renamePlayer(squad(), "sean-ryan", "  ").players[0].name).toBe("Sean Ryan");
  });

  it("removing a player keeps the record, so past sessions still name them", () => {
    const gone = removePlayer(squad(), "ali-khan");
    expect(gone.players).toHaveLength(3);
    expect(currentPlayers(gone).map((p) => p.id)).toEqual(["sean-ryan", "sean-ryan-2"]);
    expect(playerName(gone, "ali-khan")).toBe("Ali Khan");
  });

  it("restores a player to their original place in the list", () => {
    const back = restorePlayer(removePlayer(squad(), "ali-khan"), "ali-khan");
    expect(currentPlayers(back).map((p) => p.id)).toEqual(["sean-ryan", "ali-khan", "sean-ryan-2"]);
  });

  it("survives being asked about nobody, or about no squad at all", () => {
    expect(playerName(squad(), "nobody")).toBe(null);
    expect(currentPlayers(undefined)).toEqual([]);
    expect(playerName(undefined, "x")).toBe(null);
  });
});

describe("linkSquadId", () => {
  const squads = { u14a: { id: "u14a", name: "U14A Boys" }, u12: { id: "u12", name: "U12s" } };

  it("links a session's free-text squad name to the squad of that name", () => {
    expect(linkSquadId({ squad: "U14A Boys" }, squads).squadId).toBe("u14a");
    expect(linkSquadId({ squad: "  u14a boys  " }, squads).squadId).toBe("u14a");
  });

  it("leaves an unmatched name alone rather than guessing", () => {
    expect(linkSquadId({ squad: "Nobody" }, squads).squadId).toBeUndefined();
    expect(linkSquadId({ squad: "" }, squads).squadId).toBeUndefined();
  });

  it("never second-guesses a link that already exists", () => {
    const already = { squad: "U12s", squadId: "u14a" };
    expect(linkSquadId(already, squads)).toBe(already);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/squads.test.js`

- [ ] **Step 3: Implement**

```js
// src/lib/squads.js
// A squad is a name and a list of players; a player is a name and an id. Pure — no Drive,
// no React.
//
// A player's ID IS FIXED AT CREATION and never derived again. Attendance records point at
// ids, so deriving the id from the name would mean that fixing a spelling, or a player
// changing their surname, orphaned every record of them ever turning up. The name is
// editable; the id is not.
import { slugify } from "./drills.js";

const VERSION = 1;
export const EMPTY_SQUADS = Object.freeze({ version: VERSION, squads: {} });

// -> {ok:true, squads} | {ok:false, reason}. Deliberately NOT "unreadable reads as empty":
// that mistake is how a corrupt sessions.json nearly lost every plan, because the caller
// could not tell "nothing here" from "I could not read it" and overwrote the file.
export function parseSquads(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "shape" };
    if (parsed.version !== VERSION) return { ok: false, reason: "version" };
    if (!parsed.squads || typeof parsed.squads !== "object" || Array.isArray(parsed.squads)) {
      return { ok: false, reason: "squads" };
    }
    return { ok: true, squads: parsed.squads };
  } catch {
    return { ok: false, reason: "parse" };
  }
}

export function playerId(name, taken = []) {
  const base = slugify(name);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export const emptySquad = (id, name) => ({ id, name, players: [] });

export function addPlayer(squad, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return squad;
  const id = playerId(clean, (squad.players ?? []).map((p) => p.id));
  return { ...squad, players: [...(squad.players ?? []), { id, name: clean }] };
}

export function renamePlayer(squad, id, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return squad;
  return {
    ...squad,
    players: (squad.players ?? []).map((p) => (p.id === id ? { ...p, name: clean } : p)),
  };
}

// Leaving is not deletion. Last month's session must still be able to say who was there,
// and that needs the name to survive — so the player stays in the list, marked.
export const removePlayer = (squad, id) => ({
  ...squad,
  players: (squad.players ?? []).map((p) => (p.id === id ? { ...p, left: true } : p)),
});

export const restorePlayer = (squad, id) => ({
  ...squad,
  players: (squad.players ?? []).map((p) => (p.id === id ? { ...p, left: false } : p)),
});

export const currentPlayers = (squad) => (squad?.players ?? []).filter((p) => !p.left);

export const playerName = (squad, id) =>
  (squad?.players ?? []).find((p) => p.id === id)?.name ?? null;

// A session names its squad by id. Sessions written before squads existed carry only free
// text, so match it to a squad NAME once and leave anything unmatched alone — a wrong
// guess would attach the wrong roster to a night's attendance.
export function linkSquadId(session, squads) {
  if (session?.squadId) return session;
  const text = String(session?.squad ?? "").trim().toLowerCase();
  if (!text) return session;
  const hit = Object.values(squads ?? {})
    .find((s) => String(s?.name ?? "").trim().toLowerCase() === text);
  return hit ? { ...session, squadId: hit.id } : session;
}
```

- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: the squad model"`

---

### Task 2: squads in Drive

**Files:**
- Modify: `src/lib/drive.js`
- Test: `test/drive.test.js`

Contract:

```
loadSquads(folder) -> { squads, fileId, modifiedTime, failed }
      squads:  { [id]: squad }    empty when there is no file yet
      failed:  null, or { reason } when a file exists but could not be read
saveSquads({ folder, fileId, data, baseModifiedTime })
      -> { ok: true, fileId, modifiedTime }
       | { ok: false, conflict: true, modifiedTime }
       | { ok: false, error }
```

**Read `src/lib/drive.js` first.** `known` is the sole authority on `modifiedTime`; `withRetry` handles reauth; `test/drive.test.js` resets module state via `forgetDriveState()` in `beforeEach` — extend that if you add module state. `saveSessions` (the old whole-blob save, still in git history) is the closest precedent for a single authoritative file; `saveSession` is the current per-file one.

**A file that exists but cannot be read must NOT come back as `{}`** — return `failed` and let the caller refuse to overwrite it. This is the defect that nearly cost every session plan.

- [ ] **Step 1: Write the failing tests** covering: no file yet (empty, no write); a good file; an unreadable file (reports `failed`, squads empty, and a later `saveSquads` is the caller's decision — assert `loadSquads` itself writes nothing); create on first save; conflict on a stale baseline with no write; a failed save returning the error; a 401 propagating to `withRetry`.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: load and save squads"`

---

### Task 3: routes

**Files:**
- Modify: `src/lib/route.js`
- Test: `test/route.test.js`

`#/squads` → `{view:"squads", slug:null}`; `#/squad/<id>` → `{view:"squad", slug:id}`; `#/squad/` with no id falls back to `#/squads`, mirroring how `#/session/` falls back. Round-trip through `formatHash`, including an id needing percent-encoding.

- [ ] **Step 1: Write the failing tests** (follow the file's existing round-trip tests)
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement** — note `parseHash` deliberately does not `.filter(Boolean)`; keep that.
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: routes for squads"`

---

### Task 4: the squad views

**Files:**
- Create: `src/components/SquadList.jsx`, `src/components/SquadEditor.jsx`
- Modify: `src/styles.css`
- Test: `test/squadList.test.jsx`, `test/squadEditor.test.jsx`

Both presentational — handed data, reporting changes upward, no Drive.

`SquadList({ squads, onOpen, onCreate })`: a row per squad with its name and how many current players; "New squad".

`SquadEditor({ squad, onChange, onBack, onDelete })`:
- the squad's name, editable
- a row per current player: the name, editable, and a Remove control
- an "Add player" input that adds on submit and stays focused, because you add twenty names in a row
- departed players in a collapsed `<details>` ("Left the squad"), each with Restore — visible, since they still appear in past attendance, but out of the way
- every change reported through `onChange(nextSquad)`; the component holds no copy of the squad

Model the tests on `test/sessionBuilder.test.jsx` (the closest existing presentational-editor tests). Cover at least: adding a player; adding an empty name adds nobody; renaming a player does not change the row count; removing moves them into the departed section without losing them; restoring brings them back; the count in the list excludes departed players.

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Style** — reuse `.card`, `.chip-button`, `.row`. Player rows need to be thumb-sized: this is used standing up.
- [ ] **Step 5: Run the tests**
- [ ] **Step 6: Commit** — `git commit -m "feat: manage a squad and its players"`

---

### Task 5: wire it up

**Files:**
- Modify: `src/components/Header.jsx`, `src/components/Catalogue.jsx`, `src/components/SessionBuilder.jsx`, `src/App.jsx`
- Test: `test/header.test.jsx`, `test/sessionBuilder.test.jsx`, `test/app.test.jsx`

- [ ] **Step 1: Header — a third section.**

**There is a bug waiting here.** `Header` currently marks Drills active with `mode !== "sessions"`, so with a third mode Drills would light up while you are on Squads. Change it to `mode === "drills"` and add a test that no two sections are ever active at once.

- [ ] **Step 2: App — load, save, route, link.**
  - Load squads after sessions, in the same `try` that owns the sessions load (a squads failure must not blank the app — check how the sessions load was separated and follow it).
  - Debounced save on change, per the sessions pattern, with conflict handling. Squads are one file, so one baseline — the pre-split `saveSessions` shape, not the per-session one.
  - **Never overwrite a `squads.json` that could not be read.** If `loadSquads` reports `failed`, hold saves and tell the owner, the way an unreadable session file is reported.
  - Routes `#/squads` and `#/squad/<id>`; `onModeChange("squads")`. Follow what `onModeChange` does for the other two — it closes the editor, the builder and the run view through their flushing paths, and getting that wrong loses edits.
  - On load, apply `linkSquadId` to every session. **Linking is a change to a session, so it must be saved** — but a load that immediately dirties every session and saves them all is wrong. Decide: link in memory only and let the next real edit persist it, or persist deliberately. Say which you chose and why. (In-memory is the safer default.)
  - New squad: prompt for a name, id from `slugify`, dedupe against existing ids.

- [ ] **Step 3: SessionBuilder — choose the squad.** A `<select>` of squads beside the existing fields, reported through `onChange`. Setting it must update `squadId` and keep `squad` in step with the chosen squad's name so existing displays keep working. Include a "no squad" option.

- [ ] **Step 4: Run the whole suite and the build**
- [ ] **Step 5: Commit** — `git commit -m "feat: squads have a home, and a session has a squad"`

---

### Task 6: Look at it

- [ ] Render, at 390px: the squad list, a squad with a dozen players and two departed, and the session builder with the squad picker. View them, fix what they expose, commit any fix.

---

## Deliberately not in this plan

- **Attendance.** Its own plan, next; this one only has to make a squad exist and a session point at one.
- **Shirt numbers and positions.** Name only, as asked. Adding a field later needs no migration.
- **Importing a squad from a file or a paste.** Twenty names typed once a season is not the bottleneck.
- **Per-squad Drive files.** One small, rarely-written file has none of the problems that forced sessions apart.
