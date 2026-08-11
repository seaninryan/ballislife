# ballislife Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit a drill's markdown beside a live preview, autosaving to Drive, with conflicts handled without ever losing your typing — plus creating and deleting drills, and linking straight to one.

**Architecture:** The edit/save lifecycle is a **pure state machine in `src/lib/editor.js`**, unit-tested with no React and no timers. Components dispatch actions and render; `App` owns the debounce and the Drive calls. That is what keeps the hardest logic in this project testable.

**Tech Stack:** React 18, Vite 5, Vitest 2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-ballislife-design.md`
**Previous plans:** foundation, drive-layer, browse — all complete and deployed at v0.2.0

---

## Environment

```bash
node -v   # must be v20; if v14: export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

**`grep` is broken in this sandbox** — it exits 1 with no output even for strings that are present. Never use it to verify anything; use the Grep tool or node.

Work from `/home/sean/workspace/ballislife`. **First create a branch: `git checkout -b editor`.** Do not commit to `main`.

---

## What already exists

`npm test` is **253 passing across 20 files**.

| Module | Exports you will use |
| --- | --- |
| `lib/drive.js` | `loadCatalogue()`, `readDrill(id, folder)`, `saveDrill({id, text, baseModifiedTime})`, `knownModifiedTime(id)`, `noteModifiedTime`, `FOLDER_NAME` |
| `lib/driveApi.js` | `createFile`, `trashFile`, `renameFile`, `listFiles`, `readFile`, `writeFile` |
| `lib/drills.js` | `filterDrills`, `slugify`, `fileNameFor(title, taken)` |
| `lib/prose.js` | `renderProse(markdown)` |
| `components/DrillPreview.jsx` | `<DrillPreview source />` |
| `components/Grid.jsx`, `DrillCard.jsx`, `Filters.jsx`, `DrillView.jsx`, `Catalogue.jsx` | the browse UI |
| `src/App.jsx` | auth, owner gate, catalogue load, selection, `requestSeq` stale-fetch guard |

**The save contract, established by the Drive layer and non-negotiable:** pass only
`baseModifiedTime` (what you loaded) to `saveDrill`, and adopt the `modifiedTime` from
every successful result — **including a `coalesced` one**. `drive.js` is the authority on
what Drive last reported. Passing a stale baseline produces a spurious conflict against
the user's own previous keystroke.

---

## Two deliberate exclusions

**Renaming is not in this plan.** The filename slug is a drill's stable id. Editing
`title` in frontmatter deliberately does **not** rename the file — otherwise every
keystroke in the title would rename a Drive file. Renaming stays a Drive-web-UI action
until there is a reason to build it, and `renameFile` already exists for when there is.

**Drive integration is still unproven.** Every Drive test mocks the network, and the
manual checklist from the drive-layer plan has not been reported. This plan writes to
Drive for the first time, so an unproven sign-in matters more here than it did for
browsing. Task 9's manual checklist is the gate.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/editor.js` | The edit/save state machine. Pure: no React, no timers, no Drive |
| `src/lib/route.js` | The URL hash ⇄ `{view, slug}`. Pure |
| `src/lib/drive.js` | Modified: `createDrill`, `deleteDrill` |
| `src/components/Editor.jsx` | Source textarea, live preview, save status, conflict banner |
| `src/components/Workspace.jsx` | The three-pane layout and its mobile collapse |
| `src/components/Catalogue.jsx` | Modified: route to browse, read or edit |
| `src/App.jsx` | Modified: editor state, the debounce, create/delete, hash routing |

---

## Task 1: The editor state machine

**Files:**
- Create: `src/lib/editor.js`
- Test: `test/editor.test.js`

Every rule about dirtiness, saving and conflict lives here, pure and testable. **This
code is verified** — I prototyped it and ran all 15 assertions before writing this task.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import {
  openEditor, reduce, isDirty, shouldSave,
  CLEAN, DIRTY, SAVING, SAVED, CONFLICT, FAILED,
} from "../src/lib/editor.js";

describe("openEditor", () => {
  it("starts clean and not needing a save", () => {
    const s = openEditor("a", "hello", "T1");
    expect(s.status).toBe(CLEAN);
    expect(isDirty(s)).toBe(false);
    expect(shouldSave(s)).toBe(false);
  });
});

