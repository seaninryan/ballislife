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
  ctx.scene.area = { w: Number(m[1]), h: Number(m[2]), markings };
}

const DIRECTIVES = { area: parseArea };

export function parse(src) {
  const scene = emptyScene();
  const errors = [];
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
      fail: (message) => { errors.push({ line: i + 1, message }); },
    });
  });

  return { scene, errors };
}
