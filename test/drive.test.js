import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../src/lib/driveApi.js";
import * as auth from "../src/lib/driveAuth.js";
import {
  loadCatalogue, saveDrill, noteModifiedTime, knownModifiedTime, readDrill, FOLDER_NAME, INDEX_NAME,
  createDrill, deleteDrill,
} from "../src/lib/drive.js";

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
    api.findAllFolders.mockResolvedValue([]);
    api.createFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.writeFile.mockResolvedValue("T");
    await loadCatalogue();
    expect(api.createFolder).toHaveBeenCalledWith("tok", FOLDER_NAME);
  });

  it("reads only the files whose modifiedTime moved", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
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
    api.findAllFolders.mockResolvedValue(["F1"]);
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
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    api.readFile.mockResolvedValue(DRILL);
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    const { drills } = await loadCatalogue();
    expect(drills).toHaveLength(1);
  });

  it("keeps the rest of the catalogue when one drill fails to download", async () => {
    // One flaky read on a phone must not cost every drill.
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([
      { id: "good1", name: "good1.md", modifiedTime: "T1" },
      { id: "bad", name: "bad.md", modifiedTime: "T1" },
      { id: "good2", name: "good2.md", modifiedTime: "T1" },
    ]);
    api.readFile.mockImplementation(async (_t, id) => {
      if (id === "bad") throw Object.assign(new Error("flaky"), { code: 500 });
      return DRILL;
    });
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });

    const { drills, failed } = await loadCatalogue();
    expect(drills.map((d) => d.id).sort()).toEqual(["good1", "good2"]);
    expect(failed.map((f) => f.id)).toEqual(["bad"]);
  });

  it("keeps a stale cached entry when its refetch fails, and retries next load", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T2" },
    ]);
    const cached = {
      version: 1,
      entries: { a: { name: "a.md", modifiedTime: "T1", meta: { title: "Old" }, thumb: null, invalid: null } },
    };
    api.readFile.mockImplementation(async (_t, id) => {
      if (id === "idx") return JSON.stringify(cached);
      throw Object.assign(new Error("flaky"), { code: 500 });
    });
    api.writeFile.mockResolvedValue("T");

    const { drills, index } = await loadCatalogue();
    expect(drills.map((d) => d.title)).toEqual(["Old"]);
    // The OLD modifiedTime is kept, so the next load notices the mismatch and retries.
    expect(index.entries.a.modifiedTime).toBe("T1");
  });

  it("lets a 401 during a drill read reach the retry rather than failing that drill", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    let reads = 0;
    api.readFile.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) throw Object.assign(new Error("auth"), { code: 401 });
      return DRILL;
    });
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });

    const { drills, failed } = await loadCatalogue();
    expect(drills).toHaveLength(1);
    expect(failed).toEqual([]);
  });

  it("retries once after a 401, then succeeds", async () => {
    api.findAllFolders
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    await expect(loadCatalogue()).resolves.toBeTruthy();
    expect(api.findAllFolders).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-auth failure", async () => {
    api.findAllFolders.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    await expect(loadCatalogue()).rejects.toMatchObject({ code: 500 });
    expect(api.findAllFolders).toHaveBeenCalledTimes(1);
  });
});

describe("readDrill", () => {
  it("fetches the file text and records its modifiedTime", async () => {
    api.readFile.mockResolvedValue("---\ntitle: A\n---\n\nbody\n");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T7" }]);
    api.findFolder.mockResolvedValue("F1");
    const r = await readDrill("a", "F1");
    expect(r.text).toContain("title: A");
    expect(r.modifiedTime).toBe("T7");
    expect(knownModifiedTime("a")).toBe("T7");
  });

  it("retries once on a 401", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    api.readFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue("text");
    await expect(readDrill("a", "F1")).resolves.toBeTruthy();
  });
});