describe("editing", () => {
  it("becomes dirty and wants saving", () => {
    const s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hello world" });
    expect(s.status).toBe(DIRTY);
    expect(isDirty(s)).toBe(true);
    expect(shouldSave(s)).toBe(true);
  });

  it("ignores an edit that changes nothing", () => {
    const a = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "x" });
    expect(reduce(a, { type: "edit", text: "x" })).toBe(a);
  });

  it("is not dirty after typing back to the saved text", () => {
    let s = reduce(openEditor("a", "z", "T1"), { type: "edit", text: "zz" });
    s = reduce(s, { type: "edit", text: "z" });
    expect(isDirty(s)).toBe(false);
  });
});

describe("saving", () => {
  it("does not try to save while a save is in flight", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    expect(s.status).toBe(SAVING);
    expect(shouldSave(s)).toBe(false);
  });

  it("stays dirty when the user types while a save is in flight", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "edit", text: "hi!" });
    expect(s.status).toBe(DIRTY);
  });

  it("stays dirty when the text that landed is not the current text", () => {
    // The whole reason saveSucceeded carries savedText: marking clean here would
    // silently drop whatever the user typed while the write was in flight.
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "edit", text: "hi!" });
    s = reduce(s, { type: "saveSucceeded", savedText: "hi", modifiedTime: "T2" });
    expect(s.status).toBe(DIRTY);
    expect(s.baseText).toBe("hi");
    expect(s.baseModifiedTime).toBe("T2");
    expect(shouldSave(s)).toBe(true);
  });

  it("becomes saved when the current text lands", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "saveSucceeded", savedText: "hi", modifiedTime: "T2" });
    expect(s.status).toBe(SAVED);
    expect(isDirty(s)).toBe(false);
    expect(shouldSave(s)).toBe(false);
  });

  it("keeps the previous baseline when a coalesced save reports no time", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "saveSucceeded", savedText: "hi", modifiedTime: null });
    expect(s.baseModifiedTime).toBe("T1");
  });

  it("records a failure without losing the text", () => {
    let s = reduce(openEditor("a", "x", "T1"), { type: "edit", text: "y" });
    s = reduce(s, { type: "saveFailed", error: new Error("drive 500") });
    expect(s.status).toBe(FAILED);
    expect(s.text).toBe("y");
    expect(s.error.message).toBe("drive 500");
  });
});

describe("conflict", () => {
  const conflicted = () => {
    let s = reduce(openEditor("b", "mine", "T1"), { type: "edit", text: "my precious edit" });
    s = reduce(s, { type: "saveStarted" });
    return reduce(s, { type: "saveConflicted", modifiedTime: "T9" });
  };

  it("never discards the user's text", () => {
    const s = conflicted();
    expect(s.status).toBe(CONFLICT);
    expect(s.text).toBe("my precious edit");
  });

  it("is not cleared by typing, because Drive is still ahead", () => {
    const s = reduce(conflicted(), { type: "edit", text: "more" });
    expect(s.status).toBe(CONFLICT);
    expect(s.text).toBe("more");
  });

  it("keepMine adopts Drive's baseline but keeps the user's text", () => {
    const s = reduce(conflicted(), { type: "keepMine", modifiedTime: "T9" });
    expect(s.status).toBe(DIRTY);
    expect(s.text).toBe("my precious edit");
    expect(s.baseModifiedTime).toBe("T9");
  });

  it("reloaded takes Drive's version, deliberately discarding the user's", () => {
    const s = reduce(conflicted(), { type: "reloaded", text: "theirs", modifiedTime: "T9" });
    expect(s.status).toBe(CLEAN);
    expect(s.text).toBe("theirs");
    expect(s.baseModifiedTime).toBe("T9");
  });
});

