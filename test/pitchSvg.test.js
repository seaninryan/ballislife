import { describe, it, expect } from "vitest";
import { S, PAD, viewBox, toPx, markings } from "../src/lib/pitchSvg.js";

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

describe("markings", () => {
  const shapes = (m) => markings({ w: 40, h: 25, markings: m }).map((s) => s.type);

  it("draws only the boundary for plain", () => {
    expect(shapes("plain")).toEqual(["rect"]);
  });

  it("draws boundary, penalty box, six-yard box and arc for half", () => {
    expect(shapes("half")).toEqual(["rect", "rect", "rect", "arc"]);
  });

  it("draws boundary, halfway line, centre circle and two boxes for full", () => {
    expect(shapes("full")).toEqual(["rect", "line", "circle", "rect", "rect"]);
  });

  it("draws boundary and one box for box", () => {
    expect(shapes("box")).toEqual(["rect", "rect"]);
  });

  it("draws two dashed thirds lines", () => {
    const out = markings({ w: 45, h: 25, markings: "third" });
    expect(out.map((s) => s.type)).toEqual(["rect", "line", "line"]);
    expect(out.slice(1).every((s) => s.dashed)).toBe(true);
    expect(out[1].x1).toBeCloseTo(toPx(15, 0).x);
    expect(out[2].x1).toBeCloseTo(toPx(30, 0).x);
  });

  it("caps the penalty box so it cannot exceed the training area", () => {
    const [, box] = markings({ w: 20, h: 12, markings: "box" });
    expect(box.w).toBeLessThanOrEqual(20 * 0.35 * S);
    expect(box.h).toBeLessThanOrEqual(12 * 0.7 * S);
  });

  it("centres the penalty box vertically", () => {
    const [, box] = markings({ w: 40, h: 25, markings: "box" });
    expect(box.y + box.h / 2).toBeCloseTo(toPx(0, 12.5).y);
  });

  it("puts the boundary rect at the padded origin", () => {
    const [bound] = markings({ w: 40, h: 25, markings: "plain" });
    expect(bound).toMatchObject({ x: PAD * S, y: PAD * S, w: 40 * S, h: 25 * S });
  });

  it("draws the penalty arc only beyond the box line", () => {
    // Both endpoints must sit on the penalty box line, so the arc is the "D" poking out
    // of the box rather than a semicircle cutting through it.
    const arc = markings({ w: 40, h: 25, markings: "half" }).find((s) => s.type === "arc");
    const boxLine = toPx(Math.min(16.5, 40 * 0.35), 0).x;
    const t = arc.d.split(/\s+/); // M x y A rx ry rot laf sf x y
    expect(Number(t[1])).toBeCloseTo(boxLine);
    expect(Number(t[9])).toBeCloseTo(boxLine);
  });
});
