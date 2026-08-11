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
  api.aboutEmail.mockResolvedValue("owner@example.com");
  owner.isOwner.mockResolvedValue(true);
  drive.loadCatalogue.mockResolvedValue({
    drills: [drill("a", "Alpha"), drill("b", "Bravo")],
    failed: [], folderId: "F1", duplicateFolders: false, index: { version: 1, entries: {} },
  });
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
