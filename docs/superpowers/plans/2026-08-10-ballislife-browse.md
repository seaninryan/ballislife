# ballislife Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse the drill catalogue as a card grid with the pitch diagram as each thumbnail, filter by category and tag, search, and open a drill to read it properly rendered — the phone-at-the-side-of-a-pitch use case.

**Architecture:** Client-only React + Vite, no server. Pure logic stays in `src/lib/`; components stay thin. Markdown prose is rendered with `marked` and sanitised with `DOMPurify`, replacing the interim line-breaks-only rendering.

**Tech Stack:** React 18, Vite 5, Vitest 2. New: `marked` and `dompurify` (runtime), `jsdom` (dev only).

**Spec:** `docs/superpowers/specs/2026-08-10-ballislife-design.md`
**Previous plans:** `2026-08-10-ballislife-foundation.md`, `2026-08-10-ballislife-drive-layer.md` (both complete)

---

## Environment

```bash
node -v   # must be v20; if v14: export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

**`grep` is broken in this sandbox** — it exits 1 with no output even for present strings. Never use it to verify anything. Use the Grep tool or node.

Work from `/home/sean/workspace/ballislife`. **First create a branch: `git checkout -b browse`.** Do not commit to `main`.

---

## What already exists

`npm test` is **208 passing across 14 files**.

| Module | Exports you will use |
| --- | --- |
| `lib/drills.js` | `drillsFromIndex`, `filterDrills({category, tag, query})`, `slugify`, `fileNameFor` |
| `lib/drive.js` | `loadCatalogue()` → `{drills, index, failed, folderId}`, `saveDrill`, `noteModifiedTime`, `knownModifiedTime` |
| `lib/driveApi.js` | `readFile(token, id)` and the rest of the REST calls |
| `lib/driveAuth.js` | `getAccessToken`, `signIn`, `signOut`, `isSignedIn`, `initAuth`, `startTokenKeepAlive` |
| `lib/frontmatter.js` | `parseDoc`, `serialiseDoc` |
| `lib/markdown.js` | `splitSegments` |
| `lib/pitch.js` / `lib/pitchSvg.js` | the diagram language and its geometry |
| `components/PitchDiagram.jsx` | `<PitchDiagram source baseLine />` |
| `components/DrillPreview.jsx` | `<DrillPreview source />` — renders a whole drill |
| `components/Catalogue.jsx` | the plain list this plan replaces with a grid |

A drill, as `drills.js` presents it: `{ id, slug, title, category, minutes, players, tags, thumb, invalid }`.

---

## Two things this plan inherits

**Drive integration is still unproven.** Every Drive test mocks the network. Sean has not yet reported the manual checklist from the previous plan (sign in, folder created, revalidation, owner gate). Nothing in this plan depends on that being right, but if sign-in turns out broken, fix it before judging any of this against real data.

**Three findings were recorded for this plan by the last review**, all addressed here:
- `loadCatalogue` returns `failed: [{id, name, error}]` for drills that could not be refetched. Nothing surfaces it yet — Task 7 does.
- `App.jsx` shows raw exception text like `drive 403`, which tells a coach nothing. Task 7 fixes that.
- `findFolder` takes the first match with no ordering guarantee, so two near-simultaneous first-runs could create two `BallIsLife` folders. Task 6 adds a warning.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/prose.js` | Markdown → sanitised HTML. The only module that touches `marked`/`DOMPurify` |
| `src/components/DrillCard.jsx` | One grid card: thumbnail diagram, title, chips |
| `src/components/Filters.jsx` | Category chips, tag list, search box. Controlled, no state of its own |
| `src/components/Grid.jsx` | Filters + cards + the empty/no-match states |
| `src/components/DrillView.jsx` | One drill, read-only, full text |
| `src/components/Catalogue.jsx` | Modified: grid or drill view, plus status states |
| `src/components/DrillPreview.jsx` | Modified: prose via `prose.js` instead of line breaks |
| `src/lib/drive.js` | Modified: add `readDrill(id)`, warn on duplicate folders |
| `src/App.jsx` | Modified: selection state, friendlier errors, surface `failed` |

---

## Task 1: Render markdown prose safely

**Files:**
- Modify: `package.json`
- Create: `src/lib/prose.js`
- Test: `test/prose.test.js`

The interim rendering turns paragraphs into text with `<br>` line breaks. A coach's drill has headings, lists and emphasis; this renders them properly and sanitises the result, because drills arrive as text pasted from an LLM.

- [ ] **Step 1: Install the dependencies**

```bash
npm install marked dompurify
npm install -D jsdom
```

