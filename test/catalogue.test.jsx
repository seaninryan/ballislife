import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Catalogue from "../src/components/Catalogue.jsx";

const render = (props) => renderToStaticMarkup(<Catalogue {...props} />);

describe("Catalogue", () => {
  it("offers sign-in when signed out", () => {
    const html = render({ status: "signed-out" });
    expect(html).toContain("Sign in");
  });

  it("says so while loading", () => {
    expect(render({ status: "loading" })).toMatch(/loading/i);
  });

  it("refuses a non-owner without leaking whose app it is", () => {
    const html = render({ status: "not-owner" });
    expect(html).toMatch(/owner/i);
    expect(html).not.toContain("@");
  });

  it("lists drills with their metadata", () => {
    const drills = [
      { id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
        players: "6-8", tags: ["possession"], thumb: "area: 20x20 plain\nred: A@5,5\n", invalid: null },
    ];
    const html = render({ status: "ready", drills });
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("warmup");
    expect(html).toContain("possession");
    expect(html).toContain("<svg");
  });

  it("flags an invalid drill instead of hiding it", () => {
    const drills = [{ id: "c", slug: "broken", title: "broken", category: null, minutes: null,
                      players: null, tags: [], thumb: null, invalid: "yaml: bad" }];
    const html = render({ status: "ready", drills });
    expect(html).toContain("broken");
    expect(html).toMatch(/yaml: bad/);
  });

  it("renders a drill with no diagram without an svg", () => {
    const drills = [{ id: "d", slug: "notes", title: "Notes", category: null, minutes: null,
                      players: null, tags: [], thumb: null, invalid: null }];
    const html = render({ status: "ready", drills });
    expect(html).toContain("Notes");
    expect(html).not.toContain("<svg");
  });

  it("explains an empty folder rather than showing nothing", () => {
    const html = render({ status: "ready", drills: [] });
    expect(html).toMatch(/no drills/i);
    expect(html).toContain("BallIsLife");
  });

  it("shows an error state", () => {
    expect(render({ status: "error", message: "drive 500" })).toContain("drive 500");
  });
});
