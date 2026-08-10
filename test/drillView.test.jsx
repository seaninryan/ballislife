// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import DrillView from "../src/components/DrillView.jsx";

const drill = { id: "a", slug: "rondo", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8", tags: ["possession"], thumb: null, invalid: null };
const render = (props) => renderToStaticMarkup(<DrillView drill={drill} {...props} />);

describe("DrillView", () => {
  it("shows a back control", () => {
    expect(render({ status: "loading" })).toMatch(/back/i);
  });

  it("says it is loading before the text arrives", () => {
    expect(render({ status: "loading" })).toMatch(/loading/i);
  });

  it("renders the drill once loaded", () => {
    const text = "---\ntitle: Rondo 4v2\n---\n\nKeep the ball.\n\n```pitch\narea: 20x20 plain\nred: A@5,5\n```\n";
    const html = render({ status: "ready", text });
    expect(html).toContain("Keep the ball");
    expect(html).toContain("<svg");
  });

  it("shows an error without losing the back control", () => {
    const html = render({ status: "error", message: "drive 500" });
    expect(html).toContain("drive 500");
    expect(html).toMatch(/back/i);
  });

  it("shows the title from the drill while loading, so the header does not jump", () => {
    expect(render({ status: "loading" })).toContain("Rondo 4v2");
  });
});
