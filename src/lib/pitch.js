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
      const label = m[1];
      if (ctx.scene.players.some((p) => p.label === label)) {
        ctx.fail(`duplicate player label "${label}"`);
        continue;
      }
      ctx.scene.players.push({ team, label, x: Number(m[2]), y: Number(m[3]) });
    }
  };
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

const DIRECTIVES = { area: parseArea, goal: parseGoal, zone: parseZone, label: parseLabel };
for (const team of TEAMS) DIRECTIVES[team] = parsePlayers(team);
for (const kind of POINT_MARKS) DIRECTIVES[kind] = parsePointMarks(kind);
for (const kind of ARROW_KINDS) DIRECTIVES[kind] = parseActions(kind);

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

  // Report in source order. Endpoints resolve in this second pass, so without the sort
  // an action error on line 1 lands after a mark error on line 2 — and the whole point
  // of carrying a line number is that a reader can follow the list down the source.
  // The sort is stable, so multiple errors on one line keep their original order.
  errors.sort((x, y) => x.line - y.line);
  return { scene, errors };
}

// Trims trailing zeros so 10 serialises as "10", not "10.0".
const n = (v) => String(Number(v));
const pt = (o) => `${n(o.x)},${n(o.y)}`;
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
      lines.push(`${run.key}: ${run.items.map(pt).join(" ")}`);
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

  return lines.join("\n") + "\n";
}
