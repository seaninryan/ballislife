// src/lib/pitch.js
// The `pitch` diagram language: source text <-> scene model.
//
// parse() NEVER throws. It returns { scene, errors, spans } so that one malformed line
// degrades to an inline message while the rest of the drill still renders. The spans
// say where each coordinate is written in the source, so the editor can change one in
// place; they are not part of the scene.
// Coordinates are metres, origin top-left.

export const MARKINGS = ["plain", "half", "full", "box", "third"];
const DEFAULT_AREA = { w: 40, h: 25, markings: "plain" };

function emptyScene() {
  return {
    area: { ...DEFAULT_AREA }, marks: [], players: [], actions: [], label: null,
    loop: false, slides: [],
  };
}

// "40x25 half" -> { w, h, markings }
function parseArea(rest, ctx) {
  const m = rest.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s+(\S+))?$/);
  if (!m) return ctx.fail('expected "<width>x<height> [markings]"');
  const markings = m[3] ?? "plain";
  if (!MARKINGS.includes(markings)) {
    return ctx.fail(`unknown markings "${markings}" (expected ${MARKINGS.join(", ")})`);
  }
  const w = Number(m[1]);
  const h = Number(m[2]);
  // A zero dimension collapses the whole pitch and would render an empty box with no
  // explanation — the exact "blank preview from a typo" failure this module exists to
  // prevent. Negative dimensions are already rejected by the unsigned regex above.
  if (w <= 0 || h <= 0) {
    return ctx.fail(`area must be larger than 0x0, got "${m[1]}x${m[2]}"`);
  }
  ctx.scene.area = { w, h, markings };
}

export const TEAMS = ["red", "blue", "yellow", "gk"];

