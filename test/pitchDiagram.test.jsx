import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import PitchDiagram from "../src/components/PitchDiagram.jsx";

const render = (src) => renderToStaticMarkup(<PitchDiagram source={src} />);

describe("PitchDiagram", () => {
  it("renders an svg with the padded viewBox", () => {
    const html = render("area: 40x25 half\n");
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 440 290"');
  });

  it("renders a circle per player and its label", () => {
    const html = render("red: A@10,20 B@25,14\n");
    expect((html.match(/<circle/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
  });

  it("renders a keeper as a rounded rect rather than a circle", () => {
    // The background and the boundary are also rects, so assert on the rounded
    // corner that only the keeper marker uses.
    expect(render("gk: K@0,12\n")).toContain('rx="3"');
    expect(render("red: A@0,12\n")).not.toContain('rx="3"');
  });

  it("renders a path per action with a sequence badge", () => {
    const html = render("red: A@2,2 B@30,20\npass: A->B\n");
    expect(html).toContain("<path");
    expect(html).toContain(">1<");
  });

  it("renders the drill label", () => {
    expect(render('label: "3v2 to end line"\n')).toContain("3v2 to end line");
  });

  it("gives arrowheads a fixed size independent of stroke width", () => {
    // Without markerUnits="userSpaceOnUse", SVG scales markers by stroke-width and the
    // 4px shot gets a ~28px arrowhead that swamps a 7px player. Caught by rendering.
    const html = render("red: A@2,2 B@30,20\nshot: A->>B\n");
    expect(html).toContain('markerUnits="userSpaceOnUse"');
  });

  it("renders parse errors with their line numbers and keeps the diagram", () => {
    const html = render("area: 40x25 half\ngoal: nope\n");
    expect(html).toContain("line 2");
    expect(html).toContain("<svg");
  });

  it("renders nothing but an error list for wholly invalid source", () => {
    const html = render("!!!\n");
    expect(html).toContain("line 1");
  });

  it("does not throw on empty or missing source", () => {
    expect(() => render("")).not.toThrow();
    expect(() => renderToStaticMarkup(<PitchDiagram />)).not.toThrow();
  });

  it("offsets the label line number when given a base line", () => {
    const html = renderToStaticMarkup(<PitchDiagram source={"goal: nope\n"} baseLine={7} />);
    expect(html).toContain("line 7");
  });
});
