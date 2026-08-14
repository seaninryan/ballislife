// src/components/AppMark.jsx
// The app's mark: a monogram, not a ball. Inline so the header costs no request and the
// disc can take the colour of whatever it sits in. The same geometry as public/icon.svg,
// which cannot import this because a favicon has to be a file — keep the two in step by
// hand if the mark changes.
//
// Deliberately two shapes: at 16px in a tab strip anything more detailed turns to mush,
// and being told apart from the other tabs is the whole job.
//
// The transform is measured, not eyeballed. The path's own bounding box is already
// centred on (32,32), so the job is only to scale it: 0.8 puts the B's corners at 65% of
// the radius, which leaves a ring of disc around it and survives a rounded-square mask.
// An earlier hand-tuned nudge pushed it OFF centre and sized it at 76%, which read as
// clipped. If the mark changes, measure getBBox again rather than nudging by eye.
import React from "react";

export default function AppMark({ size = 24, className = "" }) {
  return (
    <svg
      className={`app-mark ${className}`.trim()}
      width={size} height={size} viewBox="0 0 64 64"
      role="img" aria-label="ball.is.life"
    >
      <circle cx="32" cy="32" r="30" fill="currentColor" />
      <path
        fill="var(--panel)" fillRule="evenodd"
        transform="translate(6.42 6.40) scale(0.8)"
        d="M17 13h18a12 12 0 0 1 7.4 21.4A12.6 12.6 0 0 1 36.5 51H17V13zm9 6v10h8.4a5 5 0 0 0 0-10H26zm0 16v10h9.5a5 5 0 0 0 0-10H26z"
      />
    </svg>
  );
}