// "A@10,20 B@25,14" -> one player per token. A bad token fails alone.
// On a slide, naming a player who is already on moves them; a new label adds one.
function parsePlayers(team) {
  return (rest, ctx) => {
    for (const { text: token, at } of tokens(rest)) {
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
      ctx.record(player, at + player.label.length + 1, at + token.length);
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

export const GOAL_SIZES = ["full", "small", "mini"];
export const POINT_MARKS = ["cone", "ball", "flag"];
const NUM = "-?\\d+(?:\\.\\d+)?";
// Built once at module scope rather than per token parsed.
const POINT_RE = new RegExp(`^(${NUM}),(${NUM})$`);
const ZONE_RE = new RegExp(`^(${NUM}),(${NUM})\\s+(${NUM})\\s*x\\s*(${NUM})\\s*(.*)$`);

function parsePoint(token) {
  const m = token.match(POINT_RE);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

// A player label on its own, as a ball token: "ball: B" puts the ball at B's feet.
const LABEL_RE = /^[A-Za-z][A-Za-z0-9]{0,3}$/;

function parsePointMarks(kind) {
  return (rest, ctx) => {
    for (const { text: token, at } of tokens(rest)) {
      const p = parsePoint(token);
      if (!p) { ctx.fail(`expected "<x>,<y>" but got "${token}"`); continue; }
      const mark = { kind, ...p };
      ctx.scene.marks.push(mark);
      ctx.record(mark, at, at + token.length);
    }
  };
}

// "10,12 B" -> a ball per token. A player label puts the ball at that player's feet,
// so it follows them from slide to slide. Like an action endpoint, the label is checked
// only once every player in the section is known.
//
// The base's balls live in marks, in source order with the cones. A slide's balls
// REPLACE the previous slide's, so they are collected on the slide — and only created
// when a valid token arrives, so a line of nothing but typos leaves the balls unchanged
// rather than silently clearing them. A label that turns out to name nobody is dropped
// at the end of the slide, and closeSection resets an emptied list for the same reason.
function parseBalls(rest, ctx) {
  const toks = tokens(rest);
  if (ctx.slide && toks.length === 0) {
    return ctx.fail('expected at least one ball — use "clear: balls" for none');
  }
  const kind = ctx.slide ? {} : { kind: "ball" };
  const add = (ball) => {
    const list = ctx.slide ? (ctx.slide.balls ??= []) : ctx.scene.marks;
    list.push(ball);
    return list;
  };
  for (const { text: token, at } of toks) {
    const p = parsePoint(token);
    if (p) {
      const ball = { ...kind, ...p };
      add(ball);
      ctx.record(ball, at, at + token.length);
      continue;
    }
    if (!LABEL_RE.test(token)) {
      ctx.fail(`expected "<x>,<y>" or a player label but got "${token}"`);
      continue;
    }
    const ball = { ...kind, ref: token };
    ctx.ballRefs.push({ ball, list: add(ball), line: ctx.line });
    ctx.record(ball, at, at + token.length);
  }
}

function parseLoop(rest, ctx) {
  if (rest === "on" || rest === "off") ctx.scene.loop = rest === "on";
  else ctx.fail(`expected "on" or "off" but got "${rest}"`);
}

// Players by label, arrows as they were written: "remove: X A->B". An arrow is checked
// against those on the pitch at the end of the previous slide, so one removed with its
// player on this same slide is still there to name.
function parseRemove(rest, ctx) {
  for (const { text: token, at } of tokens(rest)) {
    if (ARROW_RE.test(token)) {
      const arrow = parseArrow(token);
      if (!arrow) { ctx.fail(`expected "<from><arrow><to>" but got "${token}"`); continue; }
      if (!ctx.arrows.some((a) => sameArrow(a, arrow))) {
        ctx.fail(`no arrow "${token}" on the pitch to remove`);
        continue;
      }
      ctx.slide.removeArrows.push(arrow);
      // The whole token, so dragging that arrow's head can rewrite this mention too.
      ctx.record(arrow, at, at + token.length);
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
    caption, players: [], removes: [], removeArrows: [], clear: { arrows: false, balls: false },
    balls: null, actions: [],
  };
}

// "0,12 small"
function parseGoal(rest, ctx) {
  const [first, second] = tokens(rest);
  const p = parsePoint(first?.text ?? "");
  if (!p) return ctx.fail('expected "<x>,<y> [size]"');
  const size = second?.text ?? "full";
  if (!GOAL_SIZES.includes(size)) {
    return ctx.fail(`unknown goal size "${size}" (expected ${GOAL_SIZES.join(", ")})`);
  }
  const goal = { kind: "goal", ...p, size };
  ctx.scene.marks.push(goal);
  ctx.record(goal, first.at, first.at + first.text.length);
}

// '12,0 16x25 "press here"'
function parseZone(rest, ctx) {
  const m = rest.match(ZONE_RE);
  if (!m) return ctx.fail('expected "<x>,<y> <w>x<h> [label]"');
  const zone = {
    kind: "zone",
    x: Number(m[1]), y: Number(m[2]),
    w: Number(m[3]), h: Number(m[4]),
    label: unquote(m[5]),
  };
  ctx.scene.marks.push(zone);
  ctx.record(zone, 0, m[1].length + 1 + m[2].length);
}

// Strips surrounding double quotes; returns null for empty.
function unquote(s) {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const m = t.match(/^"(.*)"$/);
  return m ? m[1] : t;
}

// Whitespace-separated tokens with their offset in `rest`, so a coordinate's position in
// the source can be recorded for the editor's drag-to-move.
function tokens(rest) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(rest))) out.push({ text: m[0], at: m.index });
  return out;
}

function parseLabel(rest, ctx) {
  ctx.scene.label = unquote(rest);
}

// Each movement kind is written with a distinct arrow so a reader can tell a pass
// from a run at a glance in the source, not only in the rendering.
export const ARROWS = { pass: "->", run: "~>", dribble: "=>", shot: "->>" };
export const CLEAR_TARGETS = ["arrows", "balls"];
const ARROW_KINDS = Object.keys(ARROWS);

// Longest arrow first, so "->>" is not mis-read as "->".
const ARROW_RE = /^(.*?)(->>|~>|=>|->)(.*)$/;

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

function parseActions(kind) {
  return (rest, ctx) => {
    const arrow = ARROWS[kind];
    for (const { text: token, at } of tokens(rest)) {
      const m = token.match(ARROW_RE);
      if (!m || m[2] !== arrow || m[1] === "" || m[3] === "") {
        ctx.fail(`expected "<from><arrow><to>" but got "${token}"`);
        continue;
      }
      // Resolution is deferred: the player may be declared on a later line.
      ctx.pending.push({
        kind, fromRaw: m[1], toRaw: m[3], line: ctx.line,
        toSpan: ctx.span(at + m[1].length + m[2].length, at + token.length),
      });
    }
  };
}

// A target is a player label, the literal "goal", or a coordinate.
function resolveTarget(raw, known) {
  if (raw === "goal") return { ok: true, to: { ref: "goal" } };
  const p = parsePoint(raw);
  if (p) return { ok: true, to: p };
  if (known(raw)) return { ok: true, to: { ref: raw } };
  return { ok: false, message: `unknown player "${raw}"` };
}

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
    const action = { kind: a.kind, from: a.fromRaw, to: t.to, seq: into.length + 1 };
    into.push(action);
    state.spanOf.set(action, a.toSpan);
  }
  for (const r of state.ballRefs) {
    if (known(r.ball.ref)) continue;
    errors.push({ line: r.line, message: `unknown player "${r.ball.ref}"` });
    r.list.splice(r.list.indexOf(r.ball), 1);
  }
  // A slide whose every ball named nobody is a typo, not a request for no balls, so it
  // keeps the previous slide's balls; "clear: balls" is how to ask for none.
  if (state.slide?.balls?.length === 0) state.slide.balls = null;
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
  state.pending = [];
  state.ballRefs = [];
}

