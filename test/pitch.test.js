import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";

describe("parse: area", () => {
  it("reads dimensions and a markings preset", () => {
    const { scene, errors } = parse("area: 40x25 half\n");
    expect(scene.area).toEqual({ w: 40, h: 25, markings: "half" });
    expect(errors).toEqual([]);
  });

  it("defaults markings to plain", () => {
    expect(parse("area: 30x20\n").scene.area).toEqual({ w: 30, h: 20, markings: "plain" });
  });

  it("defaults the whole area when the line is absent", () => {
    expect(parse("cone: 1,1\n").scene.area).toEqual({ w: 40, h: 25, markings: "plain" });
  });

  it("accepts decimal dimensions", () => {
    expect(parse("area: 37.5x22.5 full\n").scene.area).toEqual({ w: 37.5, h: 22.5, markings: "full" });
  });

  it("ignores blank lines and comments", () => {
    const { scene, errors } = parse("\n# a comment\narea: 40x25 box\n\n");
    expect(scene.area.markings).toBe("box");
    expect(errors).toEqual([]);
  });
});

describe("parse: players", () => {
  it("reads several players from one team line", () => {
    const { scene, errors } = parse("red: A@10,20 B@25,14\n");
    expect(scene.players).toEqual([
      { team: "red", label: "A", x: 10, y: 20 },
      { team: "red", label: "B", x: 25, y: 14 },
    ]);
    expect(errors).toEqual([]);
  });

  it("supports red, blue, yellow and gk", () => {
    const src = "red: A@1,1\nblue: X@2,2\nyellow: Y@3,3\ngk: K@0,12\n";
    expect(parse(src).scene.players.map((p) => p.team)).toEqual(["red", "blue", "yellow", "gk"]);
  });

  it("accepts multi-character labels", () => {
    expect(parse("blue: CB@5,5\n").scene.players[0].label).toBe("CB");
  });

  it("reports a bad token but keeps the good ones on the same line", () => {
    const { scene, errors } = parse("red: A@10,20 B@oops C@3,4\n");
    expect(scene.players.map((p) => p.label)).toEqual(["A", "C"]);
    expect(errors).toEqual([{ line: 1, message: 'expected "<label>@<x>,<y>" but got "B@oops"' }]);
  });

  it("rejects a duplicate label", () => {
    const { scene, errors } = parse("red: A@1,1\nblue: A@2,2\n");
    expect(scene.players.map((p) => p.team)).toEqual(["red"]);
    expect(errors).toEqual([{ line: 2, message: 'duplicate player label "A"' }]);
  });

  it("says so when a label is too long, rather than blaming the syntax", () => {
    expect(parse("red: STRIKER@1,1\n").errors).toEqual([
      { line: 1, message: 'player label "STRIKER" is too long (max 4 characters)' },
    ]);
    // A genuinely malformed token still gets the syntax message.
    expect(parse("red: B@oops\n").errors).toEqual([
      { line: 1, message: 'expected "<label>@<x>,<y>" but got "B@oops"' },
    ]);
  });
});

describe("parse: marks", () => {
  it("reads repeated point marks from one line", () => {
    const { scene, errors } = parse("cone: 5,5 5,20 35,5\n");
    expect(scene.marks).toEqual([
      { kind: "cone", x: 5, y: 5 },
      { kind: "cone", x: 5, y: 20 },
      { kind: "cone", x: 35, y: 5 },
    ]);
    expect(errors).toEqual([]);
  });

  it("reads balls and flags", () => {
    const { scene } = parse("ball: 10,12\nflag: 36,4\n");
    expect(scene.marks).toEqual([
      { kind: "ball", x: 10, y: 12 },
      { kind: "flag", x: 36, y: 4 },
    ]);
  });

  it("reads a goal with a size, defaulting to full", () => {
    expect(parse("goal: 0,12 small\n").scene.marks).toEqual([
      { kind: "goal", x: 0, y: 12, size: "small" },
    ]);
    expect(parse("goal: 0,12\n").scene.marks).toEqual([
      { kind: "goal", x: 0, y: 12, size: "full" },
    ]);
  });

  it("rejects an unknown goal size", () => {
    const { scene, errors } = parse("goal: 0,12 enormous\n");
    expect(scene.marks).toEqual([]);
    expect(errors).toEqual([
      { line: 1, message: 'unknown goal size "enormous" (expected full, small, mini)' },
    ]);
  });

  it("reads a zone with dimensions and an optional label", () => {
    expect(parse('zone: 12,0 16x25 "press here"\n').scene.marks).toEqual([
      { kind: "zone", x: 12, y: 0, w: 16, h: 25, label: "press here" },
    ]);
    expect(parse("zone: 12,0 16x25\n").scene.marks).toEqual([
      { kind: "zone", x: 12, y: 0, w: 16, h: 25, label: null },
    ]);
  });

  it("reports a malformed point without dropping the rest of the line", () => {
    const { scene, errors } = parse("cone: 5,5 nope 7,7\n");
    expect(scene.marks).toEqual([
      { kind: "cone", x: 5, y: 5 },
      { kind: "cone", x: 7, y: 7 },
    ]);
    expect(errors).toEqual([{ line: 1, message: 'expected "<x>,<y>" but got "nope"' }]);
  });

  it("reads the drill label", () => {
    expect(parse('label: "3v2 to end line"\n').scene.label).toBe("3v2 to end line");
    expect(parse("label: 3v2 to end line\n").scene.label).toBe("3v2 to end line");
  });
});
