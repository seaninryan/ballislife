// src/lib/sourceEdit.js
// Dragging on the editor's diagram, as text edits. A drag rewrites exactly one
// coordinate where it is written — or, when the slide shown does not mention the item
// yet, adds one line to that slide — so a coach's comments and layout survive. That is
// why this edits spans rather than going through serialise, which drops comments.
//
// A target is { kind: "player", label } | { kind: "mark", index } (into frame.marks) |
// { kind: "ball", key } | { kind: "arrow", key } (a frame action's key).
import { parse } from "./pitch.js";
import { frames } from "./slides.js";

const num = (v) => String(Math.round(v * 10) / 10);
const coord = (x, y) => `${num(x)},${num(y)}`;

// -> the new block source, or null when the target cannot be moved there.
export function moveInSource(source, frameIndex, target, x, y) {
  const { scene, spans } = parse(source);
  const frame = frames(scene)[frameIndex];
  if (!frame) return null;
  const lines = source.split("\n");
  const cr = source.includes("\r\n") ? "\r" : "";
  const replace = (span, text) => {
    if (!span) return null;
    const l = lines[span.line];
    lines[span.line] = l.slice(0, span.from) + text + l.slice(span.to);
    return lines.join("\n");
  };
  const append = (text) => {
    lines.splice(spans.sections[frameIndex].last + 1, 0, text + cr);
    return lines.join("\n");
  };
  const section = spans.sections[frameIndex];
  const own = frameIndex === 0 ? scene : scene.slides[frameIndex - 1];

  switch (target.kind) {
    case "player": {
      const i = own.players.findIndex((p) => p.label === target.label);
      if (i >= 0) return replace(section.players[i], coord(x, y));
      const p = frame.players.find((q) => q.label === target.label);
      return p ? append(`${p.team}: ${p.label}@${coord(x, y)}`) : null;
    }
    case "mark": {
      // frame.marks is scene.marks without the balls, in order.
      const i = scene.marks.map((m, j) => (m.kind === "ball" ? -1 : j)).filter((j) => j >= 0)[target.index];
      return i === undefined ? null : replace(spans.marks[i], coord(x, y));
    }
    case "ball": {
      if (!frame.balls.some((b) => b.key === target.key)) return null;
      if (ownsBalls(scene, frameIndex)) {
        const span = frameIndex === 0
          ? spans.marks[scene.marks.map((m, j) => (m.kind === "ball" ? j : -1)).filter((j) => j >= 0)[target.key]]
          : section.balls?.[target.key];
        return replace(span, coord(x, y));
      }
      // A ball: line replaces every ball, so the new line must list them all.
      const all = frame.balls.map((b) => (b.key === target.key ? coord(x, y) : b.ref ?? coord(b.x, b.y)));
      return append(`ball: ${all.join(" ")}`);
    }
    case "arrow": {
      const [s, i] = String(target.key).split(".").map(Number);
      const list = s === 0 ? scene.actions : scene.slides[s - 1]?.actions;
      const action = list?.[i];
      if (!action || action.to.ref !== undefined) return null;
      return replace(spans.sections[s].actions[i], coord(x, y));
    }
    default:
      return null;
  }
}

// Whether the balls on this slide are the ones its own lines set, rather than carried.
function ownsBalls(scene, frameIndex) {
  if (frameIndex === 0) return true;
  const s = scene.slides[frameIndex - 1];
  return s.balls !== null;
}

// The frame with one item at (x, y): what the diagram draws while a drag is in progress.
export function moveInFrame(frame, target, x, y) {
  switch (target.kind) {
    case "player":
      return { ...frame, players: frame.players.map((p) => (p.label === target.label ? { ...p, x, y } : p)) };
    case "mark":
      return { ...frame, marks: frame.marks.map((m, i) => (i === target.index ? { ...m, x, y } : m)) };
    case "ball":
      return { ...frame, balls: frame.balls.map((b) => (b.key === target.key ? { key: b.key, x, y } : b)) };
    case "arrow":
      return { ...frame, actions: frame.actions.map((a) => (a.key === target.key ? { ...a, to: { x, y } } : a)) };
    default:
      return frame;
  }
}