describe("robustness", () => {
  it("returns the same object for an unknown action", () => {
    const s = openEditor("a", "x", "T1");
    expect(reduce(s, { type: "nonsense" })).toBe(s);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/editor.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/editor.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/editor.js
// The edit/save lifecycle as a pure state machine: no React, no timers, no Drive.
// Every rule about when we are dirty, when a save may start, and what a conflict means
// lives here, which is what makes the hardest logic in this project testable.
export const CLEAN = "clean";
export const DIRTY = "dirty";
export const SAVING = "saving";
export const SAVED = "saved";
export const CONFLICT = "conflict";
export const FAILED = "failed";

export function openEditor(id, text, modifiedTime) {
  return { id, text, baseText: text, baseModifiedTime: modifiedTime, status: CLEAN, error: null };
}

export const isDirty = (s) => s.text !== s.baseText;

export function reduce(state, action) {
  switch (action.type) {
    case "open":
      return openEditor(action.id, action.text, action.modifiedTime);

    case "edit": {
      if (action.text === state.text) return state;
      // A conflict is not cleared by typing: Drive is still ahead of us, so the next
      // save would conflict again. Only keepMine or reloaded resolve it.
      const status = state.status === CONFLICT ? CONFLICT : DIRTY;
      return { ...state, text: action.text, status };
    }

    case "saveStarted":
      return { ...state, status: SAVING, error: null };

    case "saveSucceeded": {
      // savedText is the text that actually landed, not necessarily the current text:
      // the user may have typed on while the write was in flight. Marking clean here
      // would silently strand those keystrokes.
      const base = action.savedText;
      return {
        ...state,
        baseText: base,
        baseModifiedTime: action.modifiedTime ?? state.baseModifiedTime,
        status: state.text !== base ? DIRTY : SAVED,
        error: null,
      };
    }

    case "saveConflicted":
      // Never touch `text`. The user's work is the one thing that must survive.
      return {
        ...state,
        status: CONFLICT,
        baseModifiedTime: action.modifiedTime ?? state.baseModifiedTime,
      };

    case "saveFailed":
      return { ...state, status: FAILED, error: action.error };

    case "reloaded":
      // The user chose Drive's version over their own.
      return openEditor(state.id, action.text, action.modifiedTime);

    case "keepMine":
      // The user chose to overwrite Drive. Adopt Drive's modifiedTime so the next save
      // passes the conflict check, but keep their text as the pending edit.
      return { ...state, status: DIRTY, baseModifiedTime: action.modifiedTime };

    default:
      return state;
  }
}

// May a save start right now?
export const shouldSave = (s) => s.status === DIRTY && isDirty(s);
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run test/editor.test.js
```

Expected: `Tests  15 passed (15)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor.js test/editor.test.js
git commit -m "feat: the editor save lifecycle as a pure state machine"
```

---

## Task 2: Hash routing

**Files:**
- Create: `src/lib/route.js`
- Test: `test/route.test.js`

So a drill has a URL you can bookmark, and so a future session plan can link to one.
Hash routing rather than a router library: no dependency, and it works on GitHub Pages
without server rewrites.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { parseHash, formatHash } from "../src/lib/route.js";

describe("parseHash", () => {
  it("reads the browse view by default", () => {
    for (const h of ["", "#", "#/", undefined, null, "#/nonsense"]) {
      expect(parseHash(h)).toEqual({ view: "browse", slug: null });
    }
  });

  it("reads a drill to read", () => {
    expect(parseHash("#/drill/rondo-4v2")).toEqual({ view: "read", slug: "rondo-4v2" });
  });

  it("reads a drill to edit", () => {
    expect(parseHash("#/drill/rondo-4v2/edit")).toEqual({ view: "edit", slug: "rondo-4v2" });
  });

  it("decodes a percent-encoded slug", () => {
    expect(parseHash("#/drill/a%20b")).toEqual({ view: "read", slug: "a b" });
  });

  it("survives a malformed escape rather than throwing", () => {
    expect(() => parseHash("#/drill/%E0%A4%A")).not.toThrow();
    expect(parseHash("#/drill/%E0%A4%A").view).toBe("read");
  });

  it("ignores a trailing slash", () => {
    expect(parseHash("#/drill/x/")).toEqual({ view: "read", slug: "x" });
  });
});

describe("formatHash", () => {
  it("formats each view", () => {
    expect(formatHash({ view: "browse" })).toBe("#/");
    expect(formatHash({ view: "read", slug: "rondo-4v2" })).toBe("#/drill/rondo-4v2");
    expect(formatHash({ view: "edit", slug: "rondo-4v2" })).toBe("#/drill/rondo-4v2/edit");
  });

  it("encodes a slug that needs it", () => {
    expect(formatHash({ view: "read", slug: "a b" })).toBe("#/drill/a%20b");
  });

  it("falls back to browse without a slug", () => {
    expect(formatHash({ view: "read", slug: null })).toBe("#/");
  });

  it("round-trips every view", () => {
    for (const route of [
      { view: "browse", slug: null },
      { view: "read", slug: "rondo-4v2" },
      { view: "edit", slug: "a b" },
    ]) {
      expect(parseHash(formatHash(route))).toEqual(route);
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/route.test.js
```

- [ ] **Step 3: Write the implementation**

```js
// src/lib/route.js
// The URL hash <-> { view, slug }. Hash routing rather than a router dependency: it
// needs no server rewrites, which matters on GitHub Pages.
const BROWSE = { view: "browse", slug: null };

// Never throws: a malformed percent escape in a hand-edited URL must not blank the app.
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function parseHash(hash) {
  const parts = String(hash ?? "").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] !== "drill" || !parts[1]) return { ...BROWSE };
  return { view: parts[2] === "edit" ? "edit" : "read", slug: decode(parts[1]) };
}

export function formatHash({ view, slug }) {
  if (!slug || view === "browse") return "#/";
  const base = `#/drill/${encodeURIComponent(slug)}`;
  return view === "edit" ? `${base}/edit` : base;
}
```

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run test/route.test.js    # expect 10 passed
git add src/lib/route.js test/route.test.js
git commit -m "feat: hash routing so a drill has a url"
```

---

## Task 3: Create and delete drills

**Files:**
- Modify: `src/lib/drive.js`, `test/drive.test.js`

Both operations end by reloading the catalogue rather than surgically patching
`index.json`. These are rare actions, and a reload is one `files.list` plus at most one
write — simpler than incremental edits and self-healing if anything drifted.

- [ ] **Step 1: Write the failing tests**

Append to `test/drive.test.js`, extending the import with `createDrill` and `deleteDrill`:

```js
describe("createDrill", () => {
  it("writes a starter drill and returns its id", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "NEW", modifiedTime: "T1" });
    api.writeFile.mockResolvedValue("T1");

    const r = await createDrill("F1", "Rondo 4v2", ["other.md"]);
    expect(r.id).toBe("NEW");
    const [, , name, text] = api.createFile.mock.calls[0];
    expect(name).toBe("rondo-4v2.md");
    expect(text).toContain("title: Rondo 4v2");
    expect(text).toContain("```pitch");
    expect(knownModifiedTime("NEW")).toBe("T1");
  });

  it("avoids colliding with a name already in the folder", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "NEW", modifiedTime: "T1" });
    api.writeFile.mockResolvedValue("T1");
    await createDrill("F1", "Rondo 4v2", ["rondo-4v2.md"]);
    expect(api.createFile.mock.calls[0][2]).toBe("rondo-4v2-2.md");
  });

  it("starts from a template that parses cleanly", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "NEW", modifiedTime: "T1" });
    api.writeFile.mockResolvedValue("T1");
    await createDrill("F1", "Test", []);
    const text = api.createFile.mock.calls[0][3];
    const { parseDoc } = await import("../src/lib/frontmatter.js");
    const { parse } = await import("../src/lib/pitch.js");
    const { splitSegments } = await import("../src/lib/markdown.js");
    const doc = parseDoc(text);
    expect(doc.error).toBe(null);
    const block = splitSegments(doc.body).find((s) => s.kind === "pitch");
    expect(parse(block.text).errors).toEqual([]);
  });
});

