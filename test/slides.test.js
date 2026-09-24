import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";
import { frames, FEET, stage } from "../src/lib/slides.js";

const framesOf = (src) => {
  const { scene, errors } = parse(src);
  expect(errors).toEqual([]);
  return frames(scene);
};
const xs = (f, label) => f.players.find((p) => p.label === label)?.x;

describe("frames", () => {
  it("gives a block without slides one frame that is today's scene", () => {
    const [f, ...rest] = framesOf('cone: 5,5\nred: A@1,1\nball: 2,2\npass: A->2,2\nlabel: hi\n');
    expect(rest).toEqual([]);
    expect(f.marks).toEqual([{ kind: "cone", x: 5, y: 5 }]);
    expect(f.players).toEqual([{ team: "red", label: "A", x: 1, y: 1 }]);
    expect(f.balls).toEqual([{ key: 0, x: 2, y: 2 }]);
    expect(f.actions).toEqual([
      { kind: "pass", from: "A", to: { x: 2, y: 2 }, seq: 1, key: "0.0", carried: false },
    ]);
    expect(f.label).toBe("hi");
  });

  it("moves players cumulatively", () => {
    const fs = framesOf("red: A@0,0 B@5,5\nslide:\nred: A@10,0\nslide:\nslide:\nred: A@20,0\n");
    expect(fs.map((f) => xs(f, "A"))).toEqual([0, 10, 10, 20]);
    expect(fs.map((f) => xs(f, "B"))).toEqual([5, 5, 5, 5]);
  });

  it("adds and removes players", () => {
    const fs = framesOf("red: A@0,0\nslide:\nblue: X@1,1\nslide:\nremove: A\n");
    expect(fs.map((f) => f.players.map((p) => p.label))).toEqual([["A"], ["A", "X"], ["X"]]);
  });

  it("carries balls until a slide replaces or clears them", () => {
    const fs = framesOf("ball: 1,1 2,2\nslide:\nslide:\nball: 9,9\nslide:\nclear: balls\n");
    expect(fs.map((f) => f.balls)).toEqual([
      [{ key: 0, x: 1, y: 1 }, { key: 1, x: 2, y: 2 }],
      [{ key: 0, x: 1, y: 1 }, { key: 1, x: 2, y: 2 }],
      [{ key: 0, x: 9, y: 9 }],
      [],
    ]);
  });

  it("keeps a ball at a player's feet as they move, and leaves it when they go", () => {
    const fs = framesOf(
      "red: A@0,0\nball: A\nslide:\nred: A@10,0\nslide:\nremove: A\nslide:\nred: A@30,0\n",
    );
    expect(fs.map((f) => f.balls[0])).toEqual([
      { key: 0, x: FEET, y: FEET },
      { key: 0, x: 10 + FEET, y: FEET },
      { key: 0, x: 10 + FEET, y: FEET },
      // A new player reusing the label does not claim the ball left behind.
      { key: 0, x: 10 + FEET, y: FEET },
    ]);
  });

  it("marks carried arrows and restarts numbering for each slide's own", () => {
    const fs = framesOf("red: A@0,0 B@5,5\npass: A->B\nslide:\nrun: B~>9,9\nslide:\nclear: arrows\npass: B->A\n");
    expect(fs.map((f) => f.actions.map((a) => [a.key, a.seq, a.carried]))).toEqual([
      [["0.0", 1, false]],
      [["0.0", 1, true], ["1.0", 1, false]],
      [["2.0", 1, false]],
    ]);
  });

  it("drops a carried arrow whose player has been removed", () => {
    const fs = framesOf("red: A@0,0 B@5,5\npass: A->B\nslide:\nremove: B\n");
    expect(fs[1].actions).toEqual([]);
  });

  it("labels slide 1 with the drill label and later slides with their captions", () => {
    const fs = framesOf('label: base\nslide: "first"\nslide:\n');
    expect(fs.map((f) => f.label)).toEqual(["base", "first", null]);
  });

  it("copes with a hand-built scene that has no slides field", () => {
    const scene = parse("red: A@1,1\n").scene;
    delete scene.slides;
    expect(frames(scene)).toHaveLength(1);
  });
});

describe("stage", () => {
  const fs = framesOf(
    "red: A@0,0 B@20,10\nblue: X@10,10\nball: A\npass: A->B\n" +
    "slide:\nremove: X\nblue: Y@5,5\nball: B 1,1\nrun: A~>30,20\n",
  );

  it("marks nothing as entering or leaving without a previous frame", () => {
    const s = stage(null, fs[0]);
    expect(s.players.every((p) => !p.entering && !p.leaving)).toBe(true);
    expect(s.balls.every((b) => !b.entering && !b.leaving)).toBe(true);
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0]).toMatchObject({ key: "0.0", kind: "pass", seq: 1, carried: false, entering: false, leaving: false });
    expect(s.paths[0].d).toMatch(/^M /);
  });

  it("keeps what left, at its old position, marked leaving", () => {
    const s = stage(fs[0], fs[1]);
    const x = s.players.find((p) => p.label === "X");
    expect(x).toMatchObject({ x: 10, y: 10, leaving: true, entering: false });
    expect(s.players.find((p) => p.label === "Y")).toMatchObject({ entering: true, leaving: false });
    expect(s.players.find((p) => p.label === "A")).toMatchObject({ entering: false, leaving: false });
  });

  it("matches balls by key: ball 0 glides, ball 1 enters", () => {
    const s = stage(fs[0], fs[1]);
    expect(s.balls.map((b) => [b.key, b.entering, b.leaving])).toEqual([[0, false, false], [1, true, false]]);
  });

  it("enters new arrows and keeps carried ones without re-entering them", () => {
    const s = stage(fs[0], fs[1]);
    expect(s.paths.map((p) => [p.key, p.carried, p.entering])).toEqual([
      ["0.0", true, false],
      ["1.0", false, true],
    ]);
  });
});
