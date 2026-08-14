# App Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app identifiable in a tab strip and navigable from anywhere, and make a session that is under way impossible to miss.

**Architecture:** A persistent header component owning the icon, the home link and the Drills/Sessions nav, replacing the mode switch that currently lives inside the browse view only. "Which session is under way" is a derivation, so it goes in `lib/progress.js` with tests, not in a component.

**Tech Stack:** React 18, Vitest 2, no new dependencies.

---

## The five things

From the owner, verbatim:
- an app icon — "a monotone soccer ball maybe.. how about in blue. Just to differentiate it from my other chrome tabs easier"
- "can we make the ballislife header be a link back to home"
- "can the drills and sessions links persist across all pages (so a menu attached to the header I guess)"
- "we can add our icon to the header too I think"
- "if a session is active can it get reflected on the sessions page — also maybe the sessions link - so if you're on another page it's ovbious that a session is active"

**What "active" means here.** A session is under way if at least one of its blocks is marked **for today** and at least one is still unmarked. A plan merely *dated* today is not active — nothing has happened yet — and one whose every block is settled is finished, not active. This is the state the owner is in when he is standing on a pitch halfway through, which is when a reminder is worth anything.

---

## File structure

| File | Responsibility |
|---|---|
| `public/icon.svg` (create) | The favicon. Vite serves `public/` at the configured base. |
| `index.html` (modify) | Icon links + theme colour. |
| `src/components/BallIcon.jsx` (create) | The same mark as an inline SVG for the header, so it costs no request and takes `currentColor`. |
| `src/components/Header.jsx` (create) | Icon, home link, Drills/Sessions nav, active-session dot, version. |
| `src/App.jsx` (modify) | Render `Header`; compute the active session ids. |
| `src/components/Catalogue.jsx` (modify) | Drop the mode switch it renders in the browse branch — the header owns it now. |
| `src/components/SessionList.jsx` (modify) | Mark the row of a session that is under way. |
| `src/lib/progress.js` (modify) | `activeSessionIds(sessions, day, storage)`. |
| `src/styles.css` (modify) | Header, nav and active-dot rules. |
| Tests | `test/progress.test.js`, `test/header.test.jsx` (create), `test/sessionList.test.jsx`, `test/catalogue.test.jsx`, `test/app.test.jsx`. |

---

### Task 1: `activeSessionIds`

Pure but for the storage object handed in, exactly like the rest of `progress.js`. **This composition was prototyped and every assertion below verified against a working implementation** — if a test fails, suspect the implementation.

**Files:**
- Modify: `src/lib/progress.js`
- Test: `test/progress.test.js`

- [ ] **Step 1: Write the failing tests**

Use the file's existing storage double. `writeProgress`, `DONE`, `SKIPPED` are already imported there; add `activeSessionIds`.

