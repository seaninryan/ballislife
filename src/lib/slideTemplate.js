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
