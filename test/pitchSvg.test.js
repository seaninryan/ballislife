import { describe, it, expect } from "vitest";
import { S, PAD, viewBox, toPx, markings, resolvePoint, actionPath, MARKER_GAP } from "../src/lib/pitchSvg.js";
import { parse } from "../src/lib/pitch.js";

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

describe("resolvePoint", () => {
  const { scene } = parse("area: 40x25 half\ngoal: 0,12\nred: A@10,20 B@25,14\npass: A->B\n");

  it("resolves a player reference", () => {
    expect(resolvePoint({ ref: "A" }, scene)).toEqual({ x: 10, y: 20 });
  });

  it("resolves a coordinate target unchanged", () => {
    expect(resolvePoint({ x: 3, y: 4 }, scene)).toEqual({ x: 3, y: 4 });
  });

  it("resolves goal to the declared goal mark", () => {
    expect(resolvePoint({ ref: "goal" }, scene)).toEqual({ x: 0, y: 12 });
  });

  it("falls back to the left-centre of the area when no goal is declared", () => {
    const bare = parse("area: 40x25 half\n").scene;
    expect(resolvePoint({ ref: "goal" }, bare)).toEqual({ x: 0, y: 12.5 });
  });

  it("returns null for an unresolvable reference", () => {
    expect(resolvePoint({ ref: "Q" }, scene)).toBe(null);
  });
});

describe("actionPath", () => {
  const { scene } = parse("red: A@0,0 B@20,0\npass: A->B\nrun: A~>20,0\ndribble: A=>20,0\nshot: A->>20,0\n");
  const byKind = (k) => scene.actions.find((a) => a.kind === k);

  it("draws a pass as a straight line", () => {
    const p = actionPath(byKind("pass"), scene);
    expect(p.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    expect(p.kind).toBe("pass");
  });

  it("stops short of the target so the arrowhead stays visible", () => {
    const p = actionPath(byKind("pass"), scene);
    const endX = Number(p.d.match(/L ([\d.]+)/)[1]);
    expect(endX).toBeLessThan(toPx(20, 0).x);
    expect(toPx(20, 0).x - endX).toBeCloseTo(MARKER_GAP, 5);
  });

  it("curves a run", () => {
    expect(actionPath(byKind("run"), scene).d).toContain("Q");
  });

  it("makes a dribble wavy", () => {
    const d = actionPath(byKind("dribble"), scene).d;
    expect((d.match(/q/g) || []).length).toBeGreaterThan(2);
  });

  it("places a sequence badge at the midpoint", () => {
    const p = actionPath(byKind("pass"), scene);
    expect(p.seq).toBe(1);
    expect(p.badge.x).toBeCloseTo((toPx(0, 0).x + toPx(20, 0).x) / 2, 0);
  });

  it("returns null when an endpoint cannot be resolved", () => {
    const broken = { kind: "pass", from: "Z", to: { ref: "B" }, seq: 1 };
    expect(actionPath(broken, scene)).toBe(null);
  });

  it("returns null for a zero-length action rather than dividing by zero", () => {
    const same = { kind: "pass", from: "A", to: { ref: "A" }, seq: 1 };
    expect(actionPath(same, scene)).toBe(null);
  });

  it("draws a short action instead of dropping it", () => {
    // A fixed marker gap erased any action between close players — realistic in a small
    // rondo — leaving neither an arrow nor an error to explain where it went.
    const small = parse("area: 10x10\nred: A@4,5 B@5,5\npass: A->B\n").scene;
    const p = actionPath(small.actions[0], small);
    expect(p).not.toBe(null);
    expect(p.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
  });
});