`jsdom` is a **dev** dependency: `DOMPurify` needs a DOM, and Vitest runs in the node environment. It is not shipped to the browser, where `window` already exists. Report the installed versions.

- [ ] **Step 2: Write the failing tests**

Note the first line — this one test file runs in a jsdom environment, unlike every other test in the project. That is deliberate and is the whole reason `jsdom` is installed.

```jsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderProse } from "../src/lib/prose.js";

describe("renderProse", () => {
  it("renders a list a coach actually wrote", () => {
    const html = renderProse("Set-up:\n\n- two lines of cones\n- bibs\n");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>two lines of cones</li>");
  });

  it("renders headings, emphasis and inline code", () => {
    const html = renderProse("## Coaching points\n\n**press** the `first` defender\n");
    expect(html).toContain("<h2>Coaching points</h2>");
    expect(html).toContain("<strong>press</strong>");
    expect(html).toContain("<code>first</code>");
  });

  it("strips a script tag", () => {
    expect(renderProse("ok <script>alert(1)</script>")).not.toContain("<script");
  });

  it("strips an event handler attribute but keeps the element", () => {
    const html = renderProse('<img src=x onerror=alert(1)>');
    expect(html).toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("returns a string for empty, null and undefined", () => {
    expect(renderProse("")).toBe("");
    expect(renderProse(null)).toBe("");
    expect(renderProse(undefined)).toBe("");
  });

  it("never returns a promise", () => {
    expect(typeof renderProse("x")).toBe("string");
  });

  it("leaves a bare ampersand alone rather than mangling it", () => {
    expect(renderProse("4 & 5")).toContain("4 &amp; 5");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run test/prose.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/prose.js"`.

- [ ] **Step 4: Write the implementation**

```js
// src/lib/prose.js
// Markdown prose -> sanitised HTML. The only module that knows about marked or
// DOMPurify, so swapping either is a one-file change.
//
// Sanitising is not optional even though the drills are the owner's own: they arrive as
// text pasted from an LLM, and markdown permits raw HTML.
import { marked } from "marked";
import createDOMPurify from "dompurify";

let cached = null;

// DOMPurify needs a DOM. In the browser that is `window`; under Vitest it is jsdom's,
// which is why test/prose.test.js declares `@vitest-environment jsdom`. A window can
// also be passed explicitly, which keeps the module testable without globals.
function purifier(win) {
  const w = win ?? globalThis.window;
  if (!w) throw new Error("prose: no DOM available to sanitise with");
  if (win) return createDOMPurify(win);
  if (!cached) cached = createDOMPurify(w);
  return cached;
}

export function renderProse(markdown, win) {
  // `async: false` keeps this synchronous — marked can return a promise otherwise, and
  // a component cannot render one.
  const html = marked.parse(String(markdown ?? ""), { async: false });
  return purifier(win).sanitize(html);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run test/prose.test.js
```

Expected: `Tests  7 passed (7)`.

**Verified sanitiser behaviour** (probed beyond the tests above, recorded so it is not
rediscovered): `<iframe>`, `<style>`, `<script>` — including inside `<svg>` — `onclick`
and other event handlers, and `javascript:` hrefs are all removed, while ordinary
`https:` links survive intact. Two things DOMPurify allows by default and we accept: a
`<form>` element, and a `data:` URI as an image `src`. Neither can execute, and with
scripting blocked nothing can read the access token from `sessionStorage`, so the
realistic risk on the owner’s own content is nil. If the Drive folder is ever shared
with someone who can write to it, revisit with `FORBID_TAGS: ["form", "input"]`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: render drill prose with marked, sanitised by dompurify"
```

---

## Task 2: Use it in DrillPreview

**Files:**
- Modify: `src/components/DrillPreview.jsx`
- Modify: `test/drillPreview.test.jsx`

This deliberately changes behaviour delivered in Plan 1, so one existing test changes with it.

- [ ] **Step 1: Update the existing test**

`test/drillPreview.test.jsx` has a test named `keeps single line breaks so a written list stays readable`, which asserts `<br`. That behaviour was an explicit interim stand-in for markdown rendering, and it is now superseded. Replace that whole test with:

```jsx
  it("renders a written list as a real list", () => {
    // Superseded the interim line-break rendering: `- item` lines are now a real <ul>,
    // which is what the markdown always meant.
    const html = render("---\ntitle: T\n---\n\nWarm-up:\n\n- jog\n- stretches\n\nThen play.\n");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>jog</li>");
    expect(html).toContain("Then play.");
  });
