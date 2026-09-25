# Line Numbers and Rulers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Line numbers beside the editor source (with clickable diagram errors), and x/y rulers plus a coordinate readout on the editor's diagram.

**Architecture:** Pure geometry and text offsets in lib (`rulerTicks`, `lineRange`), thin rendering in `PitchDiagram` and `Editor`.

**Spec:** `docs/superpowers/specs/2026-09-24-pitch-slides-design.md`, "Addendum — 2026-09-25 (3)".

Environment: Node v20 (`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"` if not); `grep` is broken — use the Grep tool or node. Branch `lines-and-rulers`. Baseline 1047 tests.

---

### Task 1: Lib — `rulerTicks` and `lineRange`

**Files:** `src/lib/pitchSvg.js`, `src/lib/editDoc.js`; tests `test/pitchSvg.test.js`, `test/editDoc.test.js`

- [ ] **Step 1: Failing tests**

`test/pitchSvg.test.js` (import `rulerTicks`):

```js
describe("rulerTicks", () => {
  const t = rulerTicks({ w: 12, h: 6 });
  it("ticks every metre along both edges, from 0 to the far side", () => {
    expect(t.x.map((k) => k.m)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(t.y.map((k) => k.m)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("labels every fifth metre", () => {
    expect(t.x.filter((k) => k.label).map((k) => k.label)).toEqual(["0", "5", "10"]);
    expect(t.y.filter((k) => k.label).map((k) => k.label)).toEqual(["0", "5"]);
  });
  it("places ticks in pixels on the pitch edge", () => {
    expect(t.x[1].px).toBe(toPx(1, 0).x);
    expect(t.y[2].px).toBe(toPx(0, 2).y);
  });
});
```

`test/editDoc.test.js` (import `lineRange`):

```js
describe("lineRange", () => {
  it("gives a 1-based line's start and end offsets", () => {
    expect(lineRange("ab\ncde\nf", 2)).toEqual({ start: 3, end: 6 });
    expect(lineRange("ab\ncde\nf", 3)).toEqual({ start: 7, end: 8 });
  });
  it("excludes a CRLF line's carriage return", () => {
    expect(lineRange("ab\r\ncd\r\n", 1)).toEqual({ start: 0, end: 2 });
  });
  it("returns null for a line past the end", () => {
    expect(lineRange("ab", 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/pitchSvg.test.js test/editDoc.test.js` — FAIL.

- [ ] **Step 3: Implement**

`src/lib/pitchSvg.js`, after `toMetres`:

```js
// The editor's rulers: a tick per metre along the top (x) and left (y) edges, labelled
// every 5 m. `px` is the tick's position along its edge.
export function rulerTicks(area) {
  const along = (max, axis) => {
    const out = [];
    for (let m = 0; m <= max; m++) {
      const p = axis === "x" ? toPx(m, 0).x : toPx(0, m).y;
      out.push({ m, px: p, label: m % 5 === 0 ? String(m) : null });
    }
    return out;
  };
  return { x: along(Math.floor(area.w), "x"), y: along(Math.floor(area.h), "y") };
}
```

`src/lib/editDoc.js`:

```js
// A 1-based line's offsets in `doc`, for selecting it — the line an error message names.
export function lineRange(doc, line) {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const nl = doc.indexOf("\n", start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  const nl = doc.indexOf("\n", start);
  let end = nl === -1 ? doc.length : nl;
  if (doc[end - 1] === "\r") end -= 1;
  return { start, end };
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat: ruler ticks and line offsets`.

---

### Task 2: Rulers, readout and clickable errors on the diagram

**Files:** `src/components/PitchDiagram.jsx`, `src/components/DrillPreview.jsx`, `src/styles.css`; test `test/pitchDiagram.test.jsx`

- [ ] **Step 1: Failing tests** (inside `describe("PitchDiagram", …)`; `editable` helper already exists there):

```js
  it("draws rulers only when editable", () => {
    expect(render("area: 12x6\n")).not.toContain("pitch-ruler");
    const html = editable("area: 12x6\n");
    expect(html).toContain('class="pitch-ruler"');
    expect(html).toContain("x →");
    expect(html).toContain("y ↓");
    expect(html).toContain(">10<");
  });

  it("makes each error a button that names its file line, when given onErrorLine", () => {
    const html = renderToStaticMarkup(
      <PitchDiagram source={"goal: nope\n"} baseLine={7} editable onErrorLine={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*class="error-line"[^>]*>line 7: /);
    expect(render("goal: nope\n")).not.toContain("error-line");
  });
```

- [ ] **Step 2: Run** `npx vitest run test/pitchDiagram.test.jsx` — FAIL.

- [ ] **Step 3: Implement**

1. `PitchDiagram` imports `rulerTicks`; props gain `onErrorLine`.
2. State `const [hover, setHover] = useState(null);` (with the other hooks). In the editable svg's `onPointerMove`, first `setHover(metresAt(e))`, then the existing drag logic. Add `onPointerLeave={() => setHover(null)}` when editable.
3. `const ticks = editable ? rulerTicks(scene.area) : null;` and, inside the svg after the markings and before the marks, when `ticks`:

```jsx
        {ticks ? (
          <g className="pitch-ruler" aria-hidden="true">
            {/* Across the top is x, down the left is y: the order a coordinate is typed. */}
            {ticks.x.map((t) => (
              <g key={`x${t.m}`}>
                <line x1={t.px} y1={t.label ? 13 : 16} x2={t.px} y2={20} />
                {t.label ? <text x={t.px} y={10} textAnchor="middle">{t.label}</text> : null}
              </g>
            ))}
            {ticks.y.map((t) => (
              <g key={`y${t.m}`}>
                <line x1={t.label ? 13 : 16} y1={t.px} x2={20} y2={t.px} />
                {t.label ? <text x={11} y={t.px + 2.5} textAnchor="end">{t.label}</text> : null}
              </g>
            ))}
            <text x={1} y={7}>x →</text>
            <text x={1} y={17}>y ↓</text>
          </g>
        ) : null}
```

