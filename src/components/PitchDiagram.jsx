// src/components/PitchDiagram.jsx
// Renders a `pitch` source block, and with `animated` plays its slides. Parse errors
// are shown inline and the last renderable scene is still drawn: a typo must never
// blank the preview.
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { parse } from "../lib/pitch.js";
import { viewBox, toPx, toMetres, markings, markShape } from "../lib/pitchSvg.js";
import { moveInSource, moveInFrame } from "../lib/sourceEdit.js";
import { frames, stage } from "../lib/slides.js";
import { step, initial } from "../lib/playback.js";

const TEAM_FILL = { red: "var(--red)", blue: "var(--blue)", yellow: "var(--yellow)", gk: "var(--gk)" };
const ACTION_STROKE = {
  pass: "var(--ball-line)",
  dribble: "var(--ball-line)",
  run: "var(--run-line)",
  shot: "var(--shot-line)",
};
const ACTION_WIDTH = { pass: 2.4, dribble: 2.4, run: 2.2, shot: 4 };
const R = 7; // player radius, px

// Joins the truthy class names; undefined rather than "" so no empty attribute renders.
const cls = (...names) => names.filter(Boolean).join(" ") || undefined;
const motion = (item) => cls(item.entering && "pitch-enter", item.leaving && "pitch-leave");

function Marking({ shape }) {
  const stroke = { stroke: "var(--paint)", fill: "none", strokeWidth: 1.3 };
  const dash = shape.dashed ? { strokeDasharray: "5 4" } : null;
  if (shape.type === "rect") {
    return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} {...stroke} {...dash} />;
  }
  if (shape.type === "line") {
    return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...stroke} {...dash} />;
  }
  if (shape.type === "circle") {
    return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...stroke} />;
  }
  return <path d={shape.d} {...stroke} />;
}

function Mark({ mark, onGrab }) {
  const s = markShape(mark);
  if (!s) return null;
  if (s.type === "zone") {
    return (
      <g onPointerDown={onGrab}>
        <rect
          x={s.x} y={s.y} width={s.w} height={s.h}
          fill="var(--yellow)" fillOpacity="0.16"
          stroke="var(--yellow)" strokeOpacity="0.7" strokeWidth="1.3" strokeDasharray="5 3"
        />
        {s.label ? (
          <text
            x={s.labelX} y={s.labelY} fontSize="9" fill="#fff"
            stroke="#1d4d31" strokeWidth="2.5" paintOrder="stroke" textAnchor="middle"
          >
            {s.label}
          </text>
        ) : null}
      </g>
    );
  }
  // Wrapped only when grabbable, so a read-only diagram renders exactly as it did.
  const body = markBody(s);
  return onGrab ? <g onPointerDown={onGrab}>{body}</g> : body;
}

function markBody(s) {
  if (s.type === "path") return <path d={s.d} fill="var(--cone)" />;
  if (s.type === "circle") return <circle cx={s.cx} cy={s.cy} r={s.r} fill="#fff" stroke="#222" strokeWidth="1" />;
  if (s.type === "flag") {
    return (
      <g>
        <line x1={s.x} y1={s.y} x2={s.x} y2={s.top} stroke="#fff" strokeWidth="1.6" />
        <path d={s.d} fill="var(--shot-line)" />
      </g>
    );
  }
  return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke="#fff" strokeWidth="2" />;
}

function Player({ player, onGrab }) {
  const p = toPx(player.x, player.y);
  const fill = TEAM_FILL[player.team];
  return (
    <g
      className={cls("pitch-glide", motion(player))} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
      onPointerDown={onGrab}
    >
      {player.team === "gk" ? (
        <rect x={-R} y={-R} width={R * 2} height={R * 2} rx="3" fill={fill} stroke="#fff" strokeWidth="1" />
      ) : (
        <circle cx="0" cy="0" r={R} fill={fill} stroke="#fff" strokeWidth="1" />
      )}
      <text x="0" y="3" fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">
        {player.label}
      </text>
    </g>
  );
}