describe("deleteDrill", () => {
  it("trashes rather than destroying, so a mistake is recoverable", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    api.trashFile.mockResolvedValue(undefined);
    await deleteDrill("a");
    expect(api.trashFile).toHaveBeenCalledWith("tok", "a");
  });

  it("retries once on a 401", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    api.trashFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue(undefined);
    await expect(deleteDrill("a")).resolves.toBeUndefined();
    expect(api.trashFile).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/drive.test.js
```

- [ ] **Step 3: Write the implementation**

Append to `src/lib/drive.js`:

```js
// A new drill starts from a template that parses cleanly, so the preview is a real
// diagram from the first keystroke rather than an error banner.
export const TEMPLATE = (title) => `---
title: ${title}
category: skill
minutes: 15
players: 8-12
tags: []
---

What the players do.

\`\`\`pitch
area: 30x20 plain
cone: 0,0 30,0 0,20 30,20
red: A@6,10 B@24,10
pass: A->B
label: "${title}"
\`\`\`
`;

// -> { id, modifiedTime }. `taken` is the filenames already in the folder, so the slug
// does not collide.
export async function createDrill(folder, title, taken = []) {
  return withRetry(async () => {
    const token = getAccessToken();
    const name = fileNameFor(title, taken);
    const created = await api.createFile(token, folder, name, TEMPLATE(title));
    known.set(created.id, created.modifiedTime);
    return created;
  });
}

// Trash rather than delete: a mis-tap should be recoverable from Drive's bin.
export async function deleteDrill(id) {
  await withRetry(async () => api.trashFile(getAccessToken(), id));
  known.delete(id);
}
```

Add `fileNameFor` to the `./drills.js` import at the top of the file.

- [ ] **Step 4: Run the tests, then commit**

```bash
npm test
git add src/lib/drive.js test/drive.test.js
git commit -m "feat: create a drill from a template, and trash one"
```

---

## Task 4: The editor component

**Files:**
- Create: `src/components/Editor.jsx`
- Test: `test/editor.component.test.jsx`

Presentational: it renders the state machine's state and calls back. No Drive, no timers.

- [ ] **Step 1: Write the failing tests**

```jsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Editor from "../src/components/Editor.jsx";
import { openEditor, reduce, CONFLICT, FAILED } from "../src/lib/editor.js";

const base = openEditor("a", "---\ntitle: T\n---\n\nBody.\n", "T1");
const render = (state, props) => renderToStaticMarkup(<Editor state={state} {...props} />);

describe("Editor", () => {
  it("shows the markdown source in a textarea", () => {
    expect(render(base)).toContain("Body.");
    expect(render(base)).toContain("<textarea");
  });

  it("renders the live preview beside it", () => {
    const withPitch = openEditor("a", "---\ntitle: T\n---\n\n```pitch\narea: 20x20\nred: A@5,5\n```\n", "T1");
    expect(render(withPitch)).toContain("<svg");
  });

  it("says saved when clean", () => {
    expect(render(base)).toMatch(/saved/i);
  });

  it("says unsaved while dirty", () => {
    expect(render(reduce(base, { type: "edit", text: "changed" }))).toMatch(/unsaved|saving/i);
  });

  it("offers both ways out of a conflict, and says the edit is safe", () => {
    let s = reduce(base, { type: "edit", text: "mine" });
    s = reduce(s, { type: "saveConflicted", modifiedTime: "T9" });
    const html = render(s);
    expect(html).toMatch(/changed in drive|changed on drive/i);
    expect(html).toMatch(/keep mine/i);
    expect(html).toMatch(/reload/i);
    // The user's text must still be on screen — that is the whole point.
    expect(html).toContain("mine");
  });

  it("shows a save failure without implying the edit is lost", () => {
    const s = reduce(reduce(base, { type: "edit", text: "x" }), {
      type: "saveFailed", error: Object.assign(new Error("drive 500"), { code: 500 }),
    });
    const html = render(s);
    expect(html).toMatch(/could not save|having trouble/i);
    expect(html).toContain("x");
  });

  it("offers delete and back controls", () => {
    const html = render(base);
    expect(html).toMatch(/delete/i);
    expect(html).toMatch(/back/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure, then write the component**

```jsx
// src/components/Editor.jsx
// Renders the editor state machine's state. Presentational: no Drive, no timers, no
// rules about when to save — App owns those.
import React from "react";
import DrillPreview from "./DrillPreview.jsx";
import { CLEAN, DIRTY, SAVING, SAVED, CONFLICT, FAILED } from "../lib/editor.js";
import { friendlyError } from "./Catalogue.jsx";

function Status({ state }) {
  if (state.status === CONFLICT) return <span className="chip warn-chip">conflict</span>;
  if (state.status === FAILED) return <span className="chip err-chip">not saved</span>;
  if (state.status === SAVING) return <span className="chip dim">saving…</span>;
  if (state.status === DIRTY) return <span className="chip dim">unsaved</span>;
  return <span className="chip dim">saved</span>;
}

export default function Editor({ state, onEdit, onBack, onDelete, onKeepMine, onReload }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={onBack}>← Back</button>
        <Status state={state} />
        <span style={{ marginLeft: "auto" }} />
        <button type="button" onClick={onDelete}>Delete</button>
      </div>

      {state.status === CONFLICT ? (
        <div className="banner warn">
          This drill changed in Drive since you opened it. Your edit is safe and still
          below — choose which version to keep.
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="primary" onClick={onKeepMine}>Keep mine</button>
            <button type="button" onClick={onReload}>Reload Drive’s version</button>
          </div>
        </div>
      ) : null}

      {state.status === FAILED ? (
        <div className="banner err">
          Could not save: {friendlyError(state.error)} Your edit is still here and will be
          retried when you type again.
        </div>
      ) : null}

      <div className="split">
        <textarea
          className="mono editor-source"
          value={state.text}
          onChange={(e) => onEdit?.(e.target.value)}
          spellCheck={false}
        />
        <div className="editor-preview">
          <DrillPreview source={state.text} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the styles**

```css
.editor-source { width: 100%; min-height: 60vh; resize: vertical; }
.editor-preview { min-width: 0; }
.warn-chip { background: #fdf2d0; color: #6e5400; border-color: #e7d9a4; }
.err-chip { background: #fbdcd7; color: #8c1d18; border-color: #f0c2ba; }
@media (max-width: 780px) {
  /* On a phone the source pane is the thing you scroll past to reach the diagram, so
     shrink it rather than stacking two full-height panes. */
  .editor-source { min-height: 30vh; }
}
```

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run test/editor.component.test.jsx    # expect 7 passed
git add -A
git commit -m "feat: the drill editor with conflict and failure states"
```

---

## Task 5: Wire the editor into the app

**Files:**
- Modify: `src/components/Catalogue.jsx`, `test/catalogue.test.jsx`, `src/App.jsx`

- [ ] **Step 1: Route to the editor in `Catalogue`**

`Catalogue` gains an `editor` prop (the state machine's state, or null) and its
callbacks. When `editor` is present it renders `<Editor>`; otherwise it behaves as now.
Add a test that it does so, and one that the grid gains a "New drill" control.

- [ ] **Step 2: Own the editor state and the debounce in `App.jsx`**

```jsx
  const [editor, setEditor] = useState(null);
  const editorRef = useRef(null);
  const saveTimer = useRef(null);

  // Keep a ref alongside the state so the debounce callback reads the latest text
  // without being re-created on every keystroke.
  const setEditorState = useCallback((next) => {
    editorRef.current = next;
    setEditor(next);
  }, []);

  const dispatch = useCallback((action) => {
    setEditorState(reduce(editorRef.current, action));
  }, [setEditorState]);

  const flushSave = useCallback(async () => {
    const state = editorRef.current;
    if (!state || !shouldSave(state)) return;
    const text = state.text;
    dispatch({ type: "saveStarted" });
    const result = await saveDrill({
      id: state.id,
      text,
      baseModifiedTime: state.baseModifiedTime,
    });
    if (!editorRef.current || editorRef.current.id !== state.id) return; // moved on
    if (result.ok) {
      // Adopt the modifiedTime from every success, coalesced included — that is the
      // Drive layer's contract, and skipping it makes the next save conflict with
      // the user's own keystroke.
      dispatch({ type: "saveSucceeded", savedText: text, modifiedTime: result.modifiedTime });
    } else if (result.conflict) {
      dispatch({ type: "saveConflicted", modifiedTime: result.modifiedTime });
    } else {
      dispatch({ type: "saveFailed", error: result.error });
    }
  }, [dispatch]);

  const onEdit = useCallback((text) => {
    dispatch({ type: "edit", text });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 900);
  }, [dispatch, flushSave]);
```

Add an effect that clears `saveTimer` on unmount, and **flush a pending save when the
editor is closed or the drill changes** — otherwise the last 900ms of typing is lost by
navigating away.

Wire `onKeepMine` to dispatch `keepMine` with `knownModifiedTime(state.id)` then
`flushSave`; wire `onReload` to `readDrill` then dispatch `reloaded`.

- [ ] **Step 3: Create and delete**

"New drill" prompts for a title, calls `createDrill(folderRef.current, title, names)`
where `names` are the current drills' filenames, reloads the catalogue, then opens the
new drill in the editor. Delete confirms first, calls `deleteDrill(id)`, reloads, and
returns to the grid.

- [ ] **Step 4: Hash routing**

On mount and on `hashchange`, `parseHash(location.hash)` selects the view. Opening a
drill sets `location.hash = formatHash(...)` rather than only setting state, so Back
works and a URL can be shared. A slug that matches no drill falls back to browse.

- [ ] **Step 5: Run everything, then commit**

```bash
npm test && npm run build
git add -A
git commit -m "feat: edit drills with autosave, conflict handling and urls"
```

---

## Task 6: Test the wiring for real

**Files:**
- Modify: `test/app.test.jsx`

`App` is where the debounce, the save contract and the flush-on-close live, and none of
that is reachable by SSR rendering. Extend the existing jsdom test file.

- [ ] **Step 1: Add these tests**

Use `vi.useFakeTimers()` where a debounce needs to elapse. Cover:

1. Typing in the editor eventually calls `saveDrill` **once**, not per keystroke.
2. `saveDrill` is called with `baseModifiedTime` from the loaded drill, and **no**
   `currentModifiedTime` — the contract takes one value.
3. A successful save adopts `result.modifiedTime`, so a **second** save sends the new
   baseline rather than the stale one. This is the regression test for the bug the Drive
   layer review found.
4. A `coalesced` result (`{ok: true, coalesced: true, modifiedTime}`) is treated as
   success and its `modifiedTime` adopted.
5. A `{ok: false, conflict: true}` result shows the conflict banner **and the user's
   text is still in the textarea**.
6. Closing the editor with unsaved text flushes the save rather than dropping it.
7. Deleting asks for confirmation and does not call `deleteDrill` if declined.

- [ ] **Step 2: Run, then commit**

```bash
npm test
git add -A
git commit -m "test: cover the autosave contract and conflict flow in App"
```

---

## Task 7: Look at it

**Files:** none — verification.

- [ ] **Step 1: Render and screenshot** the editor at 1100px and 390px: clean, dirty,
  conflict and failed states, and a drill with a malformed `pitch` block.

- [ ] **Step 2: Judge it as a coach.** Is the save status noticeable without being noisy?
  Does the conflict banner make it obvious the edit is safe? At 390px, is the source pane
  usable, or does the preview push it off screen? Does a long line wrap or scroll?

- [ ] **Step 3: Report concrete defects** with what you would change, then delete any
  throwaway files and confirm `git status --short` is clean.

---

## Task 8: Manual verification — Sean's, and nothing above proves it

This plan **writes to Drive** for the first time. Every test mocks the network.

- [ ] At the deployed site, open a drill, change a word, wait a second. The status goes
  `unsaved` → `saving…` → `saved`.
- [ ] Reload the page. The change is still there.
- [ ] Check the file in Drive. It contains the change, and the frontmatter is intact.
- [ ] Type quickly for several seconds, then check Drive's revision history — there
  should be a handful of revisions, not one per keystroke.
- [ ] **The conflict path.** Open a drill in ballislife. In Drive, edit the same file and
  save. Back in ballislife, change a word. You should get the conflict banner with your
  edit still visible. Try **Keep mine** — Drive should end up with your version. Repeat
  and try **Reload** — you should get Drive's version.
- [ ] Create a drill. It appears in the grid, and the file exists in Drive with a
  sensible name.
- [ ] Delete it. It leaves the grid and is in Drive's bin, **not destroyed**.
- [ ] Copy the URL of a drill, open it in a new tab. It goes straight to that drill.
- [ ] On your phone: open a drill, edit it, confirm the source pane is usable.

Report which steps passed. Any failure here is real regardless of a green suite.

---

## Done when

- `npm test` passes, `npm run build` is clean
- Editing autosaves, a conflict never loses your text, and both resolutions work
- Create and delete work, delete is recoverable from Drive's bin
- A drill has a URL that survives a reload and a new tab
- Sean has run Task 8 and reported

## Deliberately not built

- **Renaming a drill.** The filename is the stable id; editing `title` does not rename
  the file. Rename in Drive if needed — `renameFile` exists for when this is worth doing.
- **Session planning.** The original spec's second half: slot-based plans (warmup → skill
  → tactical → match → fun) stored as JSON, with a drill picker filtered by category and
  squad size. That is the next project, and it now has a real catalogue to build on.
