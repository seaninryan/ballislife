import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";
import { splitSegments } from "../src/lib/markdown.js";
import { slideTemplate, addSlide, hasPitchBlock, CAPTION } from "../src/lib/slideTemplate.js";

const HEAD = [
  `slide: "${CAPTION}"`,
  "# Uncomment a line and change it; delete the ones you don't need.",
  "# Add arrows with pass:, run:, dribble: or shot:.",
];
const template = (src) => slideTemplate(parse(src).scene);

describe("slideTemplate", () => {
  it("comments out the state at the end of the block", () => {
    expect(template(
      "red: A@10,20 B@25,14\nblue: X@18,8\nball: A\npass: A->B\nslide:\nred: A@12,20\n",
    )).toBe([
      ...HEAD,
      "# red: A@12,20 B@25,14",
      "# blue: X@18,8",
      "# ball: A",
      "# remove: A->B",
      "",
    ].join("\n"));
  });

  it("writes a loose ball as coordinates, rounded to a decimetre", () => {
    expect(template("red: A@1,1\nball: A 3,4\nslide:\nremove: A\n")).toContain("# ball: 1.8,1.8 3,4\n");
  });

  it("omits the ball and remove lines when there is nothing to name", () => {
    expect(template("red: A@1,1\n")).toBe([...HEAD, "# red: A@1,1", ""].join("\n"));
  });
});

describe("addSlide", () => {
  const DOC = "---\ntitle: x\n---\n\nIntro\n\n```pitch\nred: A@1,1\n```\n\nMore\n";

  it("appends to the block, after a blank line, and selects the caption", () => {
    const r = addSlide(DOC, 0);
    expect(r.text).toBe(
      "---\ntitle: x\n---\n\nIntro\n\n```pitch\nred: A@1,1\n\n" + template("red: A@1,1\n") + "```\n\nMore\n",
    );
    expect(r.text.slice(r.select[0], r.select[1])).toBe(CAPTION);
  });

  it("produces a block that parses cleanly, with the new slide", () => {
    const r = addSlide(DOC, 0);
    const block = r.text.split("```pitch\n")[1].split("```")[0];
    const { scene, errors } = parse(block);
    expect(errors).toEqual([]);
    expect(scene.slides.map((s) => s.caption)).toEqual([CAPTION]);
  });

  it("adds to the block holding the cursor", () => {
    const doc = "```pitch\nred: A@1,1\n```\n\n```pitch\nblue: X@2,2\n```\n";
    const r = addSlide(doc, doc.indexOf("A@1,1"));
    expect(r.text.indexOf(CAPTION)).toBeLessThan(r.text.indexOf("blue: X"));
  });

  it("falls back to the last block when the cursor is in prose", () => {
    const doc = "```pitch\nred: A@1,1\n```\n\nText\n\n```pitch\nblue: X@2,2\n```\n";
    const r = addSlide(doc, doc.indexOf("Text"));
    expect(r.text.indexOf(CAPTION)).toBeGreaterThan(r.text.indexOf("blue: X"));
  });

  it("does not add a second blank line when the block already ends with one", () => {
    const r = addSlide("```pitch\nred: A@1,1\n\n```\n", 0);
    expect(r.text).toBe("```pitch\nred: A@1,1\n\n" + template("red: A@1,1\n") + "```\n");
  });

  it("returns null for a drill with no diagram", () => {
    expect(addSlide("---\ntitle: x\n---\n\nJust words.\n", 0)).toBeNull();
  });
});

describe("addSlide at the edges", () => {
  const blockOf = (text) => splitSegments(text).find((s) => s.kind === "pitch").text;

  it("starts a new line when the document ends on the opening fence", () => {
    const r = addSlide("```pitch", 0);
    expect(r.text).toBe("```pitch\n" + template(""));
    const { scene, errors } = parse(blockOf(r.text));
    expect(errors).toEqual([]);
    expect(scene.slides).toHaveLength(1);
  });

  it("extends an unterminated block with no final newline", () => {
    expect(addSlide("```pitch\nred: A@1,1", 0).text).toBe("```pitch\nred: A@1,1\n\n" + template("red: A@1,1"));
  });

  it("fills an empty block", () => {
    expect(addSlide("```pitch\n```\n", 0).text).toBe("```pitch\n" + template("") + "```\n");
  });

  it("counts a cursor on the opening fence as inside that block", () => {
    const doc = "```pitch\nred: A@1,1\n```\n\n```pitch\nblue: X@2,2\n```\n";
    const r = addSlide(doc, 2);
    expect(r.text.indexOf(CAPTION)).toBeLessThan(r.text.indexOf("blue: X"));
  });

  it("keeps a CRLF drill CRLF", () => {
    const r = addSlide("```pitch\r\nred: A@1,1\r\n```\r\n", 0);
    expect(r.text).not.toMatch(/[^\r]\n/);
    expect(r.text.slice(r.select[0], r.select[1])).toBe(CAPTION);
    expect(parse(blockOf(r.text)).errors).toEqual([]);
  });

  it("works under frontmatter that does not parse", () => {
    const r = addSlide("---\ntitle: [\n---\n\n```pitch\nred: A@1,1\n```\n", 0);
    expect(r.text.slice(r.select[0], r.select[1])).toBe(CAPTION);
  });

  it("says whether there is a diagram to extend", () => {
    expect(hasPitchBlock("```pitch\n```\n")).toBe(true);
    expect(hasPitchBlock("Just words.\n")).toBe(false);
  });
});
