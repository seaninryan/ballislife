// Pure geometry for rendering a pitch scene: numbers and SVG path strings only.
// No JSX lives here — that is what makes it testable in the node environment.

export const S = 10;   // pixels per metre
export const PAD = 2;  // metres of margin, so marks on the boundary are not clipped

export const viewBox = (area) => `0 0 ${(area.w + 2 * PAD) * S} ${(area.h + 2 * PAD) * S}`;

export const toPx = (x, y) => ({ x: (x + PAD) * S, y: (y + PAD) * S });

// Marking dimensions are capped proportions of the area: a real 16.5 m penalty box
// would swallow a 40x25 m training grid.
const BOX_DEPTH = (w) => Math.min(16.5, w * 0.35);
const BOX_WIDTH = (h) => Math.min(40.3, h * 0.7);
const SIX_DEPTH = (w) => Math.min(5.5, w * 0.12);
const SIX_WIDTH = (h) => Math.min(18.3, h * 0.35);
const CIRCLE_R = (h) => Math.min(9.15, h * 0.3);
const SPOT_X = (w) => Math.min(11, w * 0.22);
// The arc is capped against the pitch DEPTH as well as its width. Capping on `h` alone
// let the D outgrow the pitch: on a 12m-deep, 40m-wide area it bulged to 11.8m, further
// from goal than the penalty box itself and within 0.2m of the far edge.
const ARC_R = (w, h) => Math.min(9.15, h * 0.25, (w - SPOT_X(w)) * 0.5);

const rect = (x, y, w, h) => {
  const a = toPx(x, y);
  return { type: "rect", x: a.x, y: a.y, w: w * S, h: h * S };
};
const line = (x1, y1, x2, y2, dashed = false) => {
  const a = toPx(x1, y1), b = toPx(x2, y2);
  return { type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, dashed };
};
const circle = (cx, cy, r) => {
  const c = toPx(cx, cy);
  return { type: "circle", cx: c.x, cy: c.y, r: r * S };
};

// Penalty box and six-yard box at the x=0 goal end, vertically centred.
function boxesAt(w, h, flip = false) {
  const bd = BOX_DEPTH(w), bw = BOX_WIDTH(h);
  const sd = SIX_DEPTH(w), sw = SIX_WIDTH(h);
  const bx = flip ? w - bd : 0;
  const sx = flip ? w - sd : 0;
  return [rect(bx, (h - bw) / 2, bd, bw), rect(sx, (h - sw) / 2, sd, sw)];
}

// -> array of shape descriptors in pixels, in draw order.
// type is one of "rect" | "line" | "circle" | "arc".
export function markings(area) {
  const { w, h } = area;
  const out = [rect(0, 0, w, h)];

  switch (area.markings) {
    case "half": {
      out.push(...boxesAt(w, h));
      // The penalty arc is only the part of the circle that lies beyond the box line —
      // the "D". A full semicircle centred on the spot would cut straight through the
      // penalty box, which reads as wrong to anyone who knows a pitch. Omitted entirely
      // when the caps put the whole circle inside the box.
      const bd = BOX_DEPTH(w);
      const r = ARC_R(w, h);
      const dx = bd - SPOT_X(w);
      if (Math.abs(dx) < r) {
        const dy = Math.sqrt(r * r - dx * dx);
        const top = toPx(bd, h / 2 - dy);
        const bot = toPx(bd, h / 2 + dy);
        out.push({ type: "arc", d: `M ${top.x} ${top.y} A ${r * S} ${r * S} 0 0 1 ${bot.x} ${bot.y}` });
      }
      break;
    }
    case "full": {
      out.push(line(w / 2, 0, w / 2, h));
      out.push(circle(w / 2, h / 2, CIRCLE_R(h)));
      // Both boxes at both ends. An earlier version dropped the six-yard boxes here on
      // the grounds that they were unreadable slivers at full-pitch scale, which is
      // simply false: at 100x64 the caps resolve to the real 5.5x18.3m box, rendered at
      // the same scale as everything else. Verified by rendering.
      out.push(...boxesAt(w, h), ...boxesAt(w, h, true));
      break;
    }
    case "box":
      out.push(boxesAt(w, h)[0]);
      break;
    case "third":
      out.push(line(w / 3, 0, w / 3, h, true));
      out.push(line((2 * w) / 3, 0, (2 * w) / 3, h, true));
      break;
    default:
      break; // plain: boundary only
  }
  return out;
}

