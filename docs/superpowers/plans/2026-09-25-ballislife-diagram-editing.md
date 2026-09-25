# Slide Controls and Diagram Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play/Pause + Replay + clickable slide numbers under animated diagrams; in the editor preview, click the pitch to insert a coordinate at the cursor and drag items to rewrite their coordinates in place.

**Architecture:** Pure lib does all the work. `playback.js` gains seek/replay/edited events. `parse` additionally returns `spans` (where each coordinate's text sits) without touching the scene. `sourceEdit.js` turns "drag this item on this slide to x,y" into a new block source by rewriting one span or appending one line. `editDoc.js` maps blocks inside a drill document. `PitchDiagram` only converts pointer events and calls back.

**Tech Stack:** React 18, Vitest 2 (node env, SSR smoke tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-pitch-slides-design.md`, section "Addendum — 2026-09-25 (2)".

---

## Before you start

- `node -v` must say v20, else `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- `grep` is broken in this sandbox. Use the Grep tool or `node -e`.
- Branch: `diagram-editing` (the controller creates it).
- Baseline: `npm test` → 1009 passed.

## File map

| File | Change |
|---|---|
| `src/lib/playback.js` | `seek`, `replay`, `edited`; `play` restarts from the last slide |
| `src/components/PitchDiagram.jsx` | New controls (Task 2); `editable` pointer handling (Task 7) |
| `src/styles.css` | Slide-number buttons; editable cursor |
| `src/lib/pitchSvg.js` | `toMetres` |
| `src/lib/pitch.js` | `spans` from `parse` |
| `src/lib/sourceEdit.js` (new) | `moveInSource`, `moveInFrame` |
| `src/lib/editDoc.js` (new) | `pitchBlocks`, `replaceBlock`, `insertText` |
| `src/lib/slideTemplate.js` | Use `pitchBlocks` |
| `src/components/DrillPreview.jsx`, `src/components/Editor.jsx` | Wire editing |
| `src/components/PitchHelp.jsx` | Document it |

---

### Task 1: Playback events

**Files:** Modify `src/lib/playback.js`; Test `test/playback.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("playback", …)`:

```js
  it("starts again from slide 1 when Play is pressed on the last slide", () => {
    const onLast = run([{ type: "seek", index: 2 }]);
    expect(run([{ type: "play", n: 3 }], onLast)).toEqual({
      index: 0, from: null, playing: true, ended: false, delay: HOLD_MS,
    });
  });

  it("replays from slide 1 whatever the state", () => {
    const mid = run([{ type: "play", n: 3 }, tick(3)]);
    expect(run([{ type: "replay" }], mid)).toEqual({
      index: 0, from: null, playing: true, ended: false, delay: HOLD_MS,
    });
  });

  it("seeks to a slide with a cut, paused", () => {
    const mid = run([{ type: "play", n: 3 }, tick(3)]);
    expect(run([{ type: "seek", index: 2 }], mid)).toEqual({
      index: 2, from: null, playing: false, ended: false, delay: 0,
    });
  });

  it("stays on the slide shown after an edit, paused, clamped to what is left", () => {
    const onThird = run([{ type: "seek", index: 2 }]);
    expect(run([{ type: "edited", n: 3 }], onThird)).toMatchObject({ index: 2, playing: false, from: null });
    expect(run([{ type: "edited", n: 2 }], onThird)).toMatchObject({ index: 1 });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/playback.test.js` — the four new tests FAIL.

- [ ] **Step 3: Implement**

In `src/lib/playback.js`, replace the `play` case and add three cases before `reset`:

```js
    case "play":
      // From the end, or from the last slide reached by seeking, Play means "again".
      if (state.ended || state.index >= event.n - 1) return replayed();
      return { ...state, playing: true, delay: START_MS };
```

```js
    case "replay":
      return replayed();
    case "seek":
      return { index: event.index, from: null, playing: false, ended: false, delay: 0 };
    // The source changed under the diagram. Stay on the slide shown — the coach is
    // probably editing it — but stop, and clamp in case slides were deleted.
    case "edited":
      return { ...state, index: Math.min(state.index, Math.max(0, event.n - 1)), from: null, playing: false, ended: false };
```

and add below `initial`:

```js
const replayed = () => ({ index: 0, from: null, playing: true, ended: false, delay: HOLD_MS });
```

(`state.index >= event.n - 1` is false when `n` is absent — `NaN` — so the existing tests that dispatch a bare `play` keep their meaning.)

- [ ] **Step 4: Run** `npx vitest run test/playback.test.js` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playback.js test/playback.test.js
git commit -m "feat: seek, replay, and stay on the slide being edited"
```

---

### Task 2: The new controls

**Files:** Modify `src/components/PitchDiagram.jsx`, `src/styles.css`; Test `test/pitchDiagram.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `test/pitchDiagram.test.jsx`, replace the test "shows Play and the slide counter for an animated diagram with slides" with:

```js
  it("shows Play, Replay and a button per slide, slide 1 current", () => {
    const html = animated('red: A@1,1\nslide: "go"\nred: A@5,5\nslide:\nred: A@9,9\n');
    expect(html).toContain(">Play<");
    expect(html).toContain(">Replay<");
    expect(html.match(/class="pitch-slide"/g)).toHaveLength(3);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>1</);
    expect(html).toContain('title="go"');
    expect(html).toContain('title="Slide 3"');
    // Starts on slide 1 — nothing moves until Play is pressed.
    expect(html).toContain("translate(30px, 30px)");
  });
```

(The `SLIDES` constant's other tests stay. Remove any remaining assertion on `"1 / 3"`.)

- [ ] **Step 2: Run** `npx vitest run test/pitchDiagram.test.jsx` — the new test FAILS.

- [ ] **Step 3: Implement**

1. In `usePlayback`, the reset effect becomes

```js
  useEffect(() => { dispatch({ type: "edited", n: count }); }, [source]);
```

and its comment: "Editing the source pauses and keeps the slide shown."

2. Replace the controls block with:

```jsx
      {controls ? (
        <div className="row pitch-controls">
          <button
            type="button"
            onClick={() => dispatch(play.playing ? { type: "pause" } : { type: "play", n: all.length })}
          >
            {play.playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "replay" })}>Replay</button>
          <span className="pitch-slides" role="group" aria-label="Slides">
            {all.map((f, i) => (
              <button
                key={i} type="button" className="pitch-slide"
                aria-current={i === index ? "step" : undefined}
                title={f.label || `Slide ${i + 1}`}
                onClick={() => dispatch({ type: "seek", index: i })}
              >
                {i + 1}
              </button>
            ))}
          </span>
        </div>
      ) : null}
```

3. `src/styles.css`, after `.pitch-controls { … }`:

```css
.pitch-slides { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.pitch-slide { min-width: 32px; padding: 4px 8px; }
/* The slide on screen. Colour plus weight, since colour alone fails in bright sun. */
.pitch-slide[aria-current] { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
```

- [ ] **Step 4: Run** `npx vitest run test/pitchDiagram.test.jsx test/drillPreview.test.jsx` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PitchDiagram.jsx src/styles.css test/pitchDiagram.test.jsx
git commit -m "feat: Play/Pause, Replay and a button for every slide"
```

---

### Task 3: Pixels back to metres

**Files:** Modify `src/lib/pitchSvg.js`; Test `test/pitchSvg.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/pitchSvg.test.js` (add `toMetres` to its import from `../src/lib/pitchSvg.js`):

```js
describe("toMetres", () => {
  const area = { w: 40, h: 25 };
  it("inverts toPx", () => {
    const p = toPx(12, 7);
    expect(toMetres(p.x, p.y, area)).toEqual({ x: 12, y: 7 });
  });
  it("snaps to the half metre", () => {
    const p = toPx(12.3, 7.8);
    expect(toMetres(p.x, p.y, area)).toEqual({ x: 12.5, y: 8 });
  });
  it("keeps the point on the pitch", () => {
    expect(toMetres(0, 0, area)).toEqual({ x: 0, y: 0 });
    expect(toMetres(10000, 10000, area)).toEqual({ x: 40, y: 25 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/pitchSvg.test.js` — FAIL.

- [ ] **Step 3: Implement** — add after `toPx` in `src/lib/pitchSvg.js`:

```js
// Pixels -> metres: the inverse of toPx, snapped to the half metre (as fine as anyone
// places a cone) and kept on the pitch, for picking and dragging in the editor.
export function toMetres(px, py, area) {
  const snap = (v, max) => Math.min(max, Math.max(0, Math.round((v / S - PAD) * 2) / 2));
  return { x: snap(px, area.w), y: snap(py, area.h) };
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `git commit -am "feat: turn a point on the diagram back into metres"` (only `src/lib/pitchSvg.js` and `test/pitchSvg.test.js` should be modified).

---

### Task 4: `parse` reports where each coordinate is written

**Files:** Modify `src/lib/pitch.js`; Test `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/pitch.test.js`:

```js
describe("parse: spans", () => {
  // The source text a span covers.
  const at = (src, s) => src.split("\n")[s.line].slice(s.from, s.to);

  it("locates player coordinates, per section", () => {
    const src = "red: A@1,2 B@3,4\nslide:\nred: B@5,6\n";
    const { spans } = parse(src);
    expect(spans.sections[0].players.map((s) => at(src, s))).toEqual(["1,2", "3,4"]);
    expect(spans.sections[1].players.map((s) => at(src, s))).toEqual(["5,6"]);
  });

  it("locates every mark's coordinate, aligned with scene.marks", () => {
    const src = 'cone: 5,5 6,6\ngoal: 0,12 small\nzone: 12,0 16x25 "z"\nball: 1,1\n';
    const { scene, spans } = parse(src);
    expect(spans.marks).toHaveLength(scene.marks.length);
    expect(spans.marks.map((s) => at(src, s))).toEqual(["5,5", "6,6", "0,12", "12,0", "1,1"]);
  });

  it("locates action targets, aligned with each section's actions", () => {
    const src = "red: A@1,1 B@2,2\npass: A->3,4 A->B\nslide:\nshot: B->>goal\n";
    const { spans } = parse(src);
    expect(spans.sections[0].actions.map((s) => at(src, s))).toEqual(["3,4", "B"]);
    expect(spans.sections[1].actions.map((s) => at(src, s))).toEqual(["goal"]);
  });

  it("locates a slide's balls, and stays aligned when a ball is dropped", () => {
    const src = "red: A@1,1\nslide:\nball: Z A 2,2\n";
    const { scene, spans } = parse(src);
    expect(scene.slides[0].balls).toHaveLength(2);
    expect(spans.sections[1].balls.map((s) => at(src, s))).toEqual(["A", "2,2"]);
    expect(spans.sections[0].balls).toBeNull();
  });

  it("records each section's last non-blank line, comments included", () => {
    const { spans } = parse("red: A@1,1\n\nslide: x\n# note\n\n");
    expect(spans.sections.map((s) => s.last)).toEqual([0, 3]);
  });

  it("leaves the scene exactly as before", () => {
    const src = "red: A@1,1\nball: A\nslide:\nred: A@2,2\n";
    expect(Object.keys(parse(src))).toEqual(["scene", "errors", "spans"]);
    expect(parse(serialise(parse(src).scene)).scene).toEqual(parse(src).scene);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/pitch.test.js -t spans` — FAIL.

- [ ] **Step 3: Implement** in `src/lib/pitch.js`:

1. After `unquote`, add a tokenizer that keeps offsets:

```js
// Whitespace-separated tokens with their offset in `rest`, so a coordinate's position in
// the source can be recorded for the editor's drag-to-move.
function tokens(rest) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(rest))) out.push({ text: m[0], at: m.index });
  return out;
}
```

2. In each of `parsePlayers`, `parsePointMarks`, `parseBalls` and `parseActions`, iterate `for (const { text: token, at } of tokens(rest))` instead of the `split` (in `parseBalls`, `const toks = tokens(rest)` and use `toks.length` for the empty check). Record the span of every item that is kept, with `ctx.record(item, from, to)` (offsets within `rest`):
   - `parsePlayers`, after the push: `ctx.record(player, at + player.label.length + 1, at + token.length);`
   - `parsePointMarks`: `const mark = { kind, ...p }; ctx.scene.marks.push(mark); ctx.record(mark, at, at + token.length);`
   - `parseBalls`: record each ball object added (coordinate or ref) with `at, at + token.length`.
   - `parseGoal`: take `const [first] = tokens(rest);` for the coordinate and record the pushed goal with `first.at, first.at + first.text.length` (keep the existing error handling: `parsePoint(first?.text ?? "")`).
   - `parseZone`: record the pushed zone with `0, m[1].length + 1 + m[2].length`.
   - `parseActions`: pending entries gain `toSpan: ctx.span(at + m[1].length + m[2].length, at + token.length)`.
3. In `closeSection`, when an action is pushed: `const action = { kind: a.kind, from: a.fromRaw, to: t.to, seq: into.length + 1 }; into.push(action); state.spanOf.set(action, a.toSpan);`
4. In `parse`:
   - `state` gains `spanOf: new Map()` and `sections: [{ last: -1 }]`.
   - The blank/comment early return becomes:

```js
    if (line === "") return;
    const section = state.sections[state.sections.length - 1];
    if (line.trimStart().startsWith("#")) { section.last = i; return; }
```

   - After the directive match: `const restAt = line.length - m[2].length;` (the line has no trailing whitespace, so `rest === m[2]`).
   - In the `slide` branch, after pushing the slide: `state.sections.push({ last: i });`
   - Otherwise, before dispatching: `section.last = i;`
   - The handler ctx gains:

```js
      span: (from, to) => ({ line: i, from: restAt + from, to: restAt + to }),
      record: (item, from, to) => state.spanOf.set(item, { line: i, from: restAt + from, to: restAt + to }),
```

   - Before `return`, build the spans from the FINAL lists (so a ball or action dropped during resolution cannot misalign them):

```js
  const get = (item) => state.spanOf.get(item) ?? null;
  const spans = {
    marks: scene.marks.map(get),
    sections: state.sections.map((s, n) => {
      const src = n === 0 ? scene : scene.slides[n - 1];
      return {
        last: s.last,
        players: src.players.map(get),
        actions: src.actions.map(get),
        balls: n === 0 ? null : src.balls?.map(get) ?? null,
      };
    }),
  };
  return { scene, errors, spans };
```

   - Update the header comment at the top of the file: parse returns `{ scene, errors, spans }`; spans are where each coordinate is written, for editing in place, and are not part of the scene.

- [ ] **Step 4: Run** `npx vitest run test/pitch.test.js` then `npm test` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: parse records where each coordinate is written"
```

---

### Task 5: `sourceEdit.js`

**Files:** Create `src/lib/sourceEdit.js`; Test `test/sourceEdit.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/sourceEdit.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";
import { frames } from "../src/lib/slides.js";
import { moveInSource, moveInFrame } from "../src/lib/sourceEdit.js";

const SRC = [
  "area: 40x25",      // 0
  "cone: 5,5 6,6",    // 1
  "red: A@1,1 B@2,2", // 2
  "ball: A",          // 3
  "pass: A->10,10",   // 4
  "slide: one",       // 5
  "# keep me",        // 6
  "red: B@3,3",       // 7
  "",                 // 8
  "slide: two",       // 9
  "run: B~>20,20",    // 10
  "",
].join("\n");
const lines = (s) => s.split("\n");
const withLine = (i, text) => { const l = lines(SRC); l[i] = text; return l.join("\n"); };
const inserted = (after, text) => { const l = lines(SRC); l.splice(after + 1, 0, text); return l.join("\n"); };
const move = (frame, target) => moveInSource(SRC, frame, target, 4, 5.5);

describe("moveInSource", () => {
  it("rewrites a base player's coordinate in place", () => {
    expect(move(0, { kind: "player", label: "A" })).toBe(withLine(2, "red: A@4,5.5 B@2,2"));
  });

  it("rewrites a player placed on the slide shown", () => {
    expect(move(1, { kind: "player", label: "B" })).toBe(withLine(7, "red: B@4,5.5"));
  });

  it("adds a line to the slide shown when it does not place the player", () => {
    expect(move(1, { kind: "player", label: "A" })).toBe(inserted(7, "red: A@4,5.5"));
    expect(move(2, { kind: "player", label: "B" })).toBe(inserted(10, "red: B@4,5.5"));
  });

  it("always moves a cone on the first slide", () => {
    expect(move(2, { kind: "mark", index: 1 })).toBe(withLine(1, "cone: 5,5 4,5.5"));
  });

  it("rewrites the ball list the slide shown owns, detaching a ball from a player", () => {
    expect(move(0, { kind: "ball", key: 0 })).toBe(withLine(3, "ball: 4,5.5"));
  });

  it("adds a ball line listing every ball when the slide shown has none", () => {
    expect(move(1, { kind: "ball", key: 0 })).toBe(inserted(7, "ball: 4,5.5"));
    const src = "red: A@1,1\nball: A 9,9\nslide:\nred: A@2,2\n";
    expect(moveInSource(src, 1, { kind: "ball", key: 1 }, 4, 5)).toBe(src + "ball: A 4,5\n");
  });

  it("rewrites an arrow head on the slide it was added on", () => {
    expect(move(0, { kind: "arrow", key: "0.0" })).toBe(withLine(4, "pass: A->4,5.5"));
    expect(move(2, { kind: "arrow", key: "2.0" })).toBe(withLine(10, "run: B~>4,5.5"));
  });

  it("refuses what cannot be dragged", () => {
    expect(moveInSource("red: A@1,1 B@2,2\npass: A->B\n", 0, { kind: "arrow", key: "0.0" }, 1, 1)).toBeNull();
    expect(move(9, { kind: "player", label: "A" })).toBeNull();
    expect(move(0, { kind: "player", label: "Z" })).toBeNull();
  });

  it("keeps comments and parses cleanly afterwards", () => {
    const out = move(1, { kind: "player", label: "A" });
    expect(out).toContain("# keep me");
    expect(parse(out).errors).toEqual([]);
  });

  it("keeps CRLF on an added line", () => {
    const src = "red: A@1,1\r\nslide:\r\n";
    expect(moveInSource(src, 1, { kind: "player", label: "A" }, 2, 2)).toBe("red: A@1,1\r\nslide:\r\nred: A@2,2\r\n");
  });
});

describe("moveInFrame", () => {
  const frame = frames(parse(SRC).scene)[0];

  it("moves one item and leaves the rest", () => {
    const f = moveInFrame(frame, { kind: "player", label: "A" }, 4, 5);
    expect(f.players.find((p) => p.label === "A")).toMatchObject({ x: 4, y: 5 });
    expect(f.players.find((p) => p.label === "B")).toMatchObject({ x: 2, y: 2 });
  });

  it("moves marks, balls and arrow heads", () => {
    expect(moveInFrame(frame, { kind: "mark", index: 0 }, 4, 5).marks[0]).toMatchObject({ x: 4, y: 5 });
    expect(moveInFrame(frame, { kind: "ball", key: 0 }, 4, 5).balls[0]).toEqual({ key: 0, x: 4, y: 5 });
    expect(moveInFrame(frame, { kind: "arrow", key: "0.0" }, 4, 5).actions[0].to).toEqual({ x: 4, y: 5 });
  });
});
```

(`src` ends with a newline, so the slide's last non-blank line is `red: A@2,2`; the new line goes straight after it.)

- [ ] **Step 2: Run** `npx vitest run test/sourceEdit.test.js` — FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/lib/sourceEdit.js`:

```js
// src/lib/sourceEdit.js
// Dragging on the editor's diagram, as text edits. A drag rewrites exactly one
// coordinate where it is written — or, when the slide shown does not mention the item
// yet, adds one line to that slide — so a coach's comments and layout survive. That is
// why this edits spans rather than going through serialise, which drops comments.
//
// A target is { kind: "player", label } | { kind: "mark", index } (into frame.marks) |
// { kind: "ball", key } | { kind: "arrow", key } (a frame action's key).
import { parse } from "./pitch.js";
import { frames } from "./slides.js";

const num = (v) => String(Math.round(v * 10) / 10);
const coord = (x, y) => `${num(x)},${num(y)}`;

// -> the new block source, or null when the target cannot be moved there.
export function moveInSource(source, frameIndex, target, x, y) {
  const { scene, spans } = parse(source);
  const frame = frames(scene)[frameIndex];
  if (!frame) return null;
  const lines = source.split("\n");
  const cr = source.includes("\r\n") ? "\r" : "";
  const replace = (span, text) => {
    if (!span) return null;
    const l = lines[span.line];
    lines[span.line] = l.slice(0, span.from) + text + l.slice(span.to);
    return lines.join("\n");
  };
  const append = (text) => {
    lines.splice(spans.sections[frameIndex].last + 1, 0, text + cr);
    return lines.join("\n");
  };
  const section = spans.sections[frameIndex];
  const own = frameIndex === 0 ? scene : scene.slides[frameIndex - 1];

  switch (target.kind) {
    case "player": {
      const i = own.players.findIndex((p) => p.label === target.label);
      if (i >= 0) return replace(section.players[i], coord(x, y));
      const p = frame.players.find((q) => q.label === target.label);
      return p ? append(`${p.team}: ${p.label}@${coord(x, y)}`) : null;
    }
    case "mark": {
      // frame.marks is scene.marks without the balls, in order.
      const i = scene.marks.map((m, j) => (m.kind === "ball" ? -1 : j)).filter((j) => j >= 0)[target.index];
      return i === undefined ? null : replace(spans.marks[i], coord(x, y));
    }
    case "ball": {
      if (!frame.balls.some((b) => b.key === target.key)) return null;
      if (ownsBalls(scene, frameIndex)) {
        const span = frameIndex === 0
          ? spans.marks[scene.marks.map((m, j) => (m.kind === "ball" ? j : -1)).filter((j) => j >= 0)[target.key]]
          : section.balls?.[target.key];
        return replace(span, coord(x, y));
      }
      // A ball: line replaces every ball, so the new line must list them all.
      const all = frame.balls.map((b) => (b.key === target.key ? coord(x, y) : b.ref ?? coord(b.x, b.y)));
      return append(`ball: ${all.join(" ")}`);
    }
    case "arrow": {
      const [s, i] = String(target.key).split(".").map(Number);
      const list = s === 0 ? scene.actions : scene.slides[s - 1]?.actions;
      const action = list?.[i];
      if (!action || action.to.ref !== undefined) return null;
      return replace(spans.sections[s].actions[i], coord(x, y));
    }
    default:
      return null;
  }
}

// Whether the balls on this slide are the ones its own lines set, rather than carried.
function ownsBalls(scene, frameIndex) {
  if (frameIndex === 0) return true;
  const s = scene.slides[frameIndex - 1];
  return s.balls !== null;
}

// The frame with one item at (x, y): what the diagram draws while a drag is in progress.
export function moveInFrame(frame, target, x, y) {
  switch (target.kind) {
    case "player":
      return { ...frame, players: frame.players.map((p) => (p.label === target.label ? { ...p, x, y } : p)) };
    case "mark":
      return { ...frame, marks: frame.marks.map((m, i) => (i === target.index ? { ...m, x, y } : m)) };
    case "ball":
      return { ...frame, balls: frame.balls.map((b) => (b.key === target.key ? { key: b.key, x, y } : b)) };
    case "arrow":
      return { ...frame, actions: frame.actions.map((a) => (a.key === target.key ? { ...a, to: { x, y } } : a)) };
    default:
      return frame;
  }
}
```

(A slide with `clear: balls` and no `ball:` line has no balls on screen, so there is nothing to drag; the `some` check returns null.)

- [ ] **Step 4: Run** `npx vitest run test/sourceEdit.test.js` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourceEdit.js test/sourceEdit.test.js
git commit -m "feat: turn a drag on the diagram into a one-coordinate edit"
```

---

### Task 6: `editDoc.js` — blocks inside a drill

**Files:** Create `src/lib/editDoc.js`; Modify `src/lib/slideTemplate.js`; Test `test/editDoc.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/editDoc.test.js`:

```js
import { describe, it, expect } from "vitest";
import { pitchBlocks, replaceBlock, insertText } from "../src/lib/editDoc.js";

const DOC = "---\ntitle: x\n---\n\nIntro\n\n```pitch\nred: A@1,1\n```\n\n```pitch\nblue: X@2,2\n```\n";

describe("pitchBlocks", () => {
  it("gives each block's content range and file line", () => {
    const bs = pitchBlocks(DOC);
    expect(bs.map((b) => DOC.slice(b.from, b.to))).toEqual(["red: A@1,1\n", "blue: X@2,2\n"]);
    // The same line DrillPreview reports as a diagram's baseLine.
    expect(bs.map((b) => b.line)).toEqual([8, 12]);
    expect(DOC.slice(bs[0].start, bs[0].end)).toBe("```pitch\nred: A@1,1\n```");
  });
});

describe("replaceBlock", () => {
  it("replaces the content of the block at a file line", () => {
    expect(replaceBlock(DOC, 12, "blue: X@3,3\n")).toBe(DOC.replace("X@2,2", "X@3,3"));
  });
  it("returns null for a line with no block", () => {
    expect(replaceBlock(DOC, 3, "x")).toBeNull();
  });
});

describe("insertText", () => {
  it("inserts at the cursor, spaced from the previous token", () => {
    expect(insertText("cone: 5,5", 9, 9, "6,6")).toEqual({ text: "cone: 5,5 6,6", cursor: 13 });
  });
  it("does not add a space after whitespace, @ or an arrow", () => {
    expect(insertText("cone: ", 6, 6, "1,1").text).toBe("cone: 1,1");
    expect(insertText("red: D@", 7, 7, "1,1").text).toBe("red: D@1,1");
    expect(insertText("run: C~>", 8, 8, "1,1").text).toBe("run: C~>1,1");
  });
  it("replaces a selection", () => {
    expect(insertText("red: A@1,1", 7, 10, "4,5")).toEqual({ text: "red: A@4,5", cursor: 10 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/editDoc.test.js` — FAIL.

- [ ] **Step 3: Implement** — create `src/lib/editDoc.js`, moving `pitchRanges` out of `slideTemplate.js`:

```js
// src/lib/editDoc.js
// Where the pitch blocks sit inside a whole drill document, and small text edits on it.
// Pure: the editor applies the results to its textarea.
import { parseDoc } from "./frontmatter.js";
import { splitSegments } from "./markdown.js";

// -> [{ start, from, to, end, line }] as offsets into `doc`: from/to bound the content,
// start/end include the fence lines, and `line` is the file line where the content
// starts — the number DrillPreview hands each diagram as its baseLine.
export function pitchBlocks(doc) {
  const body = parseDoc(doc).body;
  const bodyStart = doc.length - body.length;
  const frontLines = doc.slice(0, bodyStart).split("\n").length - 1;
  const lineStarts = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === "\n") lineStarts.push(i + 1);
  return splitSegments(body)
    .filter((s) => s.kind === "pitch")
    .map((s) => {
      // splitSegments gives the content's 1-based starting line, and the content is an
      // exact slice, so its length ends it.
      const from = lineStarts[s.line - 1] ?? body.length;
      const to = from + s.text.length;
      const nl = body.indexOf("\n", to);
      return {
        start: lineStarts[s.line - 2] + bodyStart,
        from: from + bodyStart,
        to: to + bodyStart,
        end: (nl === -1 ? body.length : nl) + bodyStart,
        line: s.line + frontLines,
      };
    });
}

// The document with the content of the block starting at file line `line` replaced,
// or null when no block starts there.
export function replaceBlock(doc, line, content) {
  const b = pitchBlocks(doc).find((x) => x.line === line);
  return b ? doc.slice(0, b.from) + content + doc.slice(b.to) : null;
}

// Inserts `text` over [start, end) -> { text, cursor after it }. A picked coordinate is
// spaced from a token it would otherwise run into — but not after whitespace, `@`
// (a player's position) or `>` (the end of every arrow).
export function insertText(doc, start, end, text) {
  const before = start > 0 ? doc[start - 1] : "\n";
  const sep = /[\s@>]/.test(before) ? "" : " ";
  return { text: doc.slice(0, start) + sep + text + doc.slice(end), cursor: start + sep.length + text.length };
}
```

In `src/lib/slideTemplate.js`: import `pitchBlocks` from `./editDoc.js`; `hasPitchBlock` becomes `(doc) => pitchBlocks(doc).length > 0`; `addSlide` takes `const blocks = pitchBlocks(doc);` (already absolute offsets — delete the bodyStart shift and the local `pitchRanges`, and drop now-unused imports). All existing slideTemplate tests must still pass.

- [ ] **Step 4: Run** `npx vitest run test/editDoc.test.js test/slideTemplate.test.js` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editDoc.js src/lib/slideTemplate.js test/editDoc.test.js
git commit -m "refactor: locate pitch blocks in a drill in one place, with text edits beside it"
```

---

### Task 7: Pick and drag in the editor

**Files:** Modify `src/components/PitchDiagram.jsx`, `src/components/DrillPreview.jsx`, `src/components/Editor.jsx`, `src/styles.css`; Test `test/pitchDiagram.test.jsx`, `test/editor.component.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("PitchDiagram", …)`:

```js
  const editable = (src) => renderToStaticMarkup(<PitchDiagram source={src} editable />);

  it("is inert unless editable", () => {
    const html = render("red: A@1,1\npass: A->5,5\n");
    expect(html).not.toContain("pitch-handle");
    expect(html).not.toContain("touch-action");
  });

  it("stops the page scrolling and offers a handle on coordinate arrow heads when editable", () => {
    const html = editable("red: A@1,1 B@9,9\npass: A->5,5 A->B\n");
    expect(html).toContain("touch-action:none");
    expect(html).toContain('class="pitch editable');
    expect(html.match(/class="pitch-handle"/g)).toHaveLength(1);
  });
```

Append inside `describe("Editor", …)` in `test/editor.component.test.jsx`:

```js
  it("makes the preview's diagrams editable", () => {
    const withPitch = openEditor("a", "```pitch\nred: A@5,5\n```\n", "T1");
    expect(render(withPitch)).toContain('class="pitch editable');
  });
```

and in `test/drillView.test.jsx` (or `test/drillPreview.test.jsx`, whichever renders DrillPreview) add:

```js
  it("keeps the drill view's diagrams read-only", () => {
    // render DrillPreview (or DrillView) with a pitch block exactly as the file's other tests do
    // and assert: expect(html).not.toContain("editable");
  });
```

— write it using that file's existing render helper and a fixture with a pitch block.

- [ ] **Step 2: Run** the three files — the new tests FAIL.

- [ ] **Step 3: Implement**

**PitchDiagram.jsx**

1. Imports: add `useRef, useState` from React; `toMetres` from `../lib/pitchSvg.js`; `moveInSource, moveInFrame` from `../lib/sourceEdit.js`.
2. Props: `editable = false, onChange, onPick`.
3. `Player`, `Ball` and `Mark` accept an `onGrab` prop and put `onPointerDown={onGrab}` on their outermost `<g>` (for `Mark`, wrap non-zone shapes in a `<g onPointerDown={onGrab}>`; the zone already has one).
4. In `PitchDiagram`, after `frame` and `prev`:

```js
  const svgRef = useRef(null);
  // { target, x, y, moved }: target null means a press on the grass, which picks.
  const [drag, setDrag] = useState(null);
  const shown = drag?.moved ? moveInFrame(frame, drag.target, drag.x, drag.y) : frame;
  const { players, balls, paths } = useMemo(() => stage(drag ? null : prev, shown), [prev, shown, drag]);

  const metresAt = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return toMetres(p.x, p.y, scene.area);
  };
  const press = (target) => (e) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    svgRef.current.setPointerCapture?.(e.pointerId);
    dispatch({ type: "pause" });
    setDrag({ target, ...metresAt(e), moved: false });
  };
  const onPointerMove = (e) => {
    if (!drag?.target) return;
    const m = metresAt(e);
    if (m.x !== drag.x || m.y !== drag.y) setDrag({ ...drag, ...m, moved: true });
  };
  const onPointerUp = (e) => {
    if (!drag) return;
    const m = metresAt(e);
    if (drag.target && drag.moved) {
      const next = moveInSource(source, index, drag.target, m.x, m.y);
      if (next !== null) onChange?.(next);
    } else if (!drag.target) {
      onPick?.(`${m.x},${m.y}`);
    }
    setDrag(null);
  };
  // Arrow heads that point at a coordinate can be dragged; one into a player follows them.
  const handles = editable
    ? shown.actions.filter((a) => a.to.ref === undefined).map((a) => ({ key: a.key, ...toPx(a.to.x, a.to.y) }))
    : [];
```

5. The `<svg>` gets `ref={svgRef}`, `className={cls("pitch", editable && "editable", !prev && "cut")}`, and when editable: `style={{ touchAction: "none" }}`, `onPointerDown={press(null)}`, `onPointerMove={onPointerMove}`, `onPointerUp={onPointerUp}`, `onPointerCancel={() => setDrag(null)}`. When not editable, none of these (pass `undefined`).
6. Render `shown.marks` instead of `frame.marks`, with `onGrab={editable ? press({ kind: "mark", index: i }) : undefined}`; players `onGrab={editable && !p.leaving ? press({ kind: "player", label: p.label }) : undefined}`; balls likewise with `{ kind: "ball", key: b.key }`.
7. After the balls, render the handles:

```jsx
        {handles.map((h) => (
          <circle
            key={`h${h.key}`} className="pitch-handle" cx={h.x} cy={h.y} r="7"
            onPointerDown={press({ kind: "arrow", key: h.key })}
          />
        ))}
```

8. The caption text uses `frame.label` still (unchanged).

**DrillPreview.jsx** — props gain `onBlockChange, onPick`; a pitch segment renders

```jsx
      const line = seg.line + offset;
      return (
        <PitchDiagram
          key={i} source={seg.text} baseLine={line} animated
          editable={Boolean(onBlockChange)}
          onChange={onBlockChange ? (next) => onBlockChange(line, next) : undefined}
          onPick={onPick}
        />
      );
```

**Editor.jsx** — import `replaceBlock, insertText` from `../lib/editDoc.js`; add:

```js
  // A drag on the preview hands back the whole new block; splice it into the drill.
  const onBlockChange = (line, content) => {
    const next = replaceBlock(state.text, line, content);
    if (next !== null) onEdit?.(next);
  };
  // A click on the preview writes that coordinate where the coach is typing.
  const onPick = (coord) => {
    const el = sourceRef.current;
    const start = el ? el.selectionStart : state.text.length;
    const end = el ? el.selectionEnd : start;
    const r = insertText(state.text, start, end, coord);
    pendingSelect.current = [r.cursor, r.cursor];
    onEdit?.(r.text);
  };
```

and `<DrillPreview source={state.text} onBlockChange={onBlockChange} onPick={onPick} />`.

**styles.css** — after the `.pitch-slide` rules:

```css
/* Editing in the preview: things that can be dragged say so. */
.pitch.editable { cursor: crosshair; }
.pitch.editable .pitch-glide, .pitch.editable .pitch-handle { cursor: grab; }
.pitch-handle { fill: transparent; stroke: #fff; stroke-opacity: 0.6; stroke-dasharray: 2 2; }
```

- [ ] **Step 4: Run** `npm test && npm run build` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components src/styles.css test
git commit -m "feat: click the preview to write a coordinate, drag to move things"
```

---

### Task 8: Help card, verification, ship (controller)

- [ ] `PitchHelp.jsx`: in "Animating it", add that the number buttons jump to a slide; add a short "Editing on the diagram" paragraph: click the pitch to write that spot's coordinate at the cursor; drag players, balls, cones, goals, zones and arrow heads to move them on the slide shown (fixed things always on the first slide). Test: help contains "drag".
- [ ] `npm test && npm run build`.
- [ ] Real-browser check with a throwaway harness (not committed): drag a player with CDP `Input.dispatchMouseEvent` and confirm the source changed only in that coordinate; click grass with the cursor after `cone: ` and confirm a coordinate is inserted; click slide numbers and Replay.
- [ ] Bump to `0.20.0`, commit, fast-forward `main`, push.
