# ballislife — design

**Date:** 2026-08-10
**Status:** approved, ready for implementation planning

A personal soccer drill catalogue and (later) training session planner. Client-only
React app on GitHub Pages, drills stored as markdown files in the owner's Google
Drive. Deliberately modelled on `~/workspace/fancystats` — same stack, same
architectural rules, same auth code.

## Scope

**v1 is the drill catalogue and editor only.** Session planning, offline support and
a configurable slot template are designed for below but explicitly deferred, so that
they can be built against thirty real drills rather than guesses.

In v1:

- Browse drills as a card grid, each card's pitch diagram acting as its thumbnail
- Filter by category and tags; text search
- Three-pane editor: drill list, markdown source, live preview
- A `pitch` diagram language: parser, renderer, and inline error reporting
- Create, rename and delete drills against a visible Google Drive folder

Not in v1: session builder, offline/service worker, configurable slot template,
drag-to-edit diagram canvas, multi-frame `pitch` blocks.

## Architecture

Client-only React 18 + Vite, static build, no server. Deployed to GitHub Pages by
GitHub Actions on push to `main`. Node 20 (`.nvmrc`). Vitest for tests.
`base: "/ballislife/"`.

The fancystats rule carries over verbatim: **pure logic in `src/lib/`, thin components
in `src/components/`.** Domain rules live in unit-tested pure functions; components
only wire state and render. New derivations belong in lib with tests, never in
components.

### Module map

Each module has one job, a narrow interface, and tests.

| Module | Job | Depends on |
| --- | --- | --- |
| `lib/drive.js` | Auth (ported from fancystats) plus folder find-or-create, list, read, write, rename, delete | — |
| `lib/index.js` | Build, diff and repair `index.json` against a `files.list` result | pure |
| `lib/frontmatter.js` | `.md` text ⇄ `{meta, body}` | js-yaml |
| `lib/pitch.js` | `pitch` source ⇄ scene model, round-trippable in both directions | pure |
| `lib/pitchSvg.js` | Scene model → SVG: metres→viewBox, markings, marks, arrows | `pitch.js` |
| `lib/drills.js` | Drill model; filter by category and tags, search, slug rules | `frontmatter.js` |
| `components/` | Grid, three-pane editor, pitch preview, Drive status. Thin. | all of the above |

Two deliberate dependency calls:

- **js-yaml rather than a hand-rolled frontmatter parser.** Hand-rolled YAML subsets
  are a reliable source of silent bugs; ~10kB gzipped is a fair price.
- **`pitch.js` parses to a model that serialises back to canonical text.** The tested
  invariant is model-level: `parse(serialise(scene)).scene` deep-equals `scene`, and
  `serialise` is stable under re-parse. It is deliberately *not* byte-identical to
  arbitrary source — canonicalisation reorders directives and splits multi-action
  lines. Model-level identity is what makes a drag-to-edit canvas addable later
  without changing a single stored file.

## Authentication

Port `fancystats/src/lib/drive.js` as-is. Its token lifecycle, silent reauth,
401-retry and keep-alive behaviour are hard-won and must not be rewritten.

Two changes only:

- Scope becomes `https://www.googleapis.com/auth/drive` (fancystats uses
  `drive.appdata`)
- `TOK_KEY` becomes `ballislife_tok`, so the two apps do not contend over
  `sessionStorage`

**The fancystats OAuth client ID is reused.** Its authorised origins
(`seaninryan.github.io`, `localhost:5173`) already cover this app. Consequence
accepted: the consent screen will say "fancystats", and the two apps' grants are not
independently revocable.

Broad `drive` scope is required because the app must see markdown files the owner
creates outside it — dropped into the folder from the Drive web UI or pasted from
claude.ai. `drive.file` scope only exposes files the app itself created, and was
rejected for that reason. The token never leaves the browser; there is no server.

Only the owner signs in. There is no sharing and no multi-user model.

**Owner gate.** After a successful sign-in the app reads the authenticated account's
email and refuses to proceed unless it matches the owner. The `drive` scope already
permits this, so no extra scope is needed:

```js
GET https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)
```

A mismatch signs the token out and shows "this app is for its owner only" rather than
loading anything.

**The address is stored as a hash, not in the clear**, because this repo is public and
a plaintext personal email in a public repo gets harvested by address scrapers. The
check compares the SHA-256 of the signed-in address, trimmed and lower-cased:

```js
// sha256("<the owner's gmail address>") — the address itself is deliberately not
// committed, since this repo is public and scrapers harvest plaintext addresses.
const OWNER_EMAIL_SHA256 =
  "9620eb10792df98e40aa9814000f894744e9add26225d3aa834e707c6a6c3596";

const digest = async (email) => {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
```

`crypto.subtle` is available in every browser this app targets and needs no dependency.
Hashing adds no security — a determined person could guess the address — but it removes
the one concrete downside of committing it, which is automated scraping.

