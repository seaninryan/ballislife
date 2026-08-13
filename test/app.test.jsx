// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import * as drive from "../src/lib/drive.js";
import * as auth from "../src/lib/driveAuth.js";
import * as owner from "../src/lib/owner.js";
import * as api from "../src/lib/driveApi.js";
import App from "../src/App.jsx";

vi.mock("../src/lib/drive.js");
vi.mock("../src/lib/driveAuth.js");
vi.mock("../src/lib/owner.js");
vi.mock("../src/lib/driveApi.js");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__APP_VERSION__ = "test";

const drill = (id, title) => ({
  id, slug: id, title, category: "skill", minutes: 10, players: null,
  tags: [], thumb: null, invalid: null,
});

let container;
let root;

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom shares one `location` across every test in this file: without resetting it,
  // a hash left over from a previous test (e.g. "#/drill/a") makes the next mount
  // auto-navigate to that route before the test's own clicks run.
  location.hash = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  auth.initAuth.mockResolvedValue(true);
  auth.isSignedIn.mockReturnValue(true);
  auth.getAccessToken.mockReturnValue("tok");
  auth.startTokenKeepAlive.mockImplementation(() => {});
  // The run view now keeps tonight's progress in localStorage (lib/progress.js),
  // keyed by session id — several tests below reuse session id "s1", so without
  // clearing it a mark made in one test would leak into the next.
  localStorage.clear();
  api.aboutEmail.mockResolvedValue("owner@example.com");
  owner.isOwner.mockResolvedValue(true);
  drive.loadCatalogue.mockResolvedValue({
    drills: [drill("a", "Alpha"), drill("b", "Bravo")],
    failed: [], folderId: "F1", duplicateFolders: false, index: { version: 1, entries: {} },
  });
  drive.loadSessions.mockResolvedValue({ fileId: null, data: { version: 1, sessions: {} }, modifiedTime: null });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const mount = async () => {
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
};

const findButton = (text) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));

const openCard = async (title) => {
  await act(async () => { findButton(title).click(); });
};

// Opens a drill (read view), then clicks its Edit control to enter the editor.
const openEditFor = async (title) => {
  await openCard(title);
  await act(async () => { findButton("Edit").click(); });
};

// Sets a textarea's value the way a real keystroke would: through the native setter, so
// React's onChange fires, then dispatches the input event.
const typeInto = async (textarea, text) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("App", () => {
  it("loads and lists the drills", async () => {
    await mount();
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Bravo");
  });

  it("refuses a non-owner and signs them out", async () => {
    owner.isOwner.mockResolvedValue(false);
    await mount();
    expect(container.textContent).toMatch(/owner only/i);
    expect(auth.signOut).toHaveBeenCalled();
    expect(drive.loadCatalogue).not.toHaveBeenCalled();
  });

  it("opens a drill and shows its text", async () => {
    drive.readDrill.mockResolvedValue({ text: "---\ntitle: Alpha\n---\n\nAlpha body\n", modifiedTime: "T" });
    await mount();
    await openCard("Alpha");
    expect(container.textContent).toContain("Alpha body");
  });

  it("drops a superseded response when a different drill is opened", async () => {
    const resolvers = {};
    drive.readDrill.mockImplementation((id) =>
      new Promise((resolve) => { resolvers[id] = resolve; }));
    await mount();
    await openCard("Alpha");
    // The plan's test opened "Bravo" here with no back click, but once a drill is
    // selected the grid unmounts (Catalogue renders DrillView only) so there is no
    // "Bravo" button to click without going back first — this matches the real
    // navigation flow and is required for the test to be reproducible at all.
    await act(async () => { container.querySelector("button").click(); }); // back
    await openCard("Bravo");
    await act(async () => {
      resolvers.b({ text: "BRAVO BODY", modifiedTime: "T" });
      resolvers.a({ text: "ALPHA BODY", modifiedTime: "T" });
    });
    expect(container.textContent).toContain("BRAVO BODY");
    expect(container.textContent).not.toContain("ALPHA BODY");
  });

  it("drops a superseded response when the SAME drill is reopened", async () => {
    // An id-based guard cannot tell two requests for one drill apart, so the slower
    // response overwrote the newer one.
    const calls = [];
    drive.readDrill.mockImplementation(() =>
      new Promise((resolve) => { calls.push(resolve); }));
    await mount();
    await openCard("Alpha");
    await act(async () => { container.querySelector("button").click(); }); // back
    await openCard("Alpha");
    await act(async () => {
      calls[1]({ text: "FRESH BODY", modifiedTime: "T" });
      calls[0]({ text: "STALE BODY", modifiedTime: "T" });
    });
    expect(container.textContent).toContain("FRESH BODY");
    expect(container.textContent).not.toContain("STALE BODY");
  });

  it("shows a friendly message when a drill fails to open", async () => {
    drive.readDrill.mockRejectedValue(Object.assign(new Error("drive 500"), { code: 500 }));
    await mount();
    await openCard("Alpha");
    expect(container.textContent).toMatch(/having trouble/i);
  });
});

