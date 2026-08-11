import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import PitchHelp from "../src/components/PitchHelp.jsx";
import { MARKINGS, TEAMS, GOAL_SIZES, POINT_MARKS, ARROWS } from "../src/lib/pitch.js";

const html = () => renderToStaticMarkup(<PitchHelp />);

describe("PitchHelp", () => {
  it("is collapsed by default, so it never steals space from the source pane", () => {
    // A <details> without `open` — no JS, and it works the same on a phone.
    expect(html()).toContain("<details");
    expect(html()).not.toContain("<details open");
  });

  it("names itself so it is obvious what opening it gives you", () => {
    expect(html()).toMatch(/how to write a drill|cheat ?sheet|reference/i);
  });

  it("documents every frontmatter field the drill model reads", () => {
    for (const field of ["title", "category", "minutes", "players", "tags"]) {
      expect(html()).toContain(field);
    }
  });

  it("documents every markings preset the parser accepts", () => {
    for (const preset of MARKINGS) expect(html()).toContain(preset);
  });

  it("documents every team, mark kind and goal size", () => {
    for (const name of [...TEAMS, ...POINT_MARKS, ...GOAL_SIZES]) {
      expect(html()).toContain(name);
    }
  });

  it("documents every movement arrow, which is the part nobody can guess", () => {
    for (const arrow of Object.values(ARROWS)) {
      expect(html()).toContain(arrow.replace(/>/g, "&gt;"));
    }
    for (const kind of Object.keys(ARROWS)) expect(html()).toContain(kind);
  });

  it("states the two rules that are not visible from the syntax", () => {
    const out = html();
    expect(out).toMatch(/met(re|er)s/i); // coordinates are metres, not pixels
    expect(out).toMatch(/4 characters|four characters/i); // label length limit
  });

  it("shows a complete example a coach can copy", () => {
    const out = html();
    expect(out).toContain("area:");
    expect(out).toContain("red:");
    expect(out).toContain("pass:");
  });
});
