import { describe, it, expect } from "vitest";
import { S, PAD, viewBox, toPx } from "../src/lib/pitchSvg.js";

describe("scaling", () => {
  it("pads the viewBox so edge marks are not clipped", () => {
    expect(viewBox({ w: 40, h: 25, markings: "plain" })).toBe(
      `0 0 ${(40 + 2 * PAD) * S} ${(25 + 2 * PAD) * S}`,
    );
  });

  it("maps metres to pixels with the padding offset", () => {
    expect(toPx(0, 0)).toEqual({ x: PAD * S, y: PAD * S });
    expect(toPx(10, 5)).toEqual({ x: (10 + PAD) * S, y: (5 + PAD) * S });
  });

  it("maps a player on the goal line to a visible coordinate", () => {
    expect(toPx(0, 12).x).toBeGreaterThan(0);
  });
});
