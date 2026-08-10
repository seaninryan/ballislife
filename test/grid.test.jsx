import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Grid from "../src/components/Grid.jsx";

const drills = [
  { id: "a", slug: "rondo", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8", tags: ["possession"], thumb: null, invalid: null },
  { id: "b", slug: "press", title: "Pressing traps", category: "tactical", minutes: 20, players: null, tags: ["pressing"], thumb: null, invalid: null },
];
const render = (props) => renderToStaticMarkup(<Grid drills={drills} filter={{}} {...props} />);

describe("Grid", () => {
  it("renders a card per drill", () => {
    const html = render({});
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("Pressing traps");
  });

  it("applies the filter", () => {
    const html = render({ filter: { category: "tactical" } });
    expect(html).toContain("Pressing traps");
    expect(html).not.toContain("Rondo 4v2");
  });

  it("says so when a filter matches nothing, and offers to clear it", () => {
    const html = render({ filter: { query: "zzzz" } });
    expect(html).toMatch(/no drills match/i);
    expect(html).toMatch(/clear/i);
  });

  it("explains an empty catalogue differently from an empty filter", () => {
    const html = renderToStaticMarkup(<Grid drills={[]} filter={{}} />);
    expect(html).toMatch(/no drills yet/i);
    expect(html).toContain("BallIsLife");
  });

  it("reports drills that failed to load without hiding the ones that worked", () => {
    const failed = [{ id: "x", name: "broken.md", error: new Error("drive 500") }];
    const html = render({ failed });
    expect(html).toContain("Rondo 4v2");
    expect(html).toMatch(/1 drill could not be loaded/i);
    expect(html).toContain("broken.md");
  });

  it("counts what is showing", () => {
    expect(render({})).toMatch(/2 drills/i);
  });
});