```js
describe("activeSessionIds", () => {
  const DAY = "2026-08-14";
  const at = (t) => `${DAY}T${t}:00.000Z`;
  const B = (...slots) => slots.map((slot) => ({ slot }));
  const S = (id, blocks, progress) => ({ id, date: id, blocks, progress });
  const twoBlocks = () => B("warmup", "skill");

  it("a plan with nothing marked is not under way — being dated today is not enough", () => {
    expect(activeSessionIds([S("a", twoBlocks())], DAY, fakeStorage())).toEqual([]);
  });

  it("one block marked and one still to go is under way", () => {
    const store = fakeStorage();
    writeProgress(store, "a", DAY, { warmup: DONE }, at("19:00"));
    expect(activeSessionIds([S("a", twoBlocks())], DAY, store)).toEqual(["a"]);
  });

  it("every block settled is finished, not under way", () => {
    const store = fakeStorage();
    writeProgress(store, "a", DAY, { warmup: DONE, skill: SKIPPED }, at("19:00"));
    expect(activeSessionIds([S("a", twoBlocks())], DAY, store)).toEqual([]);
  });

  it("counts marks made on another device, from the session file", () => {
    const progress = { [DAY]: { marks: { warmup: DONE }, updatedAt: at("19:00") } };
    expect(activeSessionIds([S("a", twoBlocks(), progress)], DAY, fakeStorage())).toEqual(["a"]);
  });

  it("ignores another day's marks", () => {
    const progress = { "2026-08-13": { marks: { warmup: DONE }, updatedAt: "2026-08-13T19:00:00.000Z" } };
    expect(activeSessionIds([S("a", twoBlocks(), progress)], DAY, fakeStorage())).toEqual([]);
  });

  it("respects a clear made later on this device", () => {
    // Start over on the phone must stop the app claiming the session is still running.
    const store = fakeStorage();
    writeProgress(store, "a", DAY, {}, at("20:00"));
    const progress = { [DAY]: { marks: { warmup: DONE }, updatedAt: at("19:00") } };
    expect(activeSessionIds([S("a", twoBlocks(), progress)], DAY, store)).toEqual([]);
  });

  it("counts index-keyed marks left by an older version", () => {
    const store = fakeStorage();
    writeProgress(store, "a", DAY, { 0: DONE }, at("19:00"));
    expect(activeSessionIds([S("a", twoBlocks())], DAY, store)).toEqual(["a"]);
  });

  it("names only the plans actually under way", () => {
    const store = fakeStorage();
    writeProgress(store, "b", DAY, { warmup: DONE }, at("19:00"));
    expect(activeSessionIds([S("a", twoBlocks()), S("b", twoBlocks())], DAY, store)).toEqual(["b"]);
  });

  it("a plan with no blocks is never under way, and junk input is survivable", () => {
    const store = fakeStorage();
    writeProgress(store, "a", DAY, { warmup: DONE }, at("19:00"));
    expect(activeSessionIds([S("a", [])], DAY, store)).toEqual([]);
    expect(activeSessionIds(undefined, DAY, store)).toEqual([]);
    expect(activeSessionIds([undefined, null], DAY, store)).toEqual([]);
    expect(activeSessionIds([S("a", twoBlocks())], DAY, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/progress.test.js` — `activeSessionIds` is not exported.

- [ ] **Step 3: Implement**

```js
// Which plans are mid-run today: at least one block marked, at least one still to go. A
// plan merely DATED today is not under way (nothing has happened yet) and one whose every
// block is settled is finished, not under way.
//
// Reads the whole local store ONCE rather than per session: localStorage keeps only
// today's entry, but the session file's copy has to be checked for every plan, and this
// runs on every render of the header.
export function activeSessionIds(sessions, day, storage) {
  const store = readAll(storage);
  const active = [];
  for (const session of sessions ?? []) {
    const blocks = session?.blocks ?? [];
    if (!blocks.length) continue;
    const entry = store[session?.id];
    const local = entry && entry.date === day
      ? { marks: cleanMarks(entry.marks), updatedAt: cleanStamp(entry.updatedAt) }
      : null;
    const winner = mergeProgress(local, sessionProgress(session, day));
    const marks = migrateMarks(winner.marks, blocks);
    if (Object.keys(marks).length && currentIndex(marks, blocks) !== -1) {
      active.push(session.id);
    }
  }
  return active;
}
```

Place it after `currentIndex`/`counts`, which it uses.

- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: which sessions are under way today"`

---

### Task 2: the icon

**Files:**
- Create: `public/icon.svg`
- Create: `src/components/BallIcon.jsx`
- Modify: `index.html`
- Test: `test/header.test.jsx` (created in Task 3 — if you do this task first, put the icon test in a small file of its own and merge it there, or do Task 3 first)

The mark was designed and checked at 16px, 20px, 32px and 64px against both a light and a dark tab strip. **Use it exactly as given** — earlier candidates with thinner spokes or more patches turned to mush at 16px, which is the size that matters:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="#1d4ed8"/>
  <polygon points="32,19 44,27.7 39.4,41.8 24.6,41.8 20,27.7" fill="#fff"/>
  <g stroke="#fff" stroke-width="6" stroke-linecap="round">
    <path d="M32 19 V8"/><path d="M44 27.7 L54.5 24.3"/><path d="M39.4 41.8 L45.9 50.7"/>
    <path d="M24.6 41.8 L18.1 50.7"/><path d="M20 27.7 L9.5 24.3"/>
  </g>