const DIRECTIVES = { area: parseArea, goal: parseGoal, zone: parseZone, label: parseLabel };
for (const team of TEAMS) DIRECTIVES[team] = parsePlayers(team);
for (const kind of POINT_MARKS) DIRECTIVES[kind] = parsePointMarks(kind);
for (const kind of ARROW_KINDS) DIRECTIVES[kind] = parseActions(kind);
DIRECTIVES.ball = parseBalls;
DIRECTIVES.loop = parseLoop;
DIRECTIVES.remove = parseRemove;
DIRECTIVES.clear = parseClear;

export function parse(src) {
  const scene = emptyScene();
  const errors = [];
  // `roster` is every player on the pitch at the current point in the source, label ->
  // team. It only grows in the base; slides add to it and remove from it.
  // `spanOf` maps each scene item to where its coordinate is written; `sections` has
  // one entry per section (the base, then each slide) with its last non-blank line.
  const state = {
    slide: null, pending: [], ballRefs: [], roster: new Map(), arrows: [],
    spanOf: new Map(), sections: [{ last: -1 }],
  };
  const lines = String(src ?? "").split("\n");

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (line === "") return;
    const section = state.sections[state.sections.length - 1];
    if (line.trimStart().startsWith("#")) { section.last = i; return; }
    const fail = (message) => { errors.push({ line: i + 1, message }); };

    const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) return fail('expected "<directive>: <value>"');
    const key = m[1].toLowerCase();
    const rest = m[2].trim();
    // The line has no trailing whitespace and the regex consumed the leading, so
    // rest === m[2] and it ends the line.
    const restAt = line.length - m[2].length;

    if (key === "slide") {
      closeSection(scene, state, errors);
      state.slide = newSlide(unquote(rest));
      scene.slides.push(state.slide);
      state.sections.push({ last: i });
      return;
    }
    // Own keys only: a plain lookup finds Object.prototype's `constructor`, so the line
    // `constructor: x` was silently accepted rather than reported.
    section.last = i;
    const handler = Object.hasOwn(DIRECTIVES, key) ? DIRECTIVES[key] : undefined;
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
      arrows: state.arrows,
      line: i + 1,
      fail,
      span: (from, to) => ({ line: i, from: restAt + from, to: restAt + to }),
      record: (item, from, to) => state.spanOf.set(item, { line: i, from: restAt + from, to: restAt + to }),
    });
  });
  closeSection(scene, state, errors);

  // Report in source order. Endpoints resolve at the end of their section, so without
  // the sort an action error on line 1 lands after a mark error on line 2 — and the
  // whole point of carrying a line number is that a reader can follow the list down
  // the source. The sort is stable, so multiple errors on one line keep their order.
  errors.sort((x, y) => x.line - y.line);

  // Built from the FINAL lists, so a ball or action dropped during resolution cannot
  // misalign a span with its item.
  const get = (item) => state.spanOf.get(item) ?? null;
  const spans = {
    marks: scene.marks.map(get),
    sections: state.sections.map((s, n) => {
      const own = n === 0 ? scene : scene.slides[n - 1];
      return {
        last: s.last,
        players: own.players.map(get),
        actions: own.actions.map(get),
        balls: n === 0 ? null : own.balls?.map(get) ?? null,
        removeArrows: n === 0 ? [] : own.removeArrows.map(get),
      };
    }),
  };
  return { scene, errors, spans };
}

