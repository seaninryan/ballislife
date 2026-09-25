import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";
import { frames } from "../src/lib/slides.js";
import { moveInSource, moveInFrame } from "../src/lib/sourceEdit.js";

const SRC = [
  "area: 40x25",      // 0
  "cone: 5,5 6,6",    // 1
  "red: A@1,1 B@2,2", // 2
  "ball: A",          // 3
  "pass: A->10,10",   // 4
  "slide: one",       // 5
  "# keep me",        // 6
  "red: B@3,3",       // 7
  "",                 // 8
  "slide: two",       // 9
  "run: B~>20,20",    // 10
  "",
].join("\n");
const lines = (s) => s.split("\n");
const withLine = (i, text) => { const l = lines(SRC); l[i] = text; return l.join("\n"); };
const inserted = (after, text) => { const l = lines(SRC); l.splice(after + 1, 0, text); return l.join("\n"); };
const move = (frame, target) => moveInSource(SRC, frame, target, 4, 5.5);

describe("moveInSource", () => {
  it("rewrites a base player's coordinate in place", () => {
    expect(move(0, { kind: "player", label: "A" })).toBe(withLine(2, "red: A@4,5.5 B@2,2"));
  });

  it("rewrites a player placed on the slide shown", () => {
    expect(move(1, { kind: "player", label: "B" })).toBe(withLine(7, "red: B@4,5.5"));
  });

  it("adds a line to the slide shown when it does not place the player", () => {
    expect(move(1, { kind: "player", label: "A" })).toBe(inserted(7, "red: A@4,5.5"));
    expect(move(2, { kind: "player", label: "B" })).toBe(inserted(10, "red: B@4,5.5"));
  });

  it("always moves a cone on the first slide", () => {
    expect(move(2, { kind: "mark", index: 1 })).toBe(withLine(1, "cone: 5,5 4,5.5"));
  });

  it("rewrites the ball list the slide shown owns, detaching a ball from a player", () => {
    expect(move(0, { kind: "ball", key: 0 })).toBe(withLine(3, "ball: 4,5.5"));
  });

  it("adds a ball line listing every ball when the slide shown has none", () => {
    expect(move(1, { kind: "ball", key: 0 })).toBe(inserted(7, "ball: 4,5.5"));
    const src = "red: A@1,1\nball: A 9,9\nslide:\nred: A@2,2\n";
    expect(moveInSource(src, 1, { kind: "ball", key: 1 }, 4, 5)).toBe(src + "ball: A 4,5\n");
  });

  it("rewrites an arrow head on the slide it was added on", () => {
    expect(move(0, { kind: "arrow", key: "0.0" })).toBe(withLine(4, "pass: A->4,5.5"));
    expect(move(2, { kind: "arrow", key: "2.0" })).toBe(withLine(10, "run: B~>4,5.5"));
  });

  it("refuses what cannot be dragged", () => {
    expect(moveInSource("red: A@1,1 B@2,2\npass: A->B\n", 0, { kind: "arrow", key: "0.0" }, 1, 1)).toBeNull();
    expect(move(9, { kind: "player", label: "A" })).toBeNull();
    expect(move(0, { kind: "player", label: "Z" })).toBeNull();
  });

  it("keeps comments and parses cleanly afterwards", () => {
    const out = move(1, { kind: "player", label: "A" });
    expect(out).toContain("# keep me");
    expect(parse(out).errors).toEqual([]);
  });

  it("keeps CRLF on an added line", () => {
    const src = "red: A@1,1\r\nslide:\r\n";
    expect(moveInSource(src, 1, { kind: "player", label: "A" }, 2, 2)).toBe("red: A@1,1\r\nslide:\r\nred: A@2,2\r\n");
  });
});

describe("moveInFrame", () => {
  const frame = frames(parse(SRC).scene)[0];

  it("moves one item and leaves the rest", () => {
    const f = moveInFrame(frame, { kind: "player", label: "A" }, 4, 5);
    expect(f.players.find((p) => p.label === "A")).toMatchObject({ x: 4, y: 5 });
    expect(f.players.find((p) => p.label === "B")).toMatchObject({ x: 2, y: 2 });
  });

  it("moves marks, balls and arrow heads", () => {
    expect(moveInFrame(frame, { kind: "mark", index: 0 }, 4, 5).marks[0]).toMatchObject({ x: 4, y: 5 });
    expect(moveInFrame(frame, { kind: "ball", key: 0 }, 4, 5).balls[0]).toEqual({ key: 0, x: 4, y: 5 });
    expect(moveInFrame(frame, { kind: "arrow", key: "0.0" }, 4, 5).actions[0].to).toEqual({ x: 4, y: 5 });
  });
});
