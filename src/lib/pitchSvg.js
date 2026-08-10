// Pure geometry for rendering a pitch scene: numbers and SVG path strings only.
// No JSX lives here — that is what makes it testable in the node environment.

export const S = 10;   // pixels per metre
export const PAD = 2;  // metres of margin, so marks on the boundary are not clipped

export const viewBox = (area) => `0 0 ${(area.w + 2 * PAD) * S} ${(area.h + 2 * PAD) * S}`;

export const toPx = (x, y) => ({ x: (x + PAD) * S, y: (y + PAD) * S });