describe("App editing", () => {
  const OPEN_TEXT = "---\ntitle: Alpha\n---\n\nAlpha body\n";

  beforeEach(() => {
    drive.readDrill.mockResolvedValue({ text: OPEN_TEXT, modifiedTime: "T1" });
    drive.knownModifiedTime.mockReturnValue("T1");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces: typing repeatedly calls saveDrill once, not once per keystroke", async () => {
    drive.saveDrill.mockResolvedValue({ ok: true, modifiedTime: "T2" });
    await mount();
    await openEditFor("Alpha");
    const textarea = container.querySelector("textarea");

    await typeInto(textarea, "Alpha body one");
    await typeInto(textarea, "Alpha body two");
    await typeInto(textarea, "Alpha body three");

    expect(drive.saveDrill).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(drive.saveDrill).toHaveBeenCalledTimes(1);
    expect(drive.saveDrill.mock.calls[0][0].text).toBe("Alpha body three");
  });

  it("saves with baseModifiedTime only — no currentModifiedTime in the contract", async () => {
    drive.saveDrill.mockResolvedValue({ ok: true, modifiedTime: "T2" });
    await mount();
    await openEditFor("Alpha");
    const textarea = container.querySelector("textarea");
    await typeInto(textarea, "changed");
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(drive.saveDrill).toHaveBeenCalledTimes(1);
    const call = drive.saveDrill.mock.calls[0][0];
    expect(call).toEqual({ id: "a", text: "changed", baseModifiedTime: "T1" });
    expect(call.currentModifiedTime).toBeUndefined();
  });

  it("adopts the returned modifiedTime, so a second save sends the new baseline", async () => {
    drive.saveDrill
      .mockResolvedValueOnce({ ok: true, modifiedTime: "T2" })
      .mockResolvedValueOnce({ ok: true, modifiedTime: "T3" });
    await mount();
    await openEditFor("Alpha");
    const textarea = container.querySelector("textarea");

    await typeInto(textarea, "first edit");
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(drive.saveDrill.mock.calls[0][0].baseModifiedTime).toBe("T1");

    await typeInto(textarea, "second edit");
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(drive.saveDrill).toHaveBeenCalledTimes(2);
    // Regression test: skipping the adopted modifiedTime here would send "T1" again,
    // which would conflict against the write this very save just made.
    expect(drive.saveDrill.mock.calls[1][0].baseModifiedTime).toBe("T2");
  });

  it("treats a coalesced result as success and adopts its modifiedTime too", async () => {
    drive.saveDrill
      .mockResolvedValueOnce({ ok: true, coalesced: true, modifiedTime: "T5" })
      .mockResolvedValueOnce({ ok: true, modifiedTime: "T6" });
    await mount();
    await openEditFor("Alpha");
    const textarea = container.querySelector("textarea");

    await typeInto(textarea, "first edit");
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(container.textContent).toMatch(/saved/i);

    await typeInto(textarea, "second edit");
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    // The coalesced save's modifiedTime (T5) must have become the baseline for this
    // second save, not the original T1.
    expect(drive.saveDrill.mock.calls[1][0].baseModifiedTime).toBe("T5");
  });

  it("shows the conflict banner on a conflicting save, with the user's text still there", async () => {
    drive.saveDrill.mockResolvedValue({ ok: false, conflict: true, modifiedTime: "T9" });
    await mount();
    await openEditFor("Alpha");
    const textarea = container.querySelector("textarea");

    await typeInto(textarea, "my precious edit");
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(container.textContent).toMatch(/changed in drive|changed on drive/i);
    expect(container.querySelector("textarea").value).toBe("my precious edit");
  });

  it("flushes a pending save when the editor is closed before the debounce fires", async () => {
    drive.saveDrill.mockResolvedValue({ ok: true, modifiedTime: "T2" });
    await mount();
    await openEditFor("Alpha");
    const textarea = container.querySelector("textarea");

    await typeInto(textarea, "typed just before leaving");
    expect(drive.saveDrill).not.toHaveBeenCalled(); // debounce has not fired yet

    await act(async () => { findButton("Back").click(); });

    expect(drive.saveDrill).toHaveBeenCalledTimes(1);
    expect(drive.saveDrill.mock.calls[0][0].text).toBe("typed just before leaving");
  });

  it("asks for confirmation before deleting, and does not delete if declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await mount();
    await openEditFor("Alpha");

    await act(async () => { findButton("Delete").click(); });

    expect(confirmSpy).toHaveBeenCalled();
    expect(drive.deleteDrill).not.toHaveBeenCalled();
  });

  it("deletes when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    drive.deleteDrill.mockResolvedValue(undefined);
    await mount();
    await openEditFor("Alpha");

    await act(async () => { findButton("Delete").click(); });

    expect(drive.deleteDrill).toHaveBeenCalledWith("a");
  });
});

