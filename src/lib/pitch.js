// src/lib/pitch.js
// The `pitch` diagram language: source text <-> scene model.
//
// parse() NEVER throws. It returns { scene, errors } so that one malformed line
// degrades to an inline message while the rest of the drill still renders.
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
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      const p = parsePoint(token);
      if (!p) { ctx.fail(`expected "<x>,<y>" but got "${token}"`); continue; }
      ctx.scene.marks.push({ kind, ...p });
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

function parseLoop(rest, ctx) {
  if (rest === "on" || rest === "off") ctx.scene.loop = rest === "on";
  else ctx.fail(`expected "on" or "off" but got "${rest}"`);
}

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
  const m = rest.match(ZONE_RE);
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

// Each movement kind is written with a distinct arrow so a reader can tell a pass
// from a run at a glance in the source, not only in the rendering.
export const ARROWS = { pass: "->", run: "~>", dribble: "=>", shot: "->>" };
export const CLEAR_TARGETS = ["arrows", "balls"];
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

// Scene -> canonical source. Inverse of parse() at the MODEL level:
// parse(serialise(scene)).scene deep-equals scene, and serialise is stable under
// re-parse. It is NOT byte-identical to arbitrary input source: directives are
// reordered, multi-action lines are split one per line, and `#` comments are dropped
// entirely — they are stripped by parse and have no home in the scene model. A future
// drag-to-edit canvas that writes back through serialise will therefore lose any
// comments a coach hand-wrote in the block.
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
  for (const run of runs(scene.players, (p) => p.team)) {
    lines.push(`${run.key}: ${run.items.map((p) => `${p.label}@${pt(p)}`).join(" ")}`);
  }
  for (const a of [...scene.actions].sort((x, y) => x.seq - y.seq)) {
    const to = a.to.ref !== undefined ? a.to.ref : pt(a.to);
    lines.push(`${a.kind}: ${a.from}${ARROWS[a.kind]}${to}`);
  }
  // Truthiness rather than a null check: an empty label serialises to `label: ` which
  // parses back as null, so emitting it would break round-trip stability.
  if (scene.label) {
    lines.push(`label: ${quote(scene.label)}`);
  }
  if (scene.loop) lines.push("loop: on");

  return lines.join("\n") + "\n";
}
