# Swapping a Drill Mid-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a block's drill be swapped from the run view at the side of a pitch, choosing from a list that puts the most like-for-like drills first and can be searched and reordered.

**Architecture:** A new pure module `src/lib/picker.js` ranks and filters candidate drills; a new presentational component `src/components/DrillPicker.jsx` renders that ranking with a search box, an order control and an "only <slot> drills" filter. `SessionRun` opens the picker in place of a block's body and reports the choice upwards; `App` writes the change into the session (so it persists to Drive, exactly like a builder edit) and fetches the swapped-in drill's text into `runTexts`.

**Tech Stack:** React 18, Vitest 2 (node env by default; jsdom via `// @vitest-environment jsdom`), no new dependencies.

---

## Why it works this way

**A swap edits the saved plan.** Sean's words: "swap a drill at short notice (e.g. if the numbers are small)". If ten players turn up and the 11v11 block becomes a 5v5, that is what the session *was* — the plan should say so afterwards. It also means no second source of truth: the run view already renders `sessionsState.data.sessions[runSessionId]`, so writing through `onSessionChange` re-renders it immediately and the existing debounced `saveSessions` persists it. Progress marks are keyed by block **index**, and a swap replaces a drill in place without moving any block, so nothing about tonight's progress is invalidated by the write itself.

**A swap clears that block's mark.** Swapping the drill replaces the work, so "done" no longer refers to anything that happened. The alternative — a block still showing "Done" beside a drill that was never run — is a plan that lies.

**Ranking, not restriction.** The builder's picker *hides* drills whose category does not match the slot, with a "show all" opt-in. That is wrong for a swap: you are swapping precisely because the plan did not survive contact with the turnout, so the drill you need may well be a "fun" drill in the tactical slot. The picker therefore shows everything by default but sorts the like-for-like drills to the top — same category first, then shared tags with the drill being replaced — with the hard category filter available as an opt-in.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/drills.js` (modify) | Harden `filterDrills` against a drill with no `tags` array. |
| `src/lib/picker.js` (create) | Pure: score, filter and order candidate drills. Owns `SORTS`. |
| `src/components/DrillPicker.jsx` (create) | Presentational: search box, order control, category filter, ranked list of choosable drills. |
| `src/components/SessionRun.jsx` (modify) | A Swap control per open block; the picker replaces the block body while choosing; clears the mark on swap. |
| `src/components/Catalogue.jsx` (modify) | Pass `onSwap` through to `SessionRun`. |
| `src/App.jsx` (modify) | `onRunSwap`: write the block through `onSessionChange`, fetch the new drill's text into `runTexts`. Extract the shared per-drill fetch. |
| `src/styles.css` (modify) | `.drill-picker*` rules; hide the picker in print. |
| `test/drills.test.js` (modify) | One test for the `tags`-less drill. |
| `test/picker.test.js` (create) | The ranking rules. |
| `test/drillPicker.test.jsx` (create) | The component's search, order, filter and choose behaviour. |
| `test/sessionRun.test.jsx` (modify) | Swap control, picker in place of the body, mark cleared. |
| `test/app.test.jsx` (modify) | A swap saves the session and loads the new drill's text. |

---

### Task 1: `filterDrills` survives a drill with no tags

`picker.js` reuses `filterDrills` for its text search. Both of its `tags` accesses are unguarded, and a query that does not match the title reaches `d.tags.some` and throws. Real catalogue drills always have a `tags` array (`drillsFromIndex` guarantees it), but the picker is handed drills by callers and tests too, and a `TypeError` inside a filter takes the whole picker down — the same failure mode as the numeric-title crash.

