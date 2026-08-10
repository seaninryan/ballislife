// src/components/PitchDiagram.jsx
// Renders a `pitch` source block. Parse errors are shown inline and the last
// renderable scene is still drawn: a typo must never blank the preview.
import React, { useMemo } from "react";
import { parse } from "../lib/pitch.js";
import { viewBox, toPx, markings, actionPath, markShape } from "../lib/pitchSvg.js";

const TEAM_FILL = { red: "var(--red)", blue: "var(--blue)", yellow: "var(--yellow)", gk: "var(--gk)" };
const ACTION_STROKE = {
  pass: "var(--ball-line)",
  dribble: "var(--ball-line)",
  run: "var(--run-line)",
  shot: "var(--shot-line)",
};
const ACTION_WIDTH = { pass: 2.4, dribble: 2.4, run: 2.2, shot: 4 };
const R = 7; // player radius, px

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

function Mark({ mark }) {
  const s = markShape(mark);
  if (!s) return null;
  if (s.type === "zone") {
    return (
      <g>
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

function Player({ player }) {
  const p = toPx(player.x, player.y);
  const fill = TEAM_FILL[player.team];
  return (
    <g>
      {player.team === "gk" ? (
        <rect x={p.x - R} y={p.y - R} width={R * 2} height={R * 2} rx="3" fill={fill} stroke="#fff" strokeWidth="1" />
      ) : (
        <circle cx={p.x} cy={p.y} r={R} fill={fill} stroke="#fff" strokeWidth="1" />
      )}
      <text x={p.x} y={p.y + 3} fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">
        {player.label}
      </text>
    </g>
  );
}

export default function PitchDiagram({ source = "", baseLine = 1 }) {
  const { scene, errors } = useMemo(() => parse(source), [source]);
  const paths = useMemo(
    () => scene.actions.map((a) => actionPath(a, scene)).filter(Boolean),
    [scene],
  );
  const shapes = useMemo(() => markings(scene.area), [scene.area]);
  const labelAt = toPx(scene.area.w / 2, scene.area.h);

  return (
    <div>
      <svg
        className="pitch" viewBox={viewBox(scene.area)}
        role="img" aria-label={scene.label || "Pitch diagram"}
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
        {scene.marks.map((m, i) => <Mark key={i} mark={m} />)}
        {paths.map((p, i) => (
          <path
            key={i} d={p.d} fill="none"
            stroke={ACTION_STROKE[p.kind]} strokeWidth={ACTION_WIDTH[p.kind]}
            strokeDasharray={p.kind === "run" ? "6 4" : undefined}
            markerEnd={`url(#arrow-${p.kind})`}
          />
        ))}
        {/* Badges before players, so a crowded drill hides a sequence number rather
            than a player. A missing player is a missing entity; a missing ordinal is
            recoverable from the source. */}
        {paths.map((p, i) => (
          <g key={`b${i}`}>
            <circle cx={p.badge.x} cy={p.badge.y} r="6.5" fill="#000" fillOpacity="0.55" />
            <text x={p.badge.x} y={p.badge.y + 3} fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle">
              {p.seq}
            </text>
          </g>
        ))}
        {scene.players.map((p) => <Player key={p.label} player={p} />)}
        {scene.label ? (
          <text x={labelAt.x} y={labelAt.y + 14} fontSize="10" fill="#fff" fillOpacity="0.85" textAnchor="middle">
            {scene.label}
          </text>
        ) : null}
      </svg>

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
