# Animated pitch diagrams — design

**Date:** 2026-09-24
**Status:** approved, ready for implementation planning

A `pitch` block can hold a series of slides. The diagram as written today is slide 1;
every later slide is an edit of the slide before it. In the drill view (and the editor
preview) the diagram gets Play / Pause / Replay controls, and players and balls glide
from one slide to the next.

A block without a `slide:` line renders exactly as it does now, with no controls. No
existing drill changes.

## The language

```pitch
area: 40x25 half
goal: 0,12 small
cone: 5,5 5,20
red: A@10,20 B@25,14 C@34,20
blue: X@18,8 Y@30,7
ball: A
pass: A->B
loop: on

slide: "B receives, C makes the run"
ball: B
run: C~>28,4

slide: "B finds C"
clear: arrows
red: C@28,4
ball: C
pass: B->C
```

### New base directives

| Line | Meaning |
|---|---|
| `loop: on` / `loop: off` | Whether playback repeats. Default `off`. Base only. |
| `ball: B` | A ball token may be a player label as well as a coordinate: the ball sits at that player's feet and follows them on later slides. Works in the base and in slides, mixed freely with coordinates (`ball: B 30,5`). |

### Inside a slide

`slide:` (with an optional caption, quoted like `label:`) starts a new slide. Every line
until the next `slide:` or the end of the block belongs to it.

| Line | Effect |
|---|---|
| `red: C@28,4` (any team) | An existing label **moves** there. A new label **adds** a player. Re-declaring a label under a different team is a line error — players do not change team. |
| `remove: X Y` | Takes players off. An unknown label, or a label both placed and removed on the same slide, is a line error. |
| `ball: …` | **Replaces all balls.** Tokens as in the base; several `ball:` lines on one slide concatenate. |
| `clear: balls` | Removes all balls (with no `ball:` line, the slide has none). |
| `pass:` / `run:` / `dribble:` / `shot:` | **Adds** an arrow. Arrows from earlier slides carry over. |
| `clear: arrows` | Drops the carried-over arrows before this slide's own are added. `clear:` accepts `arrows`, `balls` or both. |

