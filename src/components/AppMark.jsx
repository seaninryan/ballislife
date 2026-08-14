// src/components/AppMark.jsx
// The app's mark: a lowercase b on a disc, matching the ball.is.life wordmark. Inline so
// the header costs no request and the disc can take the colour of whatever it sits in.
// The same geometry as public/icon.svg, which cannot import this because a favicon has to
// be a file — test/header.test.jsx holds the two in step.
//
// Deliberately simple: at 16px in a tab strip anything more detailed turns to mush, and
// being told apart from the other tabs is the whole job. A lowercase b is three primitives
// — a stem, a ring, a hole — where the uppercase B needed two bowls to meet at a waist,
// which is precisely where two attempts at it looked wrong.
//
// NOTE THE WINDING. The stem and the bowl OVERLAP, so this depends on the default nonzero
// fill rule to union them. Setting fillRule="evenodd" here would punch the overlap out and
// cut the letter in half. The counter is drawn the opposite way round (sweep 0 against the
// bowl's sweep 1), which is what makes it a hole under nonzero.
//
// The transform is measured, not eyeballed: the path's bounding box is 29.5 x 38 centred
// on (31.75, 32), and 0.8 puts its worst corner at 64% of the disc's radius. Re-measure
// with getBBox rather than nudging by eye if the glyph ever changes.
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
        fill="var(--panel)"
        transform="translate(6.60 6.40) scale(0.8)"
        d="M17 13 H26 V51 H17 Z M19.5 37.5 A13.5 13.5 0 1 1 46.5 37.5 A13.5 13.5 0 1 1 19.5 37.5 Z M26 37.5 A7 7 0 1 0 40 37.5 A7 7 0 1 0 26 37.5 Z"
      />
    </svg>
  );
}
