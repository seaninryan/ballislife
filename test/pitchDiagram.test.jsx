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

  it("gives the diagram an accessible name", () => {
    // role="img" with no name announces only "image" to a screen reader, and Plan 2
    // wants printable session plans where a title survives export.
    expect(render('label: "3v2 to end line"\n')).toContain('aria-label="3v2 to end line"');
    expect(render("area: 40x25\n")).toContain('aria-label="Pitch diagram"');
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

  it("positions players and balls by transform, so they can glide", () => {
    const html = render("red: A@10,20\nball: A\n");
    expect(html).toContain("transform:translate(120px, 220px)");
    expect(html).toContain('class="pitch-glide"');
  });

  it("draws slide 1 of a diagram with slides", () => {
    const html = render('red: A@1,1\nlabel: base\nslide: "later"\nred: B@5,5\n');
    expect(html).toContain("base");
    expect(html).not.toContain("later");
    expect(html).not.toContain(">B<");
  });

  const SLIDES = "red: A@1,1\nslide:\nred: A@5,5\nslide:\nred: A@9,9\n";
  const animated = (src) => renderToStaticMarkup(<PitchDiagram source={src} animated />);

  it("renders the first paint as a cut, so nothing glides in from the origin", () => {
    expect(animated(SLIDES)).toMatch(/<svg class="pitch cut"/);
  });

  it("names the diagram after the slide on screen", () => {
    expect(animated("red: A@1,1\nlabel: base\nslide: later\n")).toContain('aria-label="base"');
  });

  it("shows no controls unless animated", () => {
    expect(render(SLIDES)).not.toContain(">Play<");
  });

  it("shows no controls for a diagram without slides", () => {
    expect(animated("red: A@1,1\n")).not.toContain(">Play<");
  });

  it("shows Play, Replay and a button per slide, slide 1 current", () => {
    const html = animated('red: A@1,1\nslide: "go"\nred: A@5,5\nslide:\nred: A@9,9\n');
    expect(html).toContain(">Play<");
    expect(html).toContain(">Replay<");
    expect(html.match(/class="pitch-slide"/g)).toHaveLength(3);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>1</);
    expect(html).toContain('title="go"');
    expect(html).toContain('title="Slide 3"');
    // Starts on slide 1 — nothing moves until Play is pressed.
    expect(html).toContain("translate(30px, 30px)");
  });

  const editable = (src) => renderToStaticMarkup(<PitchDiagram source={src} editable />);

  it("draws rulers only when editable", () => {
    expect(render("area: 12x6\n")).not.toContain("pitch-ruler");
    const html = editable("area: 12x6\n");
    expect(html).toContain('class="pitch-ruler"');
    expect(html).toContain("x →");
    expect(html).toContain("y ↓");
    expect(html).toContain(">10<");
  });

  it("makes each error a button that names its file line, when given onErrorLine", () => {
    const html = renderToStaticMarkup(
      <PitchDiagram source={"goal: nope\n"} baseLine={7} editable onErrorLine={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*class="error-line"[^>]*>line 7: /);
    expect(render("goal: nope\n")).not.toContain("error-line");
  });

  it("is inert unless editable", () => {
    const html = render("red: A@1,1\npass: A->5,5\n");
    expect(html).not.toContain("pitch-handle");
    expect(html).not.toContain("touch-action");
  });

  it("stops the page scrolling and offers a handle on coordinate arrow heads when editable", () => {
    const html = editable("red: A@1,1 B@9,9\npass: A->5,5 A->B\n");
    expect(html).toContain("touch-action:none");
    expect(html).toContain('class="pitch editable');
    expect(html.match(/class="pitch-handle"/g)).toHaveLength(1);
  });
});
