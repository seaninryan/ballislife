# ballislife Foundation & Pitch Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ballislife project scaffold and the complete `pitch` diagram language — parser, serialiser, geometry, and renderer — ending with a local page that renders a drill's markdown as a live pitch diagram with inline parse errors.

**Architecture:** Client-only React + Vite app, no server. All domain logic lives in pure, unit-tested functions in `src/lib/`; components in `src/components/` only wire state and render. The `pitch` language parses to a plain scene model, which serialises back to canonical text, which is what makes a future drag-to-edit canvas possible without changing stored files. This plan touches no network code — Google Drive storage is Plan 2.

**Tech Stack:** React 18, Vite 5, Vitest 2 (node environment, no jsdom), js-yaml. Node 20.

**Spec:** `docs/superpowers/specs/2026-08-10-ballislife-design.md`

---

## Environment

Before running any command, confirm Node 20:

```bash
node -v
```

Expected: `v20.20.2`. If it reports `v14.x`, this shell is on system Node, which silently
breaks Vite and Vitest. Fix it for the session:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

All commands below run from `/home/sean/workspace/ballislife`.

---

## File Structure

Files created by this plan, and what each one is responsible for.

| File | Responsibility |
| --- | --- |
| `package.json`, `vite.config.js`, `.nvmrc`, `index.html` | Build and dev tooling |
| `.github/workflows/deploy.yml` | Test, build, publish to GitHub Pages |
| `CLAUDE.md` | Conventions for future sessions in this repo |
| `src/main.jsx`, `src/App.jsx`, `src/styles.css` | App shell and theme |
| `src/lib/frontmatter.js` | `.md` text ⇄ `{meta, body}`. Knows YAML, knows nothing about drills |
| `src/lib/markdown.js` | Split a body into prose and `pitch` segments. Pure string work |
| `src/lib/pitch.js` | `pitch` source ⇄ scene model. The language. Never throws |
| `src/lib/pitchSvg.js` | Scene model → SVG **geometry** (numbers and path strings). No JSX |
| `src/components/PitchDiagram.jsx` | Renders geometry as SVG; shows parse errors |
| `src/components/DrillPreview.jsx` | Renders a whole drill: meta, prose, diagrams |
| `test/*.test.js`, `test/*.test.jsx` | One test file per lib module |
| `test/fixtures/*.md` | Realistic drill files used by tests and the preview page |

**Note on a spec refinement:** the spec's module map gives `pitchSvg.js` the job "scene
model → SVG". This plan splits that in two: `lib/pitchSvg.js` computes pure geometry
(testable as plain numbers in the node environment), and
`components/PitchDiagram.jsx` renders it. Same responsibility boundary, but it keeps
JSX out of `lib/` and matches the fancystats testing split.

---

## The scene model

Every task below produces or consumes this shape. It is plain JSON — no classes, no
undefined-vs-missing subtleties.

```js
{
  area: { w: 40, h: 25, markings: "half" },   // markings: plain|half|full|box|third
  marks: [
    { kind: "zone", x: 12, y: 0, w: 16, h: 25, label: "press here" },
    { kind: "goal", x: 0, y: 12, size: "full" },   // size: full|small|mini
    { kind: "cone", x: 5, y: 5 },
    { kind: "ball", x: 10, y: 12 },
    { kind: "flag", x: 36, y: 4 },
  ],
  players: [
    { team: "red", label: "A", x: 10, y: 20 },    // team: red|blue|yellow|gk
  ],
  actions: [
    { kind: "pass", from: "A", to: { ref: "B" }, seq: 1 },
    { kind: "run",  from: "C", to: { x: 28, y: 4 }, seq: 2 },
  ],
  label: "3v2 to end line",   // or null
}
```

A movement target is `{ ref: "<player label>" }`, `{ ref: "goal" }`, or `{ x, y }` —
discriminated by whether `ref` is present.

`parse(src)` returns `{ scene, errors }` where `errors` is
`[{ line: 4, message: "expected x,y" }]`, `line` being 1-based within the pitch block.
**It never throws.** A drill with one bad line still renders everything else.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/styles.css`
- Create: `.github/workflows/deploy.yml`, `CLAUDE.md`
- Create: `test/smoke.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ballislife",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "js-yaml": "^4.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.js`**

The `base` must match the GitHub Pages path. `__APP_VERSION__` is rendered in the
footer and is the cache tell after a deploy.

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  base: "/ballislife/",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
```

- [ ] **Step 3: Create `index.html`**

The Google Identity Services script is loaded here even though Plan 1 does not use it,
so that Plan 2's Drive work needs no HTML change.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="referrer" content="no-referrer" />
  <meta name="mobile-web-app-capable" content="yes" />
  <title>ballislife</title>
