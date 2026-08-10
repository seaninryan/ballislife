// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DrillPreview from "../src/components/DrillPreview.jsx";

// Under the jsdom environment Vite rewrites `new URL(rel, import.meta.url)` into a
// browser-style asset URL (honouring vite.config.js's GitHub Pages `base`), which no
// longer resolves to a real file path. Resolving via fileURLToPath instead keeps fixture
// loading working the same way it did under the node environment.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

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

  it("renders a written list as a real list", () => {
    // Superseded the interim line-break rendering: `- item` lines are now a real <ul>,
    // which is what the markdown always meant.
    const html = render("---\ntitle: T\n---\n\nWarm-up:\n\n- jog\n- stretches\n\nThen play.\n");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>jog</li>");
    expect(html).toContain("Then play.");
  });

  it("does not throw on empty input", () => {
    expect(() => render("")).not.toThrow();
  });
});
