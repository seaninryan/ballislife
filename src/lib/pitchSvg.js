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
const ARC_R = (h) => Math.min(9.15, h * 0.25);
const SPOT_X = (w) => Math.min(11, w * 0.22);

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
      const r = ARC_R(h);
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
      // Penalty box at each end; the six-yard boxes are dropped at full-pitch
      // scale because they render as unreadable slivers.
      out.push(boxesAt(w, h)[0], boxesAt(w, h, true)[0]);
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
