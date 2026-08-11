// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import DrillPreview from "../src/components/DrillPreview.jsx";
import { readTicks } from "../src/lib/checklist.js";

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

describe("DrillPreview interactive checklists (markup)", () => {
  const withChecklist = "---\ntitle: T\n---\n\n- [ ] cones\n- [ ] bibs\n";

  it("is not interactive by default: boxes stay disabled, no data-tick", () => {
    const html = render(withChecklist);
    expect(html).toContain("disabled");
    expect(html).not.toContain("data-tick");
  });

  it("when interactive, boxes lose disabled and gain data-tick", () => {
    const html = renderToStaticMarkup(
      <DrillPreview source={withChecklist} interactive slug="a" today="2026-08-11" />,
    );
    expect(html).not.toContain("disabled");
    expect(html).toContain('data-tick="0"');
    expect(html).toContain('data-tick="1"');
  });

  it("a drill with no checkboxes is unaffected by interactive mode", () => {
    const plain = "---\ntitle: T\n---\n\njust some prose\n";
    const a = render(plain);
    const b = renderToStaticMarkup(<DrillPreview source={plain} interactive slug="a" today="2026-08-11" />);
    expect(a).toBe(b);
  });

  it("keeps tick numbering continuous across a pitch diagram that splits the body", () => {
    // splitSegments cuts the body into separate prose runs around each ```pitch block,
    // and DrillPreview renders each run through its own renderProse call — without a
    // running offset carried between them, the second run's checkbox would collide
    // with index 0 from the first.
    const src =
      "---\ntitle: T\n---\n\n- [ ] first\n\n```pitch\narea: 10x10\n```\n\n- [ ] second\n";
    const html = renderToStaticMarkup(<DrillPreview source={src} interactive slug="a" today="2026-08-11" />);
    expect(html).toContain('data-tick="0"');
    expect(html).toContain('data-tick="1"');
    expect(html.indexOf('data-tick="0"')).toBeLessThan(html.indexOf('data-tick="1"'));
  });
});

describe("DrillPreview interactive checklists (interaction)", () => {
  const withChecklist = "---\ntitle: T\n---\n\n- [ ] cones\n- [ ] bibs\n";
  let container, root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  const mount = async (props) => {
    root = createRoot(container);
    await act(async () => {
      root.render(<DrillPreview source={withChecklist} interactive slug="a" today="2026-08-11" {...props} />);
    });
  };

  const boxes = () => [...container.querySelectorAll('input[type="checkbox"]')];

  it("clicking a box records the tick in local storage", async () => {
    await mount();
    await act(async () => { boxes()[0].click(); });
    expect(boxes()[0].checked).toBe(true);
    expect([...readTicks(localStorage, "a", "2026-08-11")]).toEqual([0]);
  });

  it("clicking again clears it", async () => {
    await mount();
    await act(async () => { boxes()[0].click(); });
    await act(async () => { boxes()[0].click(); });
    expect(boxes()[0].checked).toBe(false);
    expect([...readTicks(localStorage, "a", "2026-08-11")]).toEqual([]);
  });

  it("reopening the drill the same day restores the tick", async () => {
    await mount();
    await act(async () => { boxes()[1].click(); });
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await mount();
    expect(boxes()[1].checked).toBe(true);
    expect(boxes()[0].checked).toBe(false);
  });

  it("does not restore a tick from a different day", async () => {
    await mount();
    await act(async () => { boxes()[0].click(); });
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await mount({ today: "2026-08-12" });
    expect(boxes()[0].checked).toBe(false);
  });

  it("never touches the source markdown text", async () => {
    // A tick must never modify the drill: it goes to localStorage only. There is no
    // callback here that could write back to Drive, and the rendered source text is
    // unaffected by ticking.
    await mount();
    await act(async () => { boxes()[0].click(); });
    expect(container.textContent).toContain("cones");
    expect(container.textContent).toContain("bibs");
  });
});