const session = (id, date, blocks) => ({
  id, date, squad: "U12s", theme: "pressing", length: 75,
  blocks: blocks ?? [
    { slot: "warmup", drill: null, minutes: null, note: "" },
    { slot: "skill", drill: null, minutes: null, note: "" },
    { slot: "tactical", drill: null, minutes: null, note: "" },
    { slot: "match", drill: null, minutes: null, note: "" },
    { slot: "fun", drill: null, minutes: null, note: "" },
  ],
});

const openSession = async (dateText) => {
  await act(async () => { findButton("Sessions").click(); });
  await act(async () => { findButton(dateText).click(); });
};

describe("App sessions", () => {
  it("loads sessions after the catalogue is ready", async () => {
    drive.loadSessions.mockResolvedValue({
      fileId: "sess",
      data: { version: 1, sessions: { s1: session("s1", "2026-08-12") } },
      modifiedTime: "S1",
    });
    await mount();
    expect(drive.loadSessions).toHaveBeenCalledWith("F1");
    await act(async () => { findButton("Sessions").click(); });
    expect(container.textContent).toContain("2026-08-12");
  });

  describe("editing", () => {
    const initial = () => session("s1", "2026-08-12", [
      { slot: "warmup", drill: null, minutes: null, note: "" },
      { slot: "skill", drill: "a", minutes: null, note: "" },
      { slot: "tactical", drill: null, minutes: null, note: "" },
      { slot: "match", drill: null, minutes: null, note: "" },
      { slot: "fun", drill: null, minutes: null, note: "" },
    ]);

    beforeEach(() => {
      drive.loadSessions.mockResolvedValue({
        fileId: "sess", data: { version: 1, sessions: { s1: initial() } }, modifiedTime: "S1",
      });
      vi.useFakeTimers();
    });

    afterEach(() => { vi.useRealTimers(); });

    // Number inputs in DOM order: turnout, then session length (both always present),
    // then the minutes override for the "skill" block, the only block with a drill
    // assigned. Index shifted from 1 to 2 when the length input was added alongside
    // turnout (owner asked for an editable session length).
    const minutesInput = () => container.querySelectorAll("input[type=number]")[2];

    it("debounces: repeated edits call saveSessions once, not once per change", async () => {
      drive.saveSessions.mockResolvedValue({ ok: true, fileId: "sess", modifiedTime: "S2" });
      await mount();
      await openSession("2026-08-12");

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const input = minutesInput();
      await act(async () => {
        setter.call(input, "5");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        setter.call(input, "12");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(drive.saveSessions).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSessions).toHaveBeenCalledTimes(1);
      const call = drive.saveSessions.mock.calls[0][0];
      expect(call.data.sessions.s1.blocks[1].minutes).toBe(12);
      expect(call.baseModifiedTime).toBe("S1");
    });

    it("adopts the returned modifiedTime, so a second save sends the new baseline", async () => {
      drive.saveSessions
        .mockResolvedValueOnce({ ok: true, fileId: "sess", modifiedTime: "S2" })
        .mockResolvedValueOnce({ ok: true, fileId: "sess", modifiedTime: "S3" });
      await mount();
      await openSession("2026-08-12");

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const input = minutesInput();
      await act(async () => {
        setter.call(input, "5");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSessions.mock.calls[0][0].baseModifiedTime).toBe("S1");

      await act(async () => {
        setter.call(input, "8");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSessions).toHaveBeenCalledTimes(2);
      expect(drive.saveSessions.mock.calls[1][0].baseModifiedTime).toBe("S2");
    });

    it("a conflict keeps the local version and offers both resolutions", async () => {
      drive.saveSessions.mockResolvedValue({ ok: false, conflict: true, modifiedTime: "S9" });
      await mount();
      await openSession("2026-08-12");

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const input = minutesInput();
      await act(async () => {
        setter.call(input, "17");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(container.textContent).toMatch(/changed in drive|changed on drive/i);
      expect(container.textContent).toMatch(/keep mine/i);
      expect(container.textContent).toMatch(/reload/i);
      // The user's own edit is still there, not overwritten by the conflicting version.
      expect(Number(minutesInput().value)).toBe(17);
    });

    it("deletes the session only after confirmation", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      drive.saveSessions.mockResolvedValue({ ok: true, fileId: "sess", modifiedTime: "S2" });
      await mount();
      await openSession("2026-08-12");

      await act(async () => { findButton("Delete").click(); });
      expect(confirmSpy).toHaveBeenCalled();
      expect(container.textContent).toContain("2026-08-12"); // still on the builder

      confirmSpy.mockReturnValue(true);
      await act(async () => { findButton("Delete").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSessions).toHaveBeenCalled();
      const lastCall = drive.saveSessions.mock.calls.at(-1)[0];
      expect(lastCall.data.sessions.s1).toBeUndefined();
    });
  });
});

describe("App session run mode", () => {
  const runSessionFixture = () => session("s1", "2026-08-12", [
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
    { slot: "tactical", drill: null, minutes: null, note: "" },
    { slot: "match", drill: null, minutes: null, note: "" },
    { slot: "fun", drill: null, minutes: null, note: "" },
  ]);

  beforeEach(() => {
    drive.loadSessions.mockResolvedValue({
      fileId: "sess", data: { version: 1, sessions: { s1: runSessionFixture() } }, modifiedTime: "S1",
    });
  });

  const bodyText = (slug) => `---\ntitle: Drill ${slug}\n---\n\nbody ${slug}\n`;

  it("fetches each referenced drill once, in parallel, when the run view opens", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("body a"); // block a is current, so open
    // The run view is now an accordion: block b is fetched (readDrill ran for it too)
    // but starts collapsed since block a is current. Open it to prove it was in fact
    // fetched and renders, not just requested.
    await act(async () => { container.querySelectorAll(".run-block-summary")[1].click(); });
    expect(container.textContent).toContain("body b");
  });

  it("a block with no drill chosen and a broken reference both render sensibly, without crashing the rest", async () => {
    drive.loadSessions.mockResolvedValue({
      fileId: "sess",
      data: { version: 1, sessions: { s1: session("s1", "2026-08-12", [
        { slot: "warmup", drill: "ghost", minutes: null, note: "" },
        { slot: "skill", drill: null, minutes: null, note: "" },
        { slot: "tactical", drill: "a", minutes: null, note: "" },
        { slot: "match", drill: null, minutes: null, note: "" },
        { slot: "fun", drill: null, minutes: null, note: "" },
      ]) } },
      modifiedTime: "S1",
    });
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    // Block 0 (the broken reference) is current, since nothing is marked yet, so it
    // is the one open by default.
    expect(container.textContent).toMatch(/missing/i);
    expect(container.textContent).toContain("ghost");
    // Blocks 1 (no drill) and 2 (a) are collapsed until opened — open each in turn to
    // confirm they still render sensibly rather than crashing.
    const summaries = () => container.querySelectorAll(".run-block-summary");
    await act(async () => { summaries()[1].click(); });
    expect(container.textContent).toMatch(/no drill/i);
    await act(async () => { summaries()[2].click(); });
    expect(container.textContent).toContain("body a");
  });

  it("caches within the session: leaving run mode and coming back does not refetch", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2);

    await act(async () => { findButton("Back to plan").click(); });
    await act(async () => { findButton("Run this session").click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2); // still 2 — not refetched
    expect(container.textContent).toContain("body a");
  });

  it("drops a late drill response once the run view has been left", async () => {
    // The stale-request guard pattern from openDrill: a monotonic token, not an id,
    // since re-entering run mode for the same session is indistinguishable from the
    // first entry by id alone.
    const resolvers = {};
    drive.readDrill.mockImplementation((id) => new Promise((resolve) => { resolvers[id] = resolve; }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    await act(async () => { findButton("Back to plan").click(); });
    await act(async () => {
      resolvers.a({ text: "STALE A", modifiedTime: "T" });
      resolvers.b({ text: "STALE B", modifiedTime: "T" });
    });
    expect(container.textContent).not.toContain("STALE A");
    expect(container.textContent).not.toContain("STALE B");
  });

  it("a drill that fails to load says so for that block only, leaving the rest usable", async () => {
    drive.readDrill.mockImplementation((id) =>
      id === "a"
        ? Promise.reject(Object.assign(new Error("drive 500"), { code: 500 }))
        : Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    expect(container.textContent).toMatch(/could not load|failed|trouble/i);
    // Block a (errored) is current and open; block b is collapsed. Open it to confirm
    // a's failure did not stop b from loading and rendering fine.
    await act(async () => { container.querySelectorAll(".run-block-summary")[1].click(); });
    expect(container.textContent).toContain("body b");
  });

  it("opens run mode directly from the #/session/<id>/run hash", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    location.hash = "#/session/s1/run";
    await mount();
    expect(container.textContent).toContain("body a"); // block a is current, so open
    await act(async () => { container.querySelectorAll(".run-block-summary")[1].click(); });
    expect(container.textContent).toContain("body b");
  });

  it("a run route for an unknown session id falls back to the session list", async () => {
    location.hash = "#/session/does-not-exist/run";
    await mount();
    expect(location.hash).toBe("#/sessions");
  });

  it("offers a way back to the plan from the run view, returning to the session builder", async () => {
    drive.readDrill.mockResolvedValue({ text: bodyText("a"), modifiedTime: "T" });
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    await act(async () => { findButton("Back to plan").click(); });
    expect(container.textContent).toContain("2026-08-12"); // back on the builder
    expect(location.hash).toBe("#/session/s1");
  });

  it("a swap writes the new drill into the plan and loads its text", async () => {
    drive.loadCatalogue.mockResolvedValue({
      drills: [drill("a", "Alpha"), drill("b", "Bravo"), drill("c", "Charlie")],
      failed: [], folderId: "F1", duplicateFolders: false, index: { version: 1, entries: {} },
    });
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      expect(drive.readDrill).toHaveBeenCalledTimes(2); // a and b

      await act(async () => { findButton("Swap").click(); });
      const charlie = [...container.querySelectorAll(".drill-picker-option")]
        .find((b) => b.textContent.includes("Charlie"));
      await act(async () => { charlie.click(); });

      // The swapped-in drill's text is fetched and shown — the run view had never
      // loaded it, since it was not in the plan when the view opened.
      expect(drive.readDrill).toHaveBeenCalledTimes(3);
      expect(container.textContent).toContain("body c");

      // And the change is a real edit to the plan, saved like any builder edit.
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      const saved = drive.saveSessions.mock.calls.at(-1)[0];
      expect(saved.data.sessions.s1.blocks[0].drill).toBe("c");
      expect(saved.data.sessions.s1.blocks[0].minutes).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a swap to a drill already loaded this visit does not refetch it", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2);
    // Block 0 (a) swaps to b, whose text is already in hand from this same visit.
    await act(async () => { findButton("Swap").click(); });
    const bravo = [...container.querySelectorAll(".drill-picker-option")]
      .find((b) => b.textContent.includes("Bravo"));
    await act(async () => { bravo.click(); });
    expect(drive.readDrill).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("body b");
  });

  it("swapping in a drill whose read is left over from an abandoned run visit still loads it", async () => {
    // The in-flight set must be scoped to the visit that issued the read. Otherwise:
    // leave session A's run view with A's read of "a" still pending, enter session B's
    // run view, swap a block to "a" — the swap sees "a" as already in flight and does
    // nothing, while the old reply is dropped as stale. The block waits forever.
    drive.loadSessions.mockResolvedValue({
      fileId: "sess",
      data: { version: 1, sessions: {
        s1: session("s1", "2026-08-12", [{ slot: "warmup", drill: "a", minutes: null, note: "" }]),
        s2: session("s2", "2026-08-14", [{ slot: "warmup", drill: "b", minutes: null, note: "" }]),
      } },
      modifiedTime: "S1",
    });
    drive.saveSessions.mockResolvedValue({ ok: true, modifiedTime: "S2" });
    const resolvers = {};
    drive.readDrill.mockImplementation((id) => new Promise((resolve) => {
      (resolvers[id] ??= []).push(resolve);
    }));

    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    await act(async () => { findButton("Back to plan").click(); }); // "a" still pending

    await act(async () => { findButton("← Back").click(); }); // builder → session list
    await act(async () => { findButton("2026-08-14").click(); });
    await act(async () => { findButton("Run this session").click(); });
    await act(async () => { findButton("Swap").click(); });
    const alpha = [...container.querySelectorAll(".drill-picker-option")]
      .find((b) => b.textContent.includes("Alpha"));
    await act(async () => { alpha.click(); });

    // The abandoned visit's reply lands and is correctly ignored…
    await act(async () => { resolvers.a[0]({ text: bodyText("a"), modifiedTime: "T" }); });
    // …so the swap must have issued a read of its own for the block to ever fill in.
    expect(resolvers.a).toHaveLength(2);
    await act(async () => { resolvers.a[1]({ text: bodyText("a"), modifiedTime: "T" }); });
    expect(container.textContent).toContain("body a");
    expect(container.textContent).not.toContain("Loading…");
  });

  it("a mark made during a run is saved into the session's progress", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: true, fileId: "sess", modifiedTime: "S2" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      const saved = drive.saveSessions.mock.calls.at(-1)[0];
      // Keyed by the day the run happened, which is today — NOT the session's planned
      // date (2026-08-12), so re-running this plan another day starts clean.
      const days = Object.keys(saved.data.sessions.s1.progress);
      expect(days).toHaveLength(1);
      expect(saved.data.sessions.s1.progress[days[0]].marks).toEqual({ 0: "done" });
      expect(saved.data.sessions.s1.progress[days[0]].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("progress made on another device shows when the run view opens", async () => {
    drive.loadSessions.mockResolvedValue({
      fileId: "sess",
      data: { version: 1, sessions: { s1: {
        ...runSessionFixture(),
        progress: { [new Date().toISOString().slice(0, 10)]: {
          marks: { 0: "done" }, updatedAt: new Date().toISOString(),
        } },
      } } },
      modifiedTime: "S1",
    });
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    const first = container.querySelectorAll(".run-block")[0];
    expect(first.querySelector(".run-block-summary").textContent).toContain("Done");
  });

  it("a failed save is visible from the run view, not only from the builder", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSessions.mockResolvedValue({ ok: false, error: new Error("offline") });
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(container.textContent).toMatch(/could not save/i);
      // And the mark itself is still on screen: localStorage took it regardless.
      expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
        .toContain("Done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns to the builder from Back to plan even when run mode was entered directly via the /run hash (not through a click)", async () => {
    // Mirrors the owner's report as closely as this harness allows: land on the run
    // view via #/session/<id>/run directly — the same route the report's address bar
    // could plausibly have shown right before backing out — then click Back.
    drive.readDrill.mockResolvedValue({ text: bodyText("a"), modifiedTime: "T" });
    location.hash = "#/session/s1/run";
    await mount();
    expect(container.textContent).toContain("body a"); // confirm run view is showing
    await act(async () => { findButton("Back to plan").click(); });
    expect(container.textContent).toContain("2026-08-12"); // back on the builder
    expect(container.textContent).not.toContain("body a"); // run view is gone
    expect(location.hash).toBe("#/session/s1");
  });
});
