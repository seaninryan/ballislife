# One File Per Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each session plan becomes its own file in `/BallIsLife/sessions/`, so a night's marks rewrite one small file rather than every plan ever made, a conflict on one plan cannot block saving another, and one corrupt file cannot lose the lot.

**Architecture:** `sessions/<id>.json` is authoritative, one per session. `sessions/index.json` is a disposable cache holding every session, validated on load against a real listing's `modifiedTime`s and repaired — exactly the invariant the drill index already follows. The existing `sessions.json` blob is migrated on first load and renamed aside as a visible backup.

**Tech Stack:** React 18, Vitest 2, no new dependencies.

---

## Why it works this way

**Per-file, because the blob's costs all grow.** At two sessions a week, a year is ~100 plans in one file. Every Done tap rewrites all of it; a conflict on any plan blocks saving every plan; and the file is a single point of loss. Per-file fixes all three, and makes a plan something the owner can open and read in Drive on its own.

**An index cache, because otherwise every app open costs ~100 requests.** Reading each session file on load is simple and gets slower every week. The drill catalogue already solved this: an `index.json` that is **disposable and never authoritative**, diffed on every load against a `files.list` of ids and `modifiedTime`s, with any drift repaired. The same shape applies here, and the owner has already endorsed it for drills. The index holds whole session objects — which sounds like the blob again, but the difference is the one that matters: losing or corrupting it costs nothing, because it is rebuilt from the per-session files.

**Migration renames rather than deletes.** After every session has been written to its own file, `sessions.json` becomes `sessions-before-split.json`. It is then no longer found by name, so the migration is not repeated; it stays visible in Drive as a backup the owner can see and delete himself. Migration only writes a session that has no file yet, so a migration interrupted halfway is safely resumed rather than overwriting newer per-file edits.

**In-memory shape does not change.** `sessionsState.data.sessions` stays a map of id → session, so `SessionList`, `SessionBuilder`, `SessionRun` and the route resolver are untouched. What changes is where it is loaded from and that saving is per-session.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/driveApi.js` (modify) | `createFolder` gains a parent; new `findChildFolder`. Nothing else. |
| `src/lib/sessionsIndex.js` (create) | Pure: read/validate the index, diff it against a listing, apply the result. Mirrors `driveIndex.js`. |
| `src/lib/sessions.js` (modify) | `sessionFileName(id)` and `sessionIdFromFileName(name)` — the id↔filename rule, which is session-shape knowledge. |
| `src/lib/drive.js` (modify) | `loadSessions` (folder + index + per-file reads + migration), `saveSession` (one file, own baseline), `deleteSession`. |
| `src/App.jsx` (modify) | Per-session dirty tracking, baselines and saves. |
| `src/components/Catalogue.jsx` | Unchanged. |
| `test/driveApi.test.js` (modify) | The two new/changed calls. |
| `test/sessionsIndex.test.js` (create) | The diff and repair rules. |
| `test/sessions.test.js` (modify) | The filename rule, including its round trip. |
| `test/drive.test.js` (modify) | Load, save, delete, migration. |
| `test/app.test.jsx` (modify) | Per-session saves; two sessions do not interfere. |

---

### Task 1: `driveApi` can work inside a subfolder

**Files:**
- Modify: `src/lib/driveApi.js:42-50` (`createFolder`), plus a new `findChildFolder`
- Test: `test/driveApi.test.js`

`createFolder(token, name)` creates at the root and `findFolder(token, name)` searches by name anywhere. Both need a parent-aware form for `sessions` to live inside `BallIsLife`. Read the existing functions and the file's test harness (a mocked `fetch`) before changing anything.

- [ ] **Step 1: Write the failing tests**

Follow the existing tests in `test/driveApi.test.js` for how `fetch` is mocked and how a query string is asserted. Add:

```js
  it("findChildFolder searches for a folder by name inside one parent", async () => {
    // The `sessions` folder must be found INSIDE BallIsLife: a folder of that name
    // elsewhere in the owner's Drive is not ours.
    fetchMock.mockResolvedValue(jsonResponse({ files: [{ id: "S", name: "sessions" }] }));
    const found = await findChildFolder("tok", "PARENT", "sessions");
    expect(found).toEqual({ id: "S", name: "sessions" });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("'PARENT'+in+parents");
    expect(url).toContain("mimeType='application/vnd.google-apps.folder'");
  });

  it("findChildFolder returns null when the parent has no such folder", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ files: [] }));
    expect(await findChildFolder("tok", "PARENT", "sessions")).toBe(null);
  });

  it("createFolder creates inside a parent when given one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "NEW" }));
    await createFolder("tok", "sessions", "PARENT");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parents).toEqual(["PARENT"]);
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
  });

  it("createFolder still creates at the root when given no parent", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "NEW" }));
    await createFolder("tok", "BallIsLife");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parents).toBeUndefined();
  });
