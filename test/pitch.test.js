import { describe, it, expect } from "vitest";
import { parse, serialise } from "../src/lib/pitch.js";

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

  it("rejects a zero dimension rather than collapsing the pitch", () => {
    expect(parse("area: 0x0\n").errors).toEqual([
      { line: 1, message: 'area must be larger than 0x0, got "0x0"' },
    ]);
    // The default area survives, so the rest of the drill still renders.
    expect(parse("area: 0x0\n").scene.area).toEqual({ w: 40, h: 25, markings: "plain" });
    expect(parse("area: 20x0 half\n").errors[0].message).toMatch(/larger than 0x0/);
    // Negative dimensions never match the unsigned regex, so they get the syntax error.
    expect(parse("area: -5x10\n").errors).toEqual([
      { line: 1, message: 'expected "<width>x<height> [markings]"' },
    ]);
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

describe("parse: actions", () => {
  it("reads a pass between two players", () => {
    const { scene, errors } = parse("red: A@1,1 B@2,2\npass: A->B\n");
    expect(scene.actions).toEqual([{ kind: "pass", from: "A", to: { ref: "B" }, seq: 1 }]);
    expect(errors).toEqual([]);
  });

  it("reads each movement kind with its own arrow", () => {
    const src = [
      "red: A@1,1 B@2,2 C@3,3",
      "pass: A->B",
      "run: C~>28,4",
      "dribble: B=>32,12",
      "shot: C->>goal",
    ].join("\n");
    const { scene, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(scene.actions).toEqual([
      { kind: "pass", from: "A", to: { ref: "B" }, seq: 1 },
      { kind: "run", from: "C", to: { x: 28, y: 4 }, seq: 2 },
      { kind: "dribble", from: "B", to: { x: 32, y: 12 }, seq: 3 },
      { kind: "shot", from: "C", to: { ref: "goal" }, seq: 4 },
    ]);
  });

  it("numbers actions in declaration order across lines and within a line", () => {
    const src = "red: A@1,1 B@2,2 C@3,3\npass: A->B B->C\nrun: A~>9,9\n";
    expect(parse(src).scene.actions.map((a) => a.seq)).toEqual([1, 2, 3]);
  });

  it("rejects a reference to an undeclared player", () => {
    const { scene, errors } = parse("red: A@1,1\npass: A->Z\n");
    expect(scene.actions).toEqual([]);
    expect(errors).toEqual([{ line: 2, message: 'unknown player "Z"' }]);
  });

  it("rejects an action whose source is not a player", () => {
    const { errors } = parse("red: A@1,1\npass: 3,3->A\n");
    expect(errors).toEqual([{ line: 2, message: 'expected a player label as the source, got "3,3"' }]);
  });

  it("reports a malformed action without dropping the rest of the line", () => {
    const { scene, errors } = parse("red: A@1,1 B@2,2\npass: A-B A->B\n");
    expect(scene.actions.map((a) => a.seq)).toEqual([1]);
    expect(errors).toEqual([{ line: 2, message: 'expected "<from><arrow><to>" but got "A-B"' }]);
  });

  it("resolves an action whose players are declared on a later line", () => {
    // Endpoints resolve in a second pass, so directive order in the source is free.
    const { scene, errors } = parse("pass: A->B\nred: A@1,1 B@2,2\n");
    expect(errors).toEqual([]);
    expect(scene.actions).toEqual([{ kind: "pass", from: "A", to: { ref: "B" }, seq: 1 }]);
  });
});

describe("parse: robustness", () => {
  const nasty = [
    "",
    "\n\n\n",
    "area:",
    "area: x",
    ":::",
    "red:",
    "red: @@@",
    "pass:",
    "pass: ->",
    "zone: 1,1",
    "label:",
    "area: 40x25 half\nred: A@1,1\npass: A->A",
    " ",
    "a".repeat(10000),
    "pass: A->B\n".repeat(500),
  ];

  it("never throws, whatever the input", () => {
    for (const src of nasty) {
      expect(() => parse(src), JSON.stringify(src.slice(0, 40))).not.toThrow();
    }
  });

  it("always returns a usable scene shape", () => {
    for (const src of nasty) {
      const { scene, errors } = parse(src);
      expect(Array.isArray(scene.marks)).toBe(true);
      expect(Array.isArray(scene.players)).toBe(true);
      expect(Array.isArray(scene.actions)).toBe(true);
      expect(typeof scene.area.w).toBe("number");
      expect(Array.isArray(errors)).toBe(true);
    }
  });

  it("accepts undefined and null as empty input", () => {
    expect(parse(undefined).errors).toEqual([]);
    expect(parse(null).scene.players).toEqual([]);
  });

  it("reports every error with a line number and a message", () => {
    const { errors } = parse("nonsense\nred: bad\ngoal: nope\n");
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(typeof e.line).toBe("number");
      expect(e.line).toBeGreaterThan(0);
      expect(typeof e.message).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});

describe("serialise", () => {
  it("writes directives in canonical order", () => {
    const src = [
      "label: Test",
      "pass: A->B",
      "red: A@1,1 B@2,2",
      "cone: 5,5",
      "area: 40x25 half",
    ].join("\n");
    const { scene } = parse(src);
    expect(serialise(scene)).toBe(
      [
        "area: 40x25 half",
        "cone: 5,5",
        "red: A@1,1 B@2,2",
        "pass: A->B",
        "label: Test",
        "",
      ].join("\n"),
    );
  });

  it("omits the markings word when the area is plain", () => {
    expect(serialise(parse("area: 30x20\n").scene)).toBe("area: 30x20\n");
  });

  it("writes one action per line, in sequence order", () => {
    const { scene } = parse("red: A@1,1 B@2,2\npass: A->B B->A\nrun: A~>9,9\n");
    expect(serialise(scene)).toBe(
      ["area: 40x25", "red: A@1,1 B@2,2", "pass: A->B", "pass: B->A", "run: A~>9,9", ""].join("\n"),
    );
  });

  it("quotes labels and zone labels", () => {
    const { scene } = parse('zone: 1,2 3x4 "press here"\nlabel: 3v2 to end line\n');
    const out = serialise(scene);
    expect(out).toContain('zone: 1,2 3x4 "press here"');
    expect(out).toContain('label: "3v2 to end line"');
  });

  it("round-trips a scene through serialise and parse unchanged", () => {
    const src = [
      "area: 40x25 half",
      'zone: 12,0 16x25 "press here"',
      "goal: 0,12 small",
      "cone: 5,5 5,20 35,5",
      "ball: 10,12",
      "flag: 36,4",
      "red: A@10,20 B@25,14 C@34,20",
      "blue: X@18,8 Y@30,7",
      "gk: K@1,12",
      "pass: A->B",
      "run: C~>28,4",
      "dribble: B=>32,12",
      "shot: C->>goal",
      'label: "3v2 to end line"',
    ].join("\n");
    const { scene, errors } = parse(src);
    expect(errors).toEqual([]);

    const once = serialise(scene);
    const again = parse(once);
    expect(again.errors).toEqual([]);
    expect(again.scene).toEqual(scene);
    expect(serialise(again.scene)).toBe(once);
  });

  it("survives a round trip for an empty scene", () => {
    const { scene } = parse("");
    expect(parse(serialise(scene)).scene).toEqual(scene);
  });

  it("round-trips a label that is itself quoted", () => {
    // `"a"` has no whitespace, so a whitespace-only quoting rule would emit it bare and
    // it would parse back as `a`. Applies to zone labels too, which share the helper.
    const label = parse('label: ""a""').scene.label;
    expect(label).toBe('"a"');
    const once = serialise(parse('label: ""a""').scene);
    expect(parse(once).scene.label).toBe('"a"');
    expect(serialise(parse(once).scene)).toBe(once);

    const zone = parse('zone: 1,2 3x4 ""z""').scene;
    expect(parse(serialise(zone)).scene).toEqual(zone);
  });

  it("omits an empty label, which would not round-trip", () => {
    const { scene } = parse("");
    scene.label = "";
    expect(serialise(scene)).toBe("area: 40x25\n");
    expect(parse(serialise(scene)).scene.label).toBe(null);
  });

});
