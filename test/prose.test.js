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

describe("interactive checklists", () => {
  const md = "- [ ] cones\n- [x] bibs\n- [ ] balls\n";

  it("renders task items as disabled checkboxes by default", () => {
    const html = renderProse(md);
    expect(html).toContain("disabled");
    expect(html).not.toContain("data-tick");
  });

  it("removes disabled and numbers each box when asked", () => {
    const html = renderProse(md, { interactive: true });
    expect(html).not.toContain("disabled");
    expect(html).toContain('data-tick="0"');
    expect(html).toContain('data-tick="1"');
    expect(html).toContain('data-tick="2"');
  });

  it("numbers boxes in document order across separate lists", () => {
    const html = renderProse("- [ ] a\n\ntext\n\n- [ ] b\n", { interactive: true });
    expect(html.indexOf('data-tick="0"')).toBeLessThan(html.indexOf('data-tick="1"'));
  });

  it("leaves prose with no checkboxes untouched", () => {
    expect(renderProse("just words", { interactive: true })).toBe(renderProse("just words"));
  });

  it("still sanitises when interactive", () => {
    const html = renderProse("- [ ] ok <script>alert(1)</script>", { interactive: true });
    expect(html).not.toContain("<script");
  });

  it("continues numbering from a given offset", () => {
    // DrillPreview renders a drill's body as several SEPARATE renderProse calls (prose
    // segments interleaved with pitch diagrams), so without an offset every segment's
    // checkboxes would restart at 0 and collide with an earlier segment's.
    const html = renderProse("- [ ] c\n- [ ] d\n", { interactive: true, tickOffset: 2 });
    expect(html).toContain('data-tick="2"');
    expect(html).toContain('data-tick="3"');
    expect(html).not.toContain('data-tick="0"');
  });
});