**Files:**
- Modify: `src/lib/drills.js:59-70`
- Test: `test/drills.test.js`

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe("filterDrills", ...)` block in `test/drills.test.js`:

```js
  it("does not throw on a drill with no tags array", () => {
    const bare = [{ slug: "x", title: "X", category: "skill", minutes: 5 }];
    // A query that cannot match the title is what reaches the tags branch.
    expect(filterDrills(bare, { query: "zzz" })).toEqual([]);
    expect(filterDrills(bare, { tag: "possession" })).toEqual([]);
    expect(filterDrills(bare, { query: "x" })).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/drills.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'some')`.

- [ ] **Step 3: Guard both accesses**

In `src/lib/drills.js`, replace the two `d.tags` reads inside `filterDrills`:

```js
export function filterDrills(drills, { category, tag, query } = {}) {
  const q = String(query ?? "").trim().toLowerCase();
  return (drills ?? []).filter((d) => {
    const tags = d.tags ?? [];
    if (category && d.category !== category) return false;
    if (tag && !tags.includes(tag)) return false;
    if (!q) return true;
    return (
      String(d.title ?? "").toLowerCase().includes(q) ||
      tags.some((t) => String(t).toLowerCase().includes(q))
    );
  });
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: every existing test still passes, plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/lib/drills.js test/drills.test.js
git commit -m "fix: filterDrills survives a drill with no tags array"
```

---

### Task 2: `src/lib/picker.js` — rank the candidates

Pure module. `rankDrills` returns entries of `{ drill, score, matched }` rather than bare drills, because the component wants the matched tags to show *why* a drill is near the top.

**Files:**
- Create: `src/lib/picker.js`
- Test: `test/picker.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/picker.test.js`:

```js
// The picker's ordering rules. Pure, so no jsdom: the whole point of keeping this out of
// DrillPicker.jsx is that "what should be near the top" is testable without a DOM.
import { describe, it, expect } from "vitest";
import { rankDrills, scoreDrill, sharedTags, SORTS } from "../src/lib/picker.js";

const d = (slug, title, category, minutes, tags = [], players = null) =>
  ({ slug, title, category, minutes, tags, players });

const pool = [
  d("rondo", "Rondo 4v2", "skill", 12, ["possession", "rondo"]),
  d("gates", "Passing gates", "skill", 8, ["passing"]),
  d("hk", "High knees", "warmup", 6, ["mobility"]),
  d("ssg", "SSG 6v6", "match", 25, ["possession"], "12+"),
  d("dribble", "Dribble squares", "skill", 10, ["possession", "dribbling"]),
  d("nomin", "No duration drill", "skill", null, []),
];
const slugs = (entries) => entries.map((e) => e.drill.slug);

describe("scoreDrill / sharedTags", () => {
  it("a matching category outweighs any number of shared tags", () => {
    const sameCategory = scoreDrill(d("x", "X", "skill", 5), { slot: "skill", tags: ["a", "b"] });
    const allTags = scoreDrill(d("y", "Y", "fun", 5, ["a", "b"]), { slot: "skill", tags: ["a", "b"] });
    expect(sameCategory).toBeGreaterThan(allTags);
  });

  it("compares tags case-insensitively but reports the drill's own spelling", () => {
    expect(sharedTags({ tags: ["Possession"] }, ["possession"])).toEqual(["Possession"]);
  });

  it("is total: no drill, no slot and no tags all score 0 rather than throwing", () => {
    expect(scoreDrill(undefined, { slot: "skill" })).toBe(0);
    expect(scoreDrill(d("x", "X", "skill", 5), {})).toBe(0);
    expect(sharedTags({ tags: ["a"] }, [])).toEqual([]);
  });
});

describe("rankDrills", () => {
  it("puts the slot's own category first, then most shared tags, then title", () => {
    const ranked = rankDrills(pool, { slot: "skill", tags: ["possession", "rondo"] });
    expect(slugs(ranked)).toEqual(["rondo", "dribble", "nomin", "gates", "ssg"]);
    // "nomin" before "gates" is title order among equal scores: both are skill drills
    // with no shared tag, and "No duration drill" < "Passing gates".
  });

  it("reports which tags matched, for the component to show", () => {
    const ranked = rankDrills(pool, { slot: "skill", tags: ["possession", "rondo"] });
    expect(ranked[0].matched).toEqual(["possession", "rondo"]);
    expect(ranked.find((e) => e.drill.slug === "gates").matched).toEqual([]);
  });

  it("excludes the drill being replaced — swapping a drill for itself is not a swap", () => {
    const withSelf = [...pool, d("keepaway", "Keep away", "skill", 12)];
    expect(slugs(rankDrills(withSelf, { slot: "skill", exclude: "keepaway" })))
      .not.toContain("keepaway");
  });

  it("drops a drill that does not fit the turnout, and keeps one with no players field", () => {
    const ranked = rankDrills(pool, { slot: "match", turnout: 8 });
    expect(slugs(ranked)).not.toContain("ssg"); // needs 12+
    expect(slugs(ranked)).toContain("rondo");   // no players field: unknown means fits
  });

  it("searches titles and tags", () => {
    expect(slugs(rankDrills(pool, { query: "knee" }))).toEqual(["hk"]);
    expect(slugs(rankDrills(pool, { query: "dribbl" }))).toEqual(["dribble"]);
  });

  it("restricts to the slot's category only when asked", () => {
    expect(slugs(rankDrills(pool, { slot: "warmup", sameCategoryOnly: true }))).toEqual(["hk"]);
    expect(slugs(rankDrills(pool, { slot: "warmup" })).length).toBe(pool.length);
  });

  it("orders by title, ignoring category and tags", () => {
    // Dribble squares, High knees, No duration drill, Passing gates, Rondo 4v2, SSG 6v6.
    expect(slugs(rankDrills(pool, { slot: "skill", sort: "title" })))
      .toEqual(["dribble", "hk", "nomin", "gates", "rondo", "ssg"]);
  });

  it("orders by duration, with a drill that has no duration last rather than first", () => {
    // Number(null) is 0 and Number.isFinite(0) is true, so the naive comparator puts
    // every duration-less drill at the very top of "shortest first".
    expect(slugs(rankDrills(pool, { slot: "skill", sort: "minutes" })))
      .toEqual(["hk", "gates", "dribble", "rondo", "ssg", "nomin"]);
  });

  it("with no slot and no tags, relevance order is just title order", () => {
    expect(slugs(rankDrills(pool, {}))).toEqual(slugs(rankDrills(pool, { sort: "title" })));
  });

  it("survives no drills at all and an unknown sort", () => {
    expect(rankDrills(undefined, { slot: "skill" })).toEqual([]);
    expect(slugs(rankDrills(pool, { sort: "nonsense" }))).toEqual(slugs(rankDrills(pool, {})));
  });

  it("exposes an order for every sort it accepts", () => {
    expect(SORTS.map((s) => s.key)).toEqual(["relevance", "title", "minutes"]);
    for (const { key, label } of SORTS) {
      expect(typeof label).toBe("string");
      expect(rankDrills(pool, { sort: key }).length).toBe(pool.length);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/picker.test.js`
Expected: FAIL — cannot resolve `../src/lib/picker.js`.

- [ ] **Step 3: Write the module**

Create `src/lib/picker.js`:

```js
// src/lib/picker.js
// Choosing a drill to put in a slot: which candidates to offer, and in what order.
// Pure — no React, no Drive.
//
// The builder's original picker HID everything whose category did not match the slot.
// That is wrong when swapping mid-session: you are swapping precisely because the plan
// did not survive the turnout, so the drill you need may well be a "fun" drill going
// into a tactical slot. So nothing is hidden by default — the like-for-like drills are
// sorted to the top instead, and the hard filter is an opt-in.
import { filterDrills } from "./drills.js";
import { fitsSquad } from "./sessions.js";

export const SORTS = [
  { key: "relevance", label: "Best match" },
  { key: "title", label: "Title" },
  { key: "minutes", label: "Shortest first" },
];

// A category match outranks any number of shared tags: a warm-up with three tags in
// common with the tactical drill you are replacing is still a warm-up. The tag weight
// only orders drills that are already equal on category.
const CATEGORY_SCORE = 100;
const TAG_SCORE = 10;

// Returns the DRILL's spelling of each shared tag, not the query's, so the component
// shows "Possession" if that is what the drill says.
export function sharedTags(drill, tags) {
  const want = new Set((tags ?? []).map((t) => String(t).toLowerCase()));
  if (!want.size) return [];
  return (drill?.tags ?? []).filter((t) => want.has(String(t).toLowerCase()));
}

export function scoreDrill(drill, { slot, tags } = {}) {
  let score = 0;
  if (slot && drill?.category === slot) score += CATEGORY_SCORE;
  return score + sharedTags(drill, tags).length * TAG_SCORE;
}

// A drill with no duration sorts LAST under "shortest first", never first. Number(null)
// is 0 and Number.isFinite(0) is true, so the obvious one-liner does the opposite.
const minutesOf = (drill) => {
  const raw = drill?.minutes;
  if (raw === null || raw === undefined || raw === "") return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Infinity;
};

// slot/tags describe what the slot WANTS (for scoring); query/sameCategoryOnly/turnout
// narrow what is offered at all; exclude drops the drill being replaced.
export function rankDrills(drills, options = {}) {
  const {
    slot = null, tags = [], turnout, query = "",
    sameCategoryOnly = false, exclude = null, sort = "relevance",
  } = options;

  const entries = filterDrills(drills, { query, category: sameCategoryOnly ? slot : null })
    .filter((d) => d.slug !== exclude)
    .filter((d) => fitsSquad(d, turnout))
    .map((drill) => ({
      drill,
      score: scoreDrill(drill, { slot, tags }),
      matched: sharedTags(drill, tags),
    }));

  const byTitle = (a, b) => String(a.drill.title).localeCompare(String(b.drill.title));
  if (sort === "title") return entries.sort(byTitle);
  if (sort === "minutes") {
    return entries.sort((a, b) => minutesOf(a.drill) - minutesOf(b.drill) || byTitle(a, b));
  }
  return entries.sort((a, b) => b.score - a.score || byTitle(a, b));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/picker.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/picker.js test/picker.test.js
git commit -m "feat: rank drill candidates by category then shared tags"
```

---

### Task 3: `src/components/DrillPicker.jsx`

Presentational and reusable: it is handed drills and reports a choice. It owns only view state (the search text, the chosen order, the category toggle) — never the session.

**Files:**
- Create: `src/components/DrillPicker.jsx`
- Modify: `src/styles.css`
- Test: `test/drillPicker.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `test/drillPicker.test.jsx`:

```jsx
// @vitest-environment jsdom
// DrillPicker is presentational: given drills and what the slot wants, it renders a
// ranked, searchable, reorderable list and reports the chosen drill. All of the ordering
// rules live in lib/picker.js and are tested there — these tests are about the controls.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import DrillPicker from "../src/components/DrillPicker.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const d = (slug, title, category, minutes, tags = [], players = null) =>
  ({ slug, title, category, minutes, tags, players });

const drills = [
  d("rondo", "Rondo 4v2", "skill", 12, ["possession", "rondo"]),
  d("hk", "High knees", "warmup", 6, ["mobility"]),
  d("ssg", "SSG 6v6", "match", 25, ["possession"], "12+"),
];

let container;
const mount = (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<DrillPicker drills={drills} {...props} />); });
  return root;
};

const options = () => [...container.querySelectorAll(".drill-picker-option")];
const titles = () => options().map((b) => b.querySelector(".block-title").textContent);
const setInput = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("DrillPicker", () => {
  it("offers every drill, best match first", () => {
    mount({ slot: "warmup" });
    expect(titles()[0]).toBe("High knees");
    expect(titles()).toHaveLength(3);
  });

  it("reports the chosen drill", () => {
    const onPick = vi.fn();
    mount({ slot: "warmup", onPick });
    act(() => { options()[0].click(); });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].slug).toBe("hk");
  });

  it("filters as you type", () => {
    mount({ slot: "warmup" });
    setInput(container.querySelector(".drill-picker-search"), "rondo");
    expect(titles()).toEqual(["Rondo 4v2"]);
  });

  it("reorders when a different order is chosen", () => {
    mount({ slot: "warmup" });
    const select = container.querySelector(".drill-picker-order select");
    act(() => {
      select.value = "minutes";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(titles()).toEqual(["High knees", "Rondo 4v2", "SSG 6v6"]);
  });

  it("can be narrowed to the slot's own category", () => {
    mount({ slot: "warmup" });
    const box = container.querySelector(".drill-picker-only input[type=checkbox]");
    act(() => { box.click(); });
    expect(titles()).toEqual(["High knees"]);
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    mount({ slot: "warmup" });
    setInput(container.querySelector(".drill-picker-search"), "zzzz");
    expect(options()).toHaveLength(0);
    expect(container.textContent).toMatch(/no drill/i);
  });

  it("marks the shared tags and the matching category, so the order is explicable", () => {
    mount({ slot: "skill", tags: ["possession"] });
    const first = options()[0];
    expect(first.querySelector(".block-title").textContent).toBe("Rondo 4v2");
    expect(first.textContent).toContain("possession");
    expect(first.querySelector(".drill-picker-category").className).toContain("ok-chip");
  });

  it("shows a drill with no duration as such rather than as 0′", () => {
    mount({ slot: "skill", drills: [d("x", "Bare", "skill", null)] });
    expect(options()[0].textContent).toMatch(/no duration/i);
    expect(options()[0].textContent).not.toContain("0′");
  });

  it("offers a way out when given one", () => {
    const onCancel = vi.fn();
    mount({ slot: "warmup", onCancel });
    [...container.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent)).click();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/drillPicker.test.jsx`
Expected: FAIL — cannot resolve `../src/components/DrillPicker.jsx`.

- [ ] **Step 3: Write the component**

Create `src/components/DrillPicker.jsx`:

```jsx
// src/components/DrillPicker.jsx
// Choose a drill for a slot. Presentational: it is handed the catalogue and what the
// slot wants, and reports the drill picked — it never touches a session or Drive.
//
// State here is only view state (search text, order, category toggle) and is deliberately
// NOT lifted: closing the picker and reopening it should start clean rather than remember
// last night's search.
import React, { useState } from "react";
import { rankDrills, SORTS } from "../lib/picker.js";

export default function DrillPicker({
  drills = [], slot = null, tags = [], turnout, exclude = null, onPick, onCancel,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [sameCategoryOnly, setSameCategoryOnly] = useState(false);

  const entries = rankDrills(drills, {
    slot, tags, turnout, query, exclude, sort, sameCategoryOnly,
  });

  return (
    <div className="drill-picker">
      <div className="row drill-picker-controls">
        <input
          type="search"
          className="drill-picker-search"
          value={query}
          placeholder="Search drills…"
          aria-label="Search drills"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="dim drill-picker-order">
          Order:{" "}
          <select value={sort} aria-label="Order" onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {slot ? (
          <label className="dim drill-picker-only">
            <input
              type="checkbox"
              checked={sameCategoryOnly}
              onChange={(e) => setSameCategoryOnly(e.target.checked)}
            />
            {" "}only {slot} drills
          </label>
        ) : null}
        {onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}
      </div>

      {entries.length === 0 ? (
        <p className="dim">
          No drill matches{query ? ` “${query}”` : ""}
          {sameCategoryOnly && slot ? ` in ${slot}` : ""}.
        </p>
      ) : (
        <ul className="drill-picker-list">
          {entries.map(({ drill, matched }) => (
            <li key={drill.slug}>
              <button
                type="button"
                className="drill-picker-option"
                onClick={() => onPick?.(drill)}
              >
                <span className="block-title">{drill.title}</span>
                <span
                  className={`chip drill-picker-category${drill.category === slot ? " ok-chip" : ""}`}
                >
                  {drill.category ?? "no category"}
                </span>
                <span className="chip">
                  {drill.minutes != null && drill.minutes !== "" ? `${drill.minutes}′` : "no duration"}
                </span>
                {drill.players ? <span className="chip dim">{drill.players}</span> : null}
                {matched.map((t) => <span key={t} className="chip ok-chip">{t}</span>)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `src/styles.css`, immediately before the existing `@media print` block in the run-view section:

```css
/* Choosing a drill, used mid-session to swap a block. The list scrolls inside itself
   rather than pushing the rest of the run view down: on a phone the controls above must
   stay put while you scan candidates with a thumb. */
.drill-picker { margin-top: 4px; }
.drill-picker-controls { flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.drill-picker-search {
  flex: 1 1 160px; min-width: 0; padding: 8px 10px; font: inherit;
  border: 1px solid var(--line); border-radius: 8px; background: var(--card);
}
.drill-picker-list {
  list-style: none; margin: 0; padding: 0;
  max-height: 46vh; overflow-y: auto;
  border: 1px solid var(--line); border-radius: 8px;
}
.drill-picker-list li + li { border-top: 1px solid var(--line); }
.drill-picker-option {
  width: 100%; background: none; border: none; border-radius: 0;
  padding: 10px 12px; text-align: left; cursor: pointer;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.drill-picker-option:hover, .drill-picker-option:focus-visible { background: var(--bg); }
```

And add one line inside the existing `@media print` block, beside `.run-controls button`:

```css
  .drill-picker { display: none; }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/drillPicker.test.jsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/DrillPicker.jsx src/styles.css test/drillPicker.test.jsx
git commit -m "feat: a searchable, reorderable drill picker"
```

---

### Task 4: `SessionRun` opens the picker

**Files:**
- Modify: `src/components/SessionRun.jsx`
- Test: `test/sessionRun.test.jsx`

Behaviour:
- When `onSwap` is given, an open block shows a **Swap** button in `.run-block-actions` — labelled "Choose a drill" when the block has none. Without `onSwap` nothing changes (the component stays usable read-only).
- Clicking it replaces the block's body with `DrillPicker`; the button becomes **Cancel swap**. Only one block can be picking at a time.
- Choosing a drill calls `onSwap(index, drill.slug)`, closes the picker, and **clears that block's mark** through `reopen`.
- The picker is told what the slot wants: `slot` = `block.slot`, `tags` = the current drill's tags, `exclude` = the current drill's slug, `turnout` = `session.turnout`.

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `test/sessionRun.test.jsx`. It uses the file's existing `session`, `drill`, `drillText` helpers; add a live-DOM mount helper if the file does not already have one (it has `render` for static markup and uses `createRoot` in its interactive tests — follow whichever local helper those tests use, and match their naming).

```jsx
describe("SessionRun swapping a drill", () => {
  const swapSession = () => session([
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ]);
  const swapDrills = () => [
    { ...drill("a", "Alpha", 10, "warmup"), tags: ["mobility"] },
    { ...drill("b", "Bravo", 10, "skill"), tags: [] },
    { ...drill("c", "Charlie", 5, "warmup"), tags: ["mobility"] },
  ];
  const texts = { a: { status: "ready", text: drillText("Alpha") }, b: { status: "ready", text: drillText("Bravo") } };

  it("offers Swap on the open block only when onSwap is given", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts });
    expect(findButton("Swap")).toBeUndefined();
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    expect(findButton("Swap")).toBeDefined();
  });

  it("labels it Choose a drill when the slot is empty", () => {
    const s = session([{ slot: "warmup", drill: null, minutes: null, note: "" }]);
    mount({ session: s, drills: swapDrills(), texts, onSwap: () => {} });
    expect(findButton("Choose a drill")).toBeDefined();
  });

  it("shows the picker in place of the drill body, and hides it again on cancel", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    expect(container.textContent).toContain("Coaching points here");
    act(() => { findButton("Swap").click(); });
    expect(container.querySelector(".drill-picker")).not.toBeNull();
    expect(container.textContent).not.toContain("Coaching points here");
    act(() => { findButton("Cancel swap").click(); });
    expect(container.querySelector(".drill-picker")).toBeNull();
    expect(container.textContent).toContain("Coaching points here");
  });

  it("does not offer the drill already in the block", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { findButton("Swap").click(); });
    const offered = [...container.querySelectorAll(".drill-picker-option .block-title")]
      .map((e) => e.textContent);
    expect(offered).not.toContain("Alpha");
    expect(offered).toContain("Charlie");
  });

  it("puts a like-for-like drill first: same category and a shared tag", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { findButton("Swap").click(); });
    const first = container.querySelector(".drill-picker-option .block-title").textContent;
    expect(first).toBe("Charlie"); // warmup + mobility, like Alpha; Bravo is a skill drill
  });

  it("reports the block index and the chosen slug, then closes the picker", () => {
    const onSwap = vi.fn();
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap });
    act(() => { findButton("Swap").click(); });
    act(() => { container.querySelector(".drill-picker-option").click(); });
    expect(onSwap).toHaveBeenCalledWith(0, "c");
    expect(container.querySelector(".drill-picker")).toBeNull();
  });

  it("clears the block's mark: a swapped drill was never done", () => {
    // Block 0 marked done, so block 1 is current. Peek block 0 open and swap its drill:
    // "Done" must go, and block 0 becomes current again.
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE });
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {}, today: "2026-08-13" });
    act(() => { container.querySelectorAll(".run-block-summary")[0].click(); });
    act(() => { findButton("Swap").click(); });
    act(() => { container.querySelector(".drill-picker-option").click(); });
    const first = container.querySelectorAll(".run-block")[0];
    expect(first.textContent).not.toContain("Done");
    expect(first.querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("only one block can be picking at a time", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { container.querySelectorAll(".run-block-summary")[1].click(); }); // peek block 1
    const swaps = () => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Swap");
    act(() => { swaps()[0].click(); });
    act(() => { swaps()[0].click(); }); // the remaining Swap belongs to the other block
    expect(container.querySelectorAll(".drill-picker")).toHaveLength(1);
  });
});
```

Note on the "Done" assertion: assert against the block's own `.run-block` element rather than the whole container, because the run header carries a "0 done · …" summary that contains the word.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/sessionRun.test.jsx`
Expected: FAIL — no Swap button.

