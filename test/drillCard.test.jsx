import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import DrillCard from "../src/components/DrillCard.jsx";

const drill = {
  id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
  players: "6-8", tags: ["possession"], invalid: null,
  thumb: "area: 20x20 plain\nred: A@5,5 B@15,15\npass: A->B\n",
};
const render = (d) => renderToStaticMarkup(<DrillCard drill={d} />);

describe("DrillCard", () => {
  it("shows the title, category, duration and player count", () => {
    const html = render(drill);
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("warmup");
    expect(html).toContain("10′");
    expect(html).toContain("6-8");
  });

  it("draws the thumbnail diagram", () => {
    expect(render(drill)).toContain("<svg");
  });

  it("shows a placeholder when the drill has no diagram", () => {
    const html = render({ ...drill, thumb: null });
    expect(html).not.toContain("<svg");
    expect(html).toMatch(/no diagram/i);
  });

  it("flags an invalid drill without hiding it", () => {
    const html = render({ ...drill, invalid: "yaml: bad" });
    expect(html).toContain("Rondo 4v2");
    expect(html).toMatch(/needs fixing/i);
  });

  it("renders tags", () => {
    expect(render(drill)).toContain("possession");
  });

  it("omits chips for absent fields rather than showing blanks", () => {
    const html = render({ ...drill, minutes: null, players: null, category: null, tags: [] });
    expect(html).not.toContain("′");
    expect(html).toContain("Rondo 4v2");
  });

  it("does not let a long unbroken title escape the card", () => {
    // A long title ran past the card edge and pushed the whole page sideways on a
    // phone. The fix is CSS, so assert the class that carries it is present.
    const html = render({ ...drill, title: "A".repeat(90) });
    expect(html).toContain("drill-card-title");
    expect(html).toContain("A".repeat(90));
  });
});