**Fixed from slide 1:** `area`, `goal`, `zone`, `cone`, `flag`, `loop`, `label`. Any of
these inside a slide is a line error ("cones are set on the first slide and cannot
change"). Conversely `remove:` and `clear:` before the first `slide:` are line
errors — there is nothing earlier to remove or clear. A slide's caption replaces `label:` for that slide; slide 1 shows `label:`.

Endpoints in a slide resolve against the players that exist at that slide: base, plus
earlier slides' additions, minus removals, plus this slide's placements. An unknown
label is a line error on the slide line that used it.

### Error tolerance

`parse` still never throws. A bad line inside a slide costs only that line; the slide
and every other slide still build. Line numbers are block-relative, as today.

## Model

`parse(src).scene` gains two fields; everything existing is unchanged:

```js
scene.loop    // boolean, default false
scene.slides  // [] when the block has none
// each slide:
{
  caption: "B finds C" | null,
  players: [{ team, label, x, y }],   // placements on this slide, in source order
  removes: ["X"],
  clear: { arrows: false, balls: false },
  balls: null | [{ x, y } | { ref: "C" }],  // null = unchanged from previous slide
  actions: [{ kind, from, to, seq }],       // seq restarts at 1 on each slide
}
```

Base balls stay in `scene.marks` as `{ kind: "ball", x, y }` or, new,
`{ kind: "ball", ref: "B" }`.

`serialise` writes `loop: on` when set and each slide after the base, in the order
`slide:`, `clear:`, `remove:`, players, `ball:`, actions. The invariant still holds:
`parse(serialise(scene)).scene` deep-equals `scene`, and serialise is stable under
re-parse. A slide with `clear.balls` and a non-empty `balls` round-trips as both lines.

## Frames — `src/lib/slides.js`

`frames(scene)` → an array of fully resolved scenes, one per slide (length 1 for a block
without slides). This is the only thing the renderer consumes, for animated and
static diagrams alike.

Each frame:

```js
{
  area, marks,            // fixed marks only (goal, zone, cone, flag); balls pulled out
  players: [{ team, label, x, y }],
  balls:   [{ key, x, y }],          // resolved coordinates
  actions: [{ key, kind, from, to, seq, carried }],
  label,                  // slide 1: scene.label; later: the slide caption
}
```

Rules:

- **Players:** start from the previous frame, apply placements (move or add), then
  removes.
- **Balls:** if the slide has `clear.balls` or `balls !== null`, replace the list;
  otherwise carry. A `{ref}` ball resolves to that player's position *in this frame*,
  so it follows a player who moves. A ball whose player has been removed stays at
  its last position. **Ball identity is order:** `key` is the ball's index, so ball 1
  on one slide is ball 1 on the next and glides; extras fade in, missing ones fade out.
- **Actions:** carried actions (previous frame's, unless `clear.arrows`) get
  `carried: true`; this slide's own get `carried: false` and their per-slide `seq`.
  A carried action whose endpoint player has been removed is dropped. `key` is stable
  for an action's lifetime (slide index + position within its slide), so the renderer
  can fade it in once and keep it.
- Slide 1 is the base: all its actions are `carried: false`, so it looks exactly as a
  diagram does today.

`pitchSvg.actionPath` and `resolvePoint` take a frame unchanged — a frame has the same
`players` shape a scene does.

## Rendering — `PitchDiagram.jsx`

- New prop `animated` (default `false`). `DrillCard` and `DrillPicker` thumbnails stay
  static and show slide 1. `DrillPreview` passes `animated`, so both the drill view and
  the editor preview get controls.
- With one frame, or `animated` false: renders frame 0 exactly as today.
- With two or more frames and `animated`: a control row below the SVG —
  **Play / Pause** (reads **Replay** once a non-looping run has ended) and a `2 / 4`
  counter. The frame's caption is drawn where `label:` is today, at the foot of the
  diagram, so it also shows on a thumbnail's slide 1.
- Starts paused on slide 1. Nothing moves until Play is pressed.
- Playback: a small hook advances the frame index — 1000 ms glide, then 1500 ms hold.
  At the end: if `loop`, cut (no glide) back to slide 1 and continue; otherwise stop on
  the last slide showing Replay. Replay cuts to slide 1 and plays.
- Players and balls are keyed (label, ball key) and positioned with a `transform`;
  a CSS transition on `transform` does the glide. Arrows are keyed and fade in and out
  by opacity. Carried arrows draw at reduced opacity with no number badge, so badges
  number only what is new on the current slide.
- `prefers-reduced-motion: reduce` disables the transitions: slides cut instead of
  gliding.
- Timers are cleared on pause, unmount, and when the source changes (editing in the
  preview resets to slide 1, paused).

## Help card

`PitchHelp` gains an "Animating it" section: `slide:`, moving a player by
re-declaring it, `ball: B`, `remove:`, `clear: arrows`/`clear: balls`, `loop: on`, and
the rule that cones, goals, zones and flags are set on the first slide. Examples are
built from `pitch.js` exports, as the rest of the card is.

## Testing

- `test/pitch.test.js`: slide parsing; each base-only directive rejected inside a slide;
  team change, unknown label, place-and-remove errors; `ball: B` in base and slides;
  `loop`; round trip and serialise stability with slides; one bad slide line leaving
  the other slides intact.
- `test/slides.test.js`: cumulative moves across three slides; add and remove; ball
  replace vs carry; ball order-matching keys; `{ref}` ball follows a moving player and
  stays put when its player is removed; `clear: arrows` / `clear: balls`; carried flag
  and per-slide seq; carried action dropped when its player is removed; no slides →
  one frame equal to today's scene.
- A fixture `test/fixtures/3v2-animated.md`.
- `test/pitchDiagram.test.jsx` (SSR): no controls without slides or without
  `animated`; controls and `1 / 3` counter with slides; initial render is slide 1.
- Playback timing and gliding are checked by hand in `npm run dev`.

## Out of scope

Per-slide durations, step forward/back buttons, a viewer loop toggle, cones or other
fixed marks changing between slides, drag-to-edit, GIF/video export.

## Addendum — 2026-09-25: removing arrows, an Add slide button, a smaller diagram

### `remove:` takes arrows

`remove:` accepts arrow tokens as well as player labels, written as the arrow was added:
`remove: X A->B C~>28,4`. A token matching the arrow grammar (`<from><arrow><to>`) is an
arrow; anything else is a label.

- The arrow symbol must match too: `remove: A->B` drops a pass A→B, not a run A~>B. Every
  carried arrow equal in kind, source and target is dropped.
- Checked against the arrows on the pitch at the end of the previous slide. One that is
  not there is a line error: `no arrow "A->B" on the pitch to remove`. An arrow to or from
  a player removed on the same slide is still on the pitch at that point, so listing it
  is not an error.
- To track this, the parser keeps the arrows on the pitch section by section, exactly as
  `frames` computes them: previous arrows (none after `clear: arrows`), minus removed
  ones, minus any whose endpoint player has gone, plus the slide's own.
- Model: each slide gains `removeArrows: [{ kind, from, to }]`. `serialise` writes
  them on the `remove:` line after the labels.
- `frames` drops matching carried arrows; they fade out like any leaving arrow.

### Add slide

An **Add slide** button above the editor source appends a slide to the `pitch` block the
cursor is in (or the drill's last block), with the caption selected so typing replaces
it. Disabled when the drill has no `pitch` block. What it inserts, positions taken from
the block's last frame:

```
slide: "What happens next"
# Uncomment a line and change it; delete the ones you don't need.
# Add arrows with pass:, run:, dribble: or shot:.
# red: A@10,20 B@25,14 C@28,4
# blue: X@18,8 Y@27,8
# ball: C
# remove: B->C
```

`ball:` names a player when the ball is at their feet, coordinates otherwise; the
`ball:` and `remove:` lines are omitted when there are no balls or arrows. The logic is a
pure function in `src/lib/slideTemplate.js`; the component only reads the cursor and
applies the result.

### A smaller diagram

`.pitch` is capped at 560px wide (left-aligned). Phones and thumbnails are unaffected.

## Addendum — 2026-09-25 (2): slide controls, picking and dragging

### Controls

`[Play] [Replay]  1 2 3 4` below an animated diagram, replacing the `2 / 4` counter.

- **Play / Pause** is one button that swaps its label. Play on the last slide (or after
  the run ended) starts again from slide 1.
- **Replay** is always shown: cut to slide 1 and play.
- **A slide number** cuts to that slide and pauses. The current one is marked
  (`aria-current`); each number's tooltip is the slide's caption.
- An edit to the source no longer resets to slide 1: it pauses and stays on the slide
  shown (clamped if slides were removed), so editing slide 3 keeps showing slide 3.

### Editing on the diagram (editor preview only)

The editor passes `editable` to the preview's diagrams; the drill view stays read-only.

- **Pick:** a click on the pitch that does not start a drag inserts `x,y` (snapped to
  0.5 m, clamped to the area) at the source cursor, replacing any selection, with a space
  before it unless the cursor follows whitespace, `@` or an arrow's `>`. Focus returns to
  the source.
- **Drag:** players, balls, cones, flags, goals, zones (by their top-left corner, the
  whole zone moves), and the head of an arrow whose target is a coordinate (a round
  handle at the target). The item follows the pointer live; playback pauses. On release
  the source is edited **in place** — only the dragged coordinate's text changes, so
  comments and layout survive:
  - *Player:* on the slide shown. If that slide places the label, its coordinate is
    rewritten; otherwise `<team>: <label>@x,y` is appended to the slide.
  - *Cone, flag, goal, zone:* always their line in slide 1 (they are fixed).
  - *Ball:* if the slide shown owns the ball list (it has a `ball:` line, or it is slide
    1), that token is rewritten — a ball at a player's feet becomes coordinates. Otherwise
    `ball: …` is appended to the slide listing every current ball, the dragged one at its
    new place, the rest as they are (labels for balls at a player's feet).
  - *Arrow head:* the arrow's own line, in the slide it was added on.
- Touch works: the diagram sets `touch-action: none` while editable.

### Structure

- `parse` returns `{ scene, errors, spans }`. `spans` records, per section, where each
  player's, ball's and action target's coordinate text sits (`{ line, from, to }`), the
  same for every mark, and each section's last line. The scene is unchanged, so the
  round-trip invariant is untouched.
- `src/lib/sourceEdit.js`: `moveInSource(source, frameIndex, target, x, y)` → new source
  or null; `moveInFrame(frame, target, x, y)` → the frame with that item moved, for the
  live drag.
- `src/lib/editDoc.js`: `pitchBlocks(doc)`, `replaceBlock(doc, line, content)`,
  `insertText(doc, start, end, text)`. `slideTemplate.js` uses `pitchBlocks`.
- `pitchSvg.js`: `toMetres(px, py, area)`, the inverse of `toPx`, snapped and clamped.