- [ ] **Step 3: Wire the component**

In `src/components/SessionRun.jsx`:

Import the picker and `SLOTS`-free helpers:

```jsx
import DrillPicker from "./DrillPicker.jsx";
```

Extend `RunBlock`'s signature and body:

```jsx
function RunBlock({
  block, entry, today, isOpen, isCurrent, state,
  picking, canSwap, turnout, drills, onSwapToggle, onPick,
  onDone, onSkip, onReopen, onToggle,
}) {
```

and replace the `{isOpen ? …}` body with:

```jsx
      {isOpen ? (
        <>
          <div className="row run-block-actions">
            {!state ? (
              <>
                <button type="button" className="chip-button chip-button-ok" onClick={onDone}>Done</button>
                <button type="button" className="chip-button chip-button-warn" onClick={onSkip}>Skip</button>
              </>
            ) : null}
            {canSwap ? (
              <button type="button" className="chip-button" onClick={onSwapToggle}>
                {picking ? "Cancel swap" : block.drill ? "Swap" : "Choose a drill"}
              </button>
            ) : null}
          </div>
          {picking ? (
            <DrillPicker
              drills={drills}
              slot={block.slot}
              tags={block.drill?.tags ?? []}
              turnout={turnout}
              exclude={block.drill?.slug ?? null}
              onPick={onPick}
              onCancel={onSwapToggle}
            />
          ) : (
            <BlockContent block={block} entry={entry} today={today} />
          )}
        </>
      ) : null}
```