```

Add `// @vitest-environment jsdom` as the first line of the file — `DrillPreview` now renders prose, so its tests need a DOM.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run test/drillPreview.test.jsx
```

Expected: FAIL — no `<ul>` in the output, because the component still splits on newlines.

- [ ] **Step 3: Change the component**

In `src/components/DrillPreview.jsx`, replace the prose branch of the segment map with:

```jsx
          <div
            key={i}
            className="prose"
            dangerouslySetInnerHTML={{ __html: renderProse(seg.text) }}
          />
```

and import `renderProse` from `../lib/prose.js`. Delete the now-unused per-line `React.Fragment` mapping.

`dangerouslySetInnerHTML` is safe here precisely because `renderProse` sanitises — that is the module's entire job, and it is tested.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run test/drillPreview.test.jsx
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Add prose styles to `src/styles.css`**

```css
.prose { line-height: 1.55; }
.prose h1, .prose h2, .prose h3 { margin: 14px 0 6px; line-height: 1.25; }
.prose h1 { font-size: 20px; } .prose h2 { font-size: 17px; } .prose h3 { font-size: 15px; }
.prose p { margin: 0 0 10px; }
.prose ul, .prose ol { margin: 0 0 10px; padding-left: 22px; }
.prose li { margin: 2px 0; }
.prose code { background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; font-size: 13px; }
.prose pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px; overflow-x: auto; }
.prose blockquote { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid var(--line); color: var(--dim); }
.prose a { color: var(--accent); }
.prose img { max-width: 100%; }
.prose table { border-collapse: collapse; }
.prose th, .prose td { border: 1px solid var(--line); padding: 4px 8px; }
```

- [ ] **Step 6: Run the whole suite and the build, then commit**

```bash
npm test && npm run build
git add -A
git commit -m "feat: render drill prose as real markdown"
```

---

## Task 3: The drill card

**Files:**
- Create: `src/components/DrillCard.jsx`
- Test: `test/drillCard.test.jsx`

The card is how you recognise a drill: its pitch diagram is the thumbnail.

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import DrillCard from "../src/components/DrillCard.jsx";

const drill = {
  id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
  players: "6-8", tags: ["possession"], invalid: null,
  thumb: "area: 20x20 plain\nred: A@5,5 B@15,15\npass: A->B\n",
};
const render = (d) => renderToStaticMarkup(<DrillCard drill={d} />);

describe("DrillCard", () => {
  it("shows the title, category, duration and player count", () => {
    const html = render(drill);
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("warmup");
    expect(html).toContain("10′");
    expect(html).toContain("6-8");
  });

  it("draws the thumbnail diagram", () => {
    expect(render(drill)).toContain("<svg");
  });

  it("shows a placeholder when the drill has no diagram", () => {
    const html = render({ ...drill, thumb: null });
    expect(html).not.toContain("<svg");
    expect(html).toMatch(/no diagram/i);
  });

  it("flags an invalid drill without hiding it", () => {
    const html = render({ ...drill, invalid: "yaml: bad" });
    expect(html).toContain("Rondo 4v2");
    expect(html).toMatch(/needs fixing/i);
  });

  it("renders tags", () => {
    expect(render(drill)).toContain("possession");
  });

  it("does not let a long unbroken title escape the card", () => {
    // A long title ran past the card edge and pushed the whole page sideways on a
    // phone. The fix is CSS, so assert the class that carries it is present.
    const html = render({ ...drill, title: "A".repeat(90) });
    expect(html).toContain("drill-card-title");
    expect(html).toContain("A".repeat(90));
  });

  it("omits chips for absent fields rather than showing blanks", () => {
    const html = render({ ...drill, minutes: null, players: null, category: null, tags: [] });
    expect(html).not.toContain("′");
    expect(html).toContain("Rondo 4v2");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/drillCard.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```jsx
// src/components/DrillCard.jsx
// One drill in the grid. The diagram is the thumbnail — it is how a drill is
// recognised at a glance, which is why the grid exists at all.
import React from "react";
import PitchDiagram from "./PitchDiagram.jsx";

