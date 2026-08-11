# ballislife Run-the-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take a planned session to the pitch — one scrollable page, block by block, each with its diagram and coaching points — and tick off `- [ ]` items in a drill as you set up.

**Architecture:** Tick state is a **pure module in `src/lib/checklist.js`**, stored locally and keyed by drill and day. Ticks are never written back into the drill markdown. The run view is a presentational component over the existing session model.

**Tech Stack:** React 18, Vite 5, Vitest 2. No new dependencies.

**Previous plans:** foundation, drive-layer, browse, editor, sessions — all complete, deployed at v0.4.0, and now **in real use with real drills and a real session**.

---

## Environment

```bash
node -v   # must be v20; if v14: export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

**`grep` is broken in this sandbox** — it exits 1 with no output even for strings that are present. Use the Grep tool or node.

Work from `/home/sean/workspace/ballislife`. **First create a branch: `git checkout -b run-session`.** Do not commit to `main`.

---

## What already exists

`npm test` is **370 passing across 27 files**.

| Module | Exports you will use |
| --- | --- |
| `lib/sessions.js` | `SLOTS`, `resolveBlocks`, `totalMinutes`, `emptySlots` |
| `lib/prose.js` | `renderProse(markdown, win)` — marked + DOMPurify |
| `lib/drive.js` | `readDrill(id, folder)`, `loadSessions`, `saveSessions` |
| `lib/route.js` | `parseHash`, `formatHash` — already handles `#/sessions` and `#/session/<id>` |
| `components/DrillPreview.jsx` | `<DrillPreview source />` |
| `components/SessionBuilder.jsx`, `SessionList.jsx` | the planning UI |

---

## Two decisions, and why

**1. A tick is about tonight, not about the drill.** `- [ ] cones out` is in the drill
because you do it every time you run that drill. If ticking wrote `- [x]` back to the
markdown, next season's session would start with everything already ticked and the
checklist would be worthless. So ticks live in `localStorage`, keyed by drill **and
today's date**, and clear themselves at the next session without anyone clearing them.
They survive a reload — a phone locking mid-setup must not lose them — but never reach
Drive.

**2. The run view fetches each drill's full text.** The session builder works from the
cached index, which holds only frontmatter and the first diagram. Running a session needs
the whole drill: every diagram, the coaching points, the checklists. So the run view loads
each referenced drill once and shows progress while it does.

---

## Task 1: The tick store

**Files:**
- Create: `src/lib/checklist.js`
- Test: `test/checklist.test.js`

**This code is verified** — I prototyped it and ran all 10 assertions before writing this
task, including corrupt storage, absent storage, and old-day eviction.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { readStore, readTicks, writeTicks, toggle } from "../src/lib/checklist.js";

const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

describe("readTicks / writeTicks", () => {
  it("starts empty and round-trips what was written", () => {
    const s = fakeStorage();
    expect(readTicks(s, "a", "2026-08-11").size).toBe(0);
    writeTicks(s, "a", "2026-08-11", new Set([0, 2]));
    expect([...readTicks(s, "a", "2026-08-11")]).toEqual([0, 2]);
  });

  it("clears itself on a new day", () => {
    // The point of keying by day: last week's ticks must not greet you at the next
    // session, and nobody should have to clear them by hand.
    const s = fakeStorage();
    writeTicks(s, "a", "2026-08-11", new Set([0]));
    expect(readTicks(s, "a", "2026-08-12").size).toBe(0);
  });

  it("keeps drills separate", () => {
    const s = fakeStorage();
    writeTicks(s, "a", "d", new Set([0, 1]));
    writeTicks(s, "b", "d", new Set([1]));
    expect(readTicks(s, "a", "d").size).toBe(2);
    expect(readTicks(s, "b", "d").size).toBe(1);
  });

  it("removes an entry once everything is unticked", () => {
    const s = fakeStorage();
    writeTicks(s, "a", "d", new Set([0]));
    writeTicks(s, "a", "d", new Set());
    expect(readStore(s).a).toBeUndefined();
  });

  it("evicts other days when it writes, so it cannot grow without bound", () => {
    const s = fakeStorage();
    writeTicks(s, "old", "2026-08-01", new Set([0]));
    writeTicks(s, "new", "2026-08-11", new Set([0]));
    expect(Object.keys(readStore(s))).toEqual(["new"]);
  });

  it("ignores indices that are not sane", () => {
    const s = fakeStorage();
    writeTicks(s, "a", "d", new Set([1, -1, "x", 2.5]));
    expect([...readTicks(s, "a", "d")]).toEqual([1]);
  });
});

describe("robustness", () => {
  it("survives corrupt storage", () => {
    const s = fakeStorage();
    s.setItem("ballislife_ticks", "{{{ not json");
    expect(readTicks(s, "a", "d").size).toBe(0);
  });

  it("survives storage being absent or refusing writes", () => {
    // Private browsing throws on setItem. Losing ticks is acceptable; crashing is not.
    expect(readTicks(null, "a", "d").size).toBe(0);
    expect(() => writeTicks(null, "a", "d", new Set([1]))).not.toThrow();
    const throwing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeTicks(throwing, "a", "d", new Set([1]))).not.toThrow();
  });
});