Note the actions row is now rendered whenever the block is open, so a settled block can still be swapped without un-marking it first. The `{!state ? …}` guard still keeps Done/Skip out of a settled block.

In `SessionRun` itself, add the picking state and the handler, and accept `onSwap`:

```jsx
export default function SessionRun({ session, drills = [], texts = {}, onBack, onSwap, today }) {
```

```jsx
  // Which block is choosing a replacement drill, or null. One at a time: two open
  // pickers on a phone is two scrolling lists competing for the same thumb.
  const [picking, setPicking] = useState(null);
```

```jsx
  // A swap replaces the work, so whatever was marked no longer refers to anything that
  // happened — clear it. App owns the write to the plan itself; this component only
  // reports the choice and cleans up tonight's progress for that block.
  const handlePick = (index, drill) => {
    setPicking(null);
    persist(reopen(marks, index));
    onSwap?.(index, drill.slug);
  };
```

and inside the `rows` map, pass:

```jsx
        picking={picking === index}
        canSwap={Boolean(onSwap)}
        turnout={Number.isFinite(session?.turnout) ? session.turnout : undefined}
        drills={drills}
        onSwapToggle={() => setPicking((cur) => (cur === index ? null : index))}
        onPick={(drill) => handlePick(index, drill)}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/sessionRun.test.jsx`
