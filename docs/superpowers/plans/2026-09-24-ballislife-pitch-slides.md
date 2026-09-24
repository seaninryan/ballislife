# Animated Pitch Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `pitch` block can hold slides — each an edit of the one before — and the drill view plays them with Play / Pause / Replay, players and balls gliding between slides.

**Architecture:** `pitch.js` parses slides into a delta model on the scene (round-trip preserved). A new pure `slides.js` replays those deltas into complete frames and diffs two frames into what to draw (entering / leaving items). A pure reducer in `playback.js` decides what comes next. `PitchDiagram` only wires the reducer to timers and renders the staged frame; CSS transitions do the gliding.

**Tech Stack:** React 18, Vitest 2 (node env, SSR smoke tests), plain CSS transitions. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-pitch-slides-design.md` — read it first.

---

## Before you start

- `node -v` must say v20. If not: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- `grep` is broken in this sandbox (exits 1 with no output). Use the Grep tool or `node -e`.
- Work on a branch, not `main`: `git switch -c pitch-slides`.
- Baseline: `npm test` → 919 passed.

## File map

| File | Responsibility |
|---|---|
| `src/lib/pitch.js` (modify) | Parse/serialise: `loop`, ball-at-player, `slide:`, `remove:`, `clear:`, per-slide validation |
| `src/lib/slides.js` (create) | `frames(scene)` — replay slides into whole frames; `stage(prev, next)` — what to draw |
| `src/lib/playback.js` (create) | Pure reducer: play / pause / tick / reset, and the timing constants |
| `src/components/PitchDiagram.jsx` (modify) | Render a staged frame; controls and timers when `animated` |
| `src/components/DrillPreview.jsx` (modify) | Pass `animated` |
| `src/components/PitchHelp.jsx` (modify) | "Animating it" section |
| `src/styles.css` (modify) | Glide / fade / reduced-motion rules |
| `test/pitch.test.js`, `test/slides.test.js`, `test/playback.test.js`, `test/pitchDiagram.test.jsx`, `test/pitchHelp.test.jsx` | Tests |
| `test/fixtures/3v2-animated.md` (create) | Worked example drill |

---

### Task 1: `loop:` and a ball at a player's feet (base only)

**Files:**
- Modify: `src/lib/pitch.js`
- Test: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`:

```js
describe("parse: loop", () => {
  it("defaults to off", () => {
    expect(parse("area: 40x25\n").scene.loop).toBe(false);
  });

  it("reads on and off", () => {
    expect(parse("loop: on\n").scene.loop).toBe(true);
    expect(parse("loop: off\n").scene.loop).toBe(false);
  });

  it("rejects anything else", () => {
    expect(parse("loop: maybe\n").errors).toEqual([
      { line: 1, message: 'expected "on" or "off" but got "maybe"' },
    ]);
  });
});

describe("parse: a ball at a player's feet", () => {
  it("accepts a player label as a ball token, declared before or after", () => {
    const { scene, errors } = parse("ball: 10,12 B\nred: B@3,4\n");
    expect(errors).toEqual([]);
    expect(scene.marks).toEqual([
      { kind: "ball", x: 10, y: 12 },
      { kind: "ball", ref: "B" },
    ]);
  });

  it("drops a ball at an unknown player with an error on its line", () => {
    const { scene, errors } = parse("red: A@1,1\nball: Z 2,2\n");
    expect(errors).toEqual([{ line: 2, message: 'unknown player "Z"' }]);
    expect(scene.marks).toEqual([{ kind: "ball", x: 2, y: 2 }]);
  });

  it("names both accepted forms for a token that is neither", () => {
    expect(parse("ball: 9x\n").errors).toEqual([
      { line: 1, message: 'expected "<x>,<y>" or a player label but got "9x"' },
    ]);
  });

  it("round-trips a ball at a player and loop", () => {
    const { scene } = parse("red: B@3,4\nball: B 1,1\nloop: on\n");
    const once = serialise(scene);
    expect(once).toBe(["area: 40x25", "ball: B 1,1", "red: B@3,4", "loop: on", ""].join("\n"));
    expect(parse(once).scene).toEqual(scene);
    expect(serialise(parse(once).scene)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitch.test.js`
Expected: the new tests FAIL (`scene.loop` undefined, `unknown directive "loop"`, ball token errors).

- [ ] **Step 3: Implement**

In `src/lib/pitch.js`:

1. `emptyScene` gains the two fields (the slides array is used from Task 2):

```js
function emptyScene() {
  return {
    area: { ...DEFAULT_AREA }, marks: [], players: [], actions: [], label: null,
    loop: false, slides: [],
  };
}
```

2. Below `POINT_RE`/`ZONE_RE`, add:

```js
// A player label on its own, as a ball token: "ball: B" puts the ball at B's feet.
const LABEL_RE = /^[A-Za-z][A-Za-z0-9]{0,3}$/;
```

3. After `parsePointMarks`, add:

```js
// "10,12 B" -> a ball per token. A player label puts the ball at that player's feet,
// so it follows them from slide to slide. Like an action endpoint, the label is checked
// only once every player is known, because it may be declared on a later line.
function parseBalls(rest, ctx) {
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    const p = parsePoint(token);
    if (p) { ctx.scene.marks.push({ kind: "ball", ...p }); continue; }
    if (!LABEL_RE.test(token)) {
      ctx.fail(`expected "<x>,<y>" or a player label but got "${token}"`);
      continue;
    }
    const ball = { kind: "ball", ref: token };
    ctx.scene.marks.push(ball);
    ctx.ballRefs.push({ ball, list: ctx.scene.marks, line: ctx.line });
  }
}

function parseLoop(rest, ctx) {
  if (rest === "on" || rest === "off") ctx.scene.loop = rest === "on";
  else ctx.fail(`expected "on" or "off" but got "${rest}"`);
}
```

4. Register them after the existing `for` loops that fill `DIRECTIVES`:

```js
DIRECTIVES.ball = parseBalls;
DIRECTIVES.loop = parseLoop;
```

5. In `parse`, add `const ballRefs = [];` beside `pending`, pass `ballRefs` in the handler ctx, and after the action-resolution loop (before the sort):

```js
  for (const r of ballRefs) {
    if (scene.players.some((p) => p.label === r.ball.ref)) continue;
    errors.push({ line: r.line, message: `unknown player "${r.ball.ref}"` });
    r.list.splice(r.list.indexOf(r.ball), 1);
  }
```

6. In `serialise`: add beside `pt`:

```js
// A ball may stand at a player rather than a coordinate.
const tok = (o) => (o.ref !== undefined ? o.ref : pt(o));
```

change the generic mark run to `lines.push(\`${run.key}: ${run.items.map(tok).join(" ")}\`);`, and after the `label` block add:

```js
  if (scene.loop) lines.push("loop: on");
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitch.test.js`
Expected: all PASS, including the existing generated round-trip test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: a ball can stand at a player, and a diagram can say it loops"
```

---

### Task 2: Parse slides

**Files:**
- Modify: `src/lib/pitch.js`
- Test: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`:

```js
const EMPTY_SLIDE = {
  caption: null, players: [], removes: [], clear: { arrows: false, balls: false },
  balls: null, actions: [],
};

describe("parse: slides", () => {
  it("has none by default", () => {
    expect(parse("red: A@1,1\n").scene.slides).toEqual([]);
  });

  it("starts a slide with an optional caption and leaves the base untouched", () => {
    const { scene, errors } = parse('red: A@1,1\nslide: "go"\nred: A@5,5\nslide:\n');
    expect(errors).toEqual([]);
    expect(scene.players).toEqual([{ team: "red", label: "A", x: 1, y: 1 }]);
    expect(scene.slides).toEqual([
      { ...EMPTY_SLIDE, caption: "go", players: [{ team: "red", label: "A", x: 5, y: 5 }] },
      EMPTY_SLIDE,
    ]);
  });

  it("rejects the fixed directives inside a slide", () => {
    for (const line of ["area: 10x10", "goal: 0,5", "zone: 1,1 2x2", "cone: 1,1", "flag: 1,1", "loop: on", "label: x"]) {
      const key = line.split(":")[0];
      expect(parse(`slide:\n${line}\n`).errors, line).toEqual([
        { line: 2, message: `"${key}" is set on the first slide and cannot change on a later one` },
      ]);
    }
  });

  it("rejects remove and clear before the first slide", () => {
    expect(parse("red: A@1,1\nremove: A\n").errors).toEqual([
      { line: 2, message: '"remove" only works on a slide, after a "slide:" line' },
    ]);
    expect(parse("clear: arrows\n").errors).toEqual([
      { line: 1, message: '"clear" only works on a slide, after a "slide:" line' },
    ]);
  });

  it("does not let a player change team", () => {
    const { scene, errors } = parse("red: A@1,1\nslide:\nblue: A@2,2\n");
    expect(errors).toEqual([{ line: 3, message: '"A" is red, not blue — players do not change team' }]);
    expect(scene.slides[0].players).toEqual([]);
  });

  it("adds a player with a new label", () => {
    const { scene, errors } = parse("red: A@1,1\nslide:\nblue: X@2,2\n");
    expect(errors).toEqual([]);
    expect(scene.slides[0].players).toEqual([{ team: "blue", label: "X", x: 2, y: 2 }]);
  });

  it("rejects a duplicate placement on one slide", () => {
    expect(parse("slide:\nred: A@1,1 A@2,2\n").errors).toEqual([
      { line: 2, message: 'duplicate player label "A"' },
    ]);
  });

  it("removes players, and rejects unknown ones", () => {
    const { scene, errors } = parse("red: A@1,1 B@2,2\nslide:\nremove: A Z\n");
    expect(errors).toEqual([{ line: 3, message: 'unknown player "Z"' }]);
    expect(scene.slides[0].removes).toEqual(["A"]);
  });

  it("rejects placing and removing the same player on one slide, in either order", () => {
    const msg = '"A" is both placed and removed on this slide';
    expect(parse("red: A@1,1\nslide:\nred: A@2,2\nremove: A\n").errors).toEqual([{ line: 4, message: msg }]);
    expect(parse("red: A@1,1\nslide:\nremove: A\nred: A@2,2\n").errors).toEqual([{ line: 4, message: msg }]);
  });

  it("numbers a slide's actions from 1 and resolves them against the players at that slide", () => {
    const { scene, errors } = parse(
      "red: A@1,1 B@2,2\npass: A->B\nslide:\npass: B->A\nrun: A~>N\nred: N@4,4\n",
    );
    expect(errors).toEqual([]);
    expect(scene.actions).toEqual([{ kind: "pass", from: "A", to: { ref: "B" }, seq: 1 }]);
    expect(scene.slides[0].actions).toEqual([
      { kind: "pass", from: "B", to: { ref: "A" }, seq: 1 },
      { kind: "run", from: "A", to: { ref: "N" }, seq: 2 },
    ]);
  });

  it("does not resolve an action to a player removed on that slide", () => {
    expect(parse("red: A@1,1 B@2,2\nslide:\nremove: B\npass: A->B\n").errors).toEqual([
      { line: 4, message: 'unknown player "B"' },
    ]);
  });

  it("collects a slide's balls, concatenating several lines", () => {
    const { scene, errors } = parse("red: A@1,1\nslide:\nball: A 3,3\nball: 4,4\n");
    expect(errors).toEqual([]);
    expect(scene.slides[0].balls).toEqual([{ ref: "A" }, { x: 3, y: 3 }, { x: 4, y: 4 }]);
  });

  it("rejects an empty ball line on a slide, and drops an unknown ball player", () => {
    expect(parse("slide:\nball:\n").errors).toEqual([
      { line: 2, message: 'expected at least one ball — use "clear: balls" for none' },
    ]);
    const { scene, errors } = parse("slide:\nball: Z 1,1\n");
    expect(errors).toEqual([{ line: 2, message: 'unknown player "Z"' }]);
    expect(scene.slides[0].balls).toEqual([{ x: 1, y: 1 }]);
  });

  it("reads clear targets", () => {
    expect(parse("slide:\nclear: arrows balls\n").scene.slides[0].clear).toEqual({ arrows: true, balls: true });
    expect(parse("slide:\nclear: cones\n").errors).toEqual([
      { line: 2, message: 'unknown clear target "cones" (expected arrows, balls)' },
    ]);
    expect(parse("slide:\nclear:\n").errors).toEqual([
      { line: 2, message: 'expected "arrows", "balls" or both' },
    ]);
  });

  it("keeps building the other slides when one slide line is bad", () => {
    const { scene, errors } = parse(
      "red: A@1,1\nslide:\ncone: 1,1\nred: A@2,2\nslide:\nred: A@3,3\n",
    );
    expect(errors.map((e) => e.line)).toEqual([3]);
    expect(scene.slides.map((s) => s.players[0].x)).toEqual([2, 3]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitch.test.js -t "parse: slides"`
Expected: FAIL (`unknown directive "slide"` and friends).

- [ ] **Step 3: Implement**

In `src/lib/pitch.js`:

1. Export the clear targets beside `ARROWS`:

```js
export const CLEAR_TARGETS = ["arrows", "balls"];
```

2. Replace `parsePlayers` with a version that knows about slides and uses the roster (label → team of every player on the pitch at this point in the source):

