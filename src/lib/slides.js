// src/lib/slides.js
// Replays a parsed scene's slides into complete frames, one per slide. The parser stores
// each slide as an edit of the one before; this is the only place that history is
// replayed, so the renderer only ever sees whole pictures.

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