Expected: PASS — the new block plus every pre-existing test in the file.

Then: `npm test` — the whole suite, since `.run-block-actions` now renders for settled blocks too and an existing test may assert on it.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionRun.jsx test/sessionRun.test.jsx
git commit -m "feat: swap a block's drill from the run view"
```

---

### Task 5: `App` persists the swap and loads the new drill's text

**Files:**
- Modify: `src/App.jsx` (`openRun` at :352-391, plus new `fetchRunText` and `onRunSwap`)
- Modify: `src/components/Catalogue.jsx:29,62`
- Test: `test/app.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("App session run mode", …)` block in `test/app.test.jsx`. It needs a third drill in the catalogue, so override `loadCatalogue` inside the tests:

```jsx
  it("a swap writes the new drill into the plan and loads its text", async () => {
    drive.loadCatalogue.mockResolvedValue({
      drills: [drill("a", "Alpha"), drill("b", "Bravo"), drill("c", "Charlie")],
      failed: [], folderId: "F1", duplicateFolders: false, index: { version: 1, entries: {} },
    });
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      expect(drive.readDrill).toHaveBeenCalledTimes(2); // a and b

      await act(async () => { findButton("Swap").click(); });
      const charlie = [...container.querySelectorAll(".drill-picker-option")]
        .find((b) => b.textContent.includes("Charlie"));
      await act(async () => { charlie.click(); });

      // The swapped-in drill's text is fetched and shown — the run view had never
      // loaded it, since it was not in the plan when the view opened.
      expect(drive.readDrill).toHaveBeenCalledTimes(3);
      expect(container.textContent).toContain("body c");

      // And the change is a real edit to the plan, saved like any builder edit.
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      const saved = drive.saveSessions.mock.calls.at(-1)[0];
      expect(saved.data.sessions.s1.blocks[0].drill).toBe("c");
      expect(saved.data.sessions.s1.blocks[0].minutes).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a swap to a drill already loaded this visit does not refetch it", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2);
    // Block 0 (a) swaps to b, whose text is already in hand from this same visit.
    await act(async () => { findButton("Swap").click(); });
    const bravo = [...container.querySelectorAll(".drill-picker-option")]
      .find((b) => b.textContent.includes("Bravo"));
    await act(async () => { bravo.click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("body b");
  });
```

Check whether `openSession` exists as a helper in this file; if not, use the same click sequence the neighbouring run-mode tests use to reach the builder.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/app.test.jsx`
Expected: FAIL — no Swap button (App does not pass `onSwap` down).

- [ ] **Step 3: Extract the shared per-drill fetch**

In `src/App.jsx`, add above `openRun`:

```jsx
  // Slugs with a read in flight for the current run visit, so a swap away and back does
  // not fire a second identical request.
  const runFetching = useRef(new Set());

  // Fetches one drill's text into runTexts, tagged with the run-visit token so a reply
  // landing after the run view has been left is dropped. Shared by openRun's opening
  // batch and by a mid-session swap.
  const fetchRunText = useCallback((drill, token) => {
    runFetching.current.add(drill.slug);
    readDrill(drill.id, folderRef.current).then(
      ({ text }) => {
        const entry = { status: "ready", text };
        drillTextCache.current.set(drill.slug, entry);
        runFetching.current.delete(drill.slug);
        if (runRequestSeq.current !== token) return; // this run view has been left
        setRunTexts((prev) => ({ ...prev, [drill.slug]: entry }));
      },
      (error) => {
        // Deliberately not cached: a flaky read is ordinary on a phone at the side of a
        // pitch (same reasoning as loadCatalogue's per-drill failure), and the next
        // visit should try again rather than remembering the failure forever.
        runFetching.current.delete(drill.slug);
        if (runRequestSeq.current !== token) return;
        setRunTexts((prev) => ({ ...prev, [drill.slug]: { status: "error", error } }));
      },
    );
  }, []);
```

Replace `openRun`'s fetch loop (the whole `for (const drill of toFetch) { readDrill(…) }` block) with:

```jsx
    for (const drill of toFetch) fetchRunText(drill, mine);
```

and add `fetchRunText` to `openRun`'s dependency array.

- [ ] **Step 4: Add the swap handler**

Add after `openRun`:

```jsx
  // A mid-session swap is a real edit to the plan, not a run-only override: if ten
  // players turn up and the 11v11 becomes a 5v5, that is what the session WAS. So it
  // goes through onSessionChange like any builder edit and saves with the same debounce.
  // The block's own minutes are cleared so the new drill's duration applies rather than
  // the one it replaced.
  const onRunSwap = useCallback((index, slug) => {
    const sess = sessionsStateRef.current.data.sessions[runSessionId];
    if (!sess) return;
    onSessionChange(setBlock(sess, index, { drill: slug, minutes: null }));

    const drill = drills.find((d) => d.slug === slug);
    if (!drill) return;
    const cached = drillTextCache.current.get(drill.slug);
    if (cached) { setRunTexts((prev) => ({ ...prev, [drill.slug]: cached })); return; }
    if (runFetching.current.has(drill.slug)) return;
    setRunTexts((prev) => ({ ...prev, [drill.slug]: { status: "loading" } }));
    fetchRunText(drill, runRequestSeq.current);
  }, [runSessionId, drills, onSessionChange, fetchRunText]);
```

Import `setBlock` from `./lib/sessions.js` (line 11 currently imports `emptySession, resolveBlocks`).

Pass it to `Catalogue` beside `onRunBack`:

```jsx
        onRunSwap={onRunSwap}
```

- [ ] **Step 5: Thread it through Catalogue**

In `src/components/Catalogue.jsx`, add `onRunSwap` to the destructured props beside `onRunBack`, and pass it:

```jsx
    return <SessionRun session={runSession} drills={drills} texts={runTexts} onBack={onRunBack} onSwap={onRunSwap} />;
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: everything passes.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/Catalogue.jsx test/app.test.jsx
git commit -m "feat: persist a mid-session swap and load the new drill's text"
```

---

### Task 6: Look at it

Automated tests do not tell you whether a picker is usable with a thumb. Render the run view with a picker open, at phone width, and look.

**Files:**
- Create: a throwaway script under the scratchpad directory (not committed)

- [ ] **Step 1: Render it**

Write a script that mounts `SessionRun` with `onSwap` provided and the picker open on the current block (drive it by clicking `Swap`, the way the tests do), serialises the DOM with `src/styles.css` inlined, and screenshots it in headless Chrome at 390px wide. Follow whatever harness the repo already used for previous visual checks — ImageMagick is NOT a substitute, it ignores `fill-opacity`.

- [ ] **Step 2: View the screenshot**

Read the PNG. Check: the search box, order control and category toggle all fit without horizontal scrolling; each option is a comfortable tap target; the ranked order is visibly sensible; the NOW badge and the coloured edge are still readable with the picker open.

- [ ] **Step 3: Fix anything the render exposes, then re-render**

- [ ] **Step 4: Commit any fix**

---

## Deliberately not in this plan

- **Replacing the builder's `<select>` with `DrillPicker`.** The builder's picker is weaker — a plain select, category-restricted, unranked — and `DrillPicker` was written to be reusable there. But Sean asked for the swap, and changing the builder's picker is a separate, visible change to a screen that currently works. Offer it as the next step.
- **Swapping in a drill that does not exist yet.** Writing a new drill mid-session is the editor's job, and leaving the run view to write one loses your place.
- **Undoing a swap.** The old drill is one more swap away, and the plan is saved either way.