// Trims trailing zeros so 10 serialises as "10", not "10.0".
const n = (v) => String(Number(v));
const pt = (o) => `${n(o.x)},${n(o.y)}`;
// A ball may stand at a player rather than a coordinate.
const tok = (o) => (o.ref !== undefined ? o.ref : pt(o));
// Quote when the value contains whitespace, so short labels stay unquoted — and also
// when it already starts with a quote, or the round trip breaks: `"a"` would serialise
// unquoted as `label: "a"`, which parses back as the bare string `a`.
const quote = (s) => (/\s/.test(s) || s.startsWith(`"`) ? `"${s}"` : s);

// Consecutive items sharing a key, in array order. Grouping globally by kind or team
// discarded the original order, which broke parse(serialise(scene)) deep-equality for
// any scene whose directives interleave — a drill written red, blue, red came back as
// red, red, blue. Grouping was only ever cosmetic; runs keep the tidy one-line-per-team
// output for the common case AND preserve order.
function runs(items, keyOf) {
  const out = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, items: [item] });
  }
  return out;
}

export function playerLines(players) {
  return runs(players, (p) => p.team)
    .map((run) => `${run.key}: ${run.items.map((p) => `${p.label}@${pt(p)}`).join(" ")}`);
}

// One arrow as it is written in source: "A->B", "C~>28,4", "C->>goal".
export function arrowToken(a) {
  const to = a.to.ref !== undefined ? a.to.ref : pt(a.to);
  return `${a.from}${ARROWS[a.kind]}${to}`;
}

function actionLines(actions) {
  return [...actions].sort((x, y) => x.seq - y.seq).map((a) => `${a.kind}: ${arrowToken(a)}`);
}

// clear and remove come first: they act on what the previous slide left, before this
// slide's placements. Parse forbids placing and removing one label on a slide, so the
// order never changes what the slide means.
function slideLines(s) {
  const out = [s.caption ? `slide: ${quote(s.caption)}` : "slide:"];
  const clear = CLEAR_TARGETS.filter((t) => s.clear[t]);
  if (clear.length) out.push(`clear: ${clear.join(" ")}`);
  const removes = [...s.removes, ...s.removeArrows.map(arrowToken)];
  if (removes.length) out.push(`remove: ${removes.join(" ")}`);
  out.push(...playerLines(s.players));
  if (s.balls?.length) out.push(`ball: ${s.balls.map(tok).join(" ")}`);
  out.push(...actionLines(s.actions));
  return out;
}

// Scene -> canonical source. Inverse of parse() at the MODEL level:
// parse(serialise(scene)).scene deep-equals scene, and serialise is stable under
// re-parse. It is NOT byte-identical to arbitrary input source: directives are
// reordered, multi-action lines are split one per line, and `#` comments are dropped
// entirely — they are stripped by parse and have no home in the scene model. A future
// drag-to-edit canvas that writes back through serialise will therefore lose any
// comments a coach hand-wrote in the block. Slides are written after the base, one
// directive group per line, in the order above.
export function serialise(scene) {
  const lines = [];

  const { w, h, markings } = scene.area;
  lines.push(`area: ${n(w)}x${n(h)}${markings === "plain" ? "" : ` ${markings}`}`);

  for (const run of runs(scene.marks, (m) => m.kind)) {
    if (run.key === "zone") {
      for (const z of run.items) {
        const label = z.label ? ` ${quote(z.label)}` : "";
        lines.push(`zone: ${pt(z)} ${n(z.w)}x${n(z.h)}${label}`);
      }
    } else if (run.key === "goal") {
      for (const g of run.items) {
        lines.push(`goal: ${pt(g)}${g.size === "full" ? "" : ` ${g.size}`}`);
      }
    } else {
      lines.push(`${run.key}: ${run.items.map(tok).join(" ")}`);
    }
  }
  lines.push(...playerLines(scene.players));
  lines.push(...actionLines(scene.actions));
  // Truthiness rather than a null check: an empty label serialises to `label: ` which
  // parses back as null, so emitting it would break round-trip stability.
  if (scene.label) {
    lines.push(`label: ${quote(scene.label)}`);
  }
  if (scene.loop) lines.push("loop: on");
  for (const s of scene.slides ?? []) lines.push(...slideLines(s));

  return lines.join("\n") + "\n";
}
