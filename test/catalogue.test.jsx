// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Catalogue, { friendlyError } from "../src/components/Catalogue.jsx";
import { openEditor } from "../src/lib/editor.js";

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

  it("shows the drills as a grid of cards", () => {
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

  it("surfaces a friendly message for a rate-limited Drive", () => {
    const html = render({ status: "error", error: Object.assign(new Error("drive 403"), { code: 403 }) });
    expect(html).toMatch(/too many requests|try again/i);
  });

  it("does not mistake a number in a drill name for an http status", () => {
    expect(friendlyError(new Error("could not parse rondo-500.md"))).toContain("rondo-500.md");
  });

  it("flags an invalid drill instead of hiding it", () => {
    // Not in the plan's list of tests to update, but it breaks as a direct consequence
    // of Task 3: the grid renders this through DrillCard now, which shows a generic
    // "needs fixing" banner rather than the raw invalid reason (drillCard.test.jsx
    // covers that choice already). Assert what DrillCard actually renders.
    const drills = [{ id: "c", slug: "broken", title: "broken", category: null, minutes: null,
                      players: null, tags: [], thumb: null, invalid: "yaml: bad" }];
    const html = render({ status: "ready", drills });
    expect(html).toContain("broken");
    expect(html).toMatch(/needs fixing/i);
  });

  it("renders the editor instead of the grid when an editor state is present", () => {
    const state = openEditor("a", "---\ntitle: T\n---\n\nBody.\n", "T1");
    const drills = [
      { id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
        players: "6-8", tags: ["possession"], thumb: null, invalid: null },
    ];
    const html = render({ status: "ready", drills, editor: state });
    expect(html).toContain("<textarea");
    expect(html).toContain("Body.");
    // The grid must not also be showing.
    expect(html).not.toContain("Rondo 4v2");
  });

  it("offers a new drill control in the grid", () => {
    const html = render({ status: "ready", drills: [] });
    expect(html).toMatch(/new drill/i);
  });

  it("explains an empty folder rather than showing nothing", () => {
    const html = render({ status: "ready", drills: [] });
    expect(html).toMatch(/no drills/i);
    expect(html).toContain("BallIsLife");
  });

  it("shows an error state", () => {
    // Not in the plan's list either, and it breaks for the same reason Task 7 exists:
    // raw exception text is now passed through friendlyError rather than shown as-is.
    expect(render({ status: "error", error: Object.assign(new Error("drive 500"), { code: 500 }) }))
      .toMatch(/trouble|try again/i);
  });
});