**What this does and does not protect.** The deployed site is publicly readable — that
is inherent to GitHub Pages on a public repo, and the app's HTML and JS carry nothing
sensitive. The gate stops a stranger who finds the URL from *using this deployment*
against their own Drive. It is deliberately **not** a security boundary: the repo is
public, so anyone can fork it, delete the check and run their own copy. Nothing is lost
if they do, because the drills live in the owner's Drive and are protected by Google's
authentication, not by this check. The gate buys tidiness, not secrecy.

**Dev port caveat:** the reused client ID authorises `localhost:5173`. Running the
fancystats and ballislife dev servers simultaneously pushes the second onto 5174,
which is not an authorised origin and will fail sign-in. Run one at a time, or add
5174 to the client's authorised origins.

## Storage

A visible `/BallIsLife` folder in the owner's Drive, found-or-created by name
(`mimeType = 'application/vnd.google-apps.folder'`, `trashed = false`).

One `.md` file per drill, **flat, no subfolders.** Category is frontmatter, not
directory structure, so re-filing a drill is a field edit and never a file move.
The filename slug is the drill's stable id (`3v2-to-end-line.md`); renaming a drill
renames the Drive file.

### Drill file format

````markdown
---
title: 3v2 to end line
category: skill
minutes: 15
players: 8-12
tags: [transition, finishing]
---

Reds attack, blues defend. Score by dribbling over the end line.

```pitch
area: 40x25 half
red:  A@10,20  B@25,14  C@34,20
blue: X@18,8   Y@30,7
cone: 5,5  5,20  35,5
pass: A->B  B->C
run:  C~>goal
label: "3v2 to end line"
```
````

Frontmatter fields:

- `title` — display name; falls back to the slug if absent
- `category` — one of `warmup`, `skill`, `tactical`, `match`, `fun`. Hardcoded in
  v1. This list came from how the owner actually structures a session: a warm up, a
  skill one, a tactical one, a match, and maybe a fun thing.
- `minutes` — integer, for later session duration totals
- `players` — a range like `8-12`, for later squad-size filtering
- `tags` — free list; the primary search axis

Age group, level, equipment and pitch area were considered and cut. Only one squad is
coached, and equipment lists are prose in the body until a session kit list needs
them.

### The index

`index.json` lives in `/BallIsLife` and caches each drill's frontmatter and `pitch`
source, keyed by `fileId`, alongside the `modifiedTime` it was built from. The card
grid needs every drill's frontmatter *and* diagram to draw thumbnails, so lazy
per-drill fetching cannot serve the landing view.

The cache lives in Drive rather than `localStorage` specifically so it is shared
across devices — a phone gets the fast cold load too, not only the browser that
built it.

**Invariant: `index.json` is disposable and never authoritative.**

Every app load performs one `files.list` returning each file's `id` and
`modifiedTime`, and diffs it against the index:

- `modifiedTime` matches → serve from the index, no download
- mismatch, or file absent from the index → refetch that file, update the index
- file in the index but not in Drive → drop the entry
- index missing or unparseable → rebuild from scratch by fetching everything

This is what makes the cache safe despite the "nothing derived is ever stored" rule
inherited from fancystats: the index is always validated against the authoritative
file list before use, so it cannot silently serve stale data after the owner edits a
drill directly in Drive. It also makes concurrent writes from two devices a
non-issue — latest write wins, and the next load repairs any loss.

`index.json` is excluded from the drill listing by extension.

### Saving

Per-file, debounced, latest-wins **per file** — port fancystats' `saveLatest` keyed by
`fileId` rather than a single global queue. Never a whole-folder write. After a
successful drill save, the corresponding index entry is updated and `index.json` is
written on a debounce.

**Conflict detection:** if a file's `modifiedTime` has moved since it was loaded (the
owner edited it in Drive or on another device), warn before overwriting rather than
clobbering.

## The `pitch` language