function Ball({ ball, onGrab }) {
  const s = markShape({ kind: "ball", x: ball.x, y: ball.y });
  return (
    <g
      className={cls("pitch-glide", motion(ball))} style={{ transform: `translate(${s.cx}px, ${s.cy}px)` }}
      onPointerDown={onGrab}
    >
      <circle cx="0" cy="0" r={s.r} fill="#fff" stroke="#222" strokeWidth="1" />
    </g>
  );
}

// Turns the reducer's `delay` into a timer. Every rule about what comes next is in
// lib/playback.js; this only keeps time.
function usePlayback(count, loop, source) {
  const [state, dispatch] = useReducer(step, initial);
  // Editing the source pauses and keeps the slide shown.
  useEffect(() => { dispatch({ type: "edited", n: count }); }, [source]);
  useEffect(() => {
    if (!state.playing) return undefined;
    const t = setTimeout(() => dispatch({ type: "tick", n: count, loop }), state.delay);
    return () => clearTimeout(t);
  }, [state, count, loop]);
  return [state, dispatch];
}

// `editable` turns the diagram into an input for the editor: a press on the grass picks
// that coordinate (onPick), and dragging a player, ball, mark or arrow head hands back
// the whole block with that one coordinate rewritten (onChange).
export default function PitchDiagram({
  source = "", baseLine = 1, animated = false, editable = false, onChange, onPick,
}) {
  const { scene, errors } = useMemo(() => parse(source), [source]);
  const all = useMemo(() => frames(scene), [scene]);
  const [play, dispatch] = usePlayback(all.length, scene.loop, source);
  const controls = animated && all.length > 1;
  // Clamped: the reset after an edit lands one render after the new source.
  const index = controls ? Math.min(play.index, all.length - 1) : 0;
  const frame = all[index];
  const prev = controls && play.from !== null ? all[play.from] ?? null : null;
  const svgRef = useRef(null);
  // { target, x, y, moved }: target null means a press on the grass, which picks.
  const [drag, setDrag] = useState(null);
  const shown = drag?.moved ? moveInFrame(frame, drag.target, drag.x, drag.y) : frame;
  // No previous slide while dragging: the item must follow the pointer, not glide to it.
  const { players, balls, paths } = useMemo(() => stage(drag ? null : prev, shown), [prev, shown, drag]);
  const shapes = useMemo(() => markings(scene.area), [scene.area]);
  const labelAt = toPx(scene.area.w / 2, scene.area.h);

  const metresAt = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return toMetres(p.x, p.y, scene.area);
  };
  const press = (target) => (e) => {
    if (!editable) return;
    // Stopped so a press on a player does not also reach the svg and pick.
    e.stopPropagation();
    e.preventDefault();
    // Captured on the svg, so the drag keeps coming here when the pointer outruns the item.
    svgRef.current.setPointerCapture?.(e.pointerId);
    dispatch({ type: "pause" });
    setDrag({ target, ...metresAt(e), moved: false });
  };
  const onPointerMove = (e) => {
    if (!drag?.target) return;
    const m = metresAt(e);
    if (m.x !== drag.x || m.y !== drag.y) setDrag({ ...drag, ...m, moved: true });
  };
  const onPointerUp = (e) => {
    if (!drag) return;
    const m = metresAt(e);
    if (drag.target && drag.moved) {
      const next = moveInSource(source, index, drag.target, m.x, m.y);
      if (next !== null) onChange?.(next);
    } else if (!drag.target) {
      onPick?.(`${m.x},${m.y}`);
    }
    setDrag(null);
  };
  // Arrow heads that point at a coordinate can be dragged; one into a player follows them.
  const handles = editable
    ? shown.actions.filter((a) => a.to.ref === undefined).map((a) => ({ key: a.key, ...toPx(a.to.x, a.to.y) }))
    : [];

  return (
    <div>
      <svg
        ref={svgRef}
        className={cls("pitch", editable && "editable", (drag || !prev) && "cut")} viewBox={viewBox(scene.area)}
        role="img" aria-label={frame.label || scene.label || "Pitch diagram"}
        style={editable ? { touchAction: "none" } : undefined}
        onPointerDown={editable ? press(null) : undefined}
        onPointerMove={editable ? onPointerMove : undefined}
        onPointerUp={editable ? onPointerUp : undefined}
        onPointerCancel={editable ? () => setDrag(null) : undefined}
      >
        <defs>
          {/* markerUnits="userSpaceOnUse" is essential: SVG markers scale with
              stroke-width by default, so the 4px-wide shot would get a ~28px arrowhead
              that swamps a 7px player marker. Verified by rendering — it looks
              cartoonish without this. */}
          {Object.entries(ACTION_STROKE).map(([kind, colour]) => (
            <marker
              key={kind} id={`arrow-${kind}`} markerUnits="userSpaceOnUse"
              markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"
            >
              <path d="M0,0 L9,4.5 L0,9 z" fill={colour} />
            </marker>
          ))}
        </defs>

        <rect x="0" y="0" width="100%" height="100%" fill="var(--grass)" />
        {shapes.map((s, i) => <Marking key={i} shape={s} />)}
        {shown.marks.map((m, i) => (
          <Mark key={i} mark={m} onGrab={editable ? press({ kind: "mark", index: i }) : undefined} />
        ))}
        {paths.map((p) => (
          <path
            key={p.key} d={p.d} fill="none"
            className={cls("pitch-arrow", p.carried && "pitch-carried", motion(p))}
            stroke={ACTION_STROKE[p.kind]} strokeWidth={ACTION_WIDTH[p.kind]}
            strokeDasharray={p.kind === "run" ? "6 4" : undefined}
            markerEnd={`url(#arrow-${p.kind})`}
          />
        ))}
        {/* Badges before players, so a crowded drill hides a sequence number rather
            than a player. Only this slide's own arrows are numbered: a carried arrow is
            context, and its old number would read as part of the current sequence. */}
        {paths.filter((p) => !p.carried && !p.leaving).map((p) => (
          <g key={`b${p.key}`} className={motion(p)}>
            <circle cx={p.badge.x} cy={p.badge.y} r="6.5" fill="#000" fillOpacity="0.55" />
            <text x={p.badge.x} y={p.badge.y + 3} fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle">
              {p.seq}
            </text>
          </g>
        ))}
        {players.map((p) => (
          <Player
            key={p.label} player={p}
            onGrab={editable && !p.leaving ? press({ kind: "player", label: p.label }) : undefined}
          />
        ))}
        {/* Balls after players: a ball at a player's feet overlaps the marker's edge
            and must sit on top of it to be seen. */}
        {balls.map((b) => (
          <Ball key={b.key} ball={b} onGrab={editable && !b.leaving ? press({ kind: "ball", key: b.key }) : undefined} />
        ))}
        {handles.map((h) => (
          <circle
            key={`h${h.key}`} className="pitch-handle" cx={h.x} cy={h.y} r="7"
            onPointerDown={press({ kind: "arrow", key: h.key })}
          />
        ))}
        {frame.label ? (
          <text x={labelAt.x} y={labelAt.y + 14} fontSize="10" fill="#fff" fillOpacity="0.85" textAnchor="middle">
            {frame.label}
          </text>
        ) : null}
      </svg>

      {controls ? (
        <div className="row pitch-controls">
          <button
            type="button"
            onClick={() => dispatch(play.playing ? { type: "pause" } : { type: "play", n: all.length })}
          >
            {play.playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "replay" })}>Replay</button>
          <span className="pitch-slides" role="group" aria-label="Slides">
            {all.map((f, i) => (
              <button
                key={i} type="button" className="pitch-slide"
                aria-current={i === index ? "step" : undefined}
                title={f.label || `Slide ${i + 1}`}
                onClick={() => dispatch({ type: "seek", index: i })}
              >
                {i + 1}
              </button>
            ))}
          </span>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="banner err mono">
          {errors.map((e, i) => (
            <div key={i}>line {e.line + baseLine - 1}: {e.message}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