describe("duplicate folders", () => {
  it("warns when more than one BallIsLife folder exists", async () => {
    api.findAllFolders.mockResolvedValue(["F1", "F2"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    const { duplicateFolders } = await loadCatalogue();
    expect(duplicateFolders).toBe(true);
  });

  it("reports no duplicates in the normal case", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    expect((await loadCatalogue()).duplicateFolders).toBe(false);
  });
});

describe("saveDrill", () => {
  it("writes the file and returns the new modifiedTime", async () => {
    noteModifiedTime("a", "T1");
    api.writeFile.mockResolvedValue("T9");
    const r = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T1" });
    expect(r).toEqual({ ok: true, modifiedTime: "T9" });
    expect(api.writeFile).toHaveBeenCalledWith("tok", "a", "x");
    // drive.js now knows the new value, so the next save can use it as its baseline.
    expect(knownModifiedTime("a")).toBe("T9");
  });

  it("refuses to overwrite when the file moved underneath it", async () => {
    noteModifiedTime("a", "T2");
    const r = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T1" });
    expect(r).toMatchObject({ ok: false, conflict: true, modifiedTime: "T2" });
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("saves a file it has never seen, having no baseline to contradict", async () => {
    api.writeFile.mockResolvedValue("T1");
    const r = await saveDrill({ id: "brand-new", text: "x", baseModifiedTime: undefined });
    expect(r).toMatchObject({ ok: true, modifiedTime: "T1" });
  });

  it("collapses rapid saves of one file, writing the newest text last", async () => {
    noteModifiedTime("a", "T1");
    api.writeFile.mockResolvedValue("T2");
    const results = await Promise.all([
      saveDrill({ id: "a", text: "one", baseModifiedTime: "T1" }),
      saveDrill({ id: "a", text: "two", baseModifiedTime: "T1" }),
      saveDrill({ id: "a", text: "three", baseModifiedTime: "T1" }),
    ]);
    const written = api.writeFile.mock.calls.map((c) => c[2]);
    expect(written.length).toBeLessThan(3);
    expect(written[written.length - 1]).toBe("three");
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("tells every caller in a burst which modifiedTime actually landed", async () => {
    // The caller whose text won the burst previously got no modifiedTime at all, so it
    // could not refresh its baseline and its next save conflicted against itself.
    noteModifiedTime("a", "T0");
    let release;
    let n = 0;
    api.writeFile.mockImplementation(async (_t, _id, text) => {
      n += 1;
      if (n === 1) { await new Promise((r) => { release = r; }); return "T-first"; }
      return `T-${text}`;
    });
    const first = saveDrill({ id: "a", text: "first", baseModifiedTime: "T0" });
    await new Promise((r) => setTimeout(r, 0));
    const second = saveDrill({ id: "a", text: "second", baseModifiedTime: "T0" });
    const third = saveDrill({ id: "a", text: "third", baseModifiedTime: "T0" });
    release();
    const results = await Promise.all([first, second, third]);
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(typeof r.modifiedTime).toBe("string");
    }
    expect(knownModifiedTime("a")).toBe("T-third");
  });

  it("recovers after a failed write instead of wedging the queue", async () => {
    noteModifiedTime("a", "T");
    api.writeFile
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 500 }))
      .mockResolvedValue("T5");
    const first = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T" });
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe(500);
    const second = await saveDrill({ id: "a", text: "y", baseModifiedTime: "T" });
    expect(second).toMatchObject({ ok: true, modifiedTime: "T5" });
  });

  it("queues per file, so two files do not block each other", async () => {
    noteModifiedTime("a", "T");
    noteModifiedTime("b", "T");
    api.writeFile.mockResolvedValue("T2");
    await Promise.all([
      saveDrill({ id: "a", text: "x", baseModifiedTime: "T" }),
      saveDrill({ id: "b", text: "y", baseModifiedTime: "T" }),
    ]);
    expect(api.writeFile.mock.calls.map((c) => c[1]).sort()).toEqual(["a", "b"]);
  });
});

describe("createDrill", () => {
  it("writes a starter drill and returns its id", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "NEW", modifiedTime: "T1" });
    api.writeFile.mockResolvedValue("T1");

    const r = await createDrill("F1", "Rondo 4v2", ["other.md"]);
    expect(r.id).toBe("NEW");
    const [, , name, text] = api.createFile.mock.calls[0];
    expect(name).toBe("rondo-4v2.md");
    expect(text).toContain("title: Rondo 4v2");
    expect(text).toContain("```pitch");
    expect(knownModifiedTime("NEW")).toBe("T1");
  });

  it("avoids colliding with a name already in the folder", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "NEW", modifiedTime: "T1" });
    api.writeFile.mockResolvedValue("T1");
    await createDrill("F1", "Rondo 4v2", ["rondo-4v2.md"]);
    expect(api.createFile.mock.calls[0][2]).toBe("rondo-4v2-2.md");
  });

  it("starts from a template that parses cleanly", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "NEW", modifiedTime: "T1" });
    api.writeFile.mockResolvedValue("T1");
    await createDrill("F1", "Test", []);
    const text = api.createFile.mock.calls[0][3];
    const { parseDoc } = await import("../src/lib/frontmatter.js");
    const { parse } = await import("../src/lib/pitch.js");
    const { splitSegments } = await import("../src/lib/markdown.js");
    const doc = parseDoc(text);
    expect(doc.error).toBe(null);
    const block = splitSegments(doc.body).find((s) => s.kind === "pitch");
    expect(parse(block.text).errors).toEqual([]);
  });
});

describe("deleteDrill", () => {
  it("trashes rather than destroying, so a mistake is recoverable", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    api.trashFile.mockResolvedValue(undefined);
    await deleteDrill("a");
    expect(api.trashFile).toHaveBeenCalledWith("tok", "a");
  });

  it("retries once on a 401", async () => {
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    api.trashFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue(undefined);
    await expect(deleteDrill("a")).resolves.toBeUndefined();
    expect(api.trashFile).toHaveBeenCalledTimes(2);
  });
});
