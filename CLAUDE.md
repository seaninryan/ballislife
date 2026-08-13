# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Environment — read this first

Confirm `node -v` reports v20. If it reports v14, this shell is on system Node, which
silently breaks Vite and Vitest:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

`grep` is broken in this sandbox — it exits 1 with no output even for strings that are
present. Never use it to verify absence; use the Grep tool or node.

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

A personal soccer drill catalogue and session planner. Client-only React app, no server.
Drills are markdown files in the owner's Google Drive `/BallIsLife` folder; each session
plan is a JSON file in `/BallIsLife/sessions/`. Only the owner signs in.

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
- **Both Drive index caches are disposable and never authoritative** (Plan 2, and the
  session-files plan): `index.json` for drills, `sessions/index.json` for plans. Every load
  validates each against a `files.list` of ids and `modifiedTime`s and repairs any drift.
  Never trust either without that check.
- **One file per session plan is the authority:** `sessions/<id>.json`, id ↔ file name via
  `sessions.js`. A Done tap rewrites one small file, a conflict on tonight's plan cannot
  block saving another, and one corrupt file costs one plan. The pre-split `sessions.json`
  blob is migrated on first load and renamed to `sessions-before-split.json` — a visible
  backup only the owner deletes. Never re-introduce a whole-folder or whole-blob write.
- **Nothing derived is stored in a drill file.** Diagrams render from the `pitch`
  source at display time.

## Testing conventions

Vitest in the node environment — no jsdom. Lib tests assert on plain models. Component
tests are SSR smoke tests via `renderToStaticMarkup`; interaction coverage is manual.
Prefer fixtures in `test/fixtures/` over hand-built objects.

## Workflow

Specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Read
the relevant spec before extending a feature.