export default function DrillCard({ drill, onOpen }) {
  const chips = [
    drill.category,
    drill.minutes ? `${drill.minutes}′` : null,
    drill.players,
  ].filter(Boolean).concat(drill.tags ?? []);

  return (
    <button type="button" className="card drill-card" onClick={() => onOpen?.(drill)}>
      <div className="drill-card-thumb">
        {drill.thumb ? (
          <PitchDiagram source={drill.thumb} />
        ) : (
          <div className="drill-card-empty dim">no diagram</div>
        )}
      </div>
      <div className="drill-card-title">{drill.title}</div>
      <div className="row">
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>
      {drill.invalid ? <div className="banner warn mono">needs fixing</div> : null}
    </button>
  );
}
```

- [ ] **Step 4: Add the card styles to `src/styles.css`**

```css
.drill-card {
  display: block; width: 100%; text-align: left; cursor: pointer;
  padding: 8px; border-radius: 10px;
}
.drill-card:hover { border-color: var(--accent); }
.drill-card-thumb { border-radius: 8px; overflow: hidden; }
.drill-card-empty {
  aspect-ratio: 44 / 29; display: flex; align-items: center; justify-content: center;
  background: var(--bg); border-radius: 8px; font-size: 13px;
}
/* overflow-wrap because a long unbroken title ran past the card edge and pushed the
   whole page sideways on a phone, which is the device this view exists for. */
.drill-card-title { font-weight: 700; margin: 8px 0 4px; overflow-wrap: anywhere; }
.grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
```

The card is a `<button>` so it is keyboard reachable and announced as clickable — a `<div>` with an `onClick` is neither.

- [ ] **Step 5: Run the tests, then commit**

```bash
npx vitest run test/drillCard.test.jsx    # expect 7 passed
git add -A
git commit -m "feat: drill card with the pitch diagram as its thumbnail"
```

---

## Task 4: Filters

**Files:**
- Create: `src/components/Filters.jsx`
- Test: `test/filters.test.jsx`

Fully controlled — it holds no state, so it stays testable by SSR and the filter state lives in one place.

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Filters, { tagsOf } from "../src/components/Filters.jsx";

const drills = [
  { id: "a", category: "warmup", tags: ["possession", "rondo"] },
  { id: "b", category: "skill", tags: ["transition"] },
  { id: "c", category: "warmup", tags: ["possession"] },
];
const render = (props) => renderToStaticMarkup(<Filters drills={drills} {...props} />);

describe("tagsOf", () => {
  it("lists every distinct tag, most used first", () => {
    expect(tagsOf(drills)).toEqual(["possession", "rondo", "transition"]);
  });

  it("copes with drills that have no tags", () => {
    expect(tagsOf([{ id: "a" }, { id: "b", tags: [] }])).toEqual([]);
    expect(tagsOf(null)).toEqual([]);
  });
});

describe("Filters", () => {
  it("offers every category present, plus all", () => {
    const html = render({ filter: {} });
    expect(html).toContain("warmup");
    expect(html).toContain("skill");
    expect(html).toMatch(/all/i);
  });

  it("marks the active category", () => {
    expect(render({ filter: { category: "skill" } })).toContain("active");
  });

  it("shows the tags", () => {
    const html = render({ filter: {} });
    expect(html).toContain("possession");
    expect(html).toContain("transition");
  });

  it("reflects the current query in the search box", () => {
    expect(render({ filter: { query: "rondo" } })).toContain('value="rondo"');
  });

  it("renders with no drills at all", () => {
    expect(() => renderToStaticMarkup(<Filters drills={[]} filter={{}} />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/filters.test.jsx
```

- [ ] **Step 3: Write the component**

```jsx
// src/components/Filters.jsx
// Controlled: every value comes from `filter`, every change goes out through onChange.
// Holding no state keeps the filter in one place and this component SSR-testable.
import React from "react";

const CATEGORIES = ["warmup", "skill", "tactical", "match", "fun"];

// Tags actually in use, most-used first, so the common ones are reachable without
// scrolling. Ties break alphabetically so the order is stable between renders.
export function tagsOf(drills) {
  const counts = new Map();
  for (const d of drills ?? []) {
    for (const t of d.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

export default function Filters({ drills, filter, onChange }) {
  const set = (patch) => onChange?.({ ...filter, ...patch });
  const present = CATEGORIES.filter((c) => (drills ?? []).some((d) => d.category === c));
  const tags = tagsOf(drills);

  return (
    <div className="filters">
      <div className="row">
        <button
          type="button"
          className={`chip-button${!filter.category ? " active" : ""}`}
          onClick={() => set({ category: null })}
        >
          all
        </button>
        {present.map((c) => (
          <button
            type="button"
            key={c}
            className={`chip-button${filter.category === c ? " active" : ""}`}
            onClick={() => set({ category: filter.category === c ? null : c })}
          >
            {c}
          </button>
        ))}
        <input
          className="search"
          type="search"
          placeholder="Search drills"
          value={filter.query ?? ""}
          onChange={(e) => set({ query: e.target.value })}
        />
      </div>
      {tags.length ? (
        <div className="row" style={{ marginTop: 6 }}>
          {tags.map((t) => (
            <button
              type="button"
              key={t}
              className={`chip-button small${filter.tag === t ? " active" : ""}`}
              onClick={() => set({ tag: filter.tag === t ? null : t })}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Add filter styles to `src/styles.css`**

```css
.filters { margin: 8px 0 12px; }
.chip-button {
  padding: 3px 10px; border-radius: 99px; font-size: 13px;
  background: var(--panel); border: 1px solid var(--line); cursor: pointer;
}
.chip-button.small { font-size: 12px; padding: 2px 8px; }
.chip-button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.search { flex: 1; min-width: 140px; }
```

- [ ] **Step 5: Run the tests, then commit**

```bash
npx vitest run test/filters.test.jsx    # expect 7 passed
git add -A
git commit -m "feat: category, tag and search filters"
```

---

## Task 5: The grid

**Files:**
- Create: `src/components/Grid.jsx`
- Test: `test/grid.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Grid from "../src/components/Grid.jsx";