describe("toggle", () => {
  it("adds and removes", () => {
    expect([...toggle(new Set([1]), 2)]).toEqual([1, 2]);
    expect([...toggle(new Set([1, 2]), 1)]).toEqual([2]);
  });

  it("does not mutate the set it was given", () => {
    const original = new Set([1]);
    toggle(original, 2);
    expect([...original]).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run test/checklist.test.js
```

- [ ] **Step 3: Write the implementation**

```js
// src/lib/checklist.js
// Which checklist items are ticked, kept locally and keyed by drill AND day.
//
// Ticks are deliberately NOT written back into the drill markdown. A drill is reused
// every season, so `- [ ] cones out` describes what you do each time you run it — writing
// `- [x]` would mean next season's session started with everything already ticked and the
// checklist was worthless. Keying by day also means the boxes clear themselves before the
// next session without anyone clearing them.
const KEY = "ballislife_ticks";

export function readStore(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function readTicks(storage, slug, today) {
  const entry = readStore(storage)[slug];
  if (!entry || entry.date !== today) return new Set();
  return new Set(Array.isArray(entry.ticked) ? entry.ticked : []);
}

export function writeTicks(storage, slug, today, ticked) {
  const store = readStore(storage);
  const list = [...ticked].filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => a - b);
  if (list.length === 0) delete store[slug];
  else store[slug] = { date: today, ticked: list };
  for (const [k, v] of Object.entries(store)) if (v?.date !== today) delete store[k];
  try {
    storage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private browsing refuses writes. Losing ticks is acceptable; crashing is not.
  }
  return store;
}

export function toggle(ticked, index) {
  const next = new Set(ticked);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}
```

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run test/checklist.test.js    # expect 10 passed
git add src/lib/checklist.js test/checklist.test.js
git commit -m "feat: local per-day tick state for drill checklists"
```

---

## Task 2: Make the checkboxes tickable

**Files:**
- Modify: `src/lib/prose.js`, `test/prose.test.js`

`marked` already turns `- [ ] item` into `<input disabled="" type="checkbox">`, and
DOMPurify keeps it — verified. It arrives **disabled**, so it renders un-tickable. This
adds an opt-in that removes `disabled` and numbers each box so a click can be traced back
to which item it was.

- [ ] **Step 1: Write the failing tests**

Append to `test/prose.test.js`:

```js
describe("interactive checklists", () => {
  const md = "- [ ] cones\n- [x] bibs\n- [ ] balls\n";

  it("renders task items as disabled checkboxes by default", () => {
    const html = renderProse(md);
    expect(html).toContain("disabled");
    expect(html).not.toContain("data-tick");
  });

  it("removes disabled and numbers each box when asked", () => {
    const html = renderProse(md, { interactive: true });
    expect(html).not.toContain("disabled");
    expect(html).toContain('data-tick="0"');
    expect(html).toContain('data-tick="1"');
    expect(html).toContain('data-tick="2"');
  });

  it("numbers boxes in document order across separate lists", () => {
    const html = renderProse("- [ ] a\n\ntext\n\n- [ ] b\n", { interactive: true });
    expect(html.indexOf('data-tick="0"')).toBeLessThan(html.indexOf('data-tick="1"'));
  });

  it("leaves prose with no checkboxes untouched", () => {
    expect(renderProse("just words", { interactive: true })).toBe(renderProse("just words"));
  });

  it("still sanitises when interactive", () => {
    const html = renderProse("- [ ] ok <script>alert(1)</script>", { interactive: true });
    expect(html).not.toContain("<script");
  });
});
```

- [ ] **Step 2: Write the implementation**

Change `renderProse` to take an options object as its second argument while keeping the
existing `win` escape hatch, and post-process **after** sanitising:

```js
export function renderProse(markdown, options = {}) {
  // The old second parameter was a window, but nothing ever passed one — every call site
  // relies on globalThis.window — so it becomes a named option rather than a positional
  // one, with no compatibility shim to maintain.
  const { interactive = false, win } = options;

  const html = marked.parse(String(markdown ?? ""), { async: false });
  const clean = purifier(win).sanitize(html);
  return interactive ? makeTickable(clean) : clean;
}

// Runs AFTER sanitising, and only removes an attribute and adds a data- one, so it
// cannot reintroduce anything DOMPurify stripped.
function makeTickable(html) {
  let n = 0;
  return html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/g, (match, before, after) => {
    const attrs = `${before}${after}`.replace(/\sdisabled(?:=""|='')?/g, "");
    return `<input${attrs} type="checkbox" data-tick="${n++}">`;
  });
}
```

I checked every call site before writing this: only `DrillPreview` calls `renderProse`, and
it passes one argument. The `win` parameter has never been used by anything, so changing it
from positional to a named option needs no compatibility shim. Update `prose.js`'s header
comment to match.

**Known limitation, recorded not fixed:** `makeTickable` matches any
`<input type="checkbox">` in the sanitised HTML, so a checkbox a coach typed literally in
prose would also become tickable. Verified: a checkbox inside a fenced code block is safe,
because marked escapes code content so the regex never sees a tag. A stray box is
self-consistent — it occupies a stable index — so it costs a pointless tick affordance,
not misaligned ticks. Not worth distinguishing generated from hand-written boxes for that.

- [ ] **Step 3: Run the whole suite** — the existing `prose` and `drillPreview` tests must
  still pass, since the default behaviour is unchanged. Commit.

---

## Task 3: Tick them in the drill view

**Files:**
- Modify: `src/components/DrillPreview.jsx`, `test/drillPreview.test.jsx`
- Modify: `src/components/DrillView.jsx`, `test/drillView.test.jsx`

- [ ] `DrillPreview` gains `interactive` (default `false`) and, when set, `slug` and
  `today`. When interactive it renders prose with `{ interactive: true }`, reads ticks from
  `lib/checklist.js`, applies them to the rendered inputs after mount via a ref, and
  toggles on change using the `data-tick` index — writing back through `writeTicks`.

- [ ] Use a **delegated** listener on the container rather than one per checkbox: the HTML
  is injected, so there are no React elements to attach to.

- [ ] `DrillView` passes `interactive`, the drill's `slug`, and today's date.

- [ ] Tests: interactive rendering has no `disabled` and has `data-tick`; the default is
  unchanged; a drill with no checkboxes is unaffected. Interaction itself needs
  `react-dom/client` under jsdom, as in `test/app.test.jsx` — cover: clicking a box records
  the tick, clicking again clears it, and reopening the drill the same day restores it.

- [ ] Commit as `feat: tick off checklist items in a drill`.

---

## Task 4: The run view

**Files:**
- Create: `src/components/SessionRun.jsx`
- Test: `test/sessionRun.test.jsx`

One page for a session: the header (date, squad, total), then each block in order —
slot, drill title, duration, and the drill's **full** rendered content including every
diagram and its checklists.

- [ ] Required behaviour, each a test:
  - renders a section per block, in plan order, labelled with its slot
  - shows the drill title and the block's duration
  - shows the drill's full text, not just the thumbnail — the diagram is present
  - a block with no drill chosen says so rather than rendering an empty section
  - a broken reference says the drill is missing, naming the slug
  - shows a running "so far" time beside each block, so you can tell if you are behind
  - shows loading state while the drills are being fetched
  - a drill that fails to load says so for that block only, leaving the rest usable
  - offers a way back to the plan
  - checklists inside a drill are tickable

- [ ] Add a print stylesheet (`@media print`) that hides the controls and avoids breaking
  a block across pages (`break-inside: avoid`), so the plan can be carried on paper.

- [ ] Commit as `feat: run a session block by block`.

---

## Task 5: Wire it up

**Files:**
- Modify: `src/lib/route.js`, `test/route.test.js`, `src/components/Catalogue.jsx`, `test/catalogue.test.jsx`, `src/App.jsx`, `test/app.test.jsx`

- [ ] Add `#/session/<id>/run` to routing, alongside the existing session routes, with
  round-trip tests.
- [ ] A "Run this session" control on the builder, and one on each row of the session list.
- [ ] `App` fetches each referenced drill's text when the run view opens — **once per
  drill**, in parallel, reusing the stale-request guard pattern already in `openDrill` so a
  late response cannot land in a view you have left. Cache within the session so going back
  and forth does not refetch.
- [ ] Commit as `feat: open a session in run mode`.

---

## Task 6: Look at it

- [ ] Render the run view at 1100px and 390px with a full session, one with an empty slot
  and one with a broken reference. Screenshot both widths.
- [ ] Judge as a coach mid-session: can you find where you are at a glance? Are the
  diagrams big enough to read at arm's length? Are the checkboxes big enough to tap with a
  cold finger? Is the running time visible without hunting?
- [ ] Also render with `--headless` print emulation if practical, or at least confirm the
  print rules exist. Report concrete defects; delete throwaway files.

---

## Task 7: Manual verification — Sean's

- [ ] Open one of your real sessions in run mode on your phone. Can you follow it?
- [ ] Tick some setup items in a drill. Lock the phone, reopen — the ticks are still there.
- [ ] Reload the page — still there.
- [ ] Check the drill in Drive: it still says `- [ ]`, **not** `- [x]`. This is the one that
  matters; a tick must never change the drill.
- [ ] Come back tomorrow: the boxes are clear again.
- [ ] Print or "Save as PDF" a session and confirm it is usable on paper.

---

## Done when

- A session opens in run mode, block by block, with full drills and diagrams
- Checklists tick, survive a reload, and clear the next day
- A tick never modifies the drill in Drive
- `npm test` passes, `npm run build` clean, Sean has run Task 7

## Still not built

Drag-and-drop reordering, attendance and squads, visual diagram editing, offline support,
renaming — all recorded in the spec with their reasons.