</svg>
```

- [ ] **Step 1: Add `public/icon.svg`** with exactly that content. Vite serves `public/` at the base (`/ballislife/`), so it ships as `/ballislife/icon.svg`.

- [ ] **Step 2: Link it in `index.html`**

```html
  <link rel="icon" href="./icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="./icon.svg" />
  <meta name="theme-color" content="#1d4ed8" />
```

Relative hrefs, so they resolve under the `/ballislife/` base on Pages. Verify after `npm run build` that `dist/index.html` still points at a path that exists in `dist/`.

- [ ] **Step 3: `src/components/BallIcon.jsx`** — the same geometry inline, so the header costs no extra request and the mark can inherit colour:

```jsx
// src/components/BallIcon.jsx
// The app's mark, inline so the header costs no request and the ball can take the colour
// of whatever it sits in. The same geometry as public/icon.svg, which cannot import this
// because a favicon has to be a file — keep the two in step by hand if the mark changes.
//
// Deliberately few shapes: at 16px in a tab strip anything more detailed turns to mush,
// and being told apart from the other tabs is the whole job.
import React from "react";

export default function BallIcon({ size = 24, className = "" }) {
  return (
    <svg
      className={`ball-icon ${className}`.trim()}
      width={size} height={size} viewBox="0 0 64 64"
      role="img" aria-label="ballislife"
    >
      <circle cx="32" cy="32" r="30" fill="currentColor" />
      <polygon points="32,19 44,27.7 39.4,41.8 24.6,41.8 20,27.7" fill="var(--panel)" />
      <g stroke="var(--panel)" strokeWidth="6" strokeLinecap="round">
        <path d="M32 19 V8" /><path d="M44 27.7 L54.5 24.3" /><path d="M39.4 41.8 L45.9 50.7" />
        <path d="M24.6 41.8 L18.1 50.7" /><path d="M20 27.7 L9.5 24.3" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 4: Commit** — `git commit -m "feat: an app icon, so the tab is findable"`

---

### Task 3: the header

**Files:**
- Create: `src/components/Header.jsx`
- Modify: `src/App.jsx`, `src/components/Catalogue.jsx`, `src/styles.css`
- Test: `test/header.test.jsx` (create), `test/catalogue.test.jsx`, `test/app.test.jsx`

Today `App.jsx` renders a bare `<h1>ballislife</h1>` and a version span, and `Catalogue.jsx` renders the Drills/Sessions chips **only in the browse branch** — so they vanish inside a drill, the editor, the builder and the run view. Move them into a header that is always on screen.

Behaviour:
- The icon and the word "ballislife" are one control that goes home (the browse view).
- Drills / Sessions are always present, the current one marked `active` (the existing `.chip-button.active` style).
- When a session is under way, the Sessions control carries a dot; its accessible name says so, so it is not colour-alone.
- The version stays, it is the owner's cache tell.
- `Header` is presentational: it takes `mode`, `onModeChange`, `onHome`, `activeCount`, `version`.

- [ ] **Step 1: Write the failing tests**

Create `test/header.test.jsx`:

```jsx
// @vitest-environment jsdom
// The header is the only chrome that is on screen everywhere, so it is the only place a
// session that is under way can be advertised from.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import Header from "../src/components/Header.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
const mount = (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { createRoot(container).render(<Header version="1.2.3" {...props} />); });
};
const button = (re) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent));

describe("Header", () => {
  it("shows the mark, the name and the version", () => {
    mount();
    expect(container.querySelector("svg.ball-icon")).not.toBeNull();
    expect(container.textContent).toContain("ballislife");
    expect(container.textContent).toContain("1.2.3");
  });

  it("the name is the way home", () => {
    const onHome = vi.fn();
    mount({ onHome });
    act(() => { button(/ballislife/).click(); });
    expect(onHome).toHaveBeenCalled();
  });

  it("offers both sections wherever it is, and marks the current one", () => {
    mount({ mode: "sessions" });
    expect(button(/Drills/)).toBeDefined();
    expect(button(/Sessions/).className).toContain("active");
    expect(button(/Drills/).className).not.toContain("active");
  });

  it("switches section", () => {
    const onModeChange = vi.fn();
    mount({ mode: "drills", onModeChange });
    act(() => { button(/Sessions/).click(); });
    expect(onModeChange).toHaveBeenCalledWith("sessions");
  });

  it("says a session is under way, in words as well as with a dot", () => {
    mount({ activeCount: 1 });
    const sessions = button(/Sessions/);
    expect(sessions.querySelector(".nav-dot")).not.toBeNull();
    // Colour alone would not survive a glance in bright sun, let alone a screen reader.
    expect(sessions.getAttribute("aria-label")).toMatch(/under way|in progress/i);
  });

  it("says nothing when no session is under way", () => {
    mount({ activeCount: 0 });
    expect(button(/Sessions/).querySelector(".nav-dot")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Write `src/components/Header.jsx`**

```jsx
// src/components/Header.jsx
// The only chrome on screen everywhere: the way home, the two sections, and whether a
// session is under way. The section links used to live inside the browse view, so they
// disappeared exactly when they were most useful — inside a drill, mid-edit, mid-session.
import React from "react";
import BallIcon from "./BallIcon.jsx";

export default function Header({ mode = "drills", onModeChange, onHome, activeCount = 0, version }) {
  const running = activeCount > 0;
  return (
    <header className="app-header">
      <button type="button" className="app-home" onClick={onHome}>
        <BallIcon size={26} />
        <span className="app-name">ballislife</span>
      </button>

      <nav className="row app-nav">
        <button
          type="button"
          className={`chip-button${mode !== "sessions" ? " active" : ""}`}
          onClick={() => onModeChange?.("drills")}
        >
          Drills
        </button>
        <button
          type="button"
          className={`chip-button${mode === "sessions" ? " active" : ""}`}
          onClick={() => onModeChange?.("sessions")}
          aria-label={running ? "Sessions — a session is under way" : "Sessions"}
        >
          Sessions
          {running ? <span className="nav-dot" aria-hidden="true" /> : null}
        </button>
      </nav>

      <span className="dim app-version">v{version}</span>
    </header>
  );
}
```

- [ ] **Step 4: Wire it in `src/App.jsx`**

Replace the `<div className="row">…<h1>…</h1>…</div>` block with:

```jsx
      <Header
        mode={mode}
        onModeChange={onModeChange}
        onHome={goBrowse}
        activeCount={activeSessionIds(sessionsList, todayIso(), storage()).length}
        version={__APP_VERSION__}
      />
```

`goBrowse` already exists (it is `Catalogue`'s `onBack`). Check what it does: home must leave the editor, the builder and the run view, not just clear `selected` — if it does not, use the same path `onModeChange("drills")` takes. Say which you used and why.

For the day and the storage object, follow what `SessionRun` already does (`today ?? new Date().toISOString().slice(0, 10)`, and the `storage()` helper); if that means lifting a two-line helper into a shared place rather than copying it, do that.

- [ ] **Step 5: Remove the switch from `Catalogue.jsx`**

Delete the `<div className="row">` holding the Drills/Sessions chips from the browse branch. Leave `mode` in Catalogue's props — it still decides which view to render. Update `test/catalogue.test.jsx` if it asserts on those buttons: the assertion belongs to the header now, so move it rather than deleting it.

Check `test/app.test.jsx` for tests that find the Drills/Sessions buttons by text — they should still pass (the buttons still exist, just higher up), but a test that counts buttons or scopes to a container may need adjusting. Do not weaken any.

- [ ] **Step 6: Styles**

Add to `src/styles.css`:

```css
/* The only chrome on every screen. Wraps rather than scrolls: at 360px the version drops
   under the nav instead of pushing it off the edge. */
.app-header {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 10px 0 12px;
}
.app-home {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  background: none; border: none; padding: 4px 0; color: var(--accent);
}
.app-name { font-size: 20px; font-weight: 700; color: var(--text); }
.app-nav { flex: 1; }
.app-version { margin-left: auto; }
/* A session under way, said twice: the dot catches the eye, the button's aria-label says
   it in words. Colour alone is no use in bright sun at the side of a pitch. */
.nav-dot {
  display: inline-block; width: 8px; height: 8px; margin-left: 6px; border-radius: 50%;
  background: var(--accent); vertical-align: 1px;
  animation: nav-dot-pulse 1.8s ease-in-out infinite;
}
.chip-button.active .nav-dot { background: #fff; }
@keyframes nav-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .nav-dot { animation: none; } }
@media print { .app-header { display: none; } }
```

- [ ] **Step 7: Run the whole suite and the build**
- [ ] **Step 8: Commit** — `git commit -m "feat: a header that is on every page"`

---

### Task 4: a session under way on the sessions page

**Files:**
- Modify: `src/components/SessionList.jsx`, `src/styles.css`
- Test: `test/sessionList.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `test/sessionList.test.jsx`, using its existing helpers:

```jsx
  it("marks the plan that is under way, and offers to resume rather than start it", () => {
    render({ sessions: [session("2026-08-14"), session("2026-08-13")], activeIds: ["2026-08-14"] });
    const rows = container.querySelectorAll(".session-row-wrap");
    expect(rows[0].className).toContain("session-row-active");
    expect(rows[0].textContent).toMatch(/under way/i);
    expect(rows[0].textContent).toContain("Resume");
    // The other plan is untouched.
    expect(rows[1].className).not.toContain("session-row-active");
    expect(rows[1].textContent).toContain("Run this session");
  });

  it("marks nothing when no plan is under way", () => {
    render({ sessions: [session("2026-08-14")] });
    expect(container.querySelector(".session-row-active")).toBeNull();
  });
```

Match the file's real render helper and `session` fixture.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

`SessionList` takes `activeIds = []`; `SessionRow` takes `active`. When active: add `session-row-active` to the wrapper, show an "under way" chip beside the date, and label the run control "Resume" instead of "Run this session".

- [ ] **Step 4: Pass `activeIds` through** — `App.jsx` already computes the ids for the header; hand the same array to `Catalogue`, which passes it to `SessionList`. Compute it once in `App` and pass it to both.

- [ ] **Step 5: Style**

```css
/* The plan you are in the middle of, found at a glance among a year of them. */
.session-row-active .session-row { border-color: var(--accent); border-left-width: 4px; }
```

- [ ] **Step 6: Run the suite and the build**
- [ ] **Step 7: Commit** — `git commit -m "feat: the plan under way is marked on the sessions page"`

---

### Task 5: Look at it

**Files:** a throwaway script under the scratchpad directory, not committed.

- [ ] **Step 1** Render, at 390px wide and at ~1100px, with headless Chrome: the browse view, a drill open, the session list with one session under way, and the run view. Inline `src/styles.css`. Confirm: the header does not wrap badly at 390px; the nav is reachable from every screen; the dot is visible without being garish; the icon reads at 26px next to the name.
- [ ] **Step 2** View the screenshots and fix whatever they expose.
- [ ] **Step 3** Commit any fix.

---

## Deliberately not in this plan

- **A PNG favicon fallback.** Every browser this is used from supports SVG favicons; a PNG means a second file to keep in step for a case that does not arise.
- **A full web app manifest / installability.** The owner asked for a tab icon, not an installed app. `apple-touch-icon` and `theme-color` are the cheap parts of that and are included.
- **Showing which drill the active session is on** in the header. The dot answers "is something running"; the answer to "what next" is one tap away and is the run view's whole job.
