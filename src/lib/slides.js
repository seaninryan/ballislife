// src/lib/slides.js
// Replays a parsed scene's slides into complete frames, one per slide. The parser stores
// each slide as an edit of the one before; this is the only place that history is
// replayed, so the renderer only ever sees whole pictures.

import { actionPath } from "./pitchSvg.js";

// A ball at a player's feet sits just off the player's centre, so neither hides the
// other. Metres.
export const FEET = 0.8;

// -> [{ area, marks, players, balls, actions, label }], length 1 without slides.
// marks are the fixed ones (goal, zone, cone, flag); balls are pulled out and resolved.
export function frames(scene) {
  const marks = scene.marks.filter((m) => m.kind !== "ball");
  let players = scene.players;
  let specs = scene.marks.filter((m) => m.kind === "ball").map(({ kind, ...b }) => b);
  let actions = scene.actions.map((a, i) => ({ ...a, key: `0.${i}`, carried: false }));
  let placed = [];
  const out = [];

  const snapshot = (label) => {
    ({ specs, balls: placed } = placeBalls(specs, players, placed));
    out.push({ area: scene.area, marks, players, balls: placed, actions, label });
  };
  snapshot(scene.label);

  (scene.slides ?? []).forEach((s, n) => {
    players = applyPlayers(players, s);
    if (s.clear.balls || s.balls !== null) specs = s.balls ?? [];
    const on = new Set(players.map((p) => p.label));
    const alive = (a) =>
      on.has(a.from) && (a.to.ref === undefined || a.to.ref === "goal" || on.has(a.to.ref));
    const carried = s.clear.arrows ? [] : actions.filter(alive).map((a) => ({ ...a, carried: true }));
    // key is slide number + position on that slide: stable for the arrow's lifetime, so
    // the renderer fades it in once and then keeps the same element.
    const own = s.actions.map((a, i) => ({ ...a, key: `${n + 1}.${i}`, carried: false }));
    actions = [...carried, ...own];
    snapshot(s.caption);
  });
  return out;
}

function applyPlayers(players, slide) {
  const moved = players.map((p) => slide.players.find((q) => q.label === p.label) ?? p);
  const added = slide.players.filter((q) => !players.some((p) => p.label === q.label));
  return [...moved, ...added].filter((p) => !slide.removes.includes(p.label));
}

// A ball's identity is its position in the list: ball i on one slide is ball i on the
// next, which is what lets it glide. A ball at a player's feet follows them; once that
// player leaves, the ball stays where it was, pinned to coordinates so a later player
// reusing the label does not claim it.
function placeBalls(specs, players, before) {
  const balls = [];
  const next = specs.map((spec, key) => {
    if (spec.ref === undefined) {
      balls.push({ key, x: spec.x, y: spec.y });
      return spec;
    }
    const p = players.find((pl) => pl.label === spec.ref);
    if (p) {
      balls.push({ key, x: p.x + FEET, y: p.y + FEET });
      return spec;
    }
    const last = before.find((b) => b.key === key);
    if (!last) return spec; // unreachable for a parsed scene: parse rejects unknown refs
    balls.push({ key, x: last.x, y: last.y });
    return { x: last.x, y: last.y };
  });
  return { specs: next, balls };
}

// What to draw for `next`, given the frame on screen before it — null on first render
// or after a cut, when nothing should fade. Items new to `next` are entering; items only
// in `prev` are kept, at their old position and marked leaving, so the renderer can fade
// them out rather than have them vanish mid-glide.
export function stage(prev, next) {
  const from = prev ?? next;
  return {
    players: diff(from.players, next.players, (p) => p.label),
    balls: diff(from.balls, next.balls, (b) => b.key),
    paths: diff(pathsOf(from), pathsOf(next), (p) => p.key),
  };
}

// Each arrow's geometry is resolved against its own frame, so a leaving arrow is drawn
// where it was, between players who may since have moved or gone.
function pathsOf(frame) {
  return frame.actions.flatMap((a) => {
    const p = actionPath(a, frame);
    return p ? [{ ...p, key: a.key, carried: a.carried }] : [];
  });
}

function diff(before, after, keyOf) {
  const had = new Set(before.map(keyOf));
  const has = new Set(after.map(keyOf));
  return [
    ...after.map((it) => ({ ...it, entering: !had.has(keyOf(it)), leaving: false })),
    ...before.filter((it) => !has.has(keyOf(it))).map((it) => ({ ...it, entering: false, leaving: true })),
  ];
}
