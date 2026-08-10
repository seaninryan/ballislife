import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Filters, { tagsOf } from "../src/components/Filters.jsx";

const drills = [
  { id: "a", category: "warmup", tags: ["possession", "rondo"] },
  { id: "b", category: "skill", tags: ["transition"] },
  { id: "c", category: "warmup", tags: ["possession"] },
];
const render = (props) => renderToStaticMarkup(<Filters drills={drills} {...props} />);

describe("tagsOf", () => {
  it("lists every distinct tag, most used first", () => {
    expect(tagsOf(drills)).toEqual(["possession", "rondo", "transition"]);
  });

  it("copes with drills that have no tags", () => {
    expect(tagsOf([{ id: "a" }, { id: "b", tags: [] }])).toEqual([]);
    expect(tagsOf(null)).toEqual([]);
  });
});

describe("Filters", () => {
  it("offers every category present, plus all", () => {
    const html = render({ filter: {} });
    expect(html).toContain("warmup");
    expect(html).toContain("skill");
    expect(html).toMatch(/all/i);
  });

  it("marks the active category", () => {
    expect(render({ filter: { category: "skill" } })).toContain("active");
  });

  it("shows the tags", () => {
    const html = render({ filter: {} });
    expect(html).toContain("possession");
    expect(html).toContain("transition");
  });

  it("reflects the current query in the search box", () => {
    expect(render({ filter: { query: "rondo" } })).toContain('value="rondo"');
  });

  it("renders with no drills at all", () => {
    expect(() => renderToStaticMarkup(<Filters drills={[]} filter={{}} />)).not.toThrow();
  });
});
