// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderProse } from "../src/lib/prose.js";

describe("renderProse", () => {
  it("renders a list a coach actually wrote", () => {
    const html = renderProse("Set-up:\n\n- two lines of cones\n- bibs\n");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>two lines of cones</li>");
  });

  it("renders headings, emphasis and inline code", () => {
    const html = renderProse("## Coaching points\n\n**press** the `first` defender\n");
    expect(html).toContain("<h2>Coaching points</h2>");
    expect(html).toContain("<strong>press</strong>");
    expect(html).toContain("<code>first</code>");
  });

  it("strips a script tag", () => {
    expect(renderProse("ok <script>alert(1)</script>")).not.toContain("<script");
  });

  it("strips an event handler attribute but keeps the element", () => {
    const html = renderProse('<img src=x onerror=alert(1)>');
    expect(html).toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("returns a string for empty, null and undefined", () => {
    expect(renderProse("")).toBe("");
    expect(renderProse(null)).toBe("");
    expect(renderProse(undefined)).toBe("");
  });

  it("never returns a promise", () => {
    expect(typeof renderProse("x")).toBe("string");
  });

  it("leaves a bare ampersand alone rather than mangling it", () => {
    expect(renderProse("4 & 5")).toContain("4 &amp; 5");
  });
});
