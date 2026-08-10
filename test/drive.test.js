import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../src/lib/driveApi.js";
import * as auth from "../src/lib/driveAuth.js";
import { loadCatalogue, saveDrill, FOLDER_NAME, INDEX_NAME } from "../src/lib/drive.js";

vi.mock("../src/lib/driveApi.js");
vi.mock("../src/lib/driveAuth.js");

const DRILL = "---\ntitle: A\n---\n\nbody\n";

beforeEach(() => {
  vi.resetAllMocks();
  auth.getAccessToken.mockReturnValue("tok");
  auth.ensureFreshToken.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("loadCatalogue", () => {
  it("creates the folder when it does not exist", async () => {
    api.findFolder.mockResolvedValue(null);
    api.createFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.writeFile.mockResolvedValue("T");
    await loadCatalogue();
    expect(api.createFolder).toHaveBeenCalledWith("tok", FOLDER_NAME);
  });

  it("reads only the files whose modifiedTime moved", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T1" },
      { id: "b", name: "b.md", modifiedTime: "T2" },
    ]);
    const cached = {
      version: 1,
      entries: { a: { name: "a.md", modifiedTime: "T1", meta: { title: "A" }, thumb: null, invalid: null } },
    };
    api.readFile.mockImplementation(async (_t, id) => (id === "idx" ? JSON.stringify(cached) : DRILL));
    api.writeFile.mockResolvedValue("T");

    const { drills } = await loadCatalogue();
    const read = api.readFile.mock.calls.map((c) => c[1]);
    expect(read).toContain("b");
    expect(read).not.toContain("a");
    expect(drills.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("rebuilds from scratch when the index is unreadable", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T1" },
    ]);
    api.readFile.mockImplementation(async (_t, id) => (id === "idx" ? "{{{" : DRILL));
    api.writeFile.mockResolvedValue("T");
    const { drills } = await loadCatalogue();
    expect(drills.map((d) => d.id)).toEqual(["a"]);
  });

  it("tolerates a missing index file", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    api.readFile.mockResolvedValue(DRILL);
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    const { drills } = await loadCatalogue();
    expect(drills).toHaveLength(1);
  });

  it("retries once after a 401, then succeeds", async () => {
    api.findFolder
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    await expect(loadCatalogue()).resolves.toBeTruthy();
    expect(api.findFolder).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-auth failure", async () => {
    api.findFolder.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    await expect(loadCatalogue()).rejects.toMatchObject({ code: 500 });
    expect(api.findFolder).toHaveBeenCalledTimes(1);
  });
});

describe("saveDrill", () => {
  it("writes the file and returns the new modifiedTime", async () => {
    api.writeFile.mockResolvedValue("T9");
    const r = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T1", currentModifiedTime: "T1" });
    expect(r).toEqual({ ok: true, modifiedTime: "T9" });
    expect(api.writeFile).toHaveBeenCalledWith("tok", "a", "x");
  });

  it("refuses to overwrite when the file moved underneath it", async () => {
    const r = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T1", currentModifiedTime: "T2" });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("collapses rapid saves of one file, writing the newest text last", async () => {
    // A burst of keystrokes must not issue one write per character. Exactly how many
    // writes happen depends on timing — in practice a tight burst collapses to a single
    // write — so assert what actually matters rather than a fragile call count.
    api.writeFile.mockResolvedValue("T2");
    const results = await Promise.all([
      saveDrill({ id: "a", text: "one", baseModifiedTime: "T1", currentModifiedTime: "T1" }),
      saveDrill({ id: "a", text: "two", baseModifiedTime: "T1", currentModifiedTime: "T1" }),
      saveDrill({ id: "a", text: "three", baseModifiedTime: "T1", currentModifiedTime: "T1" }),
    ]);
    const written = api.writeFile.mock.calls.map((c) => c[2]);
    expect(written.length).toBeLessThan(3);
    expect(written[written.length - 1]).toBe("three");
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("recovers after a failed write instead of wedging the queue", async () => {
    api.writeFile
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 500 }))
      .mockResolvedValue("T5");
    const first = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T", currentModifiedTime: "T" });
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe(500);
    const second = await saveDrill({ id: "a", text: "y", baseModifiedTime: "T", currentModifiedTime: "T" });
    expect(second).toMatchObject({ ok: true, modifiedTime: "T5" });
  });

  it("queues per file, so two files do not block each other", async () => {
    api.writeFile.mockResolvedValue("T2");
    await Promise.all([
      saveDrill({ id: "a", text: "x", baseModifiedTime: "T", currentModifiedTime: "T" }),
      saveDrill({ id: "b", text: "y", baseModifiedTime: "T", currentModifiedTime: "T" }),
    ]);
    expect(api.writeFile.mock.calls.map((c) => c[1]).sort()).toEqual(["a", "b"]);
  });
});