A fenced ```` ```pitch ```` block inside the markdown, parsed by `lib/pitch.js` and
rendered to SVG by `lib/pitchSvg.js`.

Chosen over two alternatives. Mermaid renders a flowchart, not a pitch — it has no
spatial truth, so a rondo and a back-four shape look identical. Raw inline SVG looks
correct and needs no code, but makes the markdown unreadable and un-editable by hand:
nudging one player means editing coordinates, so every change becomes a round-trip to
claude.ai. A small DSL keeps the source readable in Drive, hand-editable, and
reliably generatable by claude.ai from a written grammar.

### Vocabulary

Coordinates are in **metres**, origin top-left, and are mapped to the SVG viewBox by
the renderer.

Surface:

- `area: 40x25 half` — dimensions plus a markings preset: `half`, `full`, `box`,
  `third`, `plain`
- `zone: 12,0 16x25 "press here"` — a shaded region with an optional label, for
  pressing zones, thirds, offside lines and no-go areas

Objects:

- `red: A@8,12 B@20,6` / `blue: X@15,12` — team-coloured circles with short labels
- `gk: K@2,12` — square marker for a keeper
- `cone: 4,4 4,21 30,12`
- `ball: 10,12`
- `goal: 0,12 small` — sizes `full`, `small`, `mini`
- `flag: 36,4` — corner flags and poles

Movement, each with a distinct visual grammar so a reader can tell them apart at a
glance:

- `pass: A->B` — solid line; the ball travels
- `run: C~>28,4` — dashed line; a player moves without the ball
- `dribble: B=>32,12` — wavy line; a player carries the ball
- `shot: C->>goal` — thick line; a shot or long delivery

Targets may be another player's label, a coordinate, or `goal`.

**Action numbering is included.** Declaration order renders as `1, 2, 3…` badges on
each movement arrow, so a reader knows the pass precedes the run. Near-zero render
cost, and it is what makes a busy drill legible.

**Multi-frame blocks are deferred.** A `--- step: "…" ---` divider splitting one block
into several side-by-side diagrams was considered and cut from v1: writing two
separate `pitch` blocks in the markdown already achieves phase 1 / phase 2 for free.
Revisit if a drill appears that genuinely needs frames rendered side by side.

## Rendering

`marked` for markdown, `DOMPurify` to sanitise. `pitch` fences are extracted **before**
markdown runs and rendered as SVG components; everything else is ordinary markdown.

Sanitising is not optional despite the content being self-authored: drills arrive as
text pasted from claude.ai, and markdown permits raw HTML.

## User interface

Two views, because browsing and editing want opposite layouts.

**Browse — card grid.** Category filter chips across the top, then a grid of cards
where each card is the drill's rendered `pitch` diagram as a thumbnail, with title,
category and duration beneath. The diagram *is* the recognition cue; this is the view
that answers "what do I actually own".

**Edit — three panes.** Drill list on the left, markdown source in the middle, live
preview on the right. The diagram redraws as the source is typed, which matters most
precisely when `pitch` coordinates are being adjusted.

On narrow screens the three-pane editor collapses to list → read-only preview, with
source behind an Edit button. A phone at the side of a pitch is a reading device.

## Error handling

Three failure modes, each with an explicit answer, all chosen so that no state is ever
silently hidden:

- **Malformed `pitch` block** — the preview shows the parse error inline with a line
  number and what was expected (`line 4: expected x,y`) and renders the partially
  parsed scene, so every valid line still draws. A typo must never produce a blank
  pane, and a drill that has never parsed cleanly still shows whatever is valid.
- **Drive save failure** — surfaces in the header status and retries via the ported
  `saveWithRetry`; auth expiry raises the reconnect banner.
- **Invalid frontmatter** — the drill still appears in the grid, flagged, and opens in
  the editor so it can be fixed. Never dropped from the listing.

## Testing

Vitest in the node environment, no jsdom — the same split as fancystats.

- `lib/pitch.js` is the primary test target: parse fixtures and assert the model,
  assert round-trip identity (`serialise(parse(src)) === src`), and assert that bad
  input yields a useful error rather than a throw
- `lib/index.js`: diff logic against synthetic `files.list` payloads — match, stale,
  new, deleted, corrupt index
- `lib/frontmatter.js`, `lib/drills.js`: parse, serialise, filter, search, slug rules
- `lib/pitchSvg.js`: `renderToStaticMarkup` snapshots
- Components: SSR smoke tests only; interaction coverage is manual after deploy

## Deferred, and how this design accommodates it

- **Session builder.** Slot-based (warmup → skill → tactical → match → fun),
  drag-and-drop, drill picker filtered by category and by tonight's squad size,
  running duration total against session length. **Sessions store as JSON, not
  markdown** — they are ordered lists of drill references plus future structured
  fields like attendance, not prose documents. Sessions reference drills by slug
  rather than copying content, so correcting a drill retroactively fixes every session
  that used it; broken references must be shown, never silently dropped.
- **Offline.** Read-only service worker caching of the app shell and drills, so a
  session opens with no signal pitch-side. Read-only is dramatically cheaper than
  offline editing with sync, and is enough.
- **Configurable slot template.** The category list moves from hardcoded to a Settings
  field.
- **Drag-to-edit diagrams.** A canvas that manipulates the `pitch` scene model
  directly. Enabled by `pitch.js` round-trip identity; requires no storage change.
  Two constraints it must respect: `serialise` sorts actions by `seq`, so reordering
  must renumber `seq` or the reorder silently does nothing; and `#` comments in a
  `pitch` block are stripped by `parse` and have no home in the scene model, so writing
  back through `serialise` loses any a coach hand-wrote.

## Deploy

Push to `main` → GitHub Actions → Pages, mirroring fancystats' workflow
(`npm ci`, `npm test`, `npm run build`, upload `dist`). Bump `package.json` version
first; the version renders in the app footer and is the cache tell.