const drills = [
  { id: "a", slug: "rondo", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8", tags: ["possession"], thumb: null, invalid: null },
  { id: "b", slug: "press", title: "Pressing traps", category: "tactical", minutes: 20, players: null, tags: ["pressing"], thumb: null, invalid: null },
];
const render = (props) => renderToStaticMarkup(<Grid drills={drills} filter={{}} {...props} />);

describe("Grid", () => {
  it("renders a card per drill", () => {
    const html = render({});
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("Pressing traps");
  });

  it("applies the filter", () => {
    const html = render({ filter: { category: "tactical" } });
    expect(html).toContain("Pressing traps");
    expect(html).not.toContain("Rondo 4v2");
  });

  it("says so when a filter matches nothing, and offers to clear it", () => {
    const html = render({ filter: { query: "zzzz" } });
    expect(html).toMatch(/no drills match/i);
    expect(html).toMatch(/clear/i);
  });

  it("explains an empty catalogue differently from an empty filter", () => {
    const html = renderToStaticMarkup(<Grid drills={[]} filter={{}} />);
    expect(html).toMatch(/no drills yet/i);
    expect(html).toContain("BallIsLife");
  });

  it("reports drills that failed to load without hiding the ones that worked", () => {
    const failed = [{ id: "x", name: "broken.md", error: new Error("drive 500") }];
    const html = render({ failed });
    expect(html).toContain("Rondo 4v2");
    expect(html).toMatch(/1 drill could not be loaded/i);
    expect(html).toContain("broken.md");
  });

  it("counts what is showing", () => {
    expect(render({})).toMatch(/2 drills/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/grid.test.jsx
```

- [ ] **Step 3: Write the component**

```jsx
// src/components/Grid.jsx
// The browse view: filters, then a card per drill. Filtering is delegated to
// lib/drills.js — this component decides nothing about what matches.
import React from "react";
import DrillCard from "./DrillCard.jsx";
import Filters from "./Filters.jsx";
import { filterDrills } from "../lib/drills.js";

export default function Grid({ drills, filter, onFilterChange, onOpen, failed = [] }) {
  const shown = filterDrills(drills, filter);
  const filtering = Boolean(filter.category || filter.tag || (filter.query ?? "").trim());

  if (!drills.length) {
    return (
      <div className="card">
        <p>No drills yet.</p>
        <p className="dim">
          Add markdown files to the <strong>BallIsLife</strong> folder in your Google
          Drive and reload.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Filters drills={drills} filter={filter} onChange={onFilterChange} />

      {failed.length ? (
        <div className="banner warn">
          {failed.length} drill{failed.length === 1 ? "" : "s"} could not be loaded:{" "}
          {failed.map((f) => f.name).join(", ")}. They will be retried next time you reload.
        </div>
      ) : null}

      <div className="dim" style={{ margin: "0 0 8px" }}>
        {shown.length} drill{shown.length === 1 ? "" : "s"}
        {filtering && shown.length !== drills.length ? ` of ${drills.length}` : ""}
      </div>

      {shown.length ? (
        <div className="grid">
          {shown.map((d) => <DrillCard key={d.id} drill={d} onOpen={onOpen} />)}
        </div>
      ) : (
        <div className="card">
          <p>No drills match.</p>
          <button type="button" onClick={() => onFilterChange?.({})}>Clear filters</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run test/grid.test.jsx    # expect 6 passed
git add -A
git commit -m "feat: the browse grid with filters and failure reporting"
```

---

## Task 6: Read one drill

**Files:**
- Modify: `src/lib/drive.js`
- Modify: `test/drive.test.js`
- Create: `src/components/DrillView.jsx`
- Test: `test/drillView.test.jsx`

The grid shows a cached thumbnail; opening a drill fetches its full text.

- [ ] **Step 1: Write the failing `drive.js` tests**

Append to `test/drive.test.js`:

```js
describe("readDrill", () => {
  it("fetches the file text and records its modifiedTime", async () => {
    api.readFile.mockResolvedValue("---\ntitle: A\n---\n\nbody\n");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T7" }]);
    api.findFolder.mockResolvedValue("F1");
    const r = await readDrill("a", "F1");
    expect(r.text).toContain("title: A");
    expect(r.modifiedTime).toBe("T7");
    expect(knownModifiedTime("a")).toBe("T7");
  });

  it("retries once on a 401", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    api.readFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue("text");
    await expect(readDrill("a", "F1")).resolves.toBeTruthy();
  });
});

describe("duplicate folders", () => {
  it("warns when more than one BallIsLife folder exists", async () => {
    api.findAllFolders.mockResolvedValue(["F1", "F2"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    const { duplicateFolders } = await loadCatalogue();
    expect(duplicateFolders).toBe(true);
  });

  it("reports no duplicates in the normal case", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    expect((await loadCatalogue()).duplicateFolders).toBe(false);
  });
});
```

Extend the import to include `readDrill`.

- [ ] **Step 2: Add `findAllFolders` to `driveApi.js` and a test for it**

In `src/lib/driveApi.js`, generalise the folder lookup:

```js
// -> every non-trashed folder with this name. More than one means the owner ended up
// with duplicates — possible if two devices ran a first-time load at the same moment,
// since Drive's search index lags folder creation. Callers warn rather than guess.
export async function findAllFolders(token, name) {
  const q = encodeURIComponent(`name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const body = await json(token, `${FILES}?q=${q}&fields=files(id)`);
  return (body.files ?? []).map((f) => f.id);
}

export async function findFolder(token, name) {
  return (await findAllFolders(token, name))[0] ?? null;
}
```

Add to `test/driveApi.test.js`:

```js
describe("findAllFolders", () => {
  it("returns every matching folder id", async () => {
    fetchMock.mockResolvedValue(ok({ files: [{ id: "F1" }, { id: "F2" }] }));
    expect(await findAllFolders("tok", "BallIsLife")).toEqual(["F1", "F2"]);
  });

  it("returns an empty array when there are none", async () => {
    fetchMock.mockResolvedValue(ok({ files: [] }));
    expect(await findAllFolders("tok", "BallIsLife")).toEqual([]);
  });
});
```

Extend that file's import to include `findAllFolders`.

- [ ] **Step 3: Add `readDrill` and the duplicate check to `drive.js`**

```js
// Full text of one drill, plus the modifiedTime the editor will need as its save
// baseline. The grid renders a cached thumbnail; this is what opening a drill fetches.
export async function readDrill(id, folder) {
  return withRetry(async () => {
    const token = getAccessToken();
    const files = await api.listFiles(token, folder);
    const file = files.find((f) => f.id === id) ?? null;
    const text = await api.readFile(token, id);
    const modifiedTime = file?.modifiedTime ?? null;
    if (modifiedTime) known.set(id, modifiedTime);
    return { text, modifiedTime };
  });
}
```

In `loadCatalogue`, replace the `folderId` helper's use of `findFolder` with `findAllFolders`, and return the duplicate flag:

```js
async function folders(token) {
  const found = await api.findAllFolders(token, FOLDER_NAME);
  if (found.length) return { folder: found[0], duplicateFolders: found.length > 1 };
  return { folder: await api.createFolder(token, FOLDER_NAME), duplicateFolders: false };
}
```

Use it at the top of \`loadCatalogue\` (\`const { folder, duplicateFolders } = await folders(token);\`) and add \`duplicateFolders\` to the returned object.

**This breaks the existing \`loadCatalogue\` tests.** Every one of them mocks
\`api.findFolder.mockResolvedValue("F1")\`, and \`loadCatalogue\` no longer calls it — the
mocked \`findAllFolders\` returns \`undefined\` and the load fails. Update each of those
mocks to \`api.findAllFolders.mockResolvedValue(["F1"])\`. \`findFolder\` itself stays,
still exported and still tested, because it remains the simpler call for any caller that
only wants one folder.

- [ ] **Step 4: Write the failing `DrillView` tests**

```jsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import DrillView from "../src/components/DrillView.jsx";

const drill = { id: "a", slug: "rondo", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8", tags: ["possession"], thumb: null, invalid: null };
const render = (props) => renderToStaticMarkup(<DrillView drill={drill} {...props} />);

describe("DrillView", () => {
  it("shows a back control", () => {
    expect(render({ status: "loading" })).toMatch(/back/i);
  });

  it("says it is loading before the text arrives", () => {
    expect(render({ status: "loading" })).toMatch(/loading/i);
  });

  it("renders the drill once loaded", () => {
    const text = "---\ntitle: Rondo 4v2\n---\n\nKeep the ball.\n\n```pitch\narea: 20x20 plain\nred: A@5,5\n```\n";
    const html = render({ status: "ready", text });
    expect(html).toContain("Keep the ball");
    expect(html).toContain("<svg");
  });

  it("shows an error without losing the back control", () => {
    const html = render({ status: "error", message: "drive 500" });
    expect(html).toContain("drive 500");
    expect(html).toMatch(/back/i);
  });

  it("shows the title from the drill while loading, so the header does not jump", () => {
    expect(render({ status: "loading" })).toContain("Rondo 4v2");
  });
});
```

- [ ] **Step 5: Write `src/components/DrillView.jsx`**

```jsx
// src/components/DrillView.jsx
// One drill, read-only. Presentational: App fetches the text and passes it in.
import React from "react";
import DrillPreview from "./DrillPreview.jsx";

export default function DrillView({ drill, status, text, message, onBack }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={onBack}>← Back</button>
        <strong>{drill?.title}</strong>
      </div>
      {status === "loading" ? <div className="card">Loading…</div> : null}
      {status === "error" ? <div className="card banner err mono">{message}</div> : null}
      {status === "ready" ? <DrillPreview source={text} /> : null}
    </div>
  );
}
```

- [ ] **Step 6: Run everything and commit**

```bash
npm test && npm run build
git add -A
git commit -m "feat: open and read a single drill, and warn about duplicate folders"
```

---

## Task 7: Wire it together

**Files:**
- Modify: `src/components/Catalogue.jsx`, `test/catalogue.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Update `test/catalogue.test.jsx`**

`Catalogue` now shows the grid rather than a plain list, and the two tests that assert list-specific markup change. Replace the `lists drills with their metadata` and `renders a drill with no diagram without an svg` tests with:

```jsx
  it("shows the drills as a grid of cards", () => {
    const drills = [
      { id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
        players: "6-8", tags: ["possession"], thumb: "area: 20x20 plain\nred: A@5,5\n", invalid: null },
    ];
    const html = render({ status: "ready", drills });
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("warmup");
    expect(html).toContain("possession");
    expect(html).toContain("<svg");
  });

  it("surfaces a friendly message for a rate-limited Drive", () => {
    const html = render({ status: "error", message: "drive 403" });
    expect(html).toMatch(/too many requests|try again/i);
  });
```

Add `// @vitest-environment jsdom` as the first line — the grid renders cards which may render prose.

- [ ] **Step 2: Rewrite `Catalogue.jsx` to show the grid or a drill**

```jsx
// src/components/Catalogue.jsx
// Presentational: given a status, render sign-in, the grid, or one drill. No Drive
// calls — App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import Grid from "./Grid.jsx";
import DrillView from "./DrillView.jsx";

// Raw exception text like "drive 403" tells a coach nothing about what to do next.
export function friendlyError(message) {
  const text = String(message ?? "");
  if (/\b401\b/.test(text)) return "Your Google sign-in expired. Reload to sign in again.";
  if (/\b403\b/.test(text)) return "Google is rate-limiting requests. Try again in a minute.";
  if (/\b404\b/.test(text)) return "That drill is no longer in your Drive folder.";
  if (/\b5\d\d\b/.test(text)) return "Google Drive is having trouble. Try again shortly.";
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return "No connection to Google Drive. Check your signal and try again.";
  }
  return text || "Something went wrong.";
}

export default function Catalogue({
  status, drills = [], failed = [], message, onSignIn,
  filter = {}, onFilterChange, selected, drillStatus, drillText, drillMessage,
  onOpen, onBack, duplicateFolders,
}) {
  if (status === "signed-out") {
    return (
      <div className="card">
        <p>Your drills live in your own Google Drive. Nothing is stored on this site.</p>
        <button className="primary" onClick={onSignIn}>Sign in with Google</button>
      </div>
    );
  }
  if (status === "loading") return <div className="card">Loading your drills…</div>;
  if (status === "not-owner") {
    return <div className="card banner err">This app is for its owner only. You have been signed out.</div>;
  }
  if (status === "error") return <div className="card banner err">{friendlyError(message)}</div>;

  if (selected) {
    return (
      <DrillView
        drill={selected}
        status={drillStatus}
        text={drillText}
        message={friendlyError(drillMessage)}
        onBack={onBack}
      />
    );
  }

  return (
    <>
      {duplicateFolders ? (
        <div className="banner warn">
          There is more than one <strong>BallIsLife</strong> folder in your Drive. Drills
          may be split between them — merge them in Drive to be safe.
        </div>
      ) : null}
      <Grid
        drills={drills}
        failed={failed}
        filter={filter}
        onFilterChange={onFilterChange}
        onOpen={onOpen}
      />
    </>
  );
}
```

- [ ] **Step 3: Update `App.jsx` to hold selection and filter state**

Keep the existing auth and owner-gate effect exactly as it is. Add:

```jsx
  const [filter, setFilter] = useState({});
  const [selected, setSelected] = useState(null);
  const [drillStatus, setDrillStatus] = useState("loading");
  const [drillText, setDrillText] = useState("");
  const [drillMessage, setDrillMessage] = useState("");
  const [failed, setFailed] = useState([]);
  const [duplicateFolders, setDuplicateFolders] = useState(false);
  const folderRef = useRef(null);

  const openDrill = useCallback(async (drill) => {
    setSelected(drill);
    setDrillStatus("loading");
    setDrillText("");
    try {
      const { text } = await readDrill(drill.id, folderRef.current);
      setDrillText(text);
      setDrillStatus("ready");
    } catch (e) {
      setDrillMessage(String(e?.message ?? e));
      setDrillStatus("error");
    }
  }, []);
```

In `load`, capture the extra fields:

```jsx
      const { drills: loaded, failed: notLoaded, folderId, duplicateFolders: dupes } = await loadCatalogue();
      folderRef.current = folderId;
      setDrills(loaded);
      setFailed(notLoaded ?? []);
      setDuplicateFolders(Boolean(dupes));
      setStatus("ready");
```

and pass everything through to `Catalogue`, with `onBack={() => setSelected(null)}`.

Import `useRef` and `readDrill`.

- [ ] **Step 4: Run everything**

```bash
npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: browse the catalogue as a grid and open a drill to read it"
```

---

## Task 8: Look at it

**Files:** none — this is verification.

Rendering has caught defects in this project that no unit test did: arrowheads scaled to four times their intended size, a zone label sitting exactly where the play happens, a penalty arc cutting through the box. Do the same here.

- [ ] **Step 1: Render the grid and a drill to real HTML**

Write a throwaway test file (delete it afterwards, do not commit it) that renders `Grid` with six varied drills — different categories, one with no diagram, one flagged invalid, long and short titles — and `DrillView` with a full drill, using `renderToStaticMarkup`, wrapping each in a page that includes `src/styles.css`.

- [ ] **Step 2: Screenshot both at desktop and phone width**

```bash
google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1100,900 --screenshot=grid-desktop.png page.html
google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=390,844 --screenshot=grid-phone.png page.html
```

ImageMagick's `convert` ignores `fill-opacity`, so Chrome is the reference.

- [ ] **Step 3: Look at them and report**

Judge as a coach, not a developer: are the thumbnails legible at card size? Does a long title break the layout? Do the filter chips wrap sensibly at 390px? Is the invalid-drill flag noticeable without shouting? Does the card grid reflow to one column on a phone?

Report concrete defects with what you would change. Do not fix them without saying what you are changing and why.

- [ ] **Step 4: Delete the throwaway file and confirm the tree is clean**

```bash
git status --short
```

---

## Done when

- `npm test` passes and `npm run build` is clean
- The grid renders with thumbnails, filters and search, and reflows on a phone
- Opening a drill fetches and renders its full text, with markdown prose
- Drills that fail to load are reported without hiding the ones that worked
- Drive errors read as sentences a coach can act on, not `drive 403`

## What Plan 4 covers

- The three-pane editor: drill list, markdown source, live preview, collapsing on mobile
- Create, rename and delete drills (`fileNameFor` and `trashFile` already exist)
- Debounced autosave wired to `saveDrill`. **The contract:** pass only
  `baseModifiedTime` (what you loaded) and adopt the `modifiedTime` from every
  successful result, including a `coalesced` one
- The conflict warning surfaced in the UI, with an offer to reload
- Deep-linking a drill by slug, so a session plan can point at one