```

Match the helper names the file really uses (`fetchMock`, `jsonResponse` are guesses — read the file).

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement** — mirror the escaping and error handling of the existing `findFolder`/`createFolder` exactly; a folder name is interpolated into a query, so quote-escape it the same way the existing code does.
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: driveApi can find and create a folder inside a parent"`

---

### Task 2: `sessions.js` owns the id↔filename rule

**Files:**
- Modify: `src/lib/sessions.js`
- Test: `test/sessions.test.js`

A session's id is a date like `2026-08-13`, but `onCreateSession` in `App.jsx` appends a suffix on collision, so ids like `2026-08-13-2` exist. The filename must round-trip and must not let an id escape the folder.

- [ ] **Step 1: Write the failing tests**

```js
describe("session file names", () => {
  it("round-trips an id through its file name", () => {
    for (const id of ["2026-08-13", "2026-08-13-2", "u14a-friendly"]) {
      expect(sessionIdFromFileName(sessionFileName(id))).toBe(id);
    }
  });

  it("is not a session file if it does not end in .json", () => {
    expect(sessionIdFromFileName("index.json")).toBe(null);   // the cache, not a session
    expect(sessionIdFromFileName("notes.txt")).toBe(null);
    expect(sessionIdFromFileName("")).toBe(null);
  });

  it("refuses an id that could escape the folder or collide with the cache", () => {
    // Ids come from a date and a collision suffix today, but this is a file path.
    expect(() => sessionFileName("../evil")).toThrow();
    expect(() => sessionFileName("a/b")).toThrow();
    expect(() => sessionFileName("index")).toThrow();
    expect(() => sessionFileName("")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

```js
// A session's id is its file name, so it has to be safe as one. Ids are generated from a
// date plus a collision suffix today, but this is the only place that assumption is
// enforced rather than assumed — and `index` is reserved because index.json shares the
// folder.
const ID_OK = /^[a-z0-9][a-z0-9-]*$/i;
export const SESSIONS_FOLDER = "sessions";
export const SESSIONS_INDEX_NAME = "index.json";

export function sessionFileName(id) {
  const s = String(id ?? "");
  if (!ID_OK.test(s) || s.toLowerCase() === "index") {
    throw new Error(`unsafe session id: ${JSON.stringify(s)}`);
  }
  return `${s}.json`;
}

// -> the id, or null if this listing entry is not a session file (index.json included).
export function sessionIdFromFileName(name) {
  const s = String(name ?? "");
  if (!s.toLowerCase().endsWith(".json")) return null;
  const id = s.slice(0, -5);
  if (!ID_OK.test(id) || id.toLowerCase() === "index") return null;
  return id;
}
```

Then check `onCreateSession` in `src/App.jsx`: it builds an id from `window.prompt` input via the date. If that can produce an id `ID_OK` rejects (e.g. the owner types `13/08/2026`), creating a session would now throw where before it silently made a bad key. Make `onCreateSession` validate the date and refuse with a message rather than throwing — read what it does today and keep its existing style of refusal.

- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: the id-to-file-name rule for a session"`

---

### Task 3: `sessionsIndex.js` — the disposable cache

**Files:**
- Create: `src/lib/sessionsIndex.js`
- Test: `test/sessionsIndex.test.js`

Pure, and deliberately shaped like `src/lib/driveIndex.js` — read that file first and follow it.

- [ ] **Step 1: Write the failing tests**

