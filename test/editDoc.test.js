import { describe, it, expect } from "vitest";
import { pitchBlocks, replaceBlock, insertText } from "../src/lib/editDoc.js";

const DOC = "---\ntitle: x\n---\n\nIntro\n\n```pitch\nred: A@1,1\n```\n\n```pitch\nblue: X@2,2\n```\n";

describe("pitchBlocks", () => {
  it("gives each block's content range and file line", () => {
    const bs = pitchBlocks(DOC);
    expect(bs.map((b) => DOC.slice(b.from, b.to))).toEqual(["red: A@1,1\n", "blue: X@2,2\n"]);
    // The same line DrillPreview reports as a diagram's baseLine.
    expect(bs.map((b) => b.line)).toEqual([8, 12]);
    expect(DOC.slice(bs[0].start, bs[0].end)).toBe("```pitch\nred: A@1,1\n```");
  });
});

describe("replaceBlock", () => {
  it("replaces the content of the block at a file line", () => {
    expect(replaceBlock(DOC, 12, "blue: X@3,3\n")).toBe(DOC.replace("X@2,2", "X@3,3"));
  });
  it("returns null for a line with no block", () => {
    expect(replaceBlock(DOC, 3, "x")).toBeNull();
  });
});

describe("insertText", () => {
  it("inserts at the cursor, spaced from the previous token", () => {
    expect(insertText("cone: 5,5", 9, 9, "6,6")).toEqual({ text: "cone: 5,5 6,6", cursor: 13 });
  });
  it("does not add a space after whitespace, @ or an arrow", () => {
    expect(insertText("cone: ", 6, 6, "1,1").text).toBe("cone: 1,1");
    expect(insertText("red: D@", 7, 7, "1,1").text).toBe("red: D@1,1");
    expect(insertText("run: C~>", 8, 8, "1,1").text).toBe("run: C~>1,1");
  });
  it("replaces a selection", () => {
    expect(insertText("red: A@1,1", 7, 10, "4,5")).toEqual({ text: "red: A@4,5", cursor: 10 });
  });
});
