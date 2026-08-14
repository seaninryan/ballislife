// src/components/BallIcon.jsx
// The app's mark, inline so the header costs no request and the ball can take the colour
// of whatever it sits in. The same geometry as public/icon.svg, which cannot import this
// because a favicon has to be a file — keep the two in step by hand if the mark changes.
//
// Deliberately few shapes: at 16px in a tab strip anything more detailed turns to mush,
// and being told apart from the other tabs is the whole job.
import React from "react";

export default function BallIcon({ size = 24, className = "" }) {
  return (
    <svg
      className={`ball-icon ${className}`.trim()}
      width={size} height={size} viewBox="0 0 64 64"
      role="img" aria-label="ballislife"
    >
      <circle cx="32" cy="32" r="30" fill="currentColor" />
      <polygon points="32,19 44,27.7 39.4,41.8 24.6,41.8 20,27.7" fill="var(--panel)" />
      <g stroke="var(--panel)" strokeWidth="6" strokeLinecap="round">
        <path d="M32 19 V8" /><path d="M44 27.7 L54.5 24.3" /><path d="M39.4 41.8 L45.9 50.7" />
        <path d="M24.6 41.8 L18.1 50.7" /><path d="M20 27.7 L9.5 24.3" />
      </g>
    </svg>
  );
}
