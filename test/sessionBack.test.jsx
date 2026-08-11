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
let container, root;
const SESSION = { id: "2026-08-12", date: "2026-08-12", squad: "U14A Boys", theme: "", length: 75, turnout: null,
  blocks: [{ slot: "warmup", drill: null, minutes: null, note: "" }] };
beforeEach(() => {
  vi.resetAllMocks();
  location.hash = "";
  container = document.createElement("div"); document.body.appendChild(container);
  auth.initAuth.mockResolvedValue(true); auth.isSignedIn.mockReturnValue(true);
  auth.getAccessToken.mockReturnValue("tok"); auth.startTokenKeepAlive.mockImplementation(() => {});
  api.aboutEmail.mockResolvedValue("o@e.com"); owner.isOwner.mockResolvedValue(true);
  drive.loadCatalogue.mockResolvedValue({ drills: [], failed: [], folderId: "F1", duplicateFolders: false, index: { version: 1, entries: {} } });
  drive.loadSessions.mockResolvedValue({ fileId: "s", data: { version: 1, sessions: { "2026-08-12": SESSION } }, modifiedTime: "T" });
  drive.saveSessions.mockResolvedValue({ ok: true, fileId: "s", modifiedTime: "T2" });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });
const click = async (label) => {
  const b = [...container.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(label));
  if (!b) throw new Error(`no button "${label}" — saw: ${[...container.querySelectorAll("button")].map(x=>x.textContent.trim()).join(" | ")}`);
  await act(async () => { b.click(); });
};
describe("back from the session builder", () => {
  it("returns to the session list and updates the url", async () => {
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await click("Sessions");
    await click("2026-08-12");
    expect(location.hash).toBe("#/session/2026-08-12");
    await click("← Back");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(location.hash).toBe("#/sessions");
    expect(container.textContent).toContain("New session");
    expect(container.querySelector("textarea")).toBe(null);
  });
});
