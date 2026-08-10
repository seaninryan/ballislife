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