```js
// "A@10,20 B@25,14" -> one player per token. A bad token fails alone.
// On a slide, naming a player who is already on moves them; a new label adds one.
function parsePlayers(team) {
  return (rest, ctx) => {
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      const m = token.match(/^([A-Za-z][A-Za-z0-9]{0,3})@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      if (!m) {
        // Name the real problem when the label is simply too long. Drills get pasted
        // from an LLM, which reaches for words like STRIKER, and "expected
        // <label>@<x>,<y>" gives no clue what is actually wrong with that.
        const long = token.match(/^([A-Za-z][A-Za-z0-9]{4,})@/);
        ctx.fail(long
          ? `player label "${long[1]}" is too long (max 4 characters)`
          : `expected "<label>@<x>,<y>" but got "${token}"`);
        continue;
      }
      const player = { team, label: m[1], x: Number(m[2]), y: Number(m[3]) };
      const problem = ctx.slide
        ? placementProblem(ctx, player)
        : ctx.roster.has(player.label) && `duplicate player label "${player.label}"`;
      if (problem) { ctx.fail(problem); continue; }
      (ctx.slide ?? ctx.scene).players.push(player);
      ctx.roster.set(player.label, team);
    }
  };
}

function placementProblem({ slide, roster }, { team, label }) {
  if (slide.players.some((p) => p.label === label)) return `duplicate player label "${label}"`;
  if (slide.removes.includes(label)) return `"${label}" is both placed and removed on this slide`;
  const was = roster.get(label);
  if (was && was !== team) return `"${label}" is ${was}, not ${team} — players do not change team`;
  return null;
}
```

3. Replace `parseBalls` (from Task 1) with the slide-aware version:

```js
// "10,12 B" -> a ball per token. A player label puts the ball at that player's feet,
// so it follows them from slide to slide. Like an action endpoint, the label is checked
// only once every player in the section is known.
//
// The base's balls live in marks, in source order with the cones. A slide's balls
// REPLACE the previous slide's, so they are collected on the slide — and only created
// when a valid token arrives, so a line of nothing but typos leaves the balls unchanged
// rather than silently clearing them.
function parseBalls(rest, ctx) {
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (ctx.slide && tokens.length === 0) {
    return ctx.fail('expected at least one ball — use "clear: balls" for none');
  }
  const kind = ctx.slide ? {} : { kind: "ball" };
  const add = (ball) => {
    const list = ctx.slide ? (ctx.slide.balls ??= []) : ctx.scene.marks;
    list.push(ball);
    return list;
  };
  for (const token of tokens) {
    const p = parsePoint(token);
    if (p) { add({ ...kind, ...p }); continue; }
    if (!LABEL_RE.test(token)) {
      ctx.fail(`expected "<x>,<y>" or a player label but got "${token}"`);
      continue;
    }
    const ball = { ...kind, ref: token };
    ctx.ballRefs.push({ ball, list: add(ball), line: ctx.line });
  }
}
```

4. Add after `parseLoop`:

```js
function parseRemove(rest, ctx) {
  for (const label of rest.split(/\s+/).filter(Boolean)) {
    if (ctx.slide.players.some((p) => p.label === label)) {
      ctx.fail(`"${label}" is both placed and removed on this slide`);
      continue;
    }
    if (!ctx.roster.has(label)) { ctx.fail(`unknown player "${label}"`); continue; }
    ctx.slide.removes.push(label);
    ctx.roster.delete(label);
  }
}

function parseClear(rest, ctx) {
  const targets = rest.split(/\s+/).filter(Boolean);
  if (targets.length === 0) return ctx.fail('expected "arrows", "balls" or both');
  for (const t of targets) {
    if (CLEAR_TARGETS.includes(t)) ctx.slide.clear[t] = true;
    else ctx.fail(`unknown clear target "${t}" (expected ${CLEAR_TARGETS.join(", ")})`);
  }
}

// The ground and the equipment on it are set before play starts. A slide that moved a
// cone would show kit teleporting mid-drill, so these are the base's alone.
const BASE_ONLY = new Set(["area", "goal", "zone", "cone", "flag", "loop", "label"]);
// These only mean something relative to an earlier slide.
const SLIDE_ONLY = new Set(["remove", "clear"]);

function newSlide(caption) {
  return {
    caption, players: [], removes: [], clear: { arrows: false, balls: false },
    balls: null, actions: [],
  };
}
```

and register: `DIRECTIVES.remove = parseRemove; DIRECTIVES.clear = parseClear;`

5. `resolveTarget` takes a label test rather than the scene:

```js
// A target is a player label, the literal "goal", or a coordinate.
function resolveTarget(raw, known) {
  if (raw === "goal") return { ok: true, to: { ref: "goal" } };
  const p = parsePoint(raw);
  if (p) return { ok: true, to: p };
  if (known(raw)) return { ok: true, to: { ref: raw } };
  return { ok: false, message: `unknown player "${raw}"` };
}
```