4. The readout, last inside the svg, when `editable && hover`:

```jsx
        {editable && hover ? (
          <text className="pitch-readout" x={toPx(hover.x, hover.y).x + 9} y={toPx(hover.x, hover.y).y - 9}>
            {`${hover.x},${hover.y}`}
          </text>
        ) : null}
```

5. Errors: when `onErrorLine` is given, each error renders as
   `<button type="button" className="error-line" onClick={() => onErrorLine(e.line + baseLine - 1)}>line {e.line + baseLine - 1}: {e.message}</button>`
   instead of the `<div>` (keep the `<div>` otherwise). Use a single template string for the text so SSR does not split it: `` {`line ${e.line + baseLine - 1}: ${e.message}`} `` (apply the same to the `<div>` form — existing tests assert `"line 7"` and still pass).
6. `DrillPreview` accepts `onErrorLine` and passes it to each diagram (only meaningful in the editor).
7. `src/styles.css`:

```css
/* The editor's rulers sit in the diagram's margin, off the pitch itself. */
.pitch-ruler line { stroke: #fff; stroke-opacity: 0.55; stroke-width: 1; }
.pitch-ruler text { fill: #fff; fill-opacity: 0.8; font-size: 7px; }
.pitch-readout { fill: #fff; font-size: 9px; font-weight: 700; stroke: #1d4d31; stroke-width: 2.5px; paint-order: stroke; pointer-events: none; }
.error-line { display: block; background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; text-decoration: underline dotted; }
```

- [ ] **Step 4: Run** `npx vitest run test/pitchDiagram.test.jsx test/drillPreview.test.jsx` — PASS.
- [ ] **Step 5: Commit** `feat: rulers and a coordinate readout on the editor's diagram, and errors that jump to their line`.

---

### Task 3: Line numbers in the editor

**Files:** `src/components/Editor.jsx`, `src/styles.css`; test `test/editor.component.test.jsx`

- [ ] **Step 1: Failing tests**

```js
  it("numbers the source's lines", () => {
    const s = openEditor("a", "one\ntwo\nthree\n", "T1");
    const html = render(s);
    expect(html).toContain('class="editor-gutter"');
    // Four lines: the trailing newline starts an empty fourth.
    expect(html).toMatch(/editor-gutter[^>]*>1\n2\n3\n4</);
    expect(html).toContain('wrap="off"');
  });

  it("wires the preview's errors to the source", () => {
    const bad = openEditor("a", "```pitch\ngoal: nope\n```\n", "T1");
    expect(render(bad)).toContain('class="error-line"');
  });
```

- [ ] **Step 2: Run** `npx vitest run test/editor.component.test.jsx` — FAIL.

- [ ] **Step 3: Implement**

1. Import `lineRange` from `../lib/editDoc.js`.
2. Pull the select-and-scroll body of the existing effect into a helper inside the component and use it from the effect:

```js
  // Focus the source, select [start, end) and bring it into view: selecting text does not
  // scroll a textarea to it.
  const reveal = (el, start, end) => {
    el.focus();
    el.setSelectionRange(start, end);
    const line = el.value.slice(0, start).split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3);
  };
```

3. `const gutterRef = useRef(null);` and `const lineCount = state.text.split("\n").length;`
4. `const onErrorLine = (line) => { const r = lineRange(state.text, line); if (r && sourceRef.current) reveal(sourceRef.current, r.start, r.end); };` and pass `onErrorLine={onErrorLine}` to `DrillPreview`.
5. Replace the bare `<textarea>` with:

```jsx
        <div className="editor-source-wrap">
          {/* Numbers the lines as error messages count them. The textarea does not wrap,
              so each number stays beside its line; scrolling moves both together. */}
          <pre className="mono editor-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
          </pre>
          <textarea
            ref={sourceRef}
            className="mono editor-source"
            value={state.text}
            onChange={(e) => onEdit?.(e.target.value)}
            onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
            spellCheck={false}
            wrap="off"
          />
        </div>
```

6. `src/styles.css` — replace the `.editor-source` rule(s) with:

```css
.editor-source-wrap { display: flex; align-items: stretch; }
/* Gutter and source share one font size and line height, or the numbers drift. */
.editor-source, .editor-gutter { font-size: 13px; line-height: 18px; padding: 6px; }
.editor-source { flex: 1; min-width: 0; min-height: 60vh; resize: vertical; white-space: pre; overflow: auto; }
.editor-gutter {
  margin: 0; min-width: 2.5em; text-align: right; color: var(--dim); background: var(--bg);
  border: 1px solid var(--line); border-right: 0; border-radius: 8px 0 0 8px;
  overflow: hidden; user-select: none;
}
```

   and in the `max-width: 780px` block keep `.editor-source { min-height: 30vh; }`. (Check `--dim`, `--bg`, `--line` exist in `:root`; use them as the rest of the file does.) The gutter must end up the textarea's height — `align-items: stretch` does that; verify the textarea's border and padding match the gutter's vertical padding so line 1 lines up.

- [ ] **Step 4: Run** `npm test && npm run build` — PASS.
- [ ] **Step 5: Commit** `feat: line numbers beside the source`.

---

### Task 4 (controller): browser check, version 0.21.0, push.
