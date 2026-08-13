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
    // The grid must not also be showing. Assert on its markup rather than on a drill
    // title: the editor's reference card contains example titles, so a string check
    // here fails for the wrong reason.
    expect(html).not.toContain("drill-card");
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

describe("Catalogue sessions switch", () => {
  it("defaults to the Drills view, showing the grid", () => {
    const drills = [
      { id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
        players: "6-8", tags: [], thumb: null, invalid: null },
    ];
    const html = render({ status: "ready", drills });
    expect(html).toContain("Rondo 4v2");
    expect(html).toMatch(/drills/i);
    expect(html).toMatch(/sessions/i);
  });

  it("shows the session list when mode is sessions", () => {
    const html = render({ status: "ready", drills: [], mode: "sessions", sessions: [] });
    expect(html).toMatch(/no sessions/i);
  });

  it("shows the session builder when a session is selected, regardless of mode", () => {
    const session = { id: "s1", date: "2026-08-12", squad: "U12s", theme: "", length: 75,
      blocks: [{ slot: "warmup", drill: null, minutes: null, note: "" },
        { slot: "skill", drill: null, minutes: null, note: "" },
        { slot: "tactical", drill: null, minutes: null, note: "" },
        { slot: "match", drill: null, minutes: null, note: "" },
        { slot: "fun", drill: null, minutes: null, note: "" }] };
    const html = render({ status: "ready", drills: [], mode: "sessions", selectedSession: session });
    expect(html).toContain("2026-08-12");
    expect(html).toContain("warmup");
  });

  it("shows the run view when a runSession is present, taking priority over everything else", () => {
    const session = { id: "s1", date: "2026-08-12", squad: "U12s", theme: "", length: 75,
      blocks: [{ slot: "warmup", drill: null, minutes: null, note: "" },
        { slot: "skill", drill: null, minutes: null, note: "" },
        { slot: "tactical", drill: null, minutes: null, note: "" },
        { slot: "match", drill: null, minutes: null, note: "" },
        { slot: "fun", drill: null, minutes: null, note: "" }] };
    const html = render({
      status: "ready", drills: [], mode: "sessions", runSession: session, runTexts: {},
    });
    expect(html).toContain("2026-08-12");
    expect(html).toMatch(/back to plan/i);
  });

  it("offers Run this session on the builder, calling onOpenRun with the session", () => {
    const session = { id: "s1", date: "2026-08-12", squad: "", theme: "", length: 75,
      blocks: [{ slot: "warmup", drill: null, minutes: null, note: "" },
        { slot: "skill", drill: null, minutes: null, note: "" },
        { slot: "tactical", drill: null, minutes: null, note: "" },
        { slot: "match", drill: null, minutes: null, note: "" },
        { slot: "fun", drill: null, minutes: null, note: "" }] };
    const html = render({
      status: "ready", drills: [], mode: "sessions", selectedSession: session, onOpenRun: () => {},
    });
    expect(html).toMatch(/run this session/i);
  });

  it("offers Run this session on each session list row", () => {
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [
        { id: "s1", date: "2026-08-12", squad: "", theme: "", length: 75,
          blocks: [{ slot: "warmup", drill: null, minutes: null, note: "" },
            { slot: "skill", drill: null, minutes: null, note: "" },
            { slot: "tactical", drill: null, minutes: null, note: "" },
            { slot: "match", drill: null, minutes: null, note: "" },
            { slot: "fun", drill: null, minutes: null, note: "" }] },
      ], onOpenRun: () => {},
    });
    expect(html).toMatch(/run this session/i);
  });

  it("reports an unreadable sessions.json without pretending the plans are gone", () => {
    // An empty session list with no explanation reads as "my plans have vanished". Say
    // instead that nothing was moved and nothing was renamed.
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsFailed: [{ id: "BLOB", name: "sessions.json", reason: "blob", error: new Error("x") }],
    });
    expect(html).toContain("sessions.json");
    expect(html).toMatch(/could not be read/i);
    expect(html).toMatch(/nothing.*(moved|renamed)/i);
    // Not the generic per-plan banner, which would miscount the blob as one lost plan.
    expect(html).not.toMatch(/1 session plan could not be loaded/i);
  });

  it("still reports a plan that failed to download separately from the blob", () => {
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsFailed: [{ id: "FB", name: "b.json", reason: "read", error: new Error("x") }],
    });
    expect(html).toMatch(/1 session plan could not be loaded/i);
    expect(html).toContain("b.json");
  });

  it("says which plans have not moved into their own files yet", () => {
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsMigrated: 1,
      sessionsUnmigrated: [{ id: "2026-08-13", reason: "write", error: new Error("x") }],
    });
    expect(html).toContain("2026-08-13");
    expect(html).toMatch(/not.*moved|have not been moved|still/i);
    expect(html).toMatch(/tried again|retried/i);
  });

  it("says a plan is still in the old file because its own file cannot be read", () => {
    // Not the "tried again when you next save" wording: saving this one is refused, because
    // writing its file now would leave two claiming the plan. Only Drive can fix it.
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsUnmigrated: [{ id: "2026-08-13", reason: "unreadable-file", error: null }],
    });
    expect(html).toContain("2026-08-13");
    expect(html).toMatch(/could not be read/i);
    expect(html).toMatch(/in Drive/i);
    expect(html).not.toMatch(/tried again when you next save/i);
  });

  it("keeps the drills usable when the sessions load failed outright", () => {
    const drills = [
      { id: "a", slug: "rondo", title: "Rondo", category: "warmup", minutes: 10,
        players: null, tags: [], thumb: null, invalid: null },
    ];
    const html = render({
      status: "ready", drills,
      sessionsLoadError: Object.assign(new Error("drive 500"), { code: 500 }),
    });
    expect(html).toContain("Rondo");
    expect(html).toMatch(/session plans could not be loaded/i);
    expect(html).toMatch(/having trouble/i);
  });

  it("separates plans that need fixing in Drive from ones a reload would retry", () => {
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsFailed: [
        { id: "FB", name: "b.json", reason: "read", error: new Error("x") },
        { id: "FC", name: "c.json", reason: "parse", error: new Error("x") },
        { id: "FD", name: "Copy of a.json", reason: "unnamed", error: new Error("x") },
      ],
    });
    expect(html).toMatch(/1 session plan could not be loaded/i);
    expect(html).toContain("b.json");
    // The other two will never come back on their own, so they must not be reported as
    // something a reload fixes.
    expect(html).toContain("c.json");
    expect(html).toContain("Copy of a.json");
    expect(html).toMatch(/in Drive/i);
  });

  it("says a plan is claimed by two files and that saving it is blocked", () => {
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsFailed: [
        { id: "FA2", name: "a.json and a.json", reason: "duplicate", error: new Error("x") },
      ],
    });
    expect(html).toContain("a.json");
    expect(html).toMatch(/two files|more than one file/i);
    expect(html).toMatch(/newest/i);
    expect(html).toMatch(/sav/i);
    // Not the "could not be read" wording: the plan IS shown.
    expect(html).not.toMatch(/could not be read as a plan/i);
  });

  it("names a plan the old blob holds under an id no file can be called", () => {
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsMigrated: 1,
      sessionsUnmigrated: [{ id: "13/08/2026", reason: "unsafe-id", error: null }],
    });
    expect(html).toContain("13/08/2026");
    expect(html).toContain("sessions.json");
    // It is not listed, so it must not be claimed as still shown.
    expect(html).not.toMatch(/still listed here/i);
  });

  it("names the plan a sessions save conflict is about, wherever it is shown", () => {
    const session = { id: "s1", date: "2026-08-12", squad: "", theme: "", length: 75,
      blocks: [{ slot: "warmup", drill: null, minutes: null, note: "" },
        { slot: "skill", drill: null, minutes: null, note: "" },
        { slot: "tactical", drill: null, minutes: null, note: "" },
        { slot: "match", drill: null, minutes: null, note: "" },
        { slot: "fun", drill: null, minutes: null, note: "" }] };
    const html = render({
      status: "ready", drills: [], mode: "sessions", selectedSession: session,
      sessionsConflicts: [{ id: "s1", label: "2026-08-12" }],
    });
    expect(html).toMatch(/changed in drive|changed on drive/i);
    expect(html).toMatch(/keep mine/i);
    expect(html).toMatch(/reload/i);
    // The name is the point: the banner shows on every view now, so it has to say which
    // plan "Keep mine" would write.
    expect(html).toContain("2026-08-12");
  });

  it("shows a sessions conflict on the session list too, not only on the plan itself", () => {
    // It used to render inside the builder and the run view only, so a conflict landing
    // after Back was never seen — and never resolved.
    const html = render({
      status: "ready", drills: [], mode: "sessions", sessions: [],
      sessionsConflicts: [{ id: "s1", label: "2026-08-12" }],
    });
    expect(html).toMatch(/changed in drive|changed on drive/i);
    expect(html).toContain("2026-08-12");
  });
});