export const MARKER_GAP = 11; // px: stop the arrow short of the target marker

// A target -> { x, y } in metres, or null if it cannot be resolved.
// "goal" prefers a declared goal mark and otherwise falls back to the left-centre
// of the area, so a drill that says `shot: A->>goal` without declaring a goal still
// renders something sensible instead of vanishing.
export function resolvePoint(target, scene) {
  if (target.ref === undefined) return { x: target.x, y: target.y };
  if (target.ref === "goal") {
    const g = scene.marks.find((m) => m.kind === "goal");
    return g ? { x: g.x, y: g.y } : { x: 0, y: scene.area.h / 2 };
  }
  const p = scene.players.find((pl) => pl.label === target.ref);
  return p ? { x: p.x, y: p.y } : null;
}

// Action -> { kind, d, seq, badge } in pixels, or null if unrenderable.
export function actionPath(action, scene) {
  const from = resolvePoint({ ref: action.from }, scene);
  const to = resolvePoint(action.to, scene);
  if (!from || !to) return null;

  const a = toPx(from.x, from.y);
  const b = toPx(to.x, to.y);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null; // genuinely coincident, and would divide by zero

  const ux = dx / len, uy = dy / len;
  // Shrink the gap for short actions rather than dropping them. A fixed gap silently
  // erased any action between close-together players — realistic in a small rondo —
  // leaving neither an arrow nor an error to explain where it went.
  const gap = Math.min(MARKER_GAP, len * 0.35);
  const start = { x: a.x + ux * gap, y: a.y + uy * gap };
  const end = { x: b.x - ux * gap, y: b.y - uy * gap };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const r2 = (v) => Math.round(v * 100) / 100;

  let d;
  // How far the drawn path deviates from the straight chord at its midpoint. The badge
  // is offset by this plus a clearance, so it never sits on the line it labels — a fixed
  // offset from the chord put the badge inside its own run curve for almost every run.
  let curveOffset = 0;
  if (action.kind === "dribble") {
    // Perpendicular zig-zag along the line: a series of quadratic wiggles.
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(3, Math.round(span / 14));
    const seg = span / steps;
    const amp = 5;
    curveOffset = amp;
    d = `M ${r2(start.x)} ${r2(start.y)}`;
    for (let i = 0; i < steps; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const cx = start.x + ux * seg * (i + 0.5) + -uy * amp * sign;
      const cy = start.y + uy * seg * (i + 0.5) + ux * amp * sign;
      const px = start.x + ux * seg * (i + 1);
      const py = start.y + uy * seg * (i + 1);
      d += ` q ${r2(cx - (start.x + ux * seg * i))} ${r2(cy - (start.y + uy * seg * i))} ${r2(px - (start.x + ux * seg * i))} ${r2(py - (start.y + uy * seg * i))}`;
    }
  } else if (action.kind === "run") {
    // Single gentle bow, so a run reads differently from a pass even when parallel.
    const bow = Math.min(len * 0.18, 26);
    curveOffset = bow / 2; // a quadratic deviates half its control offset at t=0.5
    const cx = mid.x + -uy * bow;
    const cy = mid.y + ux * bow;
    d = `M ${r2(start.x)} ${r2(start.y)} Q ${r2(cx)} ${r2(cy)} ${r2(end.x)} ${r2(end.y)}`;
  } else {
    d = `M ${r2(start.x)} ${r2(start.y)} L ${r2(end.x)} ${r2(end.y)}`;
  }

  return {
    kind: action.kind,
    d,
    seq: action.seq,
    badge: { x: mid.x + -uy * (curveOffset + 9), y: mid.y + ux * (curveOffset + 9) },
  };
}