```js
// The sessions index is a CACHE. Every load diffs it against a real listing and repairs
// any drift, so it can never serve a stale plan after one is edited in Drive directly —
// the same invariant driveIndex.js documents for drills.
import { describe, it, expect } from "vitest";
import {
  EMPTY_SESSIONS_INDEX, readSessionsIndex, diffSessionsIndex, applySessionsDiff,
  sessionsFromIndex,
} from "../src/lib/sessionsIndex.js";

const entry = (name, modifiedTime, session) => ({ name, modifiedTime, session });
const file = (id, name, modifiedTime) => ({ id, name, modifiedTime });
const sess = (id) => ({ id, date: id, squad: "", theme: "", length: 60, turnout: null, blocks: [] });

describe("readSessionsIndex", () => {
  it("reads a well-formed index", () => {
    const raw = JSON.stringify({ version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } });
    expect(readSessionsIndex(raw).entries.F1.session.id).toBe("a");
  });

  it("rebuilds from scratch rather than throwing on anything unusable", () => {
    for (const raw of [null, "", "{", "[]", '{"version":9,"entries":{}}', '{"version":1}']) {
      expect(readSessionsIndex(raw)).toEqual(EMPTY_SESSIONS_INDEX);
    }
  });
});

describe("diffSessionsIndex", () => {
  it("keeps an entry whose file has not changed", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    const { keep, refetch, dropped } = diffSessionsIndex(index, [file("F1", "a.json", "T1")]);
    expect(Object.keys(keep)).toEqual(["F1"]);
    expect(refetch).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("refetches when modifiedTime moved — the plan was edited elsewhere", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    const { keep, refetch } = diffSessionsIndex(index, [file("F1", "a.json", "T2")]);
    expect(keep).toEqual({});
    expect(refetch.map((f) => f.id)).toEqual(["F1"]);
  });

  it("refetches on a rename too, since Drive does not always bump modifiedTime for one", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    const { refetch } = diffSessionsIndex(index, [file("F1", "b.json", "T1")]);
    expect(refetch.map((f) => f.name)).toEqual(["b.json"]);
  });

  it("refetches a file the index has never seen", () => {
    const { refetch } = diffSessionsIndex(EMPTY_SESSIONS_INDEX, [file("F2", "b.json", "T1")]);
    expect(refetch.map((f) => f.id)).toEqual(["F2"]);
  });

  it("drops an entry whose file is gone", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    expect(diffSessionsIndex(index, []).dropped).toEqual(["F1"]);
  });

  it("ignores index.json and anything that is not a session file", () => {
    const files = [file("I", "index.json", "T"), file("N", "notes.txt", "T"), file("F1", "a.json", "T1")];
    const { refetch } = diffSessionsIndex(EMPTY_SESSIONS_INDEX, files);
    expect(refetch.map((f) => f.name)).toEqual(["a.json"]);
  });

  it("survives a junk listing", () => {
    expect(diffSessionsIndex(EMPTY_SESSIONS_INDEX, null).refetch).toEqual([]);
    expect(diffSessionsIndex(null, [file("F1", "a.json", "T")]).refetch.map((f) => f.id)).toEqual(["F1"]);
  });
});

describe("applySessionsDiff / sessionsFromIndex", () => {
  it("merges kept and freshly read entries", () => {
    const kept = { F1: entry("a.json", "T1", sess("a")) };
    const fetched = { F2: entry("b.json", "T2", sess("b")) };
    const next = applySessionsDiff(kept, fetched);
    expect(Object.keys(next.entries).sort()).toEqual(["F1", "F2"]);
    expect(next.version).toBe(1);
  });

  it("turns an index into the id-keyed map the app renders, plus each file's metadata", () => {
    const index = {
      version: 1,
      entries: { F1: entry("a.json", "T1", sess("a")), F2: entry("b.json", "T2", sess("b")) },
    };
    const { sessions, meta } = sessionsFromIndex(index);
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
    expect(meta.a).toEqual({ fileId: "F1", modifiedTime: "T1" });
  });

  it("skips an entry with nothing that could be a session, rather than making a bad key", () => {
    const index = {
      version: 1,
      entries: {
        F1: entry("a.json", "T1", sess("a")),
        F2: entry("b.json", "T2", null),
        F3: entry("c.json", "T3", "not an object"),
        F4: entry("d.json", "T4", []),
      },
    };
    expect(Object.keys(sessionsFromIndex(index).sessions)).toEqual(["a"]);
  });

  it("keeps a hand-edited plan that lost its stored id, taking the id from the file name", () => {
    // The file name is the authority everywhere else in this function, so it has to be
    // here too: dropping the entry would make a file the owner can see in Drive
    // disappear from the app with nothing to explain it.
    const index = { version: 1, entries: { F3: entry("c.json", "T3", { date: "x" }) } };
    const { sessions, meta } = sessionsFromIndex(index);
    expect(sessions.c).toEqual({ date: "x", id: "c" });
    expect(meta.c).toEqual({ fileId: "F3", modifiedTime: "T3" });
  });

  it("prefers the id in the file NAME when the stored session disagrees with it", () => {
    // The file name is the authority: it is what the id was resolved from on save. A
    // session whose stored id drifted (hand-edited) must not shadow another file.
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("zzz")) } };
    const { sessions } = sessionsFromIndex(index);
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(sessions.a.id).toBe("a");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

Write `src/lib/sessionsIndex.js` following `driveIndex.js`'s structure: `VERSION`, `EMPTY_SESSIONS_INDEX`, `readSessionsIndex`, `diffSessionsIndex`, `applySessionsDiff`, and `sessionsFromIndex`. Use `sessionIdFromFileName` from `sessions.js` to decide what is a session file, so the rule lives in one place. In `sessionsFromIndex`, take the id from the file name and overwrite the stored session's `id` with it, per the last two tests — including when there is no stored id, since the name names it either way. Skip an entry only when its `session` is not an object at all.

Lead the file with the invariant comment, as `driveIndex.js` does.

- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: a disposable index for per-session files"`

