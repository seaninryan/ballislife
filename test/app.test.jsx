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

// What loadSessions now returns: the id-keyed map the app renders, plus one meta entry
// per file — each plan's own file id and conflict baseline. Tests that care about a
// specific baseline pass their own `meta`.
const sessionsLoad = (sessions, extra = {}) => ({
  sessions,
  meta: Object.fromEntries(
    Object.keys(sessions).map((id) => [id, { fileId: `f-${id}`, modifiedTime: "S1" }]),
  ),
  migrated: 0,
  failed: [],
  ...extra,
});

// saveSession answers about one plan, and App adopts the returned fileId/modifiedTime for
// that id alone — so the mock echoes back whichever id it was called with.
const saveSessionOk = (modifiedTime = "S2") => ({ id }) =>
  Promise.resolve({ ok: true, id, fileId: `f-${id}`, modifiedTime });

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
  drive.loadSessions.mockResolvedValue(sessionsLoad({}));
  // No squads.json in Drive yet: the shape loadSquads returns before one has ever been
  // written. `failed: null` is the load saying "there is nothing here", which is a
  // different answer from "I could not read what is here".
  drive.loadSquads.mockResolvedValue({ squads: {}, fileId: null, modifiedTime: null, failed: null });
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
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12") }));
    await mount();
    expect(drive.loadSessions).toHaveBeenCalledWith("F1");
    await act(async () => { findButton("Sessions").click(); });
    expect(container.textContent).toContain("2026-08-12");
  });

  it("lists both plans when they come from two files", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad({
      s1: session("s1", "2026-08-12"),
      s2: session("s2", "2026-08-14"),
    }));
    await mount();
    await act(async () => { findButton("Sessions").click(); });
    expect(container.textContent).toContain("2026-08-12");
    expect(container.textContent).toContain("2026-08-14");
  });

  it("says so once when plans were migrated out of the old blob", async () => {
    drive.loadSessions.mockResolvedValue(
      sessionsLoad({ s1: session("s1", "2026-08-12") }, { migrated: 2 }),
    );
    await mount();
    expect(container.textContent).toMatch(/sessions-before-split\.json/);
  });

  it("keeps the drills on screen when the sessions load fails outright", async () => {
    // One flaky request during the one-time migration used to replace the whole app with
    // an error screen, drills included — all of them already loaded.
    drive.loadSessions.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    await mount();
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Bravo");
    expect(container.textContent).toMatch(/session plans could not be loaded/i);
  });

  it("reports the plans the migration could not move yet", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad(
      { s1: session("s1", "2026-08-12") },
      { migrated: 0, unmigrated: [{ id: "s1", reason: "write", error: new Error("boom") }] },
    ));
    await mount();
    expect(container.textContent).toMatch(/not moved into its own file/i);
    expect(container.textContent).toContain("s1");
  });

  it("says nothing about migration on an ordinary load", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12") }));
    await mount();
    expect(container.textContent).not.toMatch(/sessions-before-split\.json/);
  });

  it("names a plan whose file could not be read, rather than silently omitting it", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad(
      { s1: session("s1", "2026-08-12") },
      { failed: [{ id: "f-s9", name: "2026-08-20.json", error: new Error("drive 500") }] },
    ));
    await mount();
    expect(container.textContent).toContain("2026-08-20.json");
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
      drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: initial() }));
      vi.useFakeTimers();
    });

    afterEach(() => { vi.useRealTimers(); });

    // Number inputs in DOM order: turnout, then session length (both always present),
    // then the minutes override for the "skill" block, the only block with a drill
    // assigned. Index shifted from 1 to 2 when the length input was added alongside
    // turnout (owner asked for an editable session length).
    const minutesInput = () => container.querySelectorAll("input[type=number]")[2];

    const setNumber = async (index, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const input = container.querySelectorAll("input[type=number]")[index];
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    it("debounces: repeated edits call saveSession once, not once per change", async () => {
      drive.saveSession.mockImplementation(saveSessionOk("S2"));
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

      expect(drive.saveSession).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);
      const call = drive.saveSession.mock.calls[0][0];
      expect(call.id).toBe("s1");
      expect(call.session.blocks[1].minutes).toBe(12);
      expect(call.baseModifiedTime).toBe("S1");
      // No fileId in the contract: drive.js keeps the id→file map, the same way it is the
      // authority on modifiedTime.
      expect(call.fileId).toBeUndefined();
    });

    it("adopts the returned modifiedTime, so a second save sends the new baseline", async () => {
      drive.saveSession
        .mockResolvedValueOnce({ ok: true, id: "s1", fileId: "f-s1", modifiedTime: "S2" })
        .mockResolvedValueOnce({ ok: true, id: "s1", fileId: "f-s1", modifiedTime: "S3" });
      await mount();
      await openSession("2026-08-12");

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const input = minutesInput();
      await act(async () => {
        setter.call(input, "5");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession.mock.calls[0][0].baseModifiedTime).toBe("S1");

      await act(async () => {
        setter.call(input, "8");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(2);
      expect(drive.saveSession.mock.calls[1][0].baseModifiedTime).toBe("S2");
    });

    it("a conflict keeps the local version and offers both resolutions", async () => {
      drive.saveSession.mockResolvedValue({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" });
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

    it("flushes a pending edit when the builder is closed before the debounce fires", async () => {
      drive.saveSession.mockImplementation(saveSessionOk("S2"));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "13");
      expect(drive.saveSession).not.toHaveBeenCalled(); // debounce has not fired yet

      await act(async () => { findButton("← Back").click(); });

      expect(drive.saveSession).toHaveBeenCalledTimes(1);
      expect(drive.saveSession.mock.calls[0][0].session.blocks[1].minutes).toBe(13);
    });

    it("deletes the session only after confirmation", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      drive.saveSession.mockImplementation(saveSessionOk("S2"));
      drive.deleteSession.mockResolvedValue(undefined);
      await mount();
      await openSession("2026-08-12");

      await act(async () => { findButton("Delete").click(); });
      expect(confirmSpy).toHaveBeenCalled();
      expect(container.textContent).toContain("2026-08-12"); // still on the builder
      expect(drive.deleteSession).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      await act(async () => { findButton("Delete").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      // One file trashed, and nothing rewritten: the other plans are not this plan's
      // business any more.
      expect(drive.deleteSession).toHaveBeenCalledWith({ id: "s1", fileId: "f-s1" });
      expect(drive.saveSession).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("2026-08-12");
    });

    // Switching plans by URL rather than via Back, which is what lets two plans be dirty
    // at once: Back flushes, a hash change does not.
    const goToHash = async (hash) => {
      await act(async () => {
        location.hash = hash;
        window.dispatchEvent(new Event("hashchange"));
      });
    };

    // Only what the banners say — the plan being edited shows its own date in an input, so
    // asserting on the whole document cannot tell "s1 conflicted" from "s1 is on screen".
    const banners = () => [...container.querySelectorAll(".banner")].map((b) => b.textContent).join(" ");

    // Finds the resolution button ("Keep mine" / "Reload") belonging to ONE named plan.
    const conflictButton = (label, plan) =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent.includes(label) && b.textContent.includes(plan));

    const twoPlans = (extra = {}) => sessionsLoad(
      { s1: initial(), s2: session("s2", "2026-08-14") },
      {
        meta: {
          s1: { fileId: "f-s1", modifiedTime: "A1" },
          s2: { fileId: "f-s2", modifiedTime: "B1" },
        },
        ...extra,
      },
    );

    it("edits to two plans in one window save both, each against its own baseline", async () => {
      drive.loadSessions.mockResolvedValue(twoPlans());
      drive.saveSession.mockImplementation(saveSessionOk("X2"));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "12"); // s1's skill block minutes
      await goToHash("#/session/s2");
      await setNumber(0, "9"); // s2's turnout

      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(drive.saveSession).toHaveBeenCalledTimes(2);
      const byId = Object.fromEntries(drive.saveSession.mock.calls.map(([c]) => [c.id, c]));
      expect(byId.s1.baseModifiedTime).toBe("A1");
      expect(byId.s1.session.blocks[1].minutes).toBe(12);
      expect(byId.s2.baseModifiedTime).toBe("B1");
      expect(byId.s2.session.turnout).toBe(9);
    });

    it("a conflict on one plan still saves the other, and keeps the conflicted edit", async () => {
      drive.loadSessions.mockResolvedValue(twoPlans());
      drive.saveSession.mockImplementation(({ id }) => Promise.resolve(
        id === "s1"
          ? { ok: false, conflict: true, id, modifiedTime: "A9" }
          : { ok: true, id, fileId: "f-s2", modifiedTime: "B2" },
      ));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await goToHash("#/session/s2");
      await setNumber(0, "9");

      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      const byId = Object.fromEntries(drive.saveSession.mock.calls.map(([c]) => [c.id, c]));
      expect(byId.s2.session.turnout).toBe(9); // saved despite s1 conflicting
      // s1's conflict IS shown while s2 is open — an unresolved conflict the owner never
      // sees is how Drive gets overwritten — but it names s1, because "Keep mine" writes
      // one file and must never read as an offer about the plan on screen.
      expect(banners()).toMatch(/changed in drive|changed on drive/i);
      expect(banners()).toContain("2026-08-12");
      expect(banners()).not.toContain("2026-08-14");
      // And s1's own edit is untouched, waiting for the owner to choose.
      await goToHash("#/session/s1");
      expect(Number(minutesInput().value)).toBe(17);
      expect(container.textContent).toMatch(/changed in drive|changed on drive/i);
    });

    it("Keep mine re-saves the conflicted plan with the baseline Drive reported", async () => {
      drive.saveSession
        .mockResolvedValueOnce({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" })
        .mockResolvedValue({ ok: true, id: "s1", fileId: "f-s1", modifiedTime: "S10" });
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(container.textContent).toMatch(/keep mine/i);

      await act(async () => { findButton("Keep mine").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(drive.saveSession).toHaveBeenCalledTimes(2);
      const retry = drive.saveSession.mock.calls[1][0];
      expect(retry.id).toBe("s1");
      expect(retry.baseModifiedTime).toBe("S9");
      expect(retry.session.blocks[1].minutes).toBe(17);
      expect(container.textContent).not.toMatch(/changed in drive|changed on drive/i);
    });

    it("never re-sends a conflicted plan on a later edit — only Keep mine or Reload may", async () => {
      // The clobber: App adopts Drive's modifiedTime as the new baseline when it reports
      // the conflict, so a flush that gates only on "is anything dirty" would re-send the
      // plan against that adopted baseline, succeed, and overwrite the other device's
      // version without the owner ever choosing.
      drive.saveSession.mockResolvedValue({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" });
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);
      expect(container.textContent).toMatch(/changed in drive|changed on drive/i);

      await setNumber(2, "18");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(drive.saveSession).toHaveBeenCalledTimes(1); // still only the first attempt
      // And the conflict is still on offer, with the owner's later edit kept.
      expect(container.textContent).toMatch(/changed in drive|changed on drive/i);
      expect(Number(minutesInput().value)).toBe(18);
    });

    it("an edit to another plan does not smuggle the conflicted one back to Drive", async () => {
      drive.loadSessions.mockResolvedValue(twoPlans());
      drive.saveSession.mockImplementation(({ id }) => Promise.resolve(
        id === "s1"
          ? { ok: false, conflict: true, id, modifiedTime: "A9" }
          : { ok: true, id, fileId: "f-s2", modifiedTime: "B2" },
      ));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);

      await goToHash("#/session/s2");
      await setNumber(0, "9"); // s2's turnout — a different plan entirely
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      const sent = drive.saveSession.mock.calls.map(([c]) => c.id);
      expect(sent).toEqual(["s1", "s2"]); // s1 attempted once, never re-sent
    });

    it("does not re-create a plan deleted while an earlier plan's save was in flight", async () => {
      // The flush sends one plan at a time and awaits each. A delete that lands during
      // that await used to be invisible to the rest of the loop, which sent the snapshot
      // it took before starting — and drive.js, having just forgotten the file id, wrote a
      // NEW file. The plan came back on the next load.
      drive.loadSessions.mockResolvedValue(twoPlans());
      vi.spyOn(window, "confirm").mockReturnValue(true);
      drive.deleteSession.mockResolvedValue(undefined);
      let releaseS1;
      drive.saveSession.mockImplementation(({ id }) =>
        id === "s1"
          ? new Promise((resolve) => {
              releaseS1 = () => resolve({ ok: true, id, fileId: "f-s1", modifiedTime: "A2" });
            })
          : Promise.resolve({ ok: true, id, fileId: `f-${id}`, modifiedTime: "B2" }));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "12");
      await goToHash("#/session/s2");
      await setNumber(0, "9");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1); // s1 in flight, s2 still queued

      await act(async () => { findButton("Delete").click(); }); // s2 is the plan on screen
      await act(async () => { releaseS1(); await vi.advanceTimersByTimeAsync(900); });

      expect(drive.deleteSession).toHaveBeenCalledWith({ id: "s2", fileId: "f-s2" });
      expect(drive.saveSession.mock.calls.map(([c]) => c.id)).not.toContain("s2");
      expect(container.textContent).not.toContain("2026-08-14"); // and it stays gone
    });

    it("refuses to delete a plan the old blob still holds, rather than undoing itself", async () => {
      // It has no file to trash and nothing here removes it from sessions.json, so the next
      // load migrated it straight back. A delete that appears to work and then reverses
      // itself is worse than one that says why it cannot.
      drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: initial() }, {
        meta: {}, // no file of its own yet
        unmigrated: [{ id: "s1", reason: "write", error: new Error("boom") }],
      }));
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      await mount();
      await openSession("2026-08-12");

      await act(async () => { findButton("Delete").click(); });

      expect(alertSpy).toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(drive.deleteSession).not.toHaveBeenCalled();
      expect(container.textContent).toContain("2026-08-12"); // still on the builder, still there
    });

    it("a plan deleted while it was queued leaves nothing scheduled behind it", async () => {
      // A deleted plan's id has to leave `dirty` — the flush marks it done when it finds the
      // plan gone, and the delete drops it as well. Lose BOTH and the id stays dirty for
      // good, re-arming the flush timer every 900ms for the rest of the app's life over a
      // write that can never happen.
      drive.loadSessions.mockResolvedValue(twoPlans());
      vi.spyOn(window, "confirm").mockReturnValue(true);
      drive.deleteSession.mockResolvedValue(undefined);
      let releaseS1;
      drive.saveSession.mockImplementation(({ id }) =>
        id === "s1"
          ? new Promise((resolve) => {
              releaseS1 = () => resolve({ ok: true, id, fileId: "f-s1", modifiedTime: "A2" });
            })
          : Promise.resolve({ ok: true, id, fileId: `f-${id}`, modifiedTime: "B2" }));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "12");
      await goToHash("#/session/s2");
      await setNumber(0, "9");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1); // s1 in flight, s2 still queued

      await act(async () => { findButton("Delete").click(); }); // s2 is the plan on screen
      await act(async () => { releaseS1(); await vi.advanceTimersByTimeAsync(2000); });

      expect(drive.saveSession.mock.calls.map(([c]) => c.id)).not.toContain("s2");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("deleting the plan whose own save is in flight leaves nothing scheduled behind it", async () => {
      // The save answers about a plan that has since gone, so the identity check at the end
      // of the flush cannot mark it done. Unless the delete takes the id out of `dirty`
      // itself, it stays there and the timer re-arms for a plan that no longer exists.
      vi.spyOn(window, "confirm").mockReturnValue(true);
      drive.deleteSession.mockResolvedValue(undefined);
      let release;
      drive.saveSession.mockImplementation(({ id }) => new Promise((resolve) => {
        release = () => resolve({ ok: true, id, fileId: `f-${id}`, modifiedTime: "S2" });
      }));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "12");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);

      await act(async () => { findButton("Delete").click(); });
      const scheduled = vi.getTimerCount();
      await act(async () => { release(); });

      // The flush ends with nothing pending, so it does not arm itself again: an id left in
      // `dirty` for a plan that no longer exists re-arms the timer for the rest of the
      // session, every 900ms, over a write that can never happen.
      expect(vi.getTimerCount()).toBe(scheduled);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);
    });

    it("shows a conflict that lands after the builder was left, naming the plan", async () => {
      // Back flushes, so the conflict arrives while the owner is on the session list. A
      // banner rendered only inside the builder and the run view meant he never saw it —
      // and an unresolved conflict he cannot see is one he can never resolve.
      drive.saveSession.mockResolvedValue({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" });
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");

      await act(async () => { findButton("← Back").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(location.hash).toBe("#/sessions"); // on the list, not the builder
      expect(banners()).toMatch(/changed in drive|changed on drive/i);
      expect(banners()).toContain("2026-08-12");
      expect(conflictButton("Keep mine", "2026-08-12")).toBeTruthy();
    });

    it("two conflicts in one flush are both offered, and each is resolved on its own", async () => {
      drive.loadSessions.mockResolvedValue(twoPlans());
      drive.saveSession.mockImplementation(({ id }) => Promise.resolve(
        { ok: false, conflict: true, id, modifiedTime: id === "s1" ? "A9" : "B9" },
      ));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await goToHash("#/session/s2");
      await setNumber(0, "9");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      // Both are named: keeping only the last conflictId lost the first one entirely.
      expect(banners()).toContain("2026-08-12");
      expect(banners()).toContain("2026-08-14");

      drive.saveSession.mockImplementation(saveSessionOk("A10"));
      await act(async () => { conflictButton("Keep mine", "2026-08-12").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Only the plan whose button was pressed is written…
      expect(drive.saveSession.mock.calls.slice(2).map(([c]) => c.id)).toEqual(["s1"]);
      // …and the other plan's conflict is still there, still unwritten.
      expect(banners()).toContain("2026-08-14");
      expect(banners()).not.toContain("2026-08-12");
    });

    it("reloading one plan's version leaves every other plan's unsaved edit alone", async () => {
      // It used to refetch everything and replace the whole state, so answering a conflict
      // on tonight's plan threw away an edit to next week's that had not landed yet.
      drive.loadSessions.mockResolvedValue(twoPlans());
      drive.saveSession.mockImplementation(({ id }) => Promise.resolve(
        id === "s1"
          ? { ok: false, conflict: true, id, modifiedTime: "A9" }
          : { ok: false, id, error: Object.assign(new Error("offline"), { code: 0 }) },
      ));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await goToHash("#/session/s2");
      await setNumber(0, "9");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(banners()).toContain("2026-08-12");           // s1 conflicted
      expect(banners()).toMatch(/could not save/i);        // s2's save failed

      await act(async () => { conflictButton("Reload", "2026-08-12").click(); });

      // Still on s2, and its unsaved turnout is exactly where the owner left it.
      expect(Number(container.querySelectorAll("input[type=number]")[0].value)).toBe(9);
      // s1 has taken Drive's version — that is what Reload means — and is resolved.
      expect(banners()).not.toContain("2026-08-12");
      await goToHash("#/session/s1");
      expect(minutesInput().value).toBe("");
    });

    it("creating a drill cannot discard an unresolved conflict or the edit behind it", async () => {
      // The banner is up and the edit exists only in memory. Tapping New drill instead of
      // answering the banner used to refetch the plans and reset dirty/conflicts with them,
      // so the edit was gone silently and permanently.
      drive.saveSession.mockResolvedValue({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" });
      drive.createDrill.mockResolvedValue({ id: "c", modifiedTime: "T" });
      vi.spyOn(window, "prompt").mockReturnValue("Charlie");
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(banners()).toContain("2026-08-12");

      await goToHash("#/browse");
      await act(async () => { findButton("New drill").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(banners()).toContain("2026-08-12");
      await goToHash("#/session/s1");
      expect(Number(minutesInput().value)).toBe(17);
      // The catalogue was reloaded; the plans were not touched at all.
      expect(drive.loadCatalogue).toHaveBeenCalledTimes(2);
      expect(drive.loadSessions).toHaveBeenCalledTimes(1);
    });

    // Reload takes a whole round trip on his connection, during which nothing visibly
    // happened and both buttons stayed live.
    const conflictOnS1 = async () => {
      drive.saveSession.mockResolvedValue({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" });
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "17");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(banners()).toContain("2026-08-12");
    };

    it("says a Reload is working, and will not let Keep mine race it", async () => {
      // Both resolutions write — Keep mine to Drive, Reload to this device — so answering
      // twice wrote the local version to Drive and then displayed Drive's PRE-write version
      // as clean: content Drive does not have, and a spurious conflict on the next edit.
      await conflictOnS1();
      let release;
      drive.loadSessions.mockImplementation(() => new Promise((resolve) => {
        release = () => resolve(sessionsLoad({ s1: initial() }));
      }));

      await act(async () => { conflictButton("Reload", "2026-08-12").click(); });
      expect(banners()).toMatch(/fetching drive/i);

      await act(async () => { conflictButton("Keep mine", "2026-08-12").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1); // the local version was not written

      await act(async () => { release(); await vi.advanceTimersByTimeAsync(900); });
      // Drive's version landed, the conflict is answered, and nothing else was sent.
      expect(banners()).not.toContain("2026-08-12");
      expect(drive.saveSession).toHaveBeenCalledTimes(1);
      expect(minutesInput().value).toBe("");
    });

    it("double-tapping Reload loads once, not twice", async () => {
      await conflictOnS1();
      let release;
      drive.loadSessions.mockImplementation(() => new Promise((resolve) => {
        release = () => resolve(sessionsLoad({ s1: initial() }));
      }));

      await act(async () => { conflictButton("Reload", "2026-08-12").click(); });
      await act(async () => { conflictButton("Reload", "2026-08-12").click(); });

      // Once on mount, once for the tap that took effect. Two concurrent loads would each
      // rewrite the index and race each other into the state.
      expect(drive.loadSessions).toHaveBeenCalledTimes(2);
      await act(async () => { release(); });
    });

    it("a reload clears the banners the previous load left behind", async () => {
      drive.loadSessions.mockResolvedValueOnce(sessionsLoad(
        { s1: initial() },
        { unmigrated: [{ id: "s1", reason: "write", error: new Error("boom") }] },
      ));
      drive.saveSession.mockResolvedValue({ ok: false, conflict: true, id: "s1", modifiedTime: "S9" });
      await mount();
      expect(container.textContent).toMatch(/not moved into its own file/i);

      await openSession("2026-08-12");
      await setNumber(2, "17");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: initial() }));
      await act(async () => { conflictButton("Reload", "2026-08-12").click(); });
      await goToHash("#/sessions");

      expect(container.textContent).not.toMatch(/not moved into its own file/i);
    });

    // A save that resolves while the plan has been edited again reports a plan Drive does
    // NOT have. Without the identity check at the end of the loop the id would be marked
    // clean and that edit would never be written — the same class of bug as the drill
    // editor's "a save burst mis-reported which edit landed".
    it("an edit made while the save was in flight is written by a second save", async () => {
      let release;
      drive.saveSession.mockImplementation(({ id }) => new Promise((resolve) => {
        release = () => resolve({ ok: true, id, fileId: `f-${id}`, modifiedTime: "S2" });
      }));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "12");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);

      await setNumber(2, "20"); // the owner keeps editing; this write has not answered yet
      drive.saveSession.mockImplementation(saveSessionOk("S3"));
      await act(async () => { release(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(drive.saveSession).toHaveBeenCalledTimes(2);
      const second = drive.saveSession.mock.calls[1][0];
      expect(second.session.blocks[1].minutes).toBe(20);
      expect(second.baseModifiedTime).toBe("S2"); // against what the first write left
    });

    // Two flushes overlapping would send the same plan twice against the same baseline,
    // and Drive reports the second as a conflict against our own first write — a conflict
    // prompt for a plan nobody else touched.
    it("does not start a second flush while one is still in flight", async () => {
      let release;
      drive.saveSession.mockImplementation(({ id }) => new Promise((resolve) => {
        release = () => resolve({ ok: true, id, fileId: `f-${id}`, modifiedTime: "S2" });
      }));
      await mount();
      await openSession("2026-08-12");
      await setNumber(2, "12");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);

      // Back flushes on the way out, with the first write still unanswered.
      await act(async () => { findButton("← Back").click(); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);

      await act(async () => { release(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession.mock.calls.map(([c]) => c.baseModifiedTime)).toEqual(["S1"]);
      expect(container.textContent).not.toMatch(/changed in drive|changed on drive/i);
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
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: runSessionFixture() }));
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
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12", [
        { slot: "warmup", drill: "ghost", minutes: null, note: "" },
        { slot: "skill", drill: null, minutes: null, note: "" },
        { slot: "tactical", drill: "a", minutes: null, note: "" },
        { slot: "match", drill: null, minutes: null, note: "" },
        { slot: "fun", drill: null, minutes: null, note: "" },
      ]) }));
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
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
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
      const saved = drive.saveSession.mock.calls.at(-1)[0];
      expect(saved.session.blocks[0].drill).toBe("c");
      expect(saved.session.blocks[0].minutes).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a swap to a drill already loaded this visit does not refetch it", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
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
    drive.loadSessions.mockResolvedValue(sessionsLoad({
        s1: session("s1", "2026-08-12", [{ slot: "warmup", drill: "a", minutes: null, note: "" }]),
        s2: session("s2", "2026-08-14", [{ slot: "warmup", drill: "b", minutes: null, note: "" }]),
      }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
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

  it("a mark made during a run is saved into that session's file only", async () => {
    // A Done tap at the side of a pitch used to rewrite every plan ever made. Loading a
    // second plan here is what proves it now writes one file.
    drive.loadSessions.mockResolvedValue(sessionsLoad({
      s1: runSessionFixture(),
      s2: session("s2", "2026-08-14"),
    }));
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSession).toHaveBeenCalledTimes(1);
      const saved = drive.saveSession.mock.calls.at(-1)[0];
      expect(saved.id).toBe("s1");
      // Keyed by the day the run happened, which is today — NOT the session's planned
      // date (2026-08-12), so re-running this plan another day starts clean.
      const days = Object.keys(saved.session.progress);
      expect(days).toHaveLength(1);
      // Keyed by the block's slot, not its position: reordering the plan must not move
      // this mark onto another drill.
      expect(saved.session.progress[days[0]].marks).toEqual({ warmup: "done" });
      expect(saved.session.progress[days[0]].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("progress made on another device shows when the run view opens", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: {
        ...runSessionFixture(),
        progress: { [new Date().toISOString().slice(0, 10)]: {
          marks: { 0: "done" }, updatedAt: new Date().toISOString(),
        } },
      } }));
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    const first = container.querySelectorAll(".run-block")[0];
    expect(first.querySelector(".run-block-summary").textContent).toContain("Done");
  });

  it("a failed save is visible from the run view, not only from the builder", async () => {
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockResolvedValue({ ok: false, id: "s1", error: new Error("offline") });
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

  it("phone to laptop: marks made in one browser appear in another", async () => {
    // "The phone": mark a block, let the save land, and capture exactly what went to Drive.
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
    vi.useFakeTimers();
    let sentToDrive;
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      sentToDrive = drive.saveSession.mock.calls.at(-1)[0].session;
    } finally {
      vi.useRealTimers();
    }

    // "The laptop": a different browser is an empty localStorage, and Drive now returns
    // what the phone wrote. Tear the app down completely to be sure nothing in memory
    // carries the answer across.
    act(() => root.unmount());
    localStorage.clear();
    location.hash = "";
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: sentToDrive }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    const blocks = container.querySelectorAll(".run-block");
    expect(blocks[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(blocks[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("a hand-edited progress block survives opening the run view", async () => {
    // The owner reads and edits sessions.json by hand. An entry with no updatedAt used to
    // be reported upward as {}, which App then saved — deleting his marks.
    const day = new Date().toISOString().slice(0, 10);
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: {
        ...runSessionFixture(),
        progress: { [day]: { marks: { 0: "done", 1: "skipped" } } },
      } }));
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      const summaries = [...container.querySelectorAll(".run-block-summary")];
      expect(summaries[0].textContent).toContain("Done");
      expect(summaries[1].textContent).toContain("Skipped");
      for (const [arg] of drive.saveSession.mock.calls) {
        expect(arg.session.progress[day].marks).toEqual({ 0: "done", 1: "skipped" });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("a mark cleared on the laptop stays cleared when the phone comes back to it", async () => {
    // The reported bug: "every mark cleared" used to be stored exactly like "no marks
    // yet", so the phone's older stamped mark won the merge and the block came back Done.
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
    const PROGRESS_KEY = "ballislife_progress";
    let phoneStorage;
    let sentToDrive;

    // "The phone": mark block 0 Done and let the save land.
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      sentToDrive = drive.saveSession.mock.calls.at(-1)[0].session;
      phoneStorage = localStorage.getItem(PROGRESS_KEY);

      // "The laptop": its own empty storage, adopting the phone's mark and then un-marking.
      act(() => root.unmount());
      localStorage.clear();
      location.hash = "";
      drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: sentToDrive }));
      await mount();
      await openSession("2026-08-12");
      await act(async () => { findButton("Run this session").click(); });
      await act(async () => { findButton("Not done").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      sentToDrive = drive.saveSession.mock.calls.at(-1)[0].session;
    } finally {
      vi.useRealTimers();
    }

    // "The phone" again: its own storage still holds the earlier Done.
    act(() => root.unmount());
    localStorage.setItem(PROGRESS_KEY, phoneStorage);
    location.hash = "";
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: sentToDrive }));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    const blocks = container.querySelectorAll(".run-block");
    expect(blocks[0].querySelector(".run-block-summary").textContent).not.toContain("Done");
    expect(blocks[0].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("a mark survives reordering the plan: it stays on its own drill", async () => {
    // The bug, by the only route it actually happens: run, back to the plan, reorder,
    // run again. Marks used to be keyed by position, so the reorder moved "Done" onto
    // whichever drill took that position.
    drive.readDrill.mockImplementation((id) => Promise.resolve({ text: bodyText(id), modifiedTime: "T" }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    // Mark the warm-up (drill a) done.
    await act(async () => { findButton("Done").click(); });
    // Back to the plan, move the skill block above the warm-up, and run it again. Row 0
    // has no "Move up" control, so the first one belongs to row 1 — the skill block.
    await act(async () => { findButton("Back to plan").click(); });
    const moveUp = [...container.querySelectorAll("button")]
      .filter((b) => b.getAttribute("aria-label") === "Move up");
    await act(async () => { moveUp[0].click(); });
    await act(async () => { findButton("Run this session").click(); });

    const rows = container.querySelectorAll(".run-block");
    // The skill block is first now, and is the one to do next — the warm-up stays done.
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("skill");
    expect(rows[0].querySelector(".run-block-now-badge")).not.toBeNull();
    expect(rows[1].querySelector(".run-block-summary").textContent).toContain("Done");
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

// The Drills/Sessions switch used to be rendered by the browse view alone, so it could
// only ever be tapped from the browse view. In the header it is one tap away from inside
// the editor, the builder and the run view — the states it never had to leave before.
describe("App header", () => {
  it("goes home from the drill editor, leaving it rather than stranding the owner in it", async () => {
    drive.readDrill.mockResolvedValue({ text: "---\ntitle: Alpha\n---\n\nAlpha body\n", modifiedTime: "T" });
    await mount();
    await openEditFor("Alpha");
    expect(container.querySelector("textarea")).not.toBeNull();
    await act(async () => { findButton("ball.is.life").click(); });
    expect(container.querySelector("textarea")).toBe(null);
    expect(container.textContent).toContain("Bravo"); // the grid is back
    expect(location.hash).toBe("#/");
  });

  it("goes home from the run view, and the run view does not come back", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12", [
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: null, minutes: null, note: "" },
      { slot: "tactical", drill: null, minutes: null, note: "" },
      { slot: "match", drill: null, minutes: null, note: "" },
      { slot: "fun", drill: null, minutes: null, note: "" },
    ]) }));
    drive.readDrill.mockResolvedValue({ text: "---\ntitle: Alpha\n---\n\nbody a\n", modifiedTime: "T" });
    await mount();
    await openSession("2026-08-12");
    await act(async () => { findButton("Run this session").click(); });
    expect(container.textContent).toContain("body a");
    await act(async () => { findButton("ball.is.life").click(); });
    expect(container.textContent).not.toContain("body a");
    expect(container.textContent).toContain("Bravo");
    expect(location.hash).toBe("#/");
  });

  it("switches to Sessions from inside a drill, not only from the grid", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12") }));
    drive.readDrill.mockResolvedValue({ text: "---\ntitle: Alpha\n---\n\nAlpha body\n", modifiedTime: "T" });
    await mount();
    await openCard("Alpha");
    expect(container.textContent).toContain("Alpha body");
    await act(async () => { findButton("Sessions").click(); });
    expect(container.textContent).not.toContain("Alpha body");
    expect(container.textContent).toContain("2026-08-12");
  });

  it("says on the Sessions control that a session is under way, wherever the owner is", async () => {
    const today = new Date().toISOString().slice(0, 10);
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: {
      ...session("s1", today, [
        { slot: "warmup", drill: "a", minutes: null, note: "" },
        { slot: "skill", drill: "b", minutes: null, note: "" },
      ]),
      // Marked on the other device: one block done, one still to go.
      progress: { [today]: { marks: { warmup: "done" }, updatedAt: `${today}T19:00:00.000Z` } },
    } }));
    drive.readDrill.mockResolvedValue({ text: "---\ntitle: Alpha\n---\n\nAlpha body\n", modifiedTime: "T" });
    await mount();
    // On the grid, nowhere near the session — which is the point.
    expect(findButton("Sessions").querySelector(".nav-dot")).not.toBeNull();
    await openCard("Alpha");
    expect(findButton("Sessions").querySelector(".nav-dot")).not.toBeNull();
    // And the same plan is the one marked on the sessions page — one derivation, so the
    // header and the list cannot name different plans.
    await act(async () => { findButton("Sessions").click(); });
    const row = container.querySelector(".session-row-active");
    expect(row).not.toBeNull();
    expect(row.textContent).toContain(today);
    expect(row.textContent).toContain("Resume");
  });
});

describe("App squads", () => {
  const squad = (id, name, players = []) => ({ id, name, players });
  const squadsLoad = (squads, extra = {}) => ({
    squads, fileId: "sq", modifiedTime: "Q1", failed: null, ...extra,
  });

  const openSquads = async () => {
    await act(async () => { findButton("Squads").click(); });
  };
  const openSquad = async (name) => {
    await openSquads();
    await act(async () => { findButton(name).click(); });
  };
  const banners = () => [...container.querySelectorAll(".banner")].map((b) => b.textContent).join(" ");
  const typeSquadName = async (value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const input = container.querySelector(".squad-name");
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("loads the squads and lists them in their own section", async () => {
    drive.loadSquads.mockResolvedValue(squadsLoad({ u14a: squad("u14a", "U14A Boys") }));
    await mount();
    expect(drive.loadSquads).toHaveBeenCalledWith("F1");
    await openSquads();
    expect(container.textContent).toContain("U14A Boys");
  });

  it("opens one squad from its own URL, and falls back to the list for an id that is gone", async () => {
    drive.loadSquads.mockResolvedValue(squadsLoad({ u14a: squad("u14a", "U14A Boys") }));
    location.hash = "#/squad/u14a";
    await mount();
    expect(container.querySelector(".squad-name").value).toBe("U14A Boys");

    await act(async () => {
      location.hash = "#/squad/does-not-exist";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(location.hash).toBe("#/squads");
  });

  it("keeps the drills and the plans on screen when the squads fail to load", async () => {
    // Its own try/catch for the same reason the sessions load has one: a flaky request for
    // a list of names must not replace an app that has already loaded everything else.
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12") }));
    drive.loadSquads.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    await mount();
    expect(container.textContent).toContain("Alpha");
    expect(banners()).toMatch(/squads could not be loaded/i);
    await act(async () => { findButton("Sessions").click(); });
    expect(container.textContent).toContain("2026-08-12");
  });

  it("holds every save when the squads load THREW, rather than creating a second file", async () => {
    // A load that threw leaves us knowing nothing about squads.json — including whether
    // there is one. Left as "no file yet", the next save takes the create path and writes a
    // SECOND squads.json, after which loadSquads reads whichever the listing returns first.
    drive.loadSquads.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    vi.spyOn(window, "prompt").mockReturnValue("U14A Boys");
    vi.useFakeTimers();
    try {
      await mount();
      await openSquads();
      await act(async () => { findButton("New squad").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

      expect(drive.saveSquads).not.toHaveBeenCalled();
      // The edit is not thrown away, and the banner says both true things: what failed, and
      // that nothing will be written until it works.
      expect(container.querySelector(".squad-name").value).toBe("U14A Boys");
      expect(banners()).toMatch(/squads could not be loaded/i);
      expect(banners()).toMatch(/this device only/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a new squad from a name, with an id of its own", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("U14A Boys");
    drive.saveSquads.mockResolvedValue({ ok: true, fileId: "sq", modifiedTime: "Q2" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSquads();
      await act(async () => { findButton("New squad").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(drive.saveSquads).toHaveBeenCalledTimes(1);
      const call = drive.saveSquads.mock.calls[0][0];
      expect(Object.keys(call.data)).toEqual(["u14a-boys"]);
      expect(call.data["u14a-boys"]).toEqual({ id: "u14a-boys", name: "U14A Boys", players: [] });
      expect(call.baseModifiedTime).toBe(null);
      expect(call.fileId).toBe(null); // no squads.json yet: this save creates it
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounces an edit and adopts the baseline the save reports", async () => {
    drive.loadSquads.mockResolvedValue(squadsLoad({ u14a: squad("u14a", "U14A Boys") }));
    drive.saveSquads
      .mockResolvedValueOnce({ ok: true, fileId: "sq", modifiedTime: "Q2" })
      .mockResolvedValueOnce({ ok: true, fileId: "sq", modifiedTime: "Q3" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSquad("U14A Boys");
      await typeSquadName("U14A");
      await typeSquadName("U14A Boy");
      expect(drive.saveSquads).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSquads).toHaveBeenCalledTimes(1);
      expect(drive.saveSquads.mock.calls[0][0].baseModifiedTime).toBe("Q1");

      await typeSquadName("U14A Boys 2027");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      // Sending Q1 again would conflict with the write this save just made.
      expect(drive.saveSquads.mock.calls[1][0].baseModifiedTime).toBe("Q2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("NEVER overwrites a squads.json it could not read, and says why", async () => {
    // Silently overwriting an unreadable file is how a corrupt sessions.json nearly lost
    // every plan. An unreadable squad list holds every save until Drive is fixed.
    drive.loadSquads.mockResolvedValue(squadsLoad({}, { failed: { reason: "parse", error: null } }));
    vi.spyOn(window, "prompt").mockReturnValue("U14A Boys");
    vi.useFakeTimers();
    try {
      await mount();
      expect(banners()).toMatch(/squads\.json/i);
      await openSquads();
      await act(async () => { findButton("New squad").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(drive.saveSquads).not.toHaveBeenCalled();
      // And what he typed is still on screen, not thrown away.
      expect(container.querySelector(".squad-name").value).toBe("U14A Boys");
      expect(banners()).toMatch(/squads\.json/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a conflict keeps the local squad and offers to keep it", async () => {
    drive.loadSquads.mockResolvedValue(squadsLoad({ u14a: squad("u14a", "U14A Boys") }));
    drive.saveSquads.mockResolvedValueOnce({ ok: false, conflict: true, modifiedTime: "Q9" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSquad("U14A Boys");
      await typeSquadName("U14A Girls");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(banners()).toMatch(/changed in drive|changed on drive/i);
      expect(container.querySelector(".squad-name").value).toBe("U14A Girls");

      // Not re-sent by a later edit — only answering the banner may write.
      await typeSquadName("U14A Girls B");
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSquads).toHaveBeenCalledTimes(1);

      drive.saveSquads.mockResolvedValue({ ok: true, fileId: "sq", modifiedTime: "Q10" });
      await act(async () => { findButton("Keep mine").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(drive.saveSquads).toHaveBeenCalledTimes(2);
      expect(drive.saveSquads.mock.calls[1][0].baseModifiedTime).toBe("Q9");
      expect(drive.saveSquads.mock.calls[1][0].data.u14a.name).toBe("U14A Girls B");
    } finally {
      vi.useRealTimers();
    }
  });

  it("links a plan's free-text squad to the squad of that name, without saving a thing", async () => {
    // Linking touches every plan. Marking them all dirty would fire one write per plan the
    // moment the app opens, on the connection least able to take it — so the link is made
    // in memory and carried to Drive by the next real edit to that plan.
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12") }));
    drive.loadSquads.mockResolvedValue(squadsLoad({ u12: squad("u12", "U12s") }));
    vi.useFakeTimers();
    try {
      await mount();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(drive.saveSession).not.toHaveBeenCalled();

      // The link is real, though: the builder's picker shows the plan is for that squad.
      await openSession("2026-08-12");
      const picker = [...container.querySelectorAll("select")]
        .find((s) => [...s.options].some((o) => /no squad/i.test(o.textContent)));
      expect(picker.value).toBe("u12");
    } finally {
      vi.useRealTimers();
    }
  });

  it("switching to Squads mid-edit flushes the plan rather than stranding the edit", async () => {
    drive.loadSessions.mockResolvedValue(sessionsLoad({ s1: session("s1", "2026-08-12") }));
    drive.saveSession.mockImplementation(saveSessionOk("S2"));
    vi.useFakeTimers();
    try {
      await mount();
      await openSession("2026-08-12");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const turnout = container.querySelectorAll("input[type=number]")[0];
      await act(async () => {
        setter.call(turnout, "9");
        turnout.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(drive.saveSession).not.toHaveBeenCalled(); // debounce has not fired

      await act(async () => { findButton("Squads").click(); });

      expect(drive.saveSession).toHaveBeenCalledTimes(1);
      expect(drive.saveSession.mock.calls[0][0].session.turnout).toBe(9);
      expect(location.hash).toBe("#/squads");
      expect(container.textContent).not.toContain("2026-08-12"); // the builder is gone
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaving a squad mid-edit writes it, rather than dropping what was typed", async () => {
    drive.loadSquads.mockResolvedValue(squadsLoad({ u14a: squad("u14a", "U14A Boys") }));
    drive.saveSquads.mockResolvedValue({ ok: true, fileId: "sq", modifiedTime: "Q2" });
    vi.useFakeTimers();
    try {
      await mount();
      await openSquad("U14A Boys");
      await typeSquadName("U14A Girls");
      expect(drive.saveSquads).not.toHaveBeenCalled();

      await act(async () => { findButton("← Back").click(); });

      expect(drive.saveSquads).toHaveBeenCalledTimes(1);
      expect(drive.saveSquads.mock.calls[0][0].data.u14a.name).toBe("U14A Girls");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not carry a half-typed name from one squad to the next", async () => {
    // The editor holds the in-progress text for a row keyed by player id, and App swaps the
    // squad underneath it without unmounting. Two squads whose players share an id — the
    // ordinary case, since ids are made from names — then showed squad A's cleared draft on
    // squad B's row: a wrong name, in an editable field, one keystroke from being saved.
    drive.loadSquads.mockResolvedValue(squadsLoad({
      a: squad("a", "Alpha Squad", [{ id: "sean-ryan", name: "Sean Ryan" }]),
      b: squad("b", "Bravo Squad", [{ id: "sean-ryan", name: "Sean Ryan (B)" }]),
    }));
    drive.saveSquads.mockResolvedValue({ ok: true, fileId: "sq", modifiedTime: "Q2" });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const typeInput = async (el, value) => {
      await act(async () => {
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    location.hash = "#/squad/a";
    await mount();

    await typeInput(container.querySelector(".squad-player input"), "");
    await typeInput(container.querySelector(".squad-add input"), "Ali Khan");

    await act(async () => {
      location.hash = "#/squad/b";
      window.dispatchEvent(new Event("hashchange"));
    });

    expect(container.querySelector(".squad-name").value).toBe("Bravo Squad");
    expect(container.querySelector(".squad-player input").value).toBe("Sean Ryan (B)");
    expect(container.querySelector(".squad-add input").value).toBe("");
  });

  it("deletes a squad only after confirmation", async () => {
    drive.loadSquads.mockResolvedValue(squadsLoad({ u14a: squad("u14a", "U14A Boys") }));
    drive.saveSquads.mockResolvedValue({ ok: true, fileId: "sq", modifiedTime: "Q2" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.useFakeTimers();
    try {
      await mount();
      await openSquad("U14A Boys");
      await act(async () => { findButton("Delete").click(); });
      expect(confirmSpy).toHaveBeenCalled();
      expect(container.querySelector(".squad-name")).not.toBeNull(); // still on the squad

      confirmSpy.mockReturnValue(true);
      await act(async () => { findButton("Delete").click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(drive.saveSquads.mock.calls.at(-1)[0].data).toEqual({});
      expect(location.hash).toBe("#/squads");
    } finally {
      vi.useRealTimers();
    }
  });
});

// Before sign-in there is nothing to navigate to and nothing to be told, so the screen is
// the button and nothing else — no header, no sections, no version. Everything the header
// offers is about a catalogue that has not been loaded yet.
describe("App signed out", () => {
  beforeEach(() => { auth.isSignedIn.mockReturnValue(false); });

  it("shows the sign-in control and nothing else", async () => {
    await mount();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Sign in");
    // No way home, no sections, no version: the header is not rendered at all.
    expect(container.querySelector(".app-header")).toBe(null);
    expect(container.textContent).not.toContain("ball.is.life");
    expect(container.textContent).not.toContain("test"); // __APP_VERSION__
  });

  it("signs in from it", async () => {
    auth.signIn.mockResolvedValue(true);
    await mount();
    await act(async () => { findButton("Sign in").click(); });
    expect(auth.signIn).toHaveBeenCalled();
    expect(container.textContent).toContain("Alpha");
  });
});
