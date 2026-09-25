# Slide Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a slide remove individual arrows, add an Add slide button that templates in the current state (commented), and cap the diagram at 560px wide.

**Architecture:** `pitch.js` learns `remove: A->B` and tracks the arrows on the pitch per section so removals are checked. `slides.js` drops removed arrows and records which player a ball is at. A new pure `slideTemplate.js` builds the template and inserts it into a document at the right block. `Editor.jsx` only reads the cursor and applies the result.

**Tech Stack:** React 18, Vitest 2 (node env; SSR smoke tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-pitch-slides-design.md`, section "Addendum — 2026-09-25".

---

## Before you start

- `node -v` must say v20, else `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.
- `grep` is broken in this sandbox. Use the Grep tool or `node -e`.
- Branch: `git switch -c slide-editing` (from `main`).
- Baseline: `npm test` → 979 passed.

## File map

| File | Change |
|---|---|
| `src/lib/pitch.js` | `remove:` arrow tokens, per-section arrow tracking, `removeArrows` in the model and serialise; export `arrowToken`, `sameArrow`, `playerLines` |
| `src/lib/slides.js` | Drop removed arrows; a ball at a player carries `ref` |
| `src/lib/slideTemplate.js` (new) | `slideTemplate(scene)`, `addSlide(doc, cursor)`, `CAPTION` |
| `src/components/Editor.jsx` | Add slide button |
| `src/components/PitchHelp.jsx` | Document arrow removal and the button |
| `src/styles.css` | `.pitch` max-width |
| tests | `test/pitch.test.js`, `test/slides.test.js`, `test/slideTemplate.test.js` (new), `test/editor.component.test.jsx`, `test/pitchHelp.test.jsx` |

---

### Task 1: `remove:` takes arrows

**Files:** Modify `src/lib/pitch.js`; Test `test/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/pitch.test.js`, change the `EMPTY_SLIDE` constant to include `removeArrows: []`:

```js
const EMPTY_SLIDE = {
  caption: null, players: [], removes: [], removeArrows: [], clear: { arrows: false, balls: false },
  balls: null, actions: [],
};
```

Append:

```js
describe("parse: removing arrows", () => {
  const TWO = "red: A@1,1 B@2,2\n";

  it("removes carried arrows written as they were added", () => {
    const { scene, errors } = parse(TWO + "pass: A->B\nrun: B~>5,5\nslide:\nremove: A->B B~>5,5\n");
    expect(errors).toEqual([]);
    expect(scene.slides[0].removeArrows).toEqual([
      { kind: "pass", from: "A", to: { ref: "B" } },
      { kind: "run", from: "B", to: { x: 5, y: 5 } },
    ]);
  });

  it("mixes players and arrows on one line", () => {
    const { scene, errors } = parse(TWO + "pass: A->B\nslide:\nremove: B A->B\n");
    expect(errors).toEqual([]);
    expect(scene.slides[0].removes).toEqual(["B"]);
    expect(scene.slides[0].removeArrows).toHaveLength(1);
  });

  it("matches the arrow kind", () => {
    expect(parse(TWO + "pass: A->B\nslide:\nremove: A~>B\n").errors).toEqual([
      { line: 4, message: 'no arrow "A~>B" on the pitch to remove' },
    ]);
  });

  it("removes a shot at goal", () => {
    expect(parse("red: A@1,1\nshot: A->>goal\nslide:\nremove: A->>goal\n").errors).toEqual([]);
  });

  it("finds an arrow carried over several slides", () => {
    expect(parse(TWO + "pass: A->B\nslide:\nslide:\nremove: A->B\n").errors).toEqual([]);
  });

  it("rejects an arrow the previous slide cleared", () => {
    expect(parse(TWO + "pass: A->B\nslide:\nclear: arrows\nslide:\nremove: A->B\n").errors).toEqual([
      { line: 6, message: 'no arrow "A->B" on the pitch to remove' },
    ]);
  });

  it("rejects an arrow that went when its player was removed", () => {
    expect(parse(TWO + "pass: A->B\nslide:\nremove: B\nslide:\nremove: A->B\n").errors).toEqual([
      { line: 6, message: 'no arrow "A->B" on the pitch to remove' },
    ]);
  });

  it("rejects an arrow added on the same slide", () => {
    expect(parse(TWO + "slide:\npass: A->B\nremove: A->B\n").errors).toEqual([
      { line: 4, message: 'no arrow "A->B" on the pitch to remove' },
    ]);
  });

  it("rejects a malformed arrow token", () => {
    expect(parse(TWO + "pass: A->B\nslide:\nremove: ->B\n").errors).toEqual([
      { line: 4, message: 'expected "<from><arrow><to>" but got "->B"' },
    ]);
  });

  it("serialises removed arrows after removed players, and round-trips", () => {
    const { scene } = parse(TWO + "pass: A->B\nrun: B~>5,5\nslide:\nremove: A->B B~>5,5 B\n");
    const once = serialise(scene);
    expect(once).toContain("remove: B A->B B~>5,5\n");
    expect(parse(once).scene).toEqual(scene);
    expect(serialise(parse(once).scene)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/pitch.test.js`
Expected: the new tests FAIL, and the `EMPTY_SLIDE` tests too (`removeArrows` missing).

- [ ] **Step 3: Implement**

In `src/lib/pitch.js`:

1. Add after `ARROW_RE`:

```js
// "A->B" -> { kind, from, to } without checking the players exist: a removal names an
// arrow already on the pitch, so it is matched rather than resolved. Null if malformed.
function parseArrow(token) {
  const m = token.match(ARROW_RE);
  if (!m || m[1] === "" || m[3] === "") return null;
  const to = m[3] === "goal" ? { ref: "goal" } : parsePoint(m[3]) ?? { ref: m[3] };
  return { kind: ARROW_KINDS.find((k) => ARROWS[k] === m[2]), from: m[1], to };
}

// Same kind, source and target: what "the same arrow" means to remove:.
export function sameArrow(a, b) {
  if (a.kind !== b.kind || a.from !== b.from) return false;
  if (a.to.ref !== undefined || b.to.ref !== undefined) return a.to.ref === b.to.ref;
  return a.to.x === b.to.x && a.to.y === b.to.y;
}
```

2. Replace `parseRemove`:

```js
// Players by label, arrows as they were written: "remove: X A->B". An arrow is checked
// against those on the pitch at the end of the previous slide, so one removed with its
// player on this same slide is still there to name.
function parseRemove(rest, ctx) {
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    if (ARROW_RE.test(token)) {
      const arrow = parseArrow(token);
      if (!arrow) { ctx.fail(`expected "<from><arrow><to>" but got "${token}"`); continue; }
      if (!ctx.arrows.some((a) => sameArrow(a, arrow))) {
        ctx.fail(`no arrow "${token}" on the pitch to remove`);
        continue;
      }
      ctx.slide.removeArrows.push(arrow);
      continue;
    }
    const label = token;
    if (ctx.slide.players.some((p) => p.label === label)) {
      ctx.fail(`"${label}" is both placed and removed on this slide`);
      continue;
    }
    if (!ctx.roster.has(label)) { ctx.fail(`unknown player "${label}"`); continue; }
    ctx.slide.removes.push(label);
    ctx.roster.delete(label);
  }
}
```

3. `newSlide` gains `removeArrows: []` after `removes: []`.

4. In `parse`: `state` gains `arrows: []`, and the handler ctx gains `arrows: state.arrows`.

5. At the end of `closeSection`, before `state.pending = [];`:

```js
  // The arrows on the pitch when this section ends, computed as frames() will draw
  // them, so the next slide's removals are checked against what is actually shown.
  if (state.slide) {
    const s = state.slide;
    const onPitch = (a) =>
      known(a.from) && (a.to.ref === undefined || a.to.ref === "goal" || known(a.to.ref));
    const kept = s.clear.arrows ? [] : state.arrows.filter((a) => !s.removeArrows.some((r) => sameArrow(r, a)));
    state.arrows = [...kept.filter(onPitch), ...s.actions];
  } else {
    state.arrows = scene.actions;
  }
```

6. Replace `actionLines` with a version built on an exported token helper:

```js
// One arrow as it is written in source: "A->B", "C~>28,4", "C->>goal".
export function arrowToken(a) {
  const to = a.to.ref !== undefined ? a.to.ref : pt(a.to);
  return `${a.from}${ARROWS[a.kind]}${to}`;
}

function actionLines(actions) {
  return [...actions].sort((x, y) => x.seq - y.seq).map((a) => `${a.kind}: ${arrowToken(a)}`);
}
```

7. Export `playerLines` (add `export` to its declaration; the Add slide template reuses it).

8. In `slideLines`, replace the `remove:` line with:

```js
  const removes = [...s.removes, ...s.removeArrows.map(arrowToken)];
  if (removes.length) out.push(`remove: ${removes.join(" ")}`);
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/pitch.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js test/pitch.test.js
git commit -m "feat: a slide can remove one arrow, written as it was added"
```

---

### Task 2: Frames drop removed arrows; a ball knows its player

**Files:** Modify `src/lib/slides.js`; Test `test/slides.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/slides.test.js`, the test "keeps a ball at a player's feet as they move, and leaves it when they go" changes its expectation: balls at a player carry `ref`, a pinned ball does not:

```js
    expect(fs.map((f) => f.balls[0])).toEqual([
      { key: 0, x: FEET, y: FEET, ref: "A" },
      { key: 0, x: 10 + FEET, y: FEET, ref: "A" },
      { key: 0, x: 10 + FEET, y: FEET },
      // A new player reusing the label does not claim the ball left behind.
      { key: 0, x: 10 + FEET, y: FEET },
    ]);
```

Append inside `describe("frames", …)`:

```js
  it("drops the carried arrows a slide removes", () => {
    const fs = framesOf("red: A@0,0 B@5,5\npass: A->B\nrun: B~>9,9\nslide:\nremove: A->B\n");
    expect(fs[1].actions.map((a) => a.key)).toEqual(["0.1"]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/slides.test.js`
Expected: those two FAIL.

- [ ] **Step 3: Implement**

In `src/lib/slides.js`:

1. `import { sameArrow } from "./pitch.js";`
2. The `carried` line in `frames` becomes:

```js
    const removed = (a) => s.removeArrows.some((r) => sameArrow(r, a));
    const carried = s.clear.arrows
      ? []
      : actions.filter((a) => alive(a) && !removed(a)).map((a) => ({ ...a, carried: true }));
```

3. In `placeBalls`, a ball at a player records who: `balls.push({ key, x: p.x + FEET, y: p.y + FEET, ref: spec.ref });` and add to the function's comment: "`ref` names the player a ball is at, so the Add slide template can write `ball: C` rather than coordinates."

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/slides.test.js test/pitchDiagram.test.jsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slides.js test/slides.test.js
git commit -m "feat: removed arrows leave the frame, and a ball remembers whose feet it is at"
```

---

### Task 3: The slide template

**Files:** Create `src/lib/slideTemplate.js`; Test `test/slideTemplate.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/slideTemplate.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";
import { slideTemplate, addSlide, CAPTION } from "../src/lib/slideTemplate.js";

const HEAD = [
  `slide: "${CAPTION}"`,
  "# Uncomment a line and change it; delete the ones you don't need.",
  "# Add arrows with pass:, run:, dribble: or shot:.",
];
const template = (src) => slideTemplate(parse(src).scene);

describe("slideTemplate", () => {
  it("comments out the state at the end of the block", () => {
    expect(template(
      "red: A@10,20 B@25,14\nblue: X@18,8\nball: A\npass: A->B\nslide:\nred: A@12,20\n",
    )).toBe([
      ...HEAD,
      "# red: A@12,20 B@25,14",
      "# blue: X@18,8",
      "# ball: A",
      "# remove: A->B",
      "",
    ].join("\n"));
  });

  it("writes a loose ball as coordinates, rounded to a decimetre", () => {
    expect(template("red: A@1,1\nball: A 3,4\nslide:\nremove: A\n")).toContain("# ball: 1.8,1.8 3,4\n");
  });

  it("omits the ball and remove lines when there is nothing to name", () => {
    expect(template("red: A@1,1\n")).toBe([...HEAD, "# red: A@1,1", ""].join("\n"));
  });
});

describe("addSlide", () => {
  const DOC = "---\ntitle: x\n---\n\nIntro\n\n```pitch\nred: A@1,1\n```\n\nMore\n";

  it("appends to the block, after a blank line, and selects the caption", () => {
    const r = addSlide(DOC, 0);
    expect(r.text).toBe(
      "---\ntitle: x\n---\n\nIntro\n\n```pitch\nred: A@1,1\n\n" + template("red: A@1,1\n") + "```\n\nMore\n",
    );
    expect(r.text.slice(r.select[0], r.select[1])).toBe(CAPTION);
  });

  it("produces a block that parses cleanly, with the new slide", () => {
    const r = addSlide(DOC, 0);
    const block = r.text.split("```pitch\n")[1].split("```")[0];
    const { scene, errors } = parse(block);
    expect(errors).toEqual([]);
    expect(scene.slides.map((s) => s.caption)).toEqual([CAPTION]);
  });

  it("adds to the block holding the cursor", () => {
    const doc = "```pitch\nred: A@1,1\n```\n\n```pitch\nblue: X@2,2\n```\n";
    const r = addSlide(doc, doc.indexOf("A@1,1"));
    expect(r.text.indexOf(CAPTION)).toBeLessThan(r.text.indexOf("blue: X"));
  });

  it("falls back to the last block when the cursor is in prose", () => {
    const doc = "```pitch\nred: A@1,1\n```\n\nText\n\n```pitch\nblue: X@2,2\n```\n";
    const r = addSlide(doc, doc.indexOf("Text"));
    expect(r.text.indexOf(CAPTION)).toBeGreaterThan(r.text.indexOf("blue: X"));
  });

  it("does not add a second blank line when the block already ends with one", () => {
    const r = addSlide("```pitch\nred: A@1,1\n\n```\n", 0);
    expect(r.text).toBe("```pitch\nred: A@1,1\n\n" + template("red: A@1,1\n") + "```\n");
  });

  it("returns null for a drill with no diagram", () => {
    expect(addSlide("---\ntitle: x\n---\n\nJust words.\n", 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/slideTemplate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/slideTemplate.js`:

```js
// src/lib/slideTemplate.js
// What the editor's Add slide button inserts: a new slide whose every line is the
// current state, commented out, so a coach uncomments and edits what moves instead of
// looking up where everyone is. Pure — the editor only reads the cursor and applies it.
import { parse, playerLines, arrowToken } from "./pitch.js";
import { frames } from "./slides.js";
import { parseDoc } from "./frontmatter.js";
import { splitSegments } from "./markdown.js";

export const CAPTION = "What happens next";

// A ball left at a player's feet sits at their position plus FEET; a decimetre is as
// fine as anyone places a ball, and keeps float noise out of the source.
const coord = (v) => String(Math.round(v * 10) / 10);

// Scene -> the new slide's lines, with positions as of the end of the block.
export function slideTemplate(scene) {
  const all = frames(scene);
  const last = all[all.length - 1];
  const lines = [
    `slide: "${CAPTION}"`,
    "# Uncomment a line and change it; delete the ones you don't need.",
    "# Add arrows with pass:, run:, dribble: or shot:.",
    ...playerLines(last.players).map((l) => `# ${l}`),
  ];
  if (last.balls.length) {
    lines.push(`# ball: ${last.balls.map((b) => b.ref ?? `${coord(b.x)},${coord(b.y)}`).join(" ")}`);
  }
  if (last.actions.length) lines.push(`# remove: ${last.actions.map(arrowToken).join(" ")}`);
  return lines.join("\n") + "\n";
}

// (document, cursor offset) -> { text, select: [start, end] } with a slide appended to the
// pitch block holding the cursor, or the last block; null when there is none. `select`
// is the caption, so typing replaces it.
export function addSlide(doc, cursor) {
  const body = parseDoc(doc).body;
  const bodyStart = doc.length - body.length;
  const blocks = pitchRanges(body).map((b) => ({ from: b.from + bodyStart, to: b.to + bodyStart }));
  if (blocks.length === 0) return null;
  const block = blocks.find((b) => cursor >= b.from && cursor <= b.to) ?? blocks[blocks.length - 1];
  const source = doc.slice(block.from, block.to);
  // One blank line between the block's last line and the new slide, as a coach would type it.
  const lead = source === "" || source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  const text = doc.slice(0, block.to) + lead + slideTemplate(parse(source).scene) + doc.slice(block.to);
  const start = block.to + lead.length + 'slide: "'.length;
  return { text, select: [start, start + CAPTION.length] };
}

// Character range of each pitch block's content within the body. splitSegments gives the
// content's 1-based starting line, and the content is an exact slice, so its length ends it.
function pitchRanges(body) {
  const lineStarts = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === "\n") lineStarts.push(i + 1);
  return splitSegments(body)
    .filter((s) => s.kind === "pitch")
    .map((s) => {
      const from = lineStarts[s.line - 1] ?? body.length;
      return { from, to: from + s.text.length };
    });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/slideTemplate.test.js`
Expected: all PASS. If "appends to the block" fails on the body offset, check that `parseDoc(doc).body` is a suffix of `doc` for these inputs (DrillPreview relies on the same property) and report rather than working around it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slideTemplate.js test/slideTemplate.test.js
git commit -m "feat: build a new slide from where everything is now, commented out"
```

---

### Task 4: The button, the help card and the size cap

**Files:** Modify `src/components/Editor.jsx`, `src/components/PitchHelp.jsx`, `src/styles.css`; Test `test/editor.component.test.jsx`, `test/pitchHelp.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("Editor", …)` in `test/editor.component.test.jsx`:

```js
  it("offers Add slide when the drill has a diagram", () => {
    const withPitch = openEditor("a", "```pitch\nred: A@5,5\n```\n", "T1");
    const html = render(withPitch);
    expect(html).toContain("Add slide");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Add slide/);
  });

  it("disables Add slide when there is no diagram to add to", () => {
    expect(render(base)).toMatch(/<button[^>]*disabled=""[^>]*>Add slide/);
  });
```

Append inside `describe("PitchHelp", …)` in `test/pitchHelp.test.jsx`:

```js
  it("explains removing an arrow and the Add slide button", () => {
    expect(html()).toContain("remove: X B-&gt;C");
    expect(html()).toContain("Add slide");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/editor.component.test.jsx test/pitchHelp.test.jsx`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

1. `src/components/Editor.jsx`: import `useEffect, useMemo, useRef` from React and `addSlide` from `../lib/slideTemplate.js`. Inside `Editor`, before `return`:

```jsx
  const sourceRef = useRef(null);
  const pendingSelect = useRef(null);
  const canAddSlide = useMemo(() => addSlide(state.text, 0) !== null, [state.text]);

  // Applied after the edit re-renders the textarea: React writing the new value moves
  // the cursor to the end, so selecting any earlier would be undone.
  useEffect(() => {
    const range = pendingSelect.current;
    const el = sourceRef.current;
    if (!range || !el) return;
    pendingSelect.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  }, [state.text]);

  const onAddSlide = () => {
    const el = sourceRef.current;
    const r = addSlide(state.text, el ? el.selectionStart : state.text.length);
    if (!r) return;
    pendingSelect.current = r.select;
    onEdit?.(r.text);
  };
```

Immediately above `<div className="split">`:

```jsx
      <div className="row" style={{ marginBottom: 6 }}>
        <button
          type="button" onClick={onAddSlide} disabled={!canAddSlide}
          title={canAddSlide ? "Add a slide to the diagram the cursor is in" : "Add a pitch diagram first"}
        >
          Add slide
        </button>
      </div>
```

and give the textarea `ref={sourceRef}`.

2. `src/components/PitchHelp.jsx`: the `remove: X` row in `SLIDES` becomes

```js
  [`remove: X B${ARROWS.pass}C`, "Takes a player off, or an arrow — write the arrow as it was added."],
```

and the "Animating it" paragraph gains a final sentence:

```jsx
        The <strong>Add slide</strong> button above the source starts one for you, with
        where everything is now written out as notes to uncomment.
```

3. `src/styles.css`: the `.pitch` rule becomes

```css
/* Capped so a laptop does not blow a 40x25 grid up to the full window width. A phone is
   narrower than the cap, so it is unaffected; so are thumbnails, capped by their card. */
.pitch { display: block; width: 100%; max-width: 560px; border-radius: 8px; }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/Editor.jsx src/components/PitchHelp.jsx src/styles.css test/editor.component.test.jsx test/pitchHelp.test.jsx
git commit -m "feat: an Add slide button, and a diagram capped for laptop screens"
```

---

### Task 5: Verify and ship (controller)

- [ ] `npm test && npm run build` pass.
- [ ] Real-browser check with a throwaway harness page (not committed): the diagram is 560px wide in a 1280px window; an animated drill with `remove: A->B` fades that arrow out.
- [ ] Bump `package.json` to `0.19.0`, commit `chore: v0.19.0`.
- [ ] Fast-forward `main` and push (the owner asked for this change to go straight to `main`).