---

### Task 4: `drive.js` loads and saves per session, and migrates the blob

**Files:**
- Modify: `src/lib/drive.js:205-243`
- Test: `test/drive.test.js`

New contract:

```
loadSessions(folder)  -> { sessions, meta, migrated }
    sessions: { [id]: session }        the map App already renders
    meta:     { [id]: { fileId, modifiedTime } }
    migrated: number                   how many plans came out of the old blob this load

saveSession({ folder, id, session, baseModifiedTime })
    -> { ok: true, id, fileId, modifiedTime }
     | { ok: false, conflict: true, id, modifiedTime }
     | { ok: false, id, error }

deleteSession({ id, fileId }) -> void   (trash, like deleteDrill)
```

**Read `src/lib/drive.js` in full first.** The module-level `known` Map is the authority on `modifiedTime` (a previous bug came from a caller trying to track it instead), `withRetry` handles reauth, and the drill path already does folder resolution — follow all three rather than inventing parallels. Note `test/drive.test.js` must reset `known` between tests; that too is a bug this project already had.

Behaviour:
1. Resolve (or create) the `sessions` subfolder inside the BallIsLife folder.
2. List it. Read `index.json` if present, `diffSessionsIndex` against the listing, read only what must be refetched, `applySessionsDiff`, and write the index back **only if it actually changed** — an app open that changes nothing should not write to Drive.
3. **A single session file that fails to read must not fail the whole load.** Degrade per file exactly as `loadCatalogue` does for drills: keep the cached entry if there is one, drop that session otherwise, and re-throw a 401 so `withRetry` can still reauthenticate. This is the same defect that once took down the whole catalogue for one flaky drill.
4. Migration, before step 2's result is returned: if a `sessions.json` exists in the **parent** folder, read it with `readSessions`, and for each session it holds that has **no** file in the sessions folder, write one. Then rename `sessions.json` to `sessions-before-split.json`. Count what was written and return it as `migrated`. If the rename fails, do not fail the load — the next load will migrate nothing (every session now has a file) and try the rename again.
5. `saveSession` conflict-checks against `known.get(fileId)` exactly as `saveSessions` does today, but per file.

- [ ] **Step 1: Write the failing tests**

Follow `test/drive.test.js`'s existing harness (it mocks `./driveApi.js` and `./driveAuth.js`). Cover, at minimum:

