import { describe, it, expect } from "vitest";
import { splitSegments } from "../src/lib/markdown.js";

describe("splitSegments", () => {
  it("returns a single prose segment when there is no pitch block", () => {
    expect(splitSegments("Hello\n\nWorld\n")).toEqual([
      { kind: "prose", text: "Hello\n\nWorld\n" },
    ]);
  });

  it("extracts a pitch block and the prose around it", () => {
    const body = "Before\n\n```pitch\narea: 40x25 half\n```\n\nAfter\n";
    expect(splitSegments(body)).toEqual([
      { kind: "prose", text: "Before\n\n" },
      { kind: "pitch", text: "area: 40x25 half\n", line: 4 },
      { kind: "prose", text: "\nAfter\n" },
    ]);
  });

  it("records the source line of each block so errors can be located", () => {
    // Lines: 1 "a", 2 fence, 3 "x", 4 fence, 5 "b", 6 fence, 7 "y", 8 fence.
    const body = "a\n```pitch\nx\n```\nb\n```pitch\ny\n```\n";
    const pitches = splitSegments(body).filter((s) => s.kind === "pitch");
    expect(pitches.map((p) => p.line)).toEqual([3, 7]);
  });

  it("reproduces the body exactly when its segments are concatenated", () => {
    // The property that matters: splitting is lossless. Any newline dropped here
    // silently corrupts a drill when the editor writes the document back.
    // An unterminated fence is excluded: rebuilding it would invent a closing fence
    // that was never in the source, so losslessness cannot hold for that input.
    for (const body of [
      "Hello\n\nWorld\n",
      "Before\n\n```pitch\narea: 40x25 half\n```\n\nAfter\n",
      "a\n```pitch\nx\n```\nb\n```pitch\ny\n```\n",
      "```pitch\narea: 10x10\n```\n",
      "",
    ]) {
      const rebuilt = splitSegments(body)
        .map((s) => (s.kind === "prose" ? s.text : "```pitch\n" + s.text + "```\n"))
        .join("");
      expect(rebuilt).toBe(body);
    }
  });

  it("leaves other fenced languages as prose", () => {
    const body = "```js\nconst a = 1;\n```\n";
    expect(splitSegments(body)).toEqual([{ kind: "prose", text: body }]);
  });

  it("treats an unterminated pitch fence as a pitch block to the end of the body", () => {
    const body = "intro\n```pitch\narea: 40x25\n";
    expect(splitSegments(body)).toEqual([
      { kind: "prose", text: "intro\n" },
      { kind: "pitch", text: "area: 40x25\n", line: 3 },
    ]);
  });
});