</head>
<body>
  <div id="root"></div>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 4: Create `src/main.jsx`**

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
```

- [ ] **Step 5: Create `src/styles.css`**

Single stylesheet with CSS variables, following the fancystats convention. The pitch
colours are variables so a future dark mode changes one block.

```css
:root {
  --bg: #f4f6f7; --panel: #ffffff; --line: #d7dee3;
  --text: #17222b; --dim: #5d7180; --accent: #1f7a4d; --warn: #9c7100; --err: #b3261e;
  --grass: #2f7d4f; --paint: rgba(255, 255, 255, 0.55);
  --red: #e8483f; --blue: #2b6cff; --yellow: #ffd83d; --gk: #3ad17a;
  --ball-line: #ffd83d; --run-line: #ffffff; --shot-line: #ff6b4a; --cone: #ffb01f;
  color-scheme: light;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
  padding-bottom: env(safe-area-inset-bottom);
}
button {
  font: inherit; color: inherit; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer;
}
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
textarea, input, select {
  font: inherit; color: inherit; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px;
}
.page { padding: 0 10px 30px; }
.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 10px; margin: 8px 0;
}
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dim { color: var(--dim); }
.chip {
  padding: 1px 7px; border-radius: 6px; font-size: 12px;
  font-weight: 600; white-space: nowrap; background: var(--bg); border: 1px solid var(--line);
}
.banner { padding: 8px 12px; border-radius: 8px; margin: 8px 0; }
.banner.warn { background: #fdf2d0; color: #6e5400; }
.banner.err { background: #fbdcd7; color: #8c1d18; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
.pitch { display: block; width: 100%; border-radius: 8px; }
.split { display: flex; gap: 10px; align-items: flex-start; }
.split > * { flex: 1; min-width: 0; }
@media (max-width: 780px) { .split { flex-direction: column; } }
```

- [ ] **Step 6: Create `src/App.jsx`**

A placeholder shell. Task 15 replaces the body with the preview harness.

```jsx
import React from "react";

export default function App() {
  return (
    <div className="page">
      <h1>ballislife</h1>
      <p className="dim">v{__APP_VERSION__}</p>
    </div>
  );
}
```

- [ ] **Step 7: Create `test/smoke.test.js`**

Proves the toolchain runs before any real code depends on it.

```js
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install dependencies and run the test**

```bash
npm install
npm test
```

Expected: `Test Files  1 passed (1)` and `Tests  1 passed (1)`.

- [ ] **Step 9: Verify the build works**

`npm run build` catches JSX errors that tests cannot, because component tests are
SSR-only.

```bash
npm run build
```

Expected: `✓ built in ...` and a `dist/` directory containing `index.html`.

- [ ] **Step 10: Create `.github/workflows/deploy.yml`**

```yaml
name: deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 11: Create `CLAUDE.md`**

```markdown
# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Environment — read this first

Confirm `node -v` reports v20. If it reports v14, this shell is on system Node, which
silently breaks Vite and Vitest:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

## Commands

```bash
npm run dev                          # http://localhost:5173/ballislife/
npm test                             # vitest run (all suites)
npx vitest run test/pitch.test.js    # one file
npx vitest run -t "round-trip"       # by test name
npm run build                        # catches JSX errors tests can't
```

**Deploy** = push to `main` → GitHub Actions → Pages. Bump `package.json` version
first; the version renders in the footer and is the user's cache tell.

## What this is

A personal soccer drill catalogue. Client-only React app, no server. Drills are
markdown files in the owner's Google Drive `/BallIsLife` folder. Only the owner
signs in.

## Architecture

**Pure logic in `src/lib/`, thin components in `src/components/`.** Domain rules live
in unit-tested pure functions; components only wire state and render. New derivations
belong in lib with tests, not in components.

- `pitch.js` — the `pitch` diagram language. `parse` returns `{scene, errors}` and
  **never throws**; a single bad line must not blank the preview.
- `pitchSvg.js` — pure geometry (numbers, path strings). No JSX; that is why it is
  testable in the node environment.
- `frontmatter.js` / `markdown.js` — document structure, no drill knowledge.

## Invariants

- **`pitch.js` round-trips at the model level:** `parse(serialise(scene)).scene` deep-
  equals `scene`, and `serialise` is stable under re-parse. This is what makes a future
  drag-to-edit canvas possible without changing stored files. It is NOT byte-identical
  to arbitrary source — canonicalisation reorders lines and splits multi-action lines.
- **`index.json` in Drive is disposable and never authoritative** (Plan 2). Every load
  validates it against a `files.list` of ids and `modifiedTime`s and repairs any drift.
  Never trust it without that check.
- **Nothing derived is stored in a drill file.** Diagrams render from the `pitch`
  source at display time.

## Testing conventions

Vitest in the node environment — no jsdom. Lib tests assert on plain models. Component
tests are SSR smoke tests via `renderToStaticMarkup`; interaction coverage is manual.
Prefer fixtures in `test/fixtures/` over hand-built objects.

## Workflow

Specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Read
the relevant spec before extending a feature.
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + react + vitest project"
```

---

## Task 2: Parse frontmatter

**Files:**
- Create: `src/lib/frontmatter.js`
- Test: `test/frontmatter.test.js`

- [ ] **Step 1: Write the failing tests**

Note the third case: a file with broken YAML must still be *readable*, because the spec
requires invalid drills to appear in the grid and open in the editor rather than being
dropped.

```js
import { describe, it, expect } from "vitest";
import { parseDoc } from "../src/lib/frontmatter.js";

describe("parseDoc", () => {
  it("splits frontmatter from body", () => {
    const src = "---\ntitle: Rondo 4v2\nminutes: 10\n---\n\nKeep the ball.\n";
    const doc = parseDoc(src);
    expect(doc.meta).toEqual({ title: "Rondo 4v2", minutes: 10 });
    expect(doc.body).toBe("Keep the ball.\n");
    expect(doc.error).toBe(null);
  });

  it("treats a document with no frontmatter as all body", () => {
    const doc = parseDoc("Just some notes.\n");
    expect(doc.meta).toEqual({});
    expect(doc.body).toBe("Just some notes.\n");
    expect(doc.error).toBe(null);
  });

  it("reports broken yaml but still returns the body", () => {
    const src = "---\ntitle: [unclosed\n---\n\nBody survives.\n";
    const doc = parseDoc(src);
    expect(doc.meta).toEqual({});
    expect(doc.body).toBe("Body survives.\n");
    expect(doc.error).toMatch(/yaml/i);
  });

  it("parses list and range fields", () => {
    const src = "---\ntags: [transition, finishing]\nplayers: 8-12\n---\nx\n";
    const doc = parseDoc(src);
    expect(doc.meta.tags).toEqual(["transition", "finishing"]);
    expect(doc.meta.players).toBe("8-12");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/frontmatter.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/frontmatter.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/frontmatter.js
// Document structure only: splitting YAML frontmatter from a markdown body.
// Knows nothing about drills.
import yaml from "js-yaml";

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// -> { meta, body, error }. Never throws: a document with broken frontmatter still
// returns its body so it can be opened and repaired in the editor.
export function parseDoc(src) {
  const text = String(src ?? "");
  const m = text.match(FENCE);
  if (!m) return { meta: {}, body: text, error: null };

  const body = text.slice(m[0].length);
  try {
    const meta = yaml.load(m[1]);
    if (meta === null || meta === undefined) return { meta: {}, body, error: null };
    if (typeof meta !== "object" || Array.isArray(meta)) {
      return { meta: {}, body, error: "yaml: frontmatter must be a mapping" };
    }
    return { meta, body, error: null };
  } catch (e) {
    return { meta: {}, body, error: `yaml: ${e.reason || e.message}` };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/frontmatter.test.js
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/frontmatter.js test/frontmatter.test.js
git commit -m "feat: parse markdown frontmatter, tolerating broken yaml"
```

---

## Task 3: Serialise a document

**Files:**
- Modify: `src/lib/frontmatter.js`
- Modify: `test/frontmatter.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/frontmatter.test.js`, and add `serialiseDoc` to the import at the top
so it reads `import { parseDoc, serialiseDoc } from "../src/lib/frontmatter.js";`

```js
describe("serialiseDoc", () => {
  it("writes frontmatter then body", () => {
    const out = serialiseDoc({ meta: { title: "Rondo 4v2", minutes: 10 }, body: "Keep the ball.\n" });
    expect(out).toBe("---\ntitle: Rondo 4v2\nminutes: 10\n---\n\nKeep the ball.\n");
  });

  it("omits the fence when there is no metadata", () => {
    expect(serialiseDoc({ meta: {}, body: "notes\n" })).toBe("notes\n");
  });

  it("round-trips a document through parse and serialise", () => {
    const src = "---\ntitle: Rondo 4v2\nminutes: 10\ntags:\n  - possession\n---\n\nKeep the ball.\n";
    const once = serialiseDoc(parseDoc(src));
    expect(serialiseDoc(parseDoc(once))).toBe(once);
    expect(parseDoc(once).meta).toEqual({ title: "Rondo 4v2", minutes: 10, tags: ["possession"] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/frontmatter.test.js -t serialiseDoc
```

Expected: FAIL — `serialiseDoc is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/frontmatter.js`:

```js
// { meta, body } -> markdown text. Inverse of parseDoc at the model level.
export function serialiseDoc({ meta, body }) {
  const text = body ?? "";
  const keys = Object.keys(meta ?? {});
  if (keys.length === 0) return text;
  const front = yaml.dump(meta, { lineWidth: 0, noRefs: true, flowLevel: -1 });
  return `---\n${front}---\n\n${text.replace(/^\n+/, "")}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/frontmatter.test.js
```

Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/frontmatter.js test/frontmatter.test.js
git commit -m "feat: serialise documents back to markdown"
```

---

## Task 4: Split a body into prose and pitch segments

**Files:**
- Create: `src/lib/markdown.js`
- Test: `test/markdown.test.js`

Why this is its own module: the renderer needs `pitch` fences pulled out *before*
markdown runs, and the parse-error reporting needs each block's starting line number in
the original body so an error can say which line of the file is wrong.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { splitSegments } from "../src/lib/markdown.js";

describe("splitSegments", () => {
  it("returns a single prose segment when there is no pitch block", () => {
    expect(splitSegments("Hello\n\nWorld\n")).toEqual([
      { kind: "prose", text: "Hello\n\nWorld\n" },
    ]);
  });

  it("extracts a pitch block and the prose around it", () => {
    const body = "Before\n\n```pitch\narea: 40x25 half\n```\n\nAfter\n";
    expect(splitSegments(body)).toEqual([
      { kind: "prose", text: "Before\n\n" },
      { kind: "pitch", text: "area: 40x25 half\n", line: 4 },
      { kind: "prose", text: "\nAfter\n" },
    ]);
  });

  it("records the source line of each block so errors can be located", () => {
    const body = "a\n```pitch\nx\n```\nb\n```pitch\ny\n```\n";
    const pitches = splitSegments(body).filter((s) => s.kind === "pitch");
    expect(pitches.map((p) => p.line)).toEqual([3, 8]);
  });

  it("leaves other fenced languages as prose", () => {
    const body = "```js\nconst a = 1;\n```\n";
    expect(splitSegments(body)).toEqual([{ kind: "prose", text: body }]);
  });

  it("treats an unterminated pitch fence as a pitch block to the end of the body", () => {
    const body = "intro\n```pitch\narea: 40x25\n";
    expect(splitSegments(body)).toEqual([
      { kind: "prose", text: "intro\n" },
      { kind: "pitch", text: "area: 40x25\n", line: 3 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/markdown.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/markdown.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/markdown.js
// Splits a markdown body into prose runs and ```pitch blocks. Pure string work.
// `line` is the 1-based line of the body where the block's CONTENT starts, so a
// parse error at pitch-line N can be reported as body-line (line + N - 1).

const OPEN = /^```pitch\s*$/;
const CLOSE = /^```\s*$/;

export function splitSegments(body) {
  const text = String(body ?? "");
  const lines = text.split("\n");
  const segments = [];
  let prose = [];

  const flushProse = () => {
    if (prose.length === 0) return;
    segments.push({ kind: "prose", text: prose.join("\n") });
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (!OPEN.test(lines[i])) {
      prose.push(lines[i]);
      continue;
    }
    flushProse();
    const contentStart = i + 1;
    const content = [];
    let j = contentStart;
    while (j < lines.length && !CLOSE.test(lines[j])) content.push(lines[j++]);
    segments.push({
      kind: "pitch",
      text: content.length ? content.join("\n") + "\n" : "",
      line: contentStart + 1, // 1-based
    });
    i = j; // skip the closing fence; if absent, j === lines.length and the loop ends
  }

  flushProse();
  return segments;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/markdown.test.js
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown.js test/markdown.test.js
git commit -m "feat: split markdown bodies into prose and pitch segments"
```

---

## Task 5: Parse the pitch area line

**Files:**
- Create: `src/lib/pitch.js`
- Test: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";

describe("parse: area", () => {
  it("reads dimensions and a markings preset", () => {
    const { scene, errors } = parse("area: 40x25 half\n");
    expect(scene.area).toEqual({ w: 40, h: 25, markings: "half" });
    expect(errors).toEqual([]);
  });

  it("defaults markings to plain", () => {
    expect(parse("area: 30x20\n").scene.area).toEqual({ w: 30, h: 20, markings: "plain" });
  });

  it("defaults the whole area when the line is absent", () => {
    expect(parse("cone: 1,1\n").scene.area).toEqual({ w: 40, h: 25, markings: "plain" });
  });

  it("accepts decimal dimensions", () => {
    expect(parse("area: 37.5x22.5 full\n").scene.area).toEqual({ w: 37.5, h: 22.5, markings: "full" });
  });

  it("ignores blank lines and comments", () => {
    const { scene, errors } = parse("\n# a comment\narea: 40x25 box\n\n");
    expect(scene.area.markings).toBe("box");
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitch.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/pitch.js"`.

- [ ] **Step 3: Write the implementation**

Only the `area` directive is handled; later tasks add the rest. The dispatch table and
error collection are in place from the start because every later task plugs into them.

```js
// src/lib/pitch.js
// The `pitch` diagram language: source text <-> scene model.
//
// parse() NEVER throws. It returns { scene, errors } so that one malformed line
// degrades to an inline message while the rest of the drill still renders.
// Coordinates are metres, origin top-left.

export const MARKINGS = ["plain", "half", "full", "box", "third"];
const DEFAULT_AREA = { w: 40, h: 25, markings: "plain" };

function emptyScene() {
  return { area: { ...DEFAULT_AREA }, marks: [], players: [], actions: [], label: null };
}

// "40x25 half" -> { w, h, markings }
function parseArea(rest, ctx) {
  const m = rest.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s+(\S+))?$/);
  if (!m) return ctx.fail('expected "<width>x<height> [markings]"');
  const markings = m[3] ?? "plain";
  if (!MARKINGS.includes(markings)) {
    return ctx.fail(`unknown markings "${markings}" (expected ${MARKINGS.join(", ")})`);
  }
  ctx.scene.area = { w: Number(m[1]), h: Number(m[2]), markings };
}

const DIRECTIVES = { area: parseArea };

export function parse(src) {
  const scene = emptyScene();
  const errors = [];
  const lines = String(src ?? "").split("\n");

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || line.trimStart().startsWith("#")) return;

    const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) {
      errors.push({ line: i + 1, message: 'expected "<directive>: <value>"' });
      return;
    }
    const key = m[1].toLowerCase();
    const handler = DIRECTIVES[key];
    if (!handler) {
      errors.push({ line: i + 1, message: `unknown directive "${key}"` });
      return;
    }
    handler(m[2].trim(), {
      scene,
      fail: (message) => { errors.push({ line: i + 1, message }); },
    });
  });

  return { scene, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitch.test.js
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: parse the pitch area directive"
```

---

## Task 6: Parse players

**Files:**
- Modify: `src/lib/pitch.js`
- Modify: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`:

```js
describe("parse: players", () => {
  it("reads several players from one team line", () => {
    const { scene, errors } = parse("red: A@10,20 B@25,14\n");
    expect(scene.players).toEqual([
      { team: "red", label: "A", x: 10, y: 20 },
      { team: "red", label: "B", x: 25, y: 14 },
    ]);
    expect(errors).toEqual([]);
  });

  it("supports red, blue, yellow and gk", () => {
    const src = "red: A@1,1\nblue: X@2,2\nyellow: Y@3,3\ngk: K@0,12\n";
    expect(parse(src).scene.players.map((p) => p.team)).toEqual(["red", "blue", "yellow", "gk"]);
  });

  it("accepts multi-character labels", () => {
    expect(parse("blue: CB@5,5\n").scene.players[0].label).toBe("CB");
  });

  it("reports a bad token but keeps the good ones on the same line", () => {
    const { scene, errors } = parse("red: A@10,20 B@oops C@3,4\n");
    expect(scene.players.map((p) => p.label)).toEqual(["A", "C"]);
    expect(errors).toEqual([{ line: 1, message: 'expected "<label>@<x>,<y>" but got "B@oops"' }]);
  });

  it("rejects a duplicate label", () => {
    const { scene, errors } = parse("red: A@1,1\nblue: A@2,2\n");
    expect(scene.players.map((p) => p.team)).toEqual(["red"]);
    expect(errors).toEqual([{ line: 2, message: 'duplicate player label "A"' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitch.test.js -t "parse: players"
```

Expected: FAIL — `unknown directive "red"`.

- [ ] **Step 3: Write the implementation**

In `src/lib/pitch.js`, add the team parser above `DIRECTIVES`:

```js
export const TEAMS = ["red", "blue", "yellow", "gk"];

// "A@10,20 B@25,14" -> one player per token. A bad token fails alone.
function parsePlayers(team) {
  return (rest, ctx) => {
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      const m = token.match(/^([A-Za-z][A-Za-z0-9]{0,3})@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      if (!m) {
        ctx.fail(`expected "<label>@<x>,<y>" but got "${token}"`);
        continue;
      }
      const label = m[1];
      if (ctx.scene.players.some((p) => p.label === label)) {
        ctx.fail(`duplicate player label "${label}"`);
        continue;
      }
      ctx.scene.players.push({ team, label, x: Number(m[2]), y: Number(m[3]) });
    }
  };
}
```

Then replace the `DIRECTIVES` declaration with:

```js
const DIRECTIVES = { area: parseArea };
for (const team of TEAMS) DIRECTIVES[team] = parsePlayers(team);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitch.test.js
```

Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: parse player positions per team"
```

---

## Task 7: Parse marks — cones, balls, flags, goals and zones

**Files:**
- Modify: `src/lib/pitch.js`
- Modify: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`:

```js
describe("parse: marks", () => {
  it("reads repeated point marks from one line", () => {
    const { scene, errors } = parse("cone: 5,5 5,20 35,5\n");
    expect(scene.marks).toEqual([
      { kind: "cone", x: 5, y: 5 },
      { kind: "cone", x: 5, y: 20 },
      { kind: "cone", x: 35, y: 5 },
    ]);
    expect(errors).toEqual([]);
  });

  it("reads balls and flags", () => {
    const { scene } = parse("ball: 10,12\nflag: 36,4\n");
    expect(scene.marks).toEqual([
      { kind: "ball", x: 10, y: 12 },
      { kind: "flag", x: 36, y: 4 },
    ]);
  });

  it("reads a goal with a size, defaulting to full", () => {
    expect(parse("goal: 0,12 small\n").scene.marks).toEqual([
      { kind: "goal", x: 0, y: 12, size: "small" },
    ]);
    expect(parse("goal: 0,12\n").scene.marks).toEqual([
      { kind: "goal", x: 0, y: 12, size: "full" },
    ]);
  });

  it("rejects an unknown goal size", () => {
    const { scene, errors } = parse("goal: 0,12 enormous\n");
    expect(scene.marks).toEqual([]);
    expect(errors).toEqual([
      { line: 1, message: 'unknown goal size "enormous" (expected full, small, mini)' },
    ]);
  });

  it("reads a zone with dimensions and an optional label", () => {
    expect(parse('zone: 12,0 16x25 "press here"\n').scene.marks).toEqual([
      { kind: "zone", x: 12, y: 0, w: 16, h: 25, label: "press here" },
    ]);
    expect(parse("zone: 12,0 16x25\n").scene.marks).toEqual([
      { kind: "zone", x: 12, y: 0, w: 16, h: 25, label: null },
    ]);
  });

  it("reports a malformed point without dropping the rest of the line", () => {
    const { scene, errors } = parse("cone: 5,5 nope 7,7\n");
    expect(scene.marks).toEqual([
      { kind: "cone", x: 5, y: 5 },
      { kind: "cone", x: 7, y: 7 },
    ]);
    expect(errors).toEqual([{ line: 1, message: 'expected "<x>,<y>" but got "nope"' }]);
  });

  it("reads the drill label", () => {
    expect(parse('label: "3v2 to end line"\n').scene.label).toBe("3v2 to end line");
    expect(parse("label: 3v2 to end line\n").scene.label).toBe("3v2 to end line");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitch.test.js -t "parse: marks"
```

Expected: FAIL — `unknown directive "cone"`.

- [ ] **Step 3: Write the implementation**

In `src/lib/pitch.js`, add above `DIRECTIVES`:

```js
export const GOAL_SIZES = ["full", "small", "mini"];
const POINT_MARKS = ["cone", "ball", "flag"];
const NUM = "-?\\d+(?:\\.\\d+)?";

function parsePoint(token) {
  const m = token.match(new RegExp(`^(${NUM}),(${NUM})$`));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function parsePointMarks(kind) {
  return (rest, ctx) => {
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      const p = parsePoint(token);
      if (!p) { ctx.fail(`expected "<x>,<y>" but got "${token}"`); continue; }
      ctx.scene.marks.push({ kind, ...p });
    }
  };
}

// "0,12 small"
function parseGoal(rest, ctx) {
  const parts = rest.split(/\s+/).filter(Boolean);
  const p = parsePoint(parts[0] ?? "");
  if (!p) return ctx.fail('expected "<x>,<y> [size]"');
  const size = parts[1] ?? "full";
  if (!GOAL_SIZES.includes(size)) {
    return ctx.fail(`unknown goal size "${size}" (expected ${GOAL_SIZES.join(", ")})`);
  }
  ctx.scene.marks.push({ kind: "goal", ...p, size });
}

// '12,0 16x25 "press here"'
function parseZone(rest, ctx) {
  const m = rest.match(new RegExp(`^(${NUM}),(${NUM})\\s+(${NUM})\\s*x\\s*(${NUM})\\s*(.*)$`));
  if (!m) return ctx.fail('expected "<x>,<y> <w>x<h> [label]"');
  ctx.scene.marks.push({
    kind: "zone",
    x: Number(m[1]), y: Number(m[2]),
    w: Number(m[3]), h: Number(m[4]),
    label: unquote(m[5]),
  });
}

// Strips surrounding double quotes; returns null for empty.
function unquote(s) {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const m = t.match(/^"(.*)"$/);
  return m ? m[1] : t;
}

function parseLabel(rest, ctx) {
  ctx.scene.label = unquote(rest);
}
```

Then extend the `DIRECTIVES` setup:

```js
const DIRECTIVES = { area: parseArea, goal: parseGoal, zone: parseZone, label: parseLabel };
for (const team of TEAMS) DIRECTIVES[team] = parsePlayers(team);
for (const kind of POINT_MARKS) DIRECTIVES[kind] = parsePointMarks(kind);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitch.test.js
```

Expected: `Tests  17 passed (17)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: parse cones, balls, flags, goals, zones and the drill label"
```

---

## Task 8: Parse movement actions with sequence numbers

**Files:**
- Modify: `src/lib/pitch.js`
- Modify: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`:

```js
describe("parse: actions", () => {
  it("reads a pass between two players", () => {
    const { scene, errors } = parse("red: A@1,1 B@2,2\npass: A->B\n");
    expect(scene.actions).toEqual([{ kind: "pass", from: "A", to: { ref: "B" }, seq: 1 }]);
    expect(errors).toEqual([]);
  });

  it("reads each movement kind with its own arrow", () => {
    const src = [
      "red: A@1,1 B@2,2 C@3,3",
      "pass: A->B",
      "run: C~>28,4",
      "dribble: B=>32,12",
      "shot: C->>goal",
    ].join("\n");
    const { scene, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(scene.actions).toEqual([
      { kind: "pass", from: "A", to: { ref: "B" }, seq: 1 },
      { kind: "run", from: "C", to: { x: 28, y: 4 }, seq: 2 },
      { kind: "dribble", from: "B", to: { x: 32, y: 12 }, seq: 3 },
      { kind: "shot", from: "C", to: { ref: "goal" }, seq: 4 },
    ]);
  });

  it("numbers actions in declaration order across lines and within a line", () => {
    const src = "red: A@1,1 B@2,2 C@3,3\npass: A->B B->C\nrun: A~>9,9\n";
    expect(parse(src).scene.actions.map((a) => a.seq)).toEqual([1, 2, 3]);
  });

  it("rejects a reference to an undeclared player", () => {
    const { scene, errors } = parse("red: A@1,1\npass: A->Z\n");
    expect(scene.actions).toEqual([]);
    expect(errors).toEqual([{ line: 2, message: 'unknown player "Z"' }]);
  });

  it("rejects an action whose source is not a player", () => {
    const { errors } = parse("red: A@1,1\npass: 3,3->A\n");
    expect(errors).toEqual([{ line: 2, message: 'expected a player label as the source, got "3,3"' }]);
  });

  it("reports a malformed action without dropping the rest of the line", () => {
    const { scene, errors } = parse("red: A@1,1 B@2,2\npass: A-B A->B\n");
    expect(scene.actions.map((a) => a.seq)).toEqual([1]);
    expect(errors).toEqual([{ line: 2, message: 'expected "<from><arrow><to>" but got "A-B"' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitch.test.js -t "parse: actions"
```

Expected: FAIL — `unknown directive "pass"`.

- [ ] **Step 3: Write the implementation**

Player and action lines can appear in any order in the source, but an action's
references must resolve against the *whole* scene. So actions are collected during the
line pass and validated afterwards, in a second pass over the parsed lines.

In `src/lib/pitch.js`, add above `DIRECTIVES`:

```js
// Each movement kind is written with a distinct arrow so a reader can tell a pass
// from a run at a glance in the source, not only in the rendering.
export const ARROWS = { pass: "->", run: "~>", dribble: "=>", shot: "->>" };
const ARROW_KINDS = Object.keys(ARROWS);

// Longest arrow first, so "->>" is not mis-read as "->".
const ARROW_RE = /^(.*?)(->>|~>|=>|->)(.*)$/;

function parseActions(kind) {
  return (rest, ctx) => {
    const arrow = ARROWS[kind];
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      const m = token.match(ARROW_RE);
      if (!m || m[2] !== arrow || m[1] === "" || m[3] === "") {
        ctx.fail(`expected "<from><arrow><to>" but got "${token}"`);
        continue;
      }
      // Resolution is deferred: the player may be declared on a later line.
      ctx.pending.push({ kind, fromRaw: m[1], toRaw: m[3], line: ctx.line });
    }
  };
}

// A target is a player label, the literal "goal", or a coordinate.
function resolveTarget(raw, scene) {
  if (raw === "goal") return { ok: true, to: { ref: "goal" } };
  const p = parsePoint(raw);
  if (p) return { ok: true, to: p };
  if (scene.players.some((pl) => pl.label === raw)) return { ok: true, to: { ref: raw } };
  return { ok: false, message: `unknown player "${raw}"` };
}
```

Extend the `DIRECTIVES` setup:

```js
for (const kind of ARROW_KINDS) DIRECTIVES[kind] = parseActions(kind);
```

Then update `parse` to carry `pending` and `line` through the context, and to resolve
actions after the line pass. Replace the body of `parse` with:

```js
export function parse(src) {
  const scene = emptyScene();
  const errors = [];
  const pending = [];
  const lines = String(src ?? "").split("\n");

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || line.trimStart().startsWith("#")) return;

    const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) {
      errors.push({ line: i + 1, message: 'expected "<directive>: <value>"' });
      return;
    }
    const key = m[1].toLowerCase();
    const handler = DIRECTIVES[key];
    if (!handler) {
      errors.push({ line: i + 1, message: `unknown directive "${key}"` });
      return;
    }
    handler(m[2].trim(), {
      scene,
      pending,
      line: i + 1,
      fail: (message) => { errors.push({ line: i + 1, message }); },
    });
  });

  // Second pass: resolve action endpoints now that every player is known.
  for (const a of pending) {
    if (!scene.players.some((p) => p.label === a.fromRaw)) {
      errors.push({
        line: a.line,
        message: `expected a player label as the source, got "${a.fromRaw}"`,
      });
      continue;
    }
    const t = resolveTarget(a.toRaw, scene);
    if (!t.ok) { errors.push({ line: a.line, message: t.message }); continue; }
    scene.actions.push({
      kind: a.kind,
      from: a.fromRaw,
      to: t.to,
      seq: scene.actions.length + 1,
    });
  }

  return { scene, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitch.test.js
```

Expected: `Tests  23 passed (23)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: parse movement actions with sequence numbering"
```

---

## Task 9: Guarantee the parser never throws

**Files:**
- Modify: `test/pitch.test.js`

This task adds no implementation — it locks in the invariant the whole error-handling
design rests on. If any of these throw, the preview pane goes blank on a typo, which
the spec forbids.

- [ ] **Step 1: Write the tests**

Append to `test/pitch.test.js`:

```js
describe("parse: robustness", () => {
  const nasty = [
    "",
    "\n\n\n",
    "area:",
    "area: x",
    ":::",
    "red:",
    "red: @@@",
    "pass:",
    "pass: ->",
    "zone: 1,1",
    "label:",
    "area: 40x25 half\nred: A@1,1\npass: A->A",
    " ",
    "a".repeat(10000),
    "pass: A->B\n".repeat(500),
  ];

  it("never throws, whatever the input", () => {
    for (const src of nasty) {
      expect(() => parse(src), JSON.stringify(src.slice(0, 40))).not.toThrow();
    }
  });

  it("always returns a usable scene shape", () => {
    for (const src of nasty) {
      const { scene, errors } = parse(src);
      expect(Array.isArray(scene.marks)).toBe(true);
      expect(Array.isArray(scene.players)).toBe(true);
      expect(Array.isArray(scene.actions)).toBe(true);
      expect(typeof scene.area.w).toBe("number");
      expect(Array.isArray(errors)).toBe(true);
    }
  });

  it("accepts undefined and null as empty input", () => {
    expect(parse(undefined).errors).toEqual([]);
    expect(parse(null).scene.players).toEqual([]);
  });

  it("reports every error with a line number and a message", () => {
    const { errors } = parse("nonsense\nred: bad\ngoal: nope\n");
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(typeof e.line).toBe("number");
      expect(e.line).toBeGreaterThan(0);
      expect(typeof e.message).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run test/pitch.test.js
```

Expected: `Tests  27 passed (27)`. If any fail, fix `pitch.js` — do not weaken the
test. A self-referential pass (`A->A`) is legal input and must simply render as a
degenerate arrow, not error.

- [ ] **Step 3: Commit**

```bash
git add test/pitch.test.js
git commit -m "test: lock in that pitch parsing never throws"
```

---

## Task 10: Serialise a scene back to canonical source

**Files:**
- Modify: `src/lib/pitch.js`
- Modify: `test/pitch.test.js`

This is the task that makes a future drag-to-edit canvas possible. The invariant is
**model-level**, not byte-level: canonicalisation reorders directives and splits
multi-action lines, so `serialise(parse(src)) === src` is false in general and is not
tested. What is tested is that a scene survives a serialise/parse round trip unchanged,
and that serialising is stable.

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`, and extend the import at the top of the file to
`import { parse, serialise } from "../src/lib/pitch.js";`

```js
describe("serialise", () => {
  it("writes directives in canonical order", () => {
    const src = [
      "label: Test",
      "pass: A->B",
      "red: A@1,1 B@2,2",
      "cone: 5,5",
      "area: 40x25 half",
    ].join("\n");
    const { scene } = parse(src);
    expect(serialise(scene)).toBe(
      [
        "area: 40x25 half",
        "cone: 5,5",
        "red: A@1,1 B@2,2",
        "pass: A->B",
        "label: Test",
        "",
      ].join("\n"),
    );
  });

  it("omits the markings word when the area is plain", () => {
    expect(serialise(parse("area: 30x20\n").scene)).toBe("area: 30x20\n");
  });

  it("writes one action per line, in sequence order", () => {
    const { scene } = parse("red: A@1,1 B@2,2\npass: A->B B->A\nrun: A~>9,9\n");
    expect(serialise(scene)).toBe(
      ["area: 40x25", "red: A@1,1 B@2,2", "pass: A->B", "pass: B->A", "run: A~>9,9", ""].join("\n"),
    );
  });

  it("quotes labels and zone labels", () => {
    const { scene } = parse('zone: 1,2 3x4 "press here"\nlabel: 3v2 to end line\n');
    const out = serialise(scene);
    expect(out).toContain('zone: 1,2 3x4 "press here"');
    expect(out).toContain('label: "3v2 to end line"');
  });

  it("round-trips a scene through serialise and parse unchanged", () => {
    const src = [
      "area: 40x25 half",
      'zone: 12,0 16x25 "press here"',
      "goal: 0,12 small",
      "cone: 5,5 5,20 35,5",
      "ball: 10,12",
      "flag: 36,4",
      "red: A@10,20 B@25,14 C@34,20",
      "blue: X@18,8 Y@30,7",
      "gk: K@1,12",
      "pass: A->B",
      "run: C~>28,4",
      "dribble: B=>32,12",
      "shot: C->>goal",
      'label: "3v2 to end line"',
    ].join("\n");
    const { scene, errors } = parse(src);
    expect(errors).toEqual([]);

    const once = serialise(scene);
    const again = parse(once);
    expect(again.errors).toEqual([]);
    expect(again.scene).toEqual(scene);
    expect(serialise(again.scene)).toBe(once);
  });

  it("survives a round trip for an empty scene", () => {
    const { scene } = parse("");
    expect(parse(serialise(scene)).scene).toEqual(scene);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitch.test.js -t serialise
```

Expected: FAIL — `serialise is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/pitch.js`:

```js
// Trims trailing zeros so 10 serialises as "10", not "10.0".
const n = (v) => String(Number(v));
const pt = (o) => `${n(o.x)},${n(o.y)}`;
// Quote only when the value contains whitespace, so short labels stay unquoted.
const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);

// Scene -> canonical source. Inverse of parse() at the MODEL level:
// parse(serialise(scene)).scene deep-equals scene, and serialise is stable under
// re-parse. It is NOT byte-identical to arbitrary input source.
export function serialise(scene) {
  const lines = [];
  const marksOf = (kind) => scene.marks.filter((m) => m.kind === kind);

  const { w, h, markings } = scene.area;
  lines.push(`area: ${n(w)}x${n(h)}${markings === "plain" ? "" : ` ${markings}`}`);

  for (const z of marksOf("zone")) {
    const label = z.label ? ` ${quote(z.label)}` : "";
    lines.push(`zone: ${pt(z)} ${n(z.w)}x${n(z.h)}${label}`);
  }
  for (const g of marksOf("goal")) {
    lines.push(`goal: ${pt(g)}${g.size === "full" ? "" : ` ${g.size}`}`);
  }
  for (const kind of ["cone", "ball", "flag"]) {
    const ms = marksOf(kind);
    if (ms.length) lines.push(`${kind}: ${ms.map(pt).join(" ")}`);
  }
  for (const team of TEAMS) {
    const ps = scene.players.filter((p) => p.team === team);
    if (ps.length) lines.push(`${team}: ${ps.map((p) => `${p.label}@${pt(p)}`).join(" ")}`);
  }
  for (const a of [...scene.actions].sort((x, y) => x.seq - y.seq)) {
    const to = a.to.ref !== undefined ? a.to.ref : pt(a.to);
    lines.push(`${a.kind}: ${a.from}${ARROWS[a.kind]}${to}`);
  }
  if (scene.label !== null && scene.label !== undefined) {
    lines.push(`label: ${quote(scene.label)}`);
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitch.test.js
```

Expected: `Tests  33 passed (33)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: serialise scenes to canonical pitch source with model round-trip"
```

---

## Task 11: Scale metres to SVG coordinates

**Files:**
- Create: `src/lib/pitchSvg.js`
- Test: `test/pitchSvg.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { S, PAD, viewBox, toPx } from "../src/lib/pitchSvg.js";

describe("scaling", () => {
  it("pads the viewBox so edge marks are not clipped", () => {
    expect(viewBox({ w: 40, h: 25, markings: "plain" })).toBe(
      `0 0 ${(40 + 2 * PAD) * S} ${(25 + 2 * PAD) * S}`,
    );
  });

  it("maps metres to pixels with the padding offset", () => {
    expect(toPx(0, 0)).toEqual({ x: PAD * S, y: PAD * S });
    expect(toPx(10, 5)).toEqual({ x: (10 + PAD) * S, y: (5 + PAD) * S });
  });

  it("maps a player on the goal line to a visible coordinate", () => {
    expect(toPx(0, 12).x).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitchSvg.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/pitchSvg.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/pitchSvg.js
// Pure geometry for rendering a pitch scene: numbers and SVG path strings only.
// No JSX lives here — that is what makes it testable in the node environment.

export const S = 10;   // pixels per metre
export const PAD = 2;  // metres of margin, so marks on the boundary are not clipped

export const viewBox = (area) => `0 0 ${(area.w + 2 * PAD) * S} ${(area.h + 2 * PAD) * S}`;

export const toPx = (x, y) => ({ x: (x + PAD) * S, y: (y + PAD) * S });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitchSvg.test.js
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitchSvg.js test/pitchSvg.test.js
git commit -m "feat: map pitch metres to padded svg coordinates"
```

---

## Task 12: Compute pitch markings

**Files:**
- Modify: `src/lib/pitchSvg.js`
- Modify: `test/pitchSvg.test.js`

Real pitch dimensions (a 16.5 m penalty box) would swallow a 40×25 m training grid, so
every marking is capped as a proportion of the area. The goal end is `x = 0`.

- [ ] **Step 1: Write the failing tests**

Append to `test/pitchSvg.test.js`, extending the import to include `markings`.

```js
describe("markings", () => {
  const shapes = (m) => markings({ w: 40, h: 25, markings: m }).map((s) => s.type);

  it("draws only the boundary for plain", () => {
    expect(shapes("plain")).toEqual(["rect"]);
  });

  it("draws boundary, penalty box, six-yard box and arc for half", () => {
    expect(shapes("half")).toEqual(["rect", "rect", "rect", "arc"]);
  });

  it("draws boundary, halfway line, centre circle and two boxes for full", () => {
    expect(shapes("full")).toEqual(["rect", "line", "circle", "rect", "rect"]);
  });

  it("draws boundary and one box for box", () => {
    expect(shapes("box")).toEqual(["rect", "rect"]);
  });

  it("draws two dashed thirds lines", () => {
    const out = markings({ w: 45, h: 25, markings: "third" });
    expect(out.map((s) => s.type)).toEqual(["rect", "line", "line"]);
    expect(out.slice(1).every((s) => s.dashed)).toBe(true);
    expect(out[1].x1).toBeCloseTo(toPx(15, 0).x);
    expect(out[2].x1).toBeCloseTo(toPx(30, 0).x);
  });

  it("caps the penalty box so it cannot exceed the training area", () => {
    const [, box] = markings({ w: 20, h: 12, markings: "box" });
    expect(box.w).toBeLessThanOrEqual(20 * 0.35 * S);
    expect(box.h).toBeLessThanOrEqual(12 * 0.7 * S);
  });

  it("centres the penalty box vertically", () => {
    const [, box] = markings({ w: 40, h: 25, markings: "box" });
    expect(box.y + box.h / 2).toBeCloseTo(toPx(0, 12.5).y);
  });

  it("puts the boundary rect at the padded origin", () => {
    const [bound] = markings({ w: 40, h: 25, markings: "plain" });
    expect(bound).toMatchObject({ x: PAD * S, y: PAD * S, w: 40 * S, h: 25 * S });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitchSvg.test.js -t markings
```

Expected: FAIL — `markings is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/pitchSvg.js`:

```js
// Marking dimensions are capped proportions of the area: a real 16.5 m penalty box
// would swallow a 40x25 m training grid.
const BOX_DEPTH = (w) => Math.min(16.5, w * 0.35);
const BOX_WIDTH = (h) => Math.min(40.3, h * 0.7);
const SIX_DEPTH = (w) => Math.min(5.5, w * 0.12);
const SIX_WIDTH = (h) => Math.min(18.3, h * 0.35);
const CIRCLE_R = (h) => Math.min(9.15, h * 0.3);
const ARC_R = (h) => Math.min(9.15, h * 0.25);
const SPOT_X = (w) => Math.min(11, w * 0.22);

const rect = (x, y, w, h) => {
  const a = toPx(x, y);
  return { type: "rect", x: a.x, y: a.y, w: w * S, h: h * S };
};
const line = (x1, y1, x2, y2, dashed = false) => {
  const a = toPx(x1, y1), b = toPx(x2, y2);
  return { type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, dashed };
};
const circle = (cx, cy, r) => {
  const c = toPx(cx, cy);
  return { type: "circle", cx: c.x, cy: c.y, r: r * S };
};

// Penalty box and six-yard box at the x=0 goal end, vertically centred.
function boxesAt(w, h, flip = false) {
  const bd = BOX_DEPTH(w), bw = BOX_WIDTH(h);
  const sd = SIX_DEPTH(w), sw = SIX_WIDTH(h);
  const bx = flip ? w - bd : 0;
  const sx = flip ? w - sd : 0;
  return [rect(bx, (h - bw) / 2, bd, bw), rect(sx, (h - sw) / 2, sd, sw)];
}

// -> array of shape descriptors in pixels, in draw order.
// type is one of "rect" | "line" | "circle" | "arc".
export function markings(area) {
  const { w, h } = area;
  const out = [rect(0, 0, w, h)];

  switch (area.markings) {
    case "half": {
      out.push(...boxesAt(w, h));
      const spot = toPx(SPOT_X(w), h / 2);
      const r = ARC_R(h) * S;
      // Semicircle bulging away from the goal, drawn top to bottom.
      out.push({
        type: "arc",
        d: `M ${spot.x} ${spot.y - r} A ${r} ${r} 0 0 1 ${spot.x} ${spot.y + r}`,
      });
      break;
    }
    case "full": {
      out.push(line(w / 2, 0, w / 2, h));
      out.push(circle(w / 2, h / 2, CIRCLE_R(h)));
      // Penalty box at each end; the six-yard boxes are dropped at full-pitch
      // scale because they render as unreadable slivers.
      out.push(boxesAt(w, h)[0], boxesAt(w, h, true)[0]);
      break;
    }
    case "box":
      out.push(boxesAt(w, h)[0]);
      break;
    case "third":
      out.push(line(w / 3, 0, w / 3, h, true));
      out.push(line((2 * w) / 3, 0, (2 * w) / 3, h, true));
      break;
    default:
      break; // plain: boundary only
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitchSvg.test.js
```

Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitchSvg.js test/pitchSvg.test.js
git commit -m "feat: compute capped pitch markings per preset"
```

---

## Task 13: Compute action arrow paths

**Files:**
- Modify: `src/lib/pitchSvg.js`
- Modify: `test/pitchSvg.test.js`

Each movement kind gets a visually distinct path: straight for a pass and a shot,
gently curved for a run, wavy for a dribble. Arrows stop short of the target marker so
the head is visible rather than buried under a circle.

- [ ] **Step 1: Write the failing tests**

Append to `test/pitchSvg.test.js`, extending the import to include
`resolvePoint, actionPath, MARKER_GAP`.

```js
import { parse } from "../src/lib/pitch.js";

describe("resolvePoint", () => {
  const { scene } = parse("area: 40x25 half\ngoal: 0,12\nred: A@10,20 B@25,14\npass: A->B\n");

  it("resolves a player reference", () => {
    expect(resolvePoint({ ref: "A" }, scene)).toEqual({ x: 10, y: 20 });
  });

  it("resolves a coordinate target unchanged", () => {
    expect(resolvePoint({ x: 3, y: 4 }, scene)).toEqual({ x: 3, y: 4 });
  });

  it("resolves goal to the declared goal mark", () => {
    expect(resolvePoint({ ref: "goal" }, scene)).toEqual({ x: 0, y: 12 });
  });

  it("falls back to the left-centre of the area when no goal is declared", () => {
    const bare = parse("area: 40x25 half\n").scene;
    expect(resolvePoint({ ref: "goal" }, bare)).toEqual({ x: 0, y: 12.5 });
  });

  it("returns null for an unresolvable reference", () => {
    expect(resolvePoint({ ref: "Q" }, scene)).toBe(null);
  });
});

describe("actionPath", () => {
  const { scene } = parse("red: A@0,0 B@20,0\npass: A->B\nrun: A~>20,0\ndribble: A=>20,0\nshot: A->>20,0\n");
  const byKind = (k) => scene.actions.find((a) => a.kind === k);

  it("draws a pass as a straight line", () => {
    const p = actionPath(byKind("pass"), scene);
    expect(p.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    expect(p.kind).toBe("pass");
  });

  it("stops short of the target so the arrowhead stays visible", () => {
    const p = actionPath(byKind("pass"), scene);
    const endX = Number(p.d.match(/L ([\d.]+)/)[1]);
    expect(endX).toBeLessThan(toPx(20, 0).x);
    expect(toPx(20, 0).x - endX).toBeCloseTo(MARKER_GAP, 5);
  });

  it("curves a run", () => {
    expect(actionPath(byKind("run"), scene).d).toContain("Q");
  });

  it("makes a dribble wavy", () => {
    const d = actionPath(byKind("dribble"), scene).d;
    expect((d.match(/q/g) || []).length).toBeGreaterThan(2);
  });

  it("places a sequence badge at the midpoint", () => {
    const p = actionPath(byKind("pass"), scene);
    expect(p.seq).toBe(1);
    expect(p.badge.x).toBeCloseTo((toPx(0, 0).x + toPx(20, 0).x) / 2, 0);
  });

  it("returns null when an endpoint cannot be resolved", () => {
    const broken = { kind: "pass", from: "Z", to: { ref: "B" }, seq: 1 };
    expect(actionPath(broken, scene)).toBe(null);
  });

  it("returns null for a zero-length action rather than dividing by zero", () => {
    const same = { kind: "pass", from: "A", to: { ref: "A" }, seq: 1 };
    expect(actionPath(same, scene)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitchSvg.test.js -t actionPath
```

Expected: FAIL — `actionPath is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/pitchSvg.js`:

```js
export const MARKER_GAP = 11; // px: stop the arrow short of the target marker

// A target -> { x, y } in metres, or null if it cannot be resolved.
// "goal" prefers a declared goal mark and otherwise falls back to the left-centre
// of the area, so a drill that says `shot: A->>goal` without declaring a goal still
// renders something sensible instead of vanishing.
export function resolvePoint(target, scene) {
  if (target.ref === undefined) return { x: target.x, y: target.y };
  if (target.ref === "goal") {
    const g = scene.marks.find((m) => m.kind === "goal");
    return g ? { x: g.x, y: g.y } : { x: 0, y: scene.area.h / 2 };
  }
  const p = scene.players.find((pl) => pl.label === target.ref);
  return p ? { x: p.x, y: p.y } : null;
}

// Action -> { kind, d, seq, badge } in pixels, or null if unrenderable.
export function actionPath(action, scene) {
  const from = resolvePoint({ ref: action.from }, scene);
  const to = resolvePoint(action.to, scene);
  if (!from || !to) return null;

  const a = toPx(from.x, from.y);
  const b = toPx(to.x, to.y);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= MARKER_GAP) return null; // too short to draw, and would divide by zero

  const ux = dx / len, uy = dy / len;
  const start = { x: a.x + ux * MARKER_GAP, y: a.y + uy * MARKER_GAP };
  const end = { x: b.x - ux * MARKER_GAP, y: b.y - uy * MARKER_GAP };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const r2 = (v) => Math.round(v * 100) / 100;

  let d;
  if (action.kind === "dribble") {
    // Perpendicular zig-zag along the line: a series of quadratic wiggles.
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(3, Math.round(span / 14));
    const seg = span / steps;
    const amp = 5;
    d = `M ${r2(start.x)} ${r2(start.y)}`;
    for (let i = 0; i < steps; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const cx = start.x + ux * seg * (i + 0.5) + -uy * amp * sign;
      const cy = start.y + uy * seg * (i + 0.5) + ux * amp * sign;
      const px = start.x + ux * seg * (i + 1);
      const py = start.y + uy * seg * (i + 1);
      d += ` q ${r2(cx - (start.x + ux * seg * i))} ${r2(cy - (start.y + uy * seg * i))} ${r2(px - (start.x + ux * seg * i))} ${r2(py - (start.y + uy * seg * i))}`;
    }
  } else if (action.kind === "run") {
    // Single gentle bow, so a run reads differently from a pass even when parallel.
    const bow = Math.min(len * 0.18, 26);
    const cx = mid.x + -uy * bow;
    const cy = mid.y + ux * bow;
    d = `M ${r2(start.x)} ${r2(start.y)} Q ${r2(cx)} ${r2(cy)} ${r2(end.x)} ${r2(end.y)}`;
  } else {
    d = `M ${r2(start.x)} ${r2(start.y)} L ${r2(end.x)} ${r2(end.y)}`;
  }

  return {
    kind: action.kind,
    d,
    seq: action.seq,
    badge: { x: mid.x + -uy * 9, y: mid.y + ux * 9 },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitchSvg.test.js
```

Expected: `Tests  23 passed (23)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitchSvg.js test/pitchSvg.test.js
git commit -m "feat: compute distinct arrow paths per movement kind"
```

---

## Task 14: Render the diagram component

**Files:**
- Create: `src/components/PitchDiagram.jsx`
- Test: `test/pitchDiagram.test.jsx`

Component tests are SSR smoke tests via `renderToStaticMarkup` — no jsdom, matching the
fancystats convention. They assert that the right things reach the DOM, not pixels.

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import PitchDiagram from "../src/components/PitchDiagram.jsx";

const render = (src) => renderToStaticMarkup(<PitchDiagram source={src} />);

describe("PitchDiagram", () => {
  it("renders an svg with the padded viewBox", () => {
    const html = render("area: 40x25 half\n");
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 440 290"');
  });

  it("renders a circle per player and its label", () => {
    const html = render("red: A@10,20 B@25,14\n");
    expect((html.match(/<circle/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
  });

  it("renders a keeper as a rounded rect rather than a circle", () => {
    // The background and the boundary are also rects, so assert on the rounded
    // corner that only the keeper marker uses.
    expect(render("gk: K@0,12\n")).toContain('rx="3"');
    expect(render("red: A@0,12\n")).not.toContain('rx="3"');
  });

  it("renders a path per action with a sequence badge", () => {
    const html = render("red: A@2,2 B@30,20\npass: A->B\n");
    expect(html).toContain("<path");
    expect(html).toContain(">1<");
  });

  it("renders the drill label", () => {
    expect(render('label: "3v2 to end line"\n')).toContain("3v2 to end line");
  });

  it("renders parse errors with their line numbers and keeps the diagram", () => {
    const html = render("area: 40x25 half\ngoal: nope\n");
    expect(html).toContain("line 2");
    expect(html).toContain("<svg");
  });

  it("renders nothing but an error list for wholly invalid source", () => {
    const html = render("!!!\n");
    expect(html).toContain("line 1");
  });

  it("does not throw on empty or missing source", () => {
    expect(() => render("")).not.toThrow();
    expect(() => renderToStaticMarkup(<PitchDiagram />)).not.toThrow();
  });

  it("offsets the label line number when given a base line", () => {
    const html = renderToStaticMarkup(<PitchDiagram source={"goal: nope\n"} baseLine={7} />);
    expect(html).toContain("line 7");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitchDiagram.test.jsx
```

Expected: FAIL — `Failed to resolve import "../src/components/PitchDiagram.jsx"`.

- [ ] **Step 3: Write the implementation**

`baseLine` exists so that a diagram embedded in a drill file reports errors against
the file's line numbers, not the block's — `splitSegments` supplies it.

```jsx
// src/components/PitchDiagram.jsx
// Renders a `pitch` source block. Parse errors are shown inline and the last
// renderable scene is still drawn: a typo must never blank the preview.
import React, { useMemo } from "react";
import { parse } from "../lib/pitch.js";
import { viewBox, toPx, markings, actionPath, S } from "../lib/pitchSvg.js";

const TEAM_FILL = { red: "var(--red)", blue: "var(--blue)", yellow: "var(--yellow)", gk: "var(--gk)" };
const ACTION_STROKE = {
  pass: "var(--ball-line)",
  dribble: "var(--ball-line)",
  run: "var(--run-line)",
  shot: "var(--shot-line)",
};
const ACTION_WIDTH = { pass: 2.4, dribble: 2.4, run: 2.2, shot: 4 };
const R = 7; // player radius, px

function Marking({ shape }) {
  const stroke = { stroke: "var(--paint)", fill: "none", strokeWidth: 1.3 };
  const dash = shape.dashed ? { strokeDasharray: "5 4" } : null;
  if (shape.type === "rect") {
    return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} {...stroke} {...dash} />;
  }
  if (shape.type === "line") {
    return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...stroke} {...dash} />;
  }
  if (shape.type === "circle") {
    return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...stroke} />;
  }
  return <path d={shape.d} {...stroke} />;
}

function Mark({ mark }) {
  const p = toPx(mark.x, mark.y);
  if (mark.kind === "zone") {
    const a = toPx(mark.x, mark.y);
    const label = toPx(mark.x + mark.w / 2, mark.y + mark.h / 2);
    return (
      <g>
        <rect
          x={a.x} y={a.y} width={mark.w * S} height={mark.h * S}
          fill="var(--yellow)" fillOpacity="0.16"
          stroke="var(--yellow)" strokeOpacity="0.7" strokeWidth="1.3" strokeDasharray="5 3"
        />
        {mark.label ? (
          <text x={label.x} y={label.y} fontSize="9" fill="#fff" fillOpacity="0.9" textAnchor="middle">
            {mark.label}
          </text>
        ) : null}
      </g>
    );
  }
  if (mark.kind === "cone") {
    return <path d={`M ${p.x} ${p.y - 5} l 5 10 h -10 z`} fill="var(--cone)" />;
  }
  if (mark.kind === "ball") {
    return <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke="#222" strokeWidth="1" />;
  }
  if (mark.kind === "flag") {
    return (
      <g>
        <line x1={p.x} y1={p.y} x2={p.x} y2={p.y - 22} stroke="#fff" strokeWidth="1.6" />
        <path d={`M ${p.x} ${p.y - 22} l 12 4 l -12 4 z`} fill="var(--shot-line)" />
      </g>
    );
  }
  // goal
  const halfHeight = { full: 3.66, small: 2, mini: 1.2 }[mark.size] * S;
  const depth = 7;
  return (
    <rect
      x={p.x - depth / 2} y={p.y - halfHeight}
      width={depth} height={halfHeight * 2}
      fill="none" stroke="#fff" strokeWidth="2"
    />
  );
}

function Player({ player }) {
  const p = toPx(player.x, player.y);
  const fill = TEAM_FILL[player.team];
  return (
    <g>
      {player.team === "gk" ? (
        <rect x={p.x - R} y={p.y - R} width={R * 2} height={R * 2} rx="3" fill={fill} stroke="#fff" strokeWidth="1" />
      ) : (
        <circle cx={p.x} cy={p.y} r={R} fill={fill} stroke="#fff" strokeWidth="1" />
      )}
      <text x={p.x} y={p.y + 3} fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">
        {player.label}
      </text>
    </g>
  );
}

export default function PitchDiagram({ source = "", baseLine = 1 }) {
  const { scene, errors } = useMemo(() => parse(source), [source]);
  const paths = useMemo(
    () => scene.actions.map((a) => actionPath(a, scene)).filter(Boolean),
    [scene],
  );
  const shapes = useMemo(() => markings(scene.area), [scene.area]);
  const labelAt = toPx(scene.area.w / 2, scene.area.h);

  return (
    <div>
      <svg className="pitch" viewBox={viewBox(scene.area)} role="img">
        <defs>
          {Object.entries(ACTION_STROKE).map(([kind, colour]) => (
            <marker
              key={kind} id={`arrow-${kind}`}
              markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"
            >
              <path d="M0,0 L7,3.5 L0,7 z" fill={colour} />
            </marker>
          ))}
        </defs>

        <rect x="0" y="0" width="100%" height="100%" fill="var(--grass)" />
        {shapes.map((s, i) => <Marking key={i} shape={s} />)}
        {scene.marks.map((m, i) => <Mark key={i} mark={m} />)}
        {paths.map((p, i) => (
          <path
            key={i} d={p.d} fill="none"
            stroke={ACTION_STROKE[p.kind]} strokeWidth={ACTION_WIDTH[p.kind]}
            strokeDasharray={p.kind === "run" ? "6 4" : undefined}
            markerEnd={`url(#arrow-${p.kind})`}
          />
        ))}
        {scene.players.map((p) => <Player key={p.label} player={p} />)}
        {paths.map((p, i) => (
          <g key={`b${i}`}>
            <circle cx={p.badge.x} cy={p.badge.y} r="6.5" fill="#000" fillOpacity="0.55" />
            <text x={p.badge.x} y={p.badge.y + 3} fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle">
              {p.seq}
            </text>
          </g>
        ))}
        {scene.label ? (
          <text x={labelAt.x} y={labelAt.y + 14} fontSize="10" fill="#fff" fillOpacity="0.85" textAnchor="middle">
            {scene.label}
          </text>
        ) : null}
      </svg>

      {errors.length > 0 ? (
        <div className="banner err mono">
          {errors.map((e, i) => (
            <div key={i}>line {e.line + baseLine - 1}: {e.message}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/pitchDiagram.test.jsx
```

Expected: `Tests  9 passed (9)`.

- [ ] **Step 5: Verify the build still succeeds**

```bash
npm run build
```

Expected: `✓ built in ...`. This catches JSX mistakes the SSR tests miss.

- [ ] **Step 6: Commit**

```bash
git add src/components/PitchDiagram.jsx test/pitchDiagram.test.jsx
git commit -m "feat: render pitch scenes as svg with inline parse errors"
```

---

## Task 15: Render a whole drill, and wire up a live preview page

**Files:**
- Create: `src/components/DrillPreview.jsx`
- Create: `test/fixtures/3v2-to-end-line.md`
- Create: `test/fixtures/rondo-4v2.md`
- Create: `test/drillPreview.test.jsx`
- Modify: `src/App.jsx`

This task produces the working software: a page with a markdown textarea on the left
and a rendered drill on the right, updating as you type.

- [ ] **Step 1: Create `test/fixtures/3v2-to-end-line.md`**

````markdown
---
title: 3v2 to end line
category: skill
minutes: 15
players: 8-12
tags: [transition, finishing]
---

Reds attack, blues defend. Score by dribbling over the end line.
Defenders win it back and counter to the small goals.

```pitch
area: 40x25 half
zone: 28,0 12x25 "scoring zone"
goal: 0,12 small
cone: 5,5 5,20 35,5
red: A@10,20 B@25,14 C@34,20
blue: X@18,8 Y@30,7
pass: A->B
run: C~>28,4
dribble: B=>32,12
label: "3v2 to end line"
```

Progression: add a recovering defender after ten seconds.
````

- [ ] **Step 2: Create `test/fixtures/rondo-4v2.md`**

````markdown
---
title: Rondo 4v2
category: warmup
minutes: 10
players: 6-8
tags: [possession, rondo]
---

Four outside, two in the middle. Two-touch maximum.

```pitch
area: 20x20 plain
cone: 0,0 20,0 0,20 20,20
red: A@0,10 B@10,0 C@20,10 D@10,20
blue: X@8,9 Y@12,11
pass: A->B
pass: B->C
label: "4v2 rondo"
```
````

- [ ] **Step 3: Write the failing tests**

```jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import DrillPreview from "../src/components/DrillPreview.jsx";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const render = (src) => renderToStaticMarkup(<DrillPreview source={src} />);

describe("DrillPreview", () => {
  it("renders the title and metadata chips", () => {
    const html = render(fixture("3v2-to-end-line.md"));
    expect(html).toContain("3v2 to end line");
    expect(html).toContain("skill");
    expect(html).toContain("15");
    expect(html).toContain("8-12");
    expect(html).toContain("transition");
  });

  it("renders prose and a diagram from the same file", () => {
    const html = render(fixture("3v2-to-end-line.md"));
    expect(html).toContain("Reds attack, blues defend");
    expect(html).toContain("Progression");
    expect(html).toContain("<svg");
  });

  it("renders every pitch block in the file", () => {
    const src = fixture("rondo-4v2.md");
    expect((render(src).match(/<svg/g) || []).length).toBe(1);
    const two = src + "\n```pitch\narea: 10x10\n```\n";
    expect((render(two).match(/<svg/g) || []).length).toBe(2);
  });

  it("falls back to a placeholder title when there is no frontmatter", () => {
    expect(render("just prose\n")).toContain("Untitled drill");
  });

  it("surfaces a frontmatter error without hiding the body", () => {
    const html = render("---\ntitle: [oops\n---\n\nbody text\n");
    expect(html).toMatch(/yaml/i);
    expect(html).toContain("body text");
  });

  it("reports a pitch error against the file's line numbers", () => {
    const src = "---\ntitle: T\n---\n\nintro\n\n```pitch\ngoal: nope\n```\n";
    expect(render(src)).toContain("line 8");
  });

  it("does not throw on empty input", () => {
    expect(() => render("")).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
npx vitest run test/drillPreview.test.jsx
```

Expected: FAIL — `Failed to resolve import "../src/components/DrillPreview.jsx"`.

- [ ] **Step 5: Write the implementation**

Prose is rendered as paragraphs of plain text for now. Full markdown via `marked` plus
`DOMPurify` arrives in Plan 2, together with the editor — this keeps Plan 1 free of
sanitisation concerns while still being demoable.

```jsx
// src/components/DrillPreview.jsx
// Renders one drill document: metadata header, prose, and every pitch diagram.
// Prose is plain text for now; markdown rendering lands with the editor in Plan 2.
import React, { useMemo } from "react";
import { parseDoc } from "../lib/frontmatter.js";
import { splitSegments } from "../lib/markdown.js";
import PitchDiagram from "./PitchDiagram.jsx";

// The pitch block's line within the FILE = frontmatter lines + its line in the body.
function frontmatterLines(source, body) {
  const consumed = source.length - body.length;
  if (consumed <= 0) return 0;
  return source.slice(0, consumed).split("\n").length - 1;
}

export default function DrillPreview({ source = "" }) {
  const doc = useMemo(() => parseDoc(source), [source]);
  const segments = useMemo(() => splitSegments(doc.body), [doc.body]);
  const offset = useMemo(() => frontmatterLines(source, doc.body), [source, doc.body]);

  const meta = doc.meta ?? {};
  const chips = [meta.category, meta.minutes ? `${meta.minutes}′` : null, meta.players]
    .filter(Boolean)
    .concat(Array.isArray(meta.tags) ? meta.tags : []);

  return (
    <div className="card">
      <h2 style={{ margin: "0 0 6px" }}>{meta.title || "Untitled drill"}</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>

      {doc.error ? <div className="banner warn mono">{doc.error}</div> : null}

      {segments.map((seg, i) =>
        seg.kind === "pitch" ? (
          <PitchDiagram key={i} source={seg.text} baseLine={seg.line + offset} />
        ) : (
          <div key={i}>
            {seg.text.split(/\n{2,}/).map((para, j) =>
              para.trim() ? <p key={j}>{para.trim()}</p> : null,
            )}
          </div>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run test/drillPreview.test.jsx
```

Expected: `Tests  7 passed (7)`.

- [ ] **Step 7: Replace `src/App.jsx` with the preview harness**

```jsx
import React, { useState } from "react";
import DrillPreview from "./components/DrillPreview.jsx";

const SAMPLE = `---
title: 3v2 to end line
category: skill
minutes: 15
players: 8-12
tags: [transition, finishing]
---

Reds attack, blues defend. Score by dribbling over the end line.

\`\`\`pitch
area: 40x25 half
zone: 28,0 12x25 "scoring zone"
goal: 0,12 small
cone: 5,5 5,20 35,5
red: A@10,20 B@25,14 C@34,20
blue: X@18,8 Y@30,7
pass: A->B
run: C~>28,4
dribble: B=>32,12
label: "3v2 to end line"
\`\`\`

Progression: add a recovering defender after ten seconds.
`;

export default function App() {
  const [source, setSource] = useState(SAMPLE);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: "10px 0" }}>ballislife</h1>
        <span className="dim">v{__APP_VERSION__} · pitch language preview</span>
      </div>
      <div className="split">
        <textarea
          className="mono"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          style={{ height: "70vh", width: "100%", resize: "vertical" }}
        />
        <DrillPreview source={source} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the whole suite and the build**

```bash
npm test && npm run build
```

Expected: all test files pass, then `✓ built in ...`.

- [ ] **Step 9: Verify by hand in the browser**

```bash
npm run dev
```

Open http://localhost:5173/ballislife/ and confirm:

1. The sample drill renders a green half-pitch with a shaded scoring zone, a small
   goal, three cones, three red players, two blue players, and numbered arrows.
2. Changing `A@10,20` to `A@10,5` moves player A immediately.
3. Typing `goal: nope` adds a red `line N: ...` banner **and the diagram is still
   drawn**.
4. Deleting the closing ``` of the pitch fence still renders rather than blanking.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: render whole drills with a live pitch language preview"
```

---

## Task 16: Correct two claims in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-ballislife-design.md`

Implementation established two places where the spec is wrong. Leaving them would
mislead whoever reads the spec next.

### Correction 1: the round-trip claim

The spec claims byte-identical round-tripping, which Task 10 established is not
achievable or necessary.

- [ ] **Step 1: Find the claim**

`grep` returns no matches in this sandbox even for strings that are present, so locate
text with node instead:

```bash
node -e 'require("fs").readFileSync("docs/superpowers/specs/2026-08-10-ballislife-design.md","utf8").split("\n").forEach((l,i)=>{if(l.includes("byte-identical"))console.log(i+1,l)})'
```

Expected: one hit in the "Module map" section's dependency-calls list.

- [ ] **Step 2: Replace the sentence**

Change:

> **`pitch.js` parses to a model that serialises back to byte-identical text.** This
> is what makes a drag-to-edit canvas addable later without changing a single stored
> file. Round-trip identity is a tested invariant, not an aspiration.

to:

> **`pitch.js` parses to a model that serialises back to canonical text.** The tested
> invariant is model-level: `parse(serialise(scene)).scene` deep-equals `scene`, and
> `serialise` is stable under re-parse. It is deliberately *not* byte-identical to
> arbitrary source — canonicalisation reorders directives and splits multi-action
> lines. Model-level identity is what makes a drag-to-edit canvas addable later
> without changing a single stored file.

### Correction 2: what a malformed diagram shows

The spec's error-handling section says a malformed `pitch` block "keeps the last good
render". Task 14 does something better and simpler: it renders the **partially parsed
scene**, so every valid line still draws while the bad line is reported. That needs no
retained previous state, and it means a drill that has never rendered successfully
still shows its valid players and cones instead of an empty box.

- [ ] **Step 4: Find the claim**

```bash
node -e 'require("fs").readFileSync("docs/superpowers/specs/2026-08-10-ballislife-design.md","utf8").split("\n").forEach((l,i)=>{if(l.includes("last good render"))console.log(i+1,l)})'
```

Expected: one hit in the "Error handling" section.

- [ ] **Step 5: Replace the bullet**

Change:

> - **Malformed `pitch` block** — the preview shows the parse error inline with a line
>   number and what was expected (`line 4: expected x,y`) and keeps the last good
>   render. A typo must never produce a blank pane.

to:

> - **Malformed `pitch` block** — the preview shows the parse error inline with a line
>   number and what was expected (`line 4: expected x,y`) and renders the partially
>   parsed scene, so every valid line still draws. A typo must never produce a blank
>   pane, and a drill that has never parsed cleanly still shows whatever is valid.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-ballislife-design.md
git commit -m "docs: correct the round-trip invariant and diagram error behaviour"
```

---

## Done when

- `npm test` passes every suite
- `npm run build` succeeds
- The dev server renders the sample drill, updates live as the source is edited, and
  shows inline parse errors without ever blanking the diagram
- `CLAUDE.md` records the environment, architecture and invariants for the next session

## What Plan 2 covers

Written after this plan lands, against the real parser:

- `lib/drive.js` — port fancystats' auth, plus `/BallIsLife` folder find-or-create and
  file CRUD
- `lib/index.js` — build, diff and repair `index.json` against a `files.list` of ids
  and `modifiedTime`s
- `lib/drills.js` — drill model, category and tag filtering, search, slug rules
- `marked` + `DOMPurify` for prose rendering
- The card grid browse view and the three-pane editor, with the mobile collapse
- Per-file debounced saving with conflict detection on `modifiedTime`