6. Add the section resolver (it absorbs the second pass and Task 1's ball-ref loop):

```js
// Resolves the endpoints collected for the section just finished — the base, or one
// slide — against the players on the pitch at its end. Deferred to the end of the
// section so a player may be declared on a later line of it; per section, because a
// slide can add and remove players, so "who exists" differs from slide to slide.
function closeSection(scene, state, errors) {
  const known = (label) => state.roster.has(label);
  const into = state.slide ? state.slide.actions : scene.actions;
  for (const a of state.pending) {
    if (!known(a.fromRaw)) {
      errors.push({
        line: a.line,
        message: `expected a player label as the source, got "${a.fromRaw}"`,
      });
      continue;
    }
    const t = resolveTarget(a.toRaw, known);
    if (!t.ok) { errors.push({ line: a.line, message: t.message }); continue; }
    into.push({ kind: a.kind, from: a.fromRaw, to: t.to, seq: into.length + 1 });
  }
  for (const r of state.ballRefs) {
    if (known(r.ball.ref)) continue;
    errors.push({ line: r.line, message: `unknown player "${r.ball.ref}"` });
    r.list.splice(r.list.indexOf(r.ball), 1);
  }
  state.pending = [];
  state.ballRefs = [];
}
```

7. Replace `parse` with:

```js
export function parse(src) {
  const scene = emptyScene();
  const errors = [];
  // `roster` is every player on the pitch at the current point in the source, label ->
  // team. It only grows in the base; slides add to it and remove from it.
  const state = { slide: null, pending: [], ballRefs: [], roster: new Map() };
  const lines = String(src ?? "").split("\n");

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || line.trimStart().startsWith("#")) return;
    const fail = (message) => { errors.push({ line: i + 1, message }); };

    const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) return fail('expected "<directive>: <value>"');
    const key = m[1].toLowerCase();
    const rest = m[2].trim();

    if (key === "slide") {
      closeSection(scene, state, errors);
      state.slide = newSlide(unquote(rest));
      scene.slides.push(state.slide);
      return;
    }
    const handler = DIRECTIVES[key];
    if (!handler) return fail(`unknown directive "${key}"`);
    if (state.slide && BASE_ONLY.has(key)) {
      return fail(`"${key}" is set on the first slide and cannot change on a later one`);
    }
    if (!state.slide && SLIDE_ONLY.has(key)) {
      return fail(`"${key}" only works on a slide, after a "slide:" line`);
    }
    handler(rest, {
      scene,
      slide: state.slide,
      roster: state.roster,
      pending: state.pending,
      ballRefs: state.ballRefs,
      line: i + 1,
      fail,
    });
  });
  closeSection(scene, state, errors);

  // Report in source order. Endpoints resolve at the end of their section, so without
  // the sort an action error on line 1 lands after a mark error on line 2 — and the
  // whole point of carrying a line number is that a reader can follow the list down
  // the source. The sort is stable, so multiple errors on one line keep their order.
  errors.sort((x, y) => x.line - y.line);
  return { scene, errors };
}
```

Delete the old inline second-pass loop and Task 1's `ballRefs` loop — `closeSection` replaces both.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitch.test.js`
Expected: all PASS (new and existing — the base behaves exactly as before).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: a pitch block can hold slides, each an edit of the one before"
```

---

### Task 3: Serialise slides

**Files:**
- Modify: `src/lib/pitch.js`
- Test: `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("serialise", …)` block:

```js
  it("writes slides after the base, in canonical line order", () => {
    const src = [
      "red: A@1,1 B@2,2",
      "ball: A",
      "pass: A->B",
      "loop: on",
      'slide: "B goes"',
      "run: B~>8,8",
      "ball: B 9,9",
      "red: B@5,5",
      "remove: A",
      "clear: arrows",
      "slide:",
      "clear: balls arrows",
    ].join("\n");
    const { scene, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(serialise(scene)).toBe([
      "area: 40x25",
      "ball: A",
      "red: A@1,1 B@2,2",
      "pass: A->B",
      "loop: on",
      'slide: "B goes"',
      "clear: arrows",
      "remove: A",
      "red: B@5,5",
      "ball: B 9,9",
      "run: B~>8,8",
      "slide:",
      "clear: arrows balls",
      "",
    ].join("\n"));
  });

  it("round-trips slides and is stable under re-parse", () => {
    const src = [
      "red: A@1,1 B@2,2",
      "blue: X@3,3",
      "ball: A",
      'slide: "one"',
      "red: A@4,4",
      "blue: Y@6,6",
      "red: N@7,7",
      "ball: A 1,2",
      "pass: A->N",
      "slide: two",
      "remove: X",
      "shot: N->>goal",
    ].join("\n");
    const { scene, errors } = parse(src);
    expect(errors).toEqual([]);
    const once = serialise(scene);
    const again = parse(once);
    expect(again.errors).toEqual([]);
    expect(again.scene).toEqual(scene);
    expect(serialise(again.scene)).toBe(once);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitch.test.js -t "serialise"`
Expected: the two new tests FAIL (no slide lines in the output).

- [ ] **Step 3: Implement**

In `src/lib/pitch.js`, factor the player and action lines out of `serialise` so slides reuse them, and append the slides:

```js
function playerLines(players) {
  return runs(players, (p) => p.team)
    .map((run) => `${run.key}: ${run.items.map((p) => `${p.label}@${pt(p)}`).join(" ")}`);
}

function actionLines(actions) {
  return [...actions].sort((x, y) => x.seq - y.seq).map((a) => {
    const to = a.to.ref !== undefined ? a.to.ref : pt(a.to);
    return `${a.kind}: ${a.from}${ARROWS[a.kind]}${to}`;
  });
}

// clear and remove come first: they act on what the previous slide left, before this
// slide's placements. Parse forbids placing and removing one label on a slide, so the
// order never changes what the slide means.
function slideLines(s) {
  const out = [s.caption ? `slide: ${quote(s.caption)}` : "slide:"];
  const clear = CLEAR_TARGETS.filter((t) => s.clear[t]);
  if (clear.length) out.push(`clear: ${clear.join(" ")}`);
  if (s.removes.length) out.push(`remove: ${s.removes.join(" ")}`);
  out.push(...playerLines(s.players));
  if (s.balls?.length) out.push(`ball: ${s.balls.map(tok).join(" ")}`);
  out.push(...actionLines(s.actions));
  return out;
}
```

In `serialise`, replace the players loop with `lines.push(...playerLines(scene.players));`, the actions loop with `lines.push(...actionLines(scene.actions));`, and after the `loop: on` line add:

```js
  for (const s of scene.slides ?? []) lines.push(...slideLines(s));
```

Update the header comment on `serialise` to say slides are written after the base, one directive group per line in the order above.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitch.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: slides survive serialise, so the round trip still holds"
```

---

### Task 4: `frames(scene)` — replay slides into whole pictures

**Files:**
- Create: `src/lib/slides.js`
- Test: `test/slides.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/slides.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";
import { frames, FEET } from "../src/lib/slides.js";

const framesOf = (src) => {
  const { scene, errors } = parse(src);
  expect(errors).toEqual([]);
  return frames(scene);
};
const xs = (f, label) => f.players.find((p) => p.label === label)?.x;

describe("frames", () => {
  it("gives a block without slides one frame that is today's scene", () => {
    const [f, ...rest] = framesOf('cone: 5,5\nred: A@1,1\nball: 2,2\npass: A->2,2\nlabel: hi\n');
    expect(rest).toEqual([]);
    expect(f.marks).toEqual([{ kind: "cone", x: 5, y: 5 }]);
    expect(f.players).toEqual([{ team: "red", label: "A", x: 1, y: 1 }]);
    expect(f.balls).toEqual([{ key: 0, x: 2, y: 2 }]);
    expect(f.actions).toEqual([
      { kind: "pass", from: "A", to: { x: 2, y: 2 }, seq: 1, key: "0.0", carried: false },
    ]);
    expect(f.label).toBe("hi");
  });

  it("moves players cumulatively", () => {
    const fs = framesOf("red: A@0,0 B@5,5\nslide:\nred: A@10,0\nslide:\nslide:\nred: A@20,0\n");
    expect(fs.map((f) => xs(f, "A"))).toEqual([0, 10, 10, 20]);
    expect(fs.map((f) => xs(f, "B"))).toEqual([5, 5, 5, 5]);
  });

  it("adds and removes players", () => {
    const fs = framesOf("red: A@0,0\nslide:\nblue: X@1,1\nslide:\nremove: A\n");
    expect(fs.map((f) => f.players.map((p) => p.label))).toEqual([["A"], ["A", "X"], ["X"]]);
  });

  it("carries balls until a slide replaces or clears them", () => {
    const fs = framesOf("ball: 1,1 2,2\nslide:\nslide:\nball: 9,9\nslide:\nclear: balls\n");
    expect(fs.map((f) => f.balls)).toEqual([
      [{ key: 0, x: 1, y: 1 }, { key: 1, x: 2, y: 2 }],
      [{ key: 0, x: 1, y: 1 }, { key: 1, x: 2, y: 2 }],
      [{ key: 0, x: 9, y: 9 }],
      [],
    ]);
  });

  it("keeps a ball at a player's feet as they move, and leaves it when they go", () => {
    const fs = framesOf(
      "red: A@0,0\nball: A\nslide:\nred: A@10,0\nslide:\nremove: A\nslide:\nred: A@30,0\n",
    );
    expect(fs.map((f) => f.balls[0])).toEqual([
      { key: 0, x: FEET, y: FEET },
      { key: 0, x: 10 + FEET, y: FEET },
      { key: 0, x: 10 + FEET, y: FEET },
      // A new player reusing the label does not claim the ball left behind.
      { key: 0, x: 10 + FEET, y: FEET },
    ]);
  });

  it("marks carried arrows and restarts numbering for each slide's own", () => {
    const fs = framesOf("red: A@0,0 B@5,5\npass: A->B\nslide:\nrun: B~>9,9\nslide:\nclear: arrows\npass: B->A\n");
    expect(fs.map((f) => f.actions.map((a) => [a.key, a.seq, a.carried]))).toEqual([
      [["0.0", 1, false]],
      [["0.0", 1, true], ["1.0", 1, false]],
      [["2.0", 1, false]],
    ]);
  });

  it("drops a carried arrow whose player has been removed", () => {
    const fs = framesOf("red: A@0,0 B@5,5\npass: A->B\nslide:\nremove: B\n");
    expect(fs[1].actions).toEqual([]);
  });

  it("labels slide 1 with the drill label and later slides with their captions", () => {
    const fs = framesOf('label: base\nslide: "first"\nslide:\n');
    expect(fs.map((f) => f.label)).toEqual(["base", "first", null]);
  });

  it("copes with a hand-built scene that has no slides field", () => {
    const scene = parse("red: A@1,1\n").scene;
    delete scene.slides;
    expect(frames(scene)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/slides.test.js`
Expected: FAIL — cannot resolve `../src/lib/slides.js`.

- [ ] **Step 3: Implement**

Create `src/lib/slides.js`:

```js
// src/lib/slides.js
// Replays a parsed scene's slides into complete frames, one per slide. The parser stores
// each slide as an edit of the one before; this is the only place that history is
// replayed, so the renderer only ever sees whole pictures.

// A ball at a player's feet sits just off the player's centre, so neither hides the
// other. Metres.
export const FEET = 0.8;

// -> [{ area, marks, players, balls, actions, label }], length 1 without slides.
// marks are the fixed ones (goal, zone, cone, flag); balls are pulled out and resolved.
export function frames(scene) {
  const marks = scene.marks.filter((m) => m.kind !== "ball");
  let players = scene.players;
  let specs = scene.marks.filter((m) => m.kind === "ball").map(({ kind, ...b }) => b);
  let actions = scene.actions.map((a, i) => ({ ...a, key: `0.${i}`, carried: false }));
  let placed = [];
  const out = [];

  const snapshot = (label) => {
    ({ specs, balls: placed } = placeBalls(specs, players, placed));
    out.push({ area: scene.area, marks, players, balls: placed, actions, label });
  };
  snapshot(scene.label);

  (scene.slides ?? []).forEach((s, n) => {
    players = applyPlayers(players, s);
    if (s.clear.balls || s.balls !== null) specs = s.balls ?? [];
    const on = new Set(players.map((p) => p.label));
    const alive = (a) =>
      on.has(a.from) && (a.to.ref === undefined || a.to.ref === "goal" || on.has(a.to.ref));
    const carried = s.clear.arrows ? [] : actions.filter(alive).map((a) => ({ ...a, carried: true }));
    // key is slide number + position on that slide: stable for the arrow's lifetime, so
    // the renderer fades it in once and then keeps the same element.
    const own = s.actions.map((a, i) => ({ ...a, key: `${n + 1}.${i}`, carried: false }));
    actions = [...carried, ...own];
    snapshot(s.caption);
  });
  return out;
}

function applyPlayers(players, slide) {
  const moved = players.map((p) => slide.players.find((q) => q.label === p.label) ?? p);
  const added = slide.players.filter((q) => !players.some((p) => p.label === q.label));
  return [...moved, ...added].filter((p) => !slide.removes.includes(p.label));
}

// A ball's identity is its position in the list: ball i on one slide is ball i on the
// next, which is what lets it glide. A ball at a player's feet follows them; once that
// player leaves, the ball stays where it was, pinned to coordinates so a later player
// reusing the label does not claim it.
function placeBalls(specs, players, before) {
  const balls = [];
  const next = specs.map((spec, key) => {
    if (spec.ref === undefined) {
      balls.push({ key, x: spec.x, y: spec.y });
      return spec;
    }
    const p = players.find((pl) => pl.label === spec.ref);
    if (p) {
      balls.push({ key, x: p.x + FEET, y: p.y + FEET });
      return spec;
    }
    const last = before.find((b) => b.key === key);
    if (!last) return spec; // unreachable for a parsed scene: parse rejects unknown refs
    balls.push({ key, x: last.x, y: last.y });
    return { x: last.x, y: last.y };
  });
  return { specs: next, balls };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/slides.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slides.js test/slides.test.js
git commit -m "feat: replay a diagram's slides into whole frames"
```

---

### Task 5: `stage(prev, next)` — what to draw during a transition

**Files:**
- Modify: `src/lib/slides.js`
- Test: `test/slides.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/slides.test.js` (and add `stage` to the import from `../src/lib/slides.js`):

```js
describe("stage", () => {
  const fs = framesOf(
    "red: A@0,0 B@20,10\nblue: X@10,10\nball: A\npass: A->B\n" +
    "slide:\nremove: X\nblue: Y@5,5\nball: B 1,1\nrun: A~>30,20\n",
  );

  it("marks nothing as entering or leaving without a previous frame", () => {
    const s = stage(null, fs[0]);
    expect(s.players.every((p) => !p.entering && !p.leaving)).toBe(true);
    expect(s.balls.every((b) => !b.entering && !b.leaving)).toBe(true);
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0]).toMatchObject({ key: "0.0", kind: "pass", seq: 1, carried: false, entering: false, leaving: false });
    expect(s.paths[0].d).toMatch(/^M /);
  });

  it("keeps what left, at its old position, marked leaving", () => {
    const s = stage(fs[0], fs[1]);
    const x = s.players.find((p) => p.label === "X");
    expect(x).toMatchObject({ x: 10, y: 10, leaving: true, entering: false });
    expect(s.players.find((p) => p.label === "Y")).toMatchObject({ entering: true, leaving: false });
    expect(s.players.find((p) => p.label === "A")).toMatchObject({ entering: false, leaving: false });
  });

  it("matches balls by key: ball 0 glides, ball 1 enters", () => {
    const s = stage(fs[0], fs[1]);
    expect(s.balls.map((b) => [b.key, b.entering, b.leaving])).toEqual([[0, false, false], [1, true, false]]);
  });

  it("enters new arrows and keeps carried ones without re-entering them", () => {
    const s = stage(fs[0], fs[1]);
    expect(s.paths.map((p) => [p.key, p.carried, p.entering])).toEqual([
      ["0.0", true, false],
      ["1.0", false, true],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/slides.test.js -t "stage"`
Expected: FAIL — `stage` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/slides.js` (import at the top):

```js
import { actionPath } from "./pitchSvg.js";
```

```js
// What to draw for `next`, given the frame on screen before it — null on first render
// or after a cut, when nothing should fade. Items new to `next` are entering; items only
// in `prev` are kept, at their old position and marked leaving, so the renderer can fade
// them out rather than have them vanish mid-glide.
export function stage(prev, next) {
  const from = prev ?? next;
  return {
    players: diff(from.players, next.players, (p) => p.label),
    balls: diff(from.balls, next.balls, (b) => b.key),
    paths: diff(pathsOf(from), pathsOf(next), (p) => p.key),
  };
}

// Each arrow's geometry is resolved against its own frame, so a leaving arrow is drawn
// where it was, between players who may since have moved or gone.
function pathsOf(frame) {
  return frame.actions.flatMap((a) => {
    const p = actionPath(a, frame);
    return p ? [{ ...p, key: a.key, carried: a.carried }] : [];
  });
}

function diff(before, after, keyOf) {
  const had = new Set(before.map(keyOf));
  const has = new Set(after.map(keyOf));
  return [
    ...after.map((it) => ({ ...it, entering: !had.has(keyOf(it)), leaving: false })),
    ...before.filter((it) => !has.has(keyOf(it))).map((it) => ({ ...it, entering: false, leaving: true })),
  ];
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/slides.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slides.js test/slides.test.js
git commit -m "feat: work out what enters and leaves between two slides"
```

---

### Task 6: The playback reducer

**Files:**
- Create: `src/lib/playback.js`
- Test: `test/playback.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/playback.test.js`:

```js
import { describe, it, expect } from "vitest";
import { step, initial, GLIDE_MS, HOLD_MS, START_MS } from "../src/lib/playback.js";

const run = (events, from = initial) => events.reduce(step, from);
const tick = (n, loop = false) => ({ type: "tick", n, loop });

describe("playback", () => {
  it("starts paused on slide 1", () => {
    expect(initial).toEqual({ index: 0, from: null, playing: false, ended: false, delay: 0 });
  });

  it("starts moving soon after Play", () => {
    expect(run([{ type: "play" }])).toMatchObject({ playing: true, delay: START_MS, index: 0 });
  });

  it("glides to the next slide on each tick, then holds", () => {
    const s = run([{ type: "play" }, tick(3)]);
    expect(s).toMatchObject({ index: 1, from: 0, delay: GLIDE_MS + HOLD_MS, playing: true });
    expect(run([tick(3)], s)).toMatchObject({ index: 2, from: 1 });
  });

  it("stops on the last slide and offers Replay when not looping", () => {
    const s = run([{ type: "play" }, tick(2), tick(2)]);
    expect(s).toMatchObject({ index: 1, playing: false, ended: true });
  });

  it("cuts back to slide 1 when looping", () => {
    const s = run([{ type: "play" }, tick(2, true), tick(2, true)]);
    expect(s).toMatchObject({ index: 0, from: null, playing: true, ended: false, delay: HOLD_MS });
  });

  it("replays from slide 1 with a cut", () => {
    const ended = run([{ type: "play" }, tick(2), tick(2)]);
    expect(run([{ type: "play" }], ended)).toEqual({
      index: 0, from: null, playing: true, ended: false, delay: HOLD_MS,
    });
  });

  it("pauses without moving, and ignores ticks while paused", () => {
    const s = run([{ type: "play" }, tick(3), { type: "pause" }]);
    expect(s).toMatchObject({ index: 1, playing: false });
    expect(run([tick(3)], s)).toBe(s);
  });

  it("resets to the start", () => {
    expect(run([{ type: "play" }, tick(3), { type: "reset" }])).toEqual(initial);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/playback.test.js`
Expected: FAIL — cannot resolve `../src/lib/playback.js`.

- [ ] **Step 3: Implement**

Create `src/lib/playback.js`:

```js
// src/lib/playback.js
// What an animated diagram does next, as a pure reducer. The component only turns
// `delay` into a timer that dispatches `tick`; every rule about order, looping and
// replay lives here, where it is testable without a DOM or a clock.
//
// `from` is the slide just left, or null after a cut (first render, loop, replay) —
// the renderer glides only when there is somewhere to glide from.

// GLIDE_MS must match the transform transition on .pitch-glide in styles.css.
export const GLIDE_MS = 1000;
export const HOLD_MS = 1500;
// Pressing Play should visibly do something almost at once, not after a full hold.
export const START_MS = 300;

export const initial = { index: 0, from: null, playing: false, ended: false, delay: 0 };

export function step(state, event) {
  switch (event.type) {
    case "play":
      if (state.ended) return { index: 0, from: null, playing: true, ended: false, delay: HOLD_MS };
      return { ...state, playing: true, delay: START_MS };
    case "pause":
      return { ...state, playing: false };
    case "tick": {
      if (!state.playing) return state;
      if (state.index < event.n - 1) {
        return { ...state, index: state.index + 1, from: state.index, delay: GLIDE_MS + HOLD_MS };
      }
      if (event.loop) return { ...state, index: 0, from: null, delay: HOLD_MS };
      return { ...state, playing: false, ended: true };
    }
    case "reset":
      return initial;
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/playback.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playback.js test/playback.test.js
git commit -m "feat: the rules for playing, pausing, looping and replaying slides"
```

---

### Task 7: Render diagrams from a staged frame

Static diagrams switch to the frame pipeline first, with no visible change, so the
animated work in Task 8 only adds controls.

**Files:**
- Modify: `src/components/PitchDiagram.jsx`
- Modify: `src/styles.css`
- Test: `test/pitchDiagram.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("PitchDiagram", …)` in `test/pitchDiagram.test.jsx`:

```js
  it("positions players and balls by transform, so they can glide", () => {
    const html = render("red: A@10,20\nball: A\n");
    expect(html).toContain("transform:translate(120px, 220px)");
    expect(html).toContain('class="pitch-glide"');
  });

  it("draws slide 1 of a diagram with slides", () => {
    const html = render('red: A@1,1\nlabel: base\nslide: "later"\nred: B@5,5\n');
    expect(html).toContain("base");
    expect(html).not.toContain("later");
    expect(html).not.toContain(">B<");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitchDiagram.test.jsx`
Expected: the transform test FAILS (players are drawn at absolute coordinates). The slide-1 test already passes — the component draws only the base today — and is a guard for this refactor.

- [ ] **Step 3: Implement**

In `src/components/PitchDiagram.jsx`:

1. Imports become:

```js
import React, { useMemo } from "react";
import { parse } from "../lib/pitch.js";
import { viewBox, toPx, markings, markShape } from "../lib/pitchSvg.js";
import { frames, stage } from "../lib/slides.js";
```

2. Add helpers above `Marking`:

```js
// Joins the truthy class names; undefined rather than "" so no empty attribute renders.
const cls = (...names) => names.filter(Boolean).join(" ") || undefined;
const motion = (item) => cls(item.entering && "pitch-enter", item.leaving && "pitch-leave");
```

3. Replace `Player` with a version drawn at the origin inside a translated group — a CSS transition on `transform` is what makes it glide:

```js
function Player({ player }) {
  const p = toPx(player.x, player.y);
  const fill = TEAM_FILL[player.team];
  return (
    <g className={cls("pitch-glide", motion(player))} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
      {player.team === "gk" ? (
        <rect x={-R} y={-R} width={R * 2} height={R * 2} rx="3" fill={fill} stroke="#fff" strokeWidth="1" />
      ) : (
        <circle cx="0" cy="0" r={R} fill={fill} stroke="#fff" strokeWidth="1" />
      )}
      <text x="0" y="3" fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">
        {player.label}
      </text>
    </g>
  );
}

function Ball({ ball }) {
  const s = markShape({ kind: "ball", x: ball.x, y: ball.y });
  return (
    <g className={cls("pitch-glide", motion(ball))} style={{ transform: `translate(${s.cx}px, ${s.cy}px)` }}>
      <circle cx="0" cy="0" r={s.r} fill="#fff" stroke="#222" strokeWidth="1" />
    </g>
  );
}
```

4. Replace the body of `PitchDiagram` (keep the `<defs>` block exactly as it is):

```jsx
export default function PitchDiagram({ source = "", baseLine = 1 }) {
  const { scene, errors } = useMemo(() => parse(source), [source]);
  const all = useMemo(() => frames(scene), [scene]);
  const frame = all[0];
  const { players, balls, paths } = useMemo(() => stage(null, frame), [frame]);
  const shapes = useMemo(() => markings(scene.area), [scene.area]);
  const labelAt = toPx(scene.area.w / 2, scene.area.h);

  return (
    <div>
      <svg
        className="pitch cut" viewBox={viewBox(scene.area)}
        role="img" aria-label={scene.label || "Pitch diagram"}
      >
        {/* <defs> … unchanged … */}

        <rect x="0" y="0" width="100%" height="100%" fill="var(--grass)" />
        {shapes.map((s, i) => <Marking key={i} shape={s} />)}
        {frame.marks.map((m, i) => <Mark key={i} mark={m} />)}
        {paths.map((p) => (
          <path
            key={p.key} d={p.d} fill="none"
            className={cls("pitch-arrow", p.carried && "pitch-carried", motion(p))}
            stroke={ACTION_STROKE[p.kind]} strokeWidth={ACTION_WIDTH[p.kind]}
            strokeDasharray={p.kind === "run" ? "6 4" : undefined}
            markerEnd={`url(#arrow-${p.kind})`}
          />
        ))}
        {/* Badges before players, so a crowded drill hides a sequence number rather
            than a player. Only this slide's own arrows are numbered: a carried arrow is
            context, and its old number would read as part of the current sequence. */}
        {paths.filter((p) => !p.carried && !p.leaving).map((p) => (
          <g key={`b${p.key}`} className={motion(p)}>
            <circle cx={p.badge.x} cy={p.badge.y} r="6.5" fill="#000" fillOpacity="0.55" />
            <text x={p.badge.x} y={p.badge.y + 3} fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle">
              {p.seq}
            </text>
          </g>
        ))}
        {players.map((p) => <Player key={p.label} player={p} />)}
        {/* Balls after players: a ball at a player's feet overlaps the marker's edge
            and must sit on top of it to be seen. */}
        {balls.map((b) => <Ball key={b.key} ball={b} />)}
        {frame.label ? (
          <text x={labelAt.x} y={labelAt.y + 14} fontSize="10" fill="#fff" fillOpacity="0.85" textAnchor="middle">
            {frame.label}
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

The `actionPath` import is gone — `stage` computes paths now. The `Mark` component's `ball` case stays (harmless) but frames no longer contain ball marks.

5. In `src/styles.css`, after `.pitch { … }` (line 50), add:

```css
/* Animated diagrams (lib/playback.js). The transform duration must match GLIDE_MS. */
.pitch-glide { transition: transform 1s ease-in-out, opacity 0.4s ease-out; }
.pitch-arrow { transition: opacity 0.4s ease-out; }
/* A cut (first render, loop, replay) jumps rather than gliding everything home. */
.pitch.cut .pitch-glide { transition: none; }
/* Arrows carried from an earlier slide are context, not the move being shown. */
.pitch-carried { opacity: 0.4; }
.pitch-leave { opacity: 0; }
.pitch-enter { animation: pitch-enter 0.6s ease-out; }
@keyframes pitch-enter { from { opacity: 0; } }
.pitch-controls { margin-top: 6px; }
```

and inside the existing `@media (prefers-reduced-motion: reduce)` block (line ~250):

```css
  /* Slides still change; they cut instead of gliding. */
  .pitch-glide, .pitch-arrow { transition: none; }
  .pitch-enter { animation: none; }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitchDiagram.test.jsx test/drillCard.test.jsx test/drillPreview.test.jsx`
Expected: all PASS — the existing keeper (`rx="3"`), badge (`>1<`), label, and error tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/PitchDiagram.jsx src/styles.css test/pitchDiagram.test.jsx
git commit -m "refactor: draw diagrams from a staged frame, positioned so they can glide"
```

---

### Task 8: Play / Pause / Replay

**Files:**
- Modify: `src/components/PitchDiagram.jsx`
- Modify: `src/components/DrillPreview.jsx:43`
- Test: `test/pitchDiagram.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("PitchDiagram", …)`:

```js
  const SLIDES = "red: A@1,1\nslide:\nred: A@5,5\nslide:\nred: A@9,9\n";
  const animated = (src) => renderToStaticMarkup(<PitchDiagram source={src} animated />);

  it("shows no controls unless animated", () => {
    expect(render(SLIDES)).not.toContain(">Play<");
  });

  it("shows no controls for a diagram without slides", () => {
    expect(animated("red: A@1,1\n")).not.toContain(">Play<");
  });

  it("shows Play and the slide counter for an animated diagram with slides", () => {
    const html = animated(SLIDES);
    expect(html).toContain(">Play<");
    expect(html).toContain("1 / 3");
    // Starts on slide 1 — nothing moves until Play is pressed.
    expect(html).toContain("translate(30px, 30px)");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitchDiagram.test.jsx`
Expected: the "shows Play" test FAILS; the other two pass already (they are guards).

- [ ] **Step 3: Implement**

In `src/components/PitchDiagram.jsx`:

1. Imports:

```js
import React, { useEffect, useMemo, useReducer } from "react";
import { step, initial } from "../lib/playback.js";
```

2. Add above `PitchDiagram`:

```js
// Turns the reducer's `delay` into a timer. Every rule about what comes next is in
// lib/playback.js; this only keeps time. Editing the source starts over, paused.
function usePlayback(count, loop, source) {
  const [state, dispatch] = useReducer(step, initial);
  useEffect(() => { dispatch({ type: "reset" }); }, [source]);
  useEffect(() => {
    if (!state.playing) return undefined;
    const t = setTimeout(() => dispatch({ type: "tick", n: count, loop }), state.delay);
    return () => clearTimeout(t);
  }, [state, count, loop]);
  return [state, dispatch];
}
```

3. In `PitchDiagram`, take `animated = false`, and replace the `frame` / `stage` lines:

```js
export default function PitchDiagram({ source = "", baseLine = 1, animated = false }) {
  const { scene, errors } = useMemo(() => parse(source), [source]);
  const all = useMemo(() => frames(scene), [scene]);
  const [play, dispatch] = usePlayback(all.length, scene.loop, source);
  const controls = animated && all.length > 1;
  // Clamped: the reset after an edit lands one render after the new source.
  const index = controls ? Math.min(play.index, all.length - 1) : 0;
  const frame = all[index];
  const prev = controls && play.from !== null ? all[play.from] ?? null : null;
  const { players, balls, paths } = useMemo(() => stage(prev, frame), [prev, frame]);
```

4. The svg class becomes `className={cls("pitch", !prev && "cut")}`.

5. After `</svg>`, before the error banner:

```jsx
      {controls ? (
        <div className="row pitch-controls">
          <button type="button" onClick={() => dispatch({ type: play.playing ? "pause" : "play" })}>
            {play.playing ? "Pause" : play.ended ? "Replay" : "Play"}
          </button>
          <span className="dim">{index + 1} / {all.length}</span>
        </div>
      ) : null}
```

6. Update the file's header comment: it renders a `pitch` block, and with `animated` plays its slides.

7. In `src/components/DrillPreview.jsx`, the pitch segment becomes:

```jsx
      return <PitchDiagram key={i} source={seg.text} baseLine={seg.line + offset} animated />;
```

(Thumbnails in `DrillCard` and `DrillPicker` do not pass `animated`, so they stay still on slide 1.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitchDiagram.test.jsx test/drillPreview.test.jsx test/drillView.test.jsx test/editor.component.test.jsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PitchDiagram.jsx src/components/DrillPreview.jsx test/pitchDiagram.test.jsx
git commit -m "feat: play, pause and replay a diagram's slides"
```

---

### Task 9: Help card and a worked example

**Files:**
- Modify: `src/components/PitchHelp.jsx`
- Create: `test/fixtures/3v2-animated.md`
- Test: `test/pitchHelp.test.jsx`, `test/slides.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/fixtures/3v2-animated.md`:

````markdown
---
title: 3v2 to end line, animated
category: skill
minutes: 15
players: 8-12
tags: [transition, finishing]
---

Reds attack, blues defend. Score by dribbling over the end line.

```pitch
area: 40x25 half
zone: 28,0 12x25 "scoring zone"
goal: 0,12 small
cone: 5,5 5,20 35,5
red: A@10,20 B@25,14 C@34,20
blue: X@18,8 Y@30,7
ball: A
pass: A->B
label: "3v2 to end line"

slide: "B receives, C makes the run"
ball: B
run: C~>28,4

slide: "B finds C in the zone"
clear: arrows
red: C@28,4
blue: Y@27,8
ball: C
pass: B->C
```
````

Append to `test/slides.test.js` (add the imports at the top):

```js
import { readFileSync } from "node:fs";
import { parseDoc } from "../src/lib/frontmatter.js";
import { splitSegments } from "../src/lib/markdown.js";
import { serialise } from "../src/lib/pitch.js";

describe("the animated fixture", () => {
  const text = readFileSync(new URL("./fixtures/3v2-animated.md", import.meta.url), "utf8");
  const block = splitSegments(parseDoc(text).body).find((s) => s.kind === "pitch").text;

  it("parses cleanly into three frames", () => {
    const fs = framesOf(block);
    expect(fs).toHaveLength(3);
    expect(fs.map((f) => f.label)).toEqual(["3v2 to end line", "B receives, C makes the run", "B finds C in the zone"]);
    expect(fs[2].actions.map((a) => a.from)).toEqual(["B"]);
  });

  it("round-trips", () => {
    const { scene } = parse(block);
    expect(parse(serialise(scene)).scene).toEqual(scene);
  });
});
```

Append inside `describe("PitchHelp", …)` in `test/pitchHelp.test.jsx`:

```js
  it("documents slides", () => {
    for (const s of ["slide:", "remove:", "clear: arrows balls", "loop: on", "ball: C"]) {
      expect(html()).toContain(s);
    }
    expect(html()).toMatch(/first slide/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitchHelp.test.jsx test/slides.test.js`
Expected: "documents slides" FAILS; the fixture tests PASS (they check Tasks 2–4 against a real drill — if they fail, fix the fixture or the code before continuing).

- [ ] **Step 3: Implement**

In `src/components/PitchHelp.jsx`, add `CLEAR_TARGETS` to the import from `../lib/pitch.js`, add after `MOVES`:

```js
const SLIDES = [
  ['slide: "B finds C"', "Starts the next slide, with an optional caption. Everything below it, up to the next slide, is what changes."],
  ["red: C@28,4", "Naming a player who is already on moves them there — they glide. A new label adds a player."],
  ["ball: C", "Replaces every ball. A player's label puts the ball at their feet, and it follows them."],
  [`pass: B${ARROWS.pass}C`, "Adds an arrow. Arrows from earlier slides stay, drawn fainter."],
  [`clear: ${CLEAR_TARGETS.join(" ")}`, "Wipes the arrows, the balls, or both, carried over from the slide before."],
  ["remove: X", "Takes a player off."],
  ["loop: on", "Before the first slide line: play round again after the last slide. Off by default."],
];
```

and after the Movement section's closing `</p>`:

```jsx
      <h4>Animating it</h4>
      <Lines rows={SLIDES} />
      <p className="dim">
        What you write before the first <code>slide:</code> is the first slide. Cones,
        goals, zones and flags are set on the first slide and stay put — only players,
        balls and arrows change. The drill view gets a Play button; thumbnails show the
        first slide.
      </p>
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitchHelp.test.jsx test/slides.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PitchHelp.jsx test/pitchHelp.test.jsx test/slides.test.js test/fixtures/3v2-animated.md
git commit -m "docs: the help card explains slides, with a worked example drill"
```

---

### Task 10: Full verification and version

**Files:**
- Modify: `package.json` (version)

- [ ] **Step 1: Full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass (919 + the new ones); build succeeds with no JSX errors.

- [ ] **Step 2: Check it by hand**

Run `npm run dev`, open http://localhost:5173/ballislife/, sign in, create a drill with the fixture's body, and check:
- The editor preview and the drill view show Play and `1 / 3`; the catalogue card shows slide 1 with no controls.
- Play: B's ball glides from A to B, C's run fades in, the pass A→B fades to faint with no number; then C and Y glide, the arrows clear, the pass B→C fades in, and the button reads Replay.
- Replay cuts back to slide 1 and plays again. Pause mid-way stops on the current slide.
- Add `loop: on` in the editor: the preview resets to slide 1, and playing now cycles.
- A typo inside a slide (`cone: 1,1` under a `slide:`) shows its line error and the other slides still play.
- With the OS set to reduce motion, slides cut instead of gliding.

- [ ] **Step 3: Bump the version and commit**

Set `"version": "0.18.0"` in `package.json`.

```bash
git add package.json
git commit -m "chore: v0.18.0"
```

Do not push or merge. Deploying is a push to `main`; leave that to the owner.