- a first-ever load: no sessions folder → one is created, no sessions, `migrated: 0`
- a load with an index that matches the listing → `api.readFile` is called for `index.json` only, not for any session file
- a load where one file's `modifiedTime` moved → only that file is re-read
- a load where a session file was deleted in Drive → it is gone from `sessions` and from the index written back
- an unreadable session file → the other sessions still load; with a cached entry it is kept, without one it is absent
- a 401 from a session file read → propagates (so `withRetry` reauths), rather than being swallowed as a per-file failure
- an index that matches exactly → `api.writeFile` is NOT called for the index
- `saveSession` on a new session → `createFile` in the sessions folder with the right name; returns the new `fileId`/`modifiedTime`
- `saveSession` with a stale `baseModifiedTime` → `{ok: false, conflict: true}` and **no write**
- `saveSession` failing → `{ok: false, error}` with the id
- `deleteSession` → `api.trashFile` with that file's id, and `known` no longer holds it
- migration: a `sessions.json` with two plans and an empty sessions folder → two `createFile` calls, `renameFile` to `sessions-before-split.json`, `migrated: 2`
- migration is not repeated: with `sessions-before-split.json` present and no `sessions.json`, nothing is written and `migrated: 0`
- a half-done migration: `sessions.json` holds two plans and one already has a file → only the missing one is written, and the existing file's content is NOT overwritten
- migration where the rename fails → the load still succeeds and returns the migrated sessions

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests** — then `npm test`; `App.jsx` still calls the old contract, so failures there are expected until Task 5.
- [ ] **Step 5: Commit** — `git commit -m "feat: one Drive file per session, with migration from the blob"`

---

### Task 5: `App` saves one session at a time

**Files:**
- Modify: `src/App.jsx`
- Test: `test/app.test.jsx`

`sessionsState` currently carries one `fileId`, one `baseModifiedTime` and one status for the whole blob. `data.sessions` **stays exactly as it is** — every view keeps working — but saving becomes per session.

New shape:

```jsx
  const [sessionsState, setSessionsStateRaw] = useState({
    data: { version: 1, sessions: {} },
    meta: {},        // id -> { fileId, modifiedTime }: the per-file conflict baseline
    dirty: [],       // ids awaiting a save, in the order they were touched
    status: "idle",  // idle | dirty | saving | conflict | failed
    error: null,
    conflictId: null,
  });
```

- `onSessionChange(updated)` merges into `data.sessions`, adds the id to `dirty`, schedules the debounce.
- `flushSessionsSave` saves **each** dirty id via `saveSession`, using that id's `meta.modifiedTime` as the baseline; on success it updates that id's meta and drops it from `dirty`. A conflict or failure on one id must not discard the others' edits or clear their dirty flags.
- `onKeepMineSessions` re-saves the conflicted id with the baseline Drive reported (the same "adopt and retry" the blob version does).
- `onReloadSessions` re-runs `loadSessions` and drops local edits, as today.
- `onDeleteSession` calls `deleteSession` with that id's `fileId`, removes it from `data.sessions`, `meta` and `dirty`.
- If `loadSessions` reports `migrated > 0`, tell the owner once — a one-line notice, not a modal. Follow the existing `duplicateFolders` banner for style.

**Keep the debounce, the flush-on-close and the `sessionsStateRef` pattern.** They exist because of real bugs: a save burst mis-reporting which edit landed, and leaving the builder losing an unsaved edit.

- [ ] **Step 1: Write the failing tests**

Use the existing helpers in `test/app.test.jsx`. Cover:

- loading two sessions from two files lists both
- editing one session saves only that session's file (`saveSession` called once, with that id)
- editing two sessions in one debounce window saves both, each with its own baseline
- a conflict on one session leaves the other's edit intact and still saved
- "Keep mine" after a conflict re-saves with the baseline Drive returned
- deleting a session trashes its file and removes it from the list
- a mark made during a run saves that session's file only
- the migration notice appears when `loadSessions` reports `migrated > 0`, and not when it is 0

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests** — `npm test` must be fully green, and `npm run build` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat: sessions save one file at a time"`

---

### Task 6: Update the documented invariants

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-10-ballislife-design.md`

Both say sessions live in one authoritative `sessions.json`, and `CLAUDE.md`'s invariants section names `index.json` as the only disposable cache. After this change there are two caches and per-session authority. Update both to describe what is now true, including the migration and the `sessions-before-split.json` backup.

- [ ] **Step 1: Make the edits**
- [ ] **Step 2: Commit** — `git commit -m "docs: sessions are per-file now"`

---

## Deliberately not in this plan

- **Per-session folders or a year/month hierarchy.** One flat folder holds a few hundred files without trouble, and a hierarchy would need the listing logic to recurse.
- **Loading a session's plan lazily.** The index makes a full load one request; lazy loading would add states to every view to save nothing.
- **Migrating drills to anything.** They are already per-file.
- **Deleting `sessions-before-split.json` automatically.** The owner should decide when to throw away the only pre-migration copy of every plan he has.
