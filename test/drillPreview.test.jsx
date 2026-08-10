import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import DrillPreview from "../src/components/DrillPreview.jsx";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const render = (src) => renderToStaticMarkup(<DrillPreview source={src} />);

describe("DrillPreview", () => {
  it("renders the title and metadata chips", () => {
    const html = render(fixture("3v2-to-end-line.md"));
    expect(html).toContain("3v2 to end line");
    expect(html).toContain("skill");
    expect(html).toContain("15");
    expect(html).toContain("8-12");
    expect(html).toContain("transition");
  });

  it("renders prose and a diagram from the same file", () => {
    const html = render(fixture("3v2-to-end-line.md"));
    expect(html).toContain("Reds attack, blues defend");
    expect(html).toContain("Progression");
    expect(html).toContain("<svg");
  });

  it("renders every pitch block in the file", () => {
    const src = fixture("rondo-4v2.md");
    expect((render(src).match(/<svg/g) || []).length).toBe(1);
    const two = src + "\n```pitch\narea: 10x10\n```\n";
    expect((render(two).match(/<svg/g) || []).length).toBe(2);
  });

  it("falls back to a placeholder title when there is no frontmatter", () => {
    expect(render("just prose\n")).toContain("Untitled drill");
  });

  it("surfaces a frontmatter error without hiding the body", () => {
    const html = render("---\ntitle: [oops\n---\n\nbody text\n");
    expect(html).toMatch(/yaml/i);
    expect(html).toContain("body text");
  });

  it("reports a pitch error against the file's line numbers", () => {
    const src = "---\ntitle: T\n---\n\nintro\n\n```pitch\ngoal: nope\n```\n";
    expect(render(src)).toContain("line 8");
  });

  it("keeps single line breaks so a written list stays readable", () => {
    // Coaches write checklists one item per line. Rendering the paragraph as a single
    // text node folded them into one run-on sentence.
    const html = render("---\ntitle: T\n---\n\nWarm-up:\n- jog\n- stretches\n\nThen play.\n");
    expect(html).toContain("<br");
    expect(html).toContain("- jog");
    expect(html).toContain("- stretches");
    expect(html).toContain("Then play.");
  });

  it("does not throw on empty input", () => {
    expect(() => render("")).not.toThrow();
  });
});
