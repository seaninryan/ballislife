// src/lib/slideTemplate.js
// What the editor's Add slide button inserts: a new slide whose every line is the
// current state, commented out, so a coach uncomments and edits what moves instead of
// looking up where everyone is. Pure — the editor only reads the cursor and applies it.
import { parse, playerLines, arrowToken } from "./pitch.js";
import { frames } from "./slides.js";
import { pitchBlocks } from "./editDoc.js";

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

// Whether the drill has a diagram for Add slide to extend.
export const hasPitchBlock = (doc) => pitchBlocks(doc).length > 0;

// (document, cursor offset) -> { text, select: [start, end] } with a slide appended to the
// pitch block holding the cursor, or the last block; null when there is none. `select`
// is the caption, so typing replaces it.
export function addSlide(doc, cursor) {
  const blocks = pitchBlocks(doc);
  if (blocks.length === 0) return null;
  // The fence lines count as inside the block: a cursor on ```pitch is visibly in that diagram.
  const block = blocks.find((b) => cursor >= b.start && cursor <= b.end) ?? blocks[blocks.length - 1];
  const source = doc.slice(block.from, block.to);
  // A CRLF drill gets a CRLF template, so one file does not end up with mixed endings.
  const eol = doc.includes("\r\n") ? "\r\n" : "\n";
  const flat = source.replace(/\r/g, "");
  // The slide starts on a line of its own, one blank line after the block's last line, as
  // a coach would type it. A document that ends on the ```pitch line itself has its
  // content starting mid-line, straight after the fence: gluing the template there would
  // turn the fence into "```pitchslide: …" and the diagram into prose.
  const midLine = block.from > 0 && doc[block.from - 1] !== "\n";
  const lead = midLine ? eol
    : flat === "" || flat.endsWith("\n\n") ? ""
    : flat.endsWith("\n") ? eol
    : eol + eol;
  const template = slideTemplate(parse(source).scene).replace(/\n/g, eol);
  const text = doc.slice(0, block.to) + lead + template + doc.slice(block.to);
  const start = block.to + lead.length + 'slide: "'.length;
  return { text, select: [start, start + CAPTION.length] };
}
