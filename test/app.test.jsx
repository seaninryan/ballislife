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

const openCard = async (title) => {
  const button = [...container.querySelectorAll("button")]
    .find((b) => b.textContent.includes(title));
  await act(async () => { button.click(); });
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
