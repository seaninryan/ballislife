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

describe("inline checkboxes written as prose, not a list", () => {
  // The owner's real report: a warm-up written as one line —
  // "[ ] high knees [ ] butt kicker [ ] gate" — instead of one list item per move.
  const row = "[ ] high knees [ ] butt kicker [x] gate\n";

  it("renders a bare [ ] and [x] in prose as checkboxes, disabled by default", () => {
    const html = renderProse(row);
    expect(html).toContain('<input disabled="" type="checkbox">');
    expect(html).not.toContain("[ ]");
    expect(html).not.toContain("[x]");
  });

  it("renders [x] checked", () => {
    const html = renderProse(row);
    expect(html).toMatch(/<input disabled="" type="checkbox" checked="">/);
  });

  it("makes inline checkboxes tickable, numbered, when interactive", () => {
    const html = renderProse(row, { interactive: true });
    expect(html).not.toContain("disabled");
    expect(html).toContain('data-tick="0"');
    expect(html).toContain('data-tick="1"');
    expect(html).toContain('data-tick="2"');
  });

  it("numbers a mix of a real list and an inline row continuously, in document order", () => {
    // This is the case that matters: a collision here would tick the wrong item,
    // because the tick store keys purely on the index.
    const md = "- [ ] cones\n- [x] bibs\n\n[ ] ball pump [ ] cones bag\n";
    const html = renderProse(md, { interactive: true });
    const at = (s) => html.indexOf(s);
    expect(at('data-tick="0"')).toBeLessThan(at('data-tick="1"'));
    expect(at('data-tick="1"')).toBeLessThan(at('data-tick="2"'));
    expect(at('data-tick="2"')).toBeLessThan(at('data-tick="3"'));
    // Exactly one input per index — no reused number.
    const indices = [...html.matchAll(/data-tick="(\d+)"/g)].map((m) => m[1]);
    expect(indices).toEqual(["0", "1", "2", "3"]);
  });

  it("does not touch a [ ] inside a fenced ```pitch code sample", () => {
    const md = "```pitch\n[ ] this documents pitch syntax, not a checklist\n```\n";
    const html = renderProse(md);
    expect(html).toContain("[ ] this documents pitch syntax");
    expect(html).not.toContain("<input");
  });

  it("does not touch a [ ] inside inline code", () => {
    const html = renderProse("write a checklist line like `[ ] item` in your drill\n");
    expect(html).toContain("<code>[ ] item</code>");
    expect(html).not.toContain("<input");
  });

  it("still sanitises normally around an inline checkbox row", () => {
    const html = renderProse("[ ] warm up <script>alert(1)</script>", { interactive: true });
    expect(html).not.toContain("<script");
    expect(html).toContain('data-tick="0"');
  });
});

describe("inline checkbox row layout: one item per line", () => {
  // The owner's actual report: a compact warm-up written on one line renders as
  // checkboxes but they all sit on a single row, running across the page.
  const warmup =
    "[ ] high knees [ ] butt kicker [ ] gate [ ] open [ ] close [ ] scoop [ ] quad pull\n";

  it("puts a line break before every inline checkbox after the first", () => {
    const html = renderProse(warmup);
    // 7 checkboxes -> 6 line breaks separating them.
    const breaks = html.match(/<br\s*\/?>/g) ?? [];
    expect(breaks.length).toBe(6);
    // No break needed before the very first item on the line.
    expect(html.indexOf("<input")).toBeLessThan(html.indexOf("<br"));
  });

  it("does not add a break for a single inline checkbox amid ordinary prose", () => {
    const html = renderProse("remember [ ] to bring the cones bag today\n");
    expect(html).not.toMatch(/<br\s*\/?>/);
    expect(html).toContain("<input");
  });

  it("keeps each checkbox's own trailing text with it, in order", () => {
    const html = renderProse("[ ] a [ ] b [ ] c\n");
    const order = [...html.matchAll(/<input[^>]*>|<br\s*\/?>|[abc]/g)].map((m) => m[0]);
    // The sequence must alternate: input, then its letter, then a break, then next input...
    expect(order).toEqual([
      "<input disabled=\"\" type=\"checkbox\">",
      "a",
      "<br>",
      "<input disabled=\"\" type=\"checkbox\">",
      "b",
      "<br>",
      "<input disabled=\"\" type=\"checkbox\">",
      "c",
    ]);
  });

  it("does not insert a break across separate paragraphs or into a real GFM list", () => {
    const md = "- [ ] cones\n- [ ] bibs\n\n[ ] warm up a\n\n[ ] warm up b\n";
    const html = renderProse(md);
    // The two inline paragraphs each have exactly one checkbox, so no <br> is needed
    // for either, and the real list must still be a <ul> with no <br> inserted into it.
    expect(html).toContain("<ul>");
    expect(html).not.toMatch(/<li>[^<]*<br/);
    expect(html).not.toMatch(/<br\s*\/?>/);
  });

  it("still numbers ticks continuously with the layout change", () => {
    const html = renderProse("[ ] a [ ] b [ ] c\n", { interactive: true });
    expect(html.indexOf('data-tick="0"')).toBeLessThan(html.indexOf('data-tick="1"'));
    expect(html.indexOf('data-tick="1"')).toBeLessThan(html.indexOf('data-tick="2"'));
  });
});
