import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../src/lib/driveApi.js";
import * as auth from "../src/lib/driveAuth.js";
import {
  loadCatalogue, saveDrill, noteModifiedTime, knownModifiedTime, readDrill, FOLDER_NAME, INDEX_NAME,
  createDrill, deleteDrill, loadSessions, saveSession, deleteSession, forgetDriveState,
  SESSIONS_NAME, SESSIONS_BACKUP_NAME,
} from "../src/lib/drive.js";

vi.mock("../src/lib/driveApi.js");
vi.mock("../src/lib/driveAuth.js");

const DRILL = "---\ntitle: A\n---\n\nbody\n";

beforeEach(() => {
  vi.resetAllMocks();
  // drive.js keeps module-level conflict baselines and file ids. Left alone they leak between
  // tests — which is how a test here once passed alone and failed in file order.
  forgetDriveState();
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

  it("still returns the catalogue when the index cannot be written", async () => {
    // The index is a disposable cache. Failing to write it must not hide every drill —
    // and at the side of a pitch that write is among the likeliest things to fail. Same
    // rule as the sessions index.
    api.findAllFolders.mockResolvedValue(["F1"]);
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T1" },
    ]);
    api.readFile.mockImplementation(async (_t, id) => (id === "idx" ? "{" : DRILL));
    api.writeFile.mockRejectedValue(new Error("offline"));

    const { drills, failed } = await loadCatalogue();
    expect(drills.map((d) => d.id)).toEqual(["a"]);
    expect(failed).toEqual([]);
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

// -- sessions: one file per plan ----------------------------------------------
// "F1" is the BallIsLife folder, "SF" the sessions subfolder inside it.
const sess = (id) => ({ id, date: id, squad: "", theme: "", length: 60, turnout: null, blocks: [] });
const file = (id, name, modifiedTime) => ({ id, name, modifiedTime });
const indexOf = (entries) => JSON.stringify({ version: 1, entries });
const entry = (name, modifiedTime, session) => ({ name, modifiedTime, session });

// `parent` is the BallIsLife listing (where the old blob lives), `sessions` the subfolder's,
// and `read` the text each file id returns. An unlisted read is a test bug, not a Drive
// failure, so it throws loudly rather than quietly returning "".
function mockSessionsDrive({ parent = [], sessions = [], read = {}, sessionsFolder = "SF" } = {}) {
  api.findChildFolder.mockResolvedValue(sessionsFolder);
  api.createFolder.mockResolvedValue("SF");
  api.listFiles.mockImplementation(async (_t, folder) => (folder === "SF" ? sessions : parent));
  api.readFile.mockImplementation(async (_t, id) => {
    if (!(id in read)) throw new Error(`test read of an unexpected file: ${id}`);
    return read[id];
  });
  api.writeFile.mockResolvedValue("TW");
  api.createFile.mockImplementation(async (_t, _f, name) => ({ id: `F-${name}`, modifiedTime: "TN" }));
  api.renameFile.mockResolvedValue("TR");
  api.trashFile.mockResolvedValue(undefined);
}

const readIds = () => api.readFile.mock.calls.map((c) => c[1]);
const writtenIndex = () => JSON.parse(api.writeFile.mock.calls[0][2]);

// One session already in Drive, loaded so drive.js holds its file id and baseline — which is
// what saveSession and deleteSession need, since the caller does not pass either.
async function loadOneSession() {
  mockSessionsDrive({
    sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1")],
    read: { idx: indexOf({ FA: entry("a.json", "T1", sess("a")) }) },
  });
  return loadSessions("F1");
}

describe("loadSessions", () => {
  it("creates the sessions subfolder on a first-ever load", async () => {
    mockSessionsDrive({ sessionsFolder: null });
    const r = await loadSessions("F1");
    expect(api.createFolder).toHaveBeenCalledWith("tok", "sessions", "F1");
    expect(r.sessions).toEqual({});
    expect(r.migrated).toBe(0);
  });

  it("reads only the index when the index already matches the listing", async () => {
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1")],
      read: { idx: indexOf({ FA: entry("a.json", "T1", sess("a")) }) },
    });
    const { sessions, meta } = await loadSessions("F1");
    expect(readIds()).toEqual(["idx"]);
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(meta.a).toEqual({ fileId: "FA", modifiedTime: "T1" });
  });

  it("does not rewrite the index when nothing changed", async () => {
    // Opening the app at the side of a pitch and changing nothing must not cost a write.
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1")],
      read: { idx: indexOf({ FA: entry("a.json", "T1", sess("a")) }) },
    });
    await loadSessions("F1");
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it("re-reads only the plan whose modifiedTime moved", async () => {
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1"), file("FB", "b.json", "T9")],
      read: {
        idx: indexOf({
          FA: entry("a.json", "T1", sess("a")),
          FB: entry("b.json", "T2", sess("b")),
        }),
        FB: JSON.stringify({ ...sess("b"), theme: "edited elsewhere" }),
      },
    });
    const { sessions } = await loadSessions("F1");
    expect(readIds()).toEqual(["idx", "FB"]);
    expect(sessions.b.theme).toBe("edited elsewhere");
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
  });

  it("forgets a plan whose file was deleted in Drive", async () => {
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1")],
      read: {
        idx: indexOf({
          FA: entry("a.json", "T1", sess("a")),
          FB: entry("b.json", "T2", sess("b")),
        }),
      },
    });
    const { sessions } = await loadSessions("F1");
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(Object.keys(writtenIndex().entries)).toEqual(["FA"]);
  });

  it("keeps the other plans when one file fails to download", async () => {
    // One flaky read on a phone must not cost every plan.
    mockSessionsDrive({
      sessions: [file("FA", "a.json", "T1"), file("FB", "b.json", "T1")],
      read: { FA: JSON.stringify(sess("a")) },
    });
    const { sessions, failed } = await loadSessions("F1");
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(failed.map((f) => f.name)).toEqual(["b.json"]);
  });

  it("keeps a stale cached plan when its refetch fails, and retries next load", async () => {
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FB", "b.json", "T2")],
      read: { idx: indexOf({ FB: entry("b.json", "T1", { ...sess("b"), theme: "cached" }) }) },
    });
    const { sessions } = await loadSessions("F1");
    expect(sessions.b.theme).toBe("cached");
    // The OLD modifiedTime is kept, so the next load notices the mismatch and retries.
    expect(writtenIndex().entries.FB.modifiedTime).toBe("T1");
  });

  it("lets a 401 during a plan read reach the retry rather than failing that plan", async () => {
    mockSessionsDrive({ sessions: [file("FA", "a.json", "T1")] });
    let reads = 0;
    api.readFile.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) throw Object.assign(new Error("auth"), { code: 401 });
      return JSON.stringify(sess("a"));
    });
    const { sessions, failed } = await loadSessions("F1");
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(failed).toEqual([]);
    expect(auth.ensureFreshToken).toHaveBeenCalled();
  });

  it("costs one plan, not the load, when a plan's JSON is broken — and says which", async () => {
    mockSessionsDrive({
      sessions: [file("FA", "a.json", "T1"), file("FB", "b.json", "T1")],
      read: { FA: JSON.stringify(sess("a")), FB: "{{{ hand-edited badly" },
    });
    const { sessions, failed } = await loadSessions("F1");
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(failed).toEqual([
      expect.objectContaining({ id: "FB", name: "b.json", reason: "parse" }),
    ]);
  });

  it("keeps reporting a broken plan on the loads that only read the cache", async () => {
    // The index caches the skip, so without this the plan is gone on every later load with
    // nothing said about it at all.
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FB", "b.json", "T1")],
      read: { idx: indexOf({ FB: entry("b.json", "T1", null) }) },
    });
    const { sessions, failed } = await loadSessions("F1");
    expect(sessions).toEqual({});
    expect(failed.map((f) => f.reason)).toEqual(["parse"]);
    expect(readIds()).toEqual(["idx"]); // still not refetched
  });

  it("loads every plan even when the index cache cannot be written back", async () => {
    // index.json is a disposable cache, rebuilt from a real listing on every load, so
    // failing to write it must cost nothing at all. On a phone at the side of a pitch that
    // write is among the likeliest things to fail.
    mockSessionsDrive({
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T2")],
      read: { idx: indexOf({ FA: entry("a.json", "T1", sess("a")) }), FA: JSON.stringify(sess("a")) },
    });
    api.writeFile.mockRejectedValue(Object.assign(new Error("offline"), { code: 0 }));

    const { sessions, meta, failed } = await loadSessions("F1");
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(meta.a).toEqual({ fileId: "FA", modifiedTime: "T2" });
    expect(failed).toEqual([]);
  });

  it("names a file whose name cannot be a plan id instead of hiding it", async () => {
    // Drive's own "Copy of a.json", made by a duplicate in the web UI.
    mockSessionsDrive({
      sessions: [file("FA", "a.json", "T1"), file("FC", "Copy of a.json", "T1")],
      read: { FA: JSON.stringify(sess("a")) },
    });
    const { sessions, failed } = await loadSessions("F1");
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(failed).toEqual([
      expect.objectContaining({ id: "FC", name: "Copy of a.json", reason: "unnamed" }),
    ]);
  });
});

describe("two files claiming one plan", () => {
  // Drive allows duplicate names, so the same-dated plan created on two devices makes two
  // a.json files. One used to shadow the other silently, and a save wrote into the winner.
  const twoAs = () => mockSessionsDrive({
    sessions: [file("FA1", "a.json", "T1"), file("FA2", "a.json", "T2")],
    read: {
      FA1: JSON.stringify({ ...sess("a"), theme: "older" }),
      FA2: JSON.stringify({ ...sess("a"), theme: "newer" }),
    },
  });

  it("shows the newest and names both files", async () => {
    twoAs();
    const { sessions, meta, failed } = await loadSessions("F1");
    expect(sessions.a.theme).toBe("newer");
    expect(meta.a.fileId).toBe("FA2");
    const dupe = failed.find((f) => f.reason === "duplicate");
    expect(dupe).toBeTruthy();
    expect(dupe.name).toContain("a.json");
  });

  it("refuses to save into the ambiguous plan rather than writing the wrong file", async () => {
    twoAs();
    await loadSessions("F1");
    api.writeFile.mockClear();   // the load wrote its own index; only the save matters here
    api.createFile.mockClear();
    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: "T2" });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBeFalsy();
    expect(r.id).toBe("a");
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.createFile).not.toHaveBeenCalled();
  });

  it("saves again once the duplicate is gone from Drive", async () => {
    twoAs();
    await loadSessions("F1");
    mockSessionsDrive({
      sessions: [file("FA2", "a.json", "T2")],
      read: { FA2: JSON.stringify(sess("a")) },
    });
    await loadSessions("F1");
    api.writeFile.mockResolvedValue("T8");
    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: "T2" });
    expect(r).toMatchObject({ ok: true, id: "a", fileId: "FA2" });
  });
});

describe("saveSession", () => {
  it("creates a file in the sessions folder for a plan Drive has never seen", async () => {
    mockSessionsDrive();
    const r = await saveSession({
      folder: "F1", id: "2026-08-13", session: sess("2026-08-13"), baseModifiedTime: null,
    });
    expect(r).toEqual({ ok: true, id: "2026-08-13", fileId: "F-2026-08-13.json", modifiedTime: "TN" });
    const [, folder, name, body] = api.createFile.mock.calls[0];
    expect(folder).toBe("SF");
    expect(name).toBe("2026-08-13.json");
    expect(JSON.parse(body).id).toBe("2026-08-13");
  });

  it("adopts a create that landed without a reply rather than duplicating it", async () => {
    // The expected failure on poor signal: the file was written, the response never came
    // back. Taking the create branch again makes a second b.json, after which the duplicate
    // guard blocks saving that plan at all.
    mockSessionsDrive();
    api.createFile.mockRejectedValue(Object.assign(new Error("network"), { code: 0 }));
    api.listFiles.mockImplementation(async (_t, folder) =>
      (folder === "SF" ? [file("F-b", "b.json", "TN")] : []));

    const r = await saveSession({ folder: "F1", id: "b", session: sess("b"), baseModifiedTime: null });
    expect(r).toMatchObject({ ok: true, id: "b", fileId: "F-b", modifiedTime: "TN" });
    expect(api.createFile).toHaveBeenCalledTimes(1);

    // And the file is now known, so the next save writes it instead of creating anything.
    api.writeFile.mockResolvedValue("TN2");
    const again = await saveSession({ folder: "F1", id: "b", session: sess("b"), baseModifiedTime: "TN" });
    expect(again).toMatchObject({ ok: true, fileId: "F-b", modifiedTime: "TN2" });
    expect(api.createFile).toHaveBeenCalledTimes(1);
  });

  it("reports a create that really did fail, having found no file for it", async () => {
    mockSessionsDrive();
    api.createFile.mockRejectedValue(Object.assign(new Error("network"), { code: 0 }));
    const r = await saveSession({ folder: "F1", id: "b", session: sess("b"), baseModifiedTime: null });
    expect(r.ok).toBe(false);
    expect(r.id).toBe("b");
    expect(r.error.code).toBe(0);
  });

  it("costs no listing at all when the create succeeds", async () => {
    // One extra listing on the failure path is worth it; one per save is not.
    mockSessionsDrive();
    await saveSession({ folder: "F1", id: "b", session: sess("b"), baseModifiedTime: null });
    expect(api.listFiles).not.toHaveBeenCalled();
  });

  it("writes the plan's own file and returns its new modifiedTime", async () => {
    await loadOneSession();
    api.writeFile.mockResolvedValue("T6");
    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: "T1" });
    expect(r).toEqual({ ok: true, id: "a", fileId: "FA", modifiedTime: "T6" });
    expect(api.writeFile).toHaveBeenCalledWith("tok", "FA", expect.any(String));
  });

  it("refuses to overwrite when that one file moved underneath it", async () => {
    await loadOneSession();
    noteModifiedTime("FA", "T9");
    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: "T1" });
    expect(r).toEqual({ ok: false, conflict: true, id: "a", modifiedTime: "T9" });
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("reports a failed write against the id that failed", async () => {
    // The caller is saving several plans at once, so a failure has to say which one.
    await loadOneSession();
    api.writeFile.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: "T1" });
    expect(r.ok).toBe(false);
    expect(r.id).toBe("a");
    expect(r.error.code).toBe(500);
  });

  it("retries once on a 401", async () => {
    await loadOneSession();
    api.writeFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue("T7");
    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: "T1" });
    expect(r).toMatchObject({ ok: true, modifiedTime: "T7" });
  });
});

describe("deleteSession", () => {
  it("trashes that plan's file and forgets its baseline", async () => {
    await loadOneSession();
    await deleteSession({ id: "a", fileId: "FA" });
    expect(api.trashFile).toHaveBeenCalledWith("tok", "FA");
    expect(knownModifiedTime("FA")).toBe(null);
  });

  it("retries once on a 401", async () => {
    mockSessionsDrive();
    api.trashFile
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue(undefined);
    await expect(deleteSession({ id: "a", fileId: "FA" })).resolves.toBeUndefined();
    expect(api.trashFile).toHaveBeenCalledTimes(2);
  });
});

describe("migrating the sessions.json blob", () => {
  const blob = (sessions) => JSON.stringify({ version: 1, sessions });

  it("writes one file per plan and renames the blob aside", async () => {
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a"), b: sess("b") }) },
    });
    const { sessions, migrated } = await loadSessions("F1");
    expect(migrated).toBe(2);
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
    const names = api.createFile.mock.calls.map((c) => c[2]);
    expect(names).toEqual(["a.json", "b.json", "index.json"]);
    expect(api.renameFile).toHaveBeenCalledWith("tok", "BLOB", SESSIONS_BACKUP_NAME);
    // The plans were already in memory: reading back what we just wrote would be wasted.
    expect(readIds()).toEqual(["BLOB"]);
  });

  it("does not run again once the blob has been renamed aside", async () => {
    mockSessionsDrive({
      parent: [file("BAK", SESSIONS_BACKUP_NAME, "T0")],
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1")],
      read: { idx: indexOf({ FA: entry("a.json", "T1", sess("a")) }) },
    });
    const { migrated } = await loadSessions("F1");
    expect(migrated).toBe(0);
    expect(api.createFile).not.toHaveBeenCalled();
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.renameFile).not.toHaveBeenCalled();
  });

  it("resumes a half-done migration without overwriting the file already written", async () => {
    // A migration interrupted by a closed tab must not replace a plan edited since.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      sessions: [file("idx", "index.json", "T"), file("FA", "a.json", "T1")],
      read: {
        BLOB: blob({ a: sess("a"), b: sess("b") }),
        idx: indexOf({ FA: entry("a.json", "T1", { ...sess("a"), theme: "already migrated" }) }),
      },
    });
    const { sessions, migrated } = await loadSessions("F1");
    expect(migrated).toBe(1);
    expect(api.createFile.mock.calls.map((c) => c[2])).toEqual(["b.json"]);
    expect(sessions.a.theme).toBe("already migrated");
    // Only the index was rewritten; a.json itself was never touched.
    expect(api.writeFile.mock.calls.map((c) => c[1])).toEqual(["idx"]);
  });

  it("does not count a file it cannot parse as proof the plan already moved", async () => {
    // a.json exists but holds broken JSON, so the plan is nowhere the app can show it.
    // Counting the file by NAME renamed the blob aside — the last readable copy of a — and
    // closed the very recovery path the rename gate exists for.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      sessions: [file("FA", "a.json", "T1")],
      read: { BLOB: blob({ a: sess("a"), b: sess("b") }), FA: "{{{ half-written" },
    });
    const { sessions, migrated, unmigrated } = await loadSessions("F1");

    expect(migrated).toBe(1); // b only
    expect(api.createFile.mock.calls.map((c) => c[2])).toEqual(["b.json", "index.json"]);
    // a is still shown, out of the blob, and the blob stays findable so a later load — after
    // the owner repairs a.json — can migrate it for real.
    expect(sessions.a).toBeTruthy();
    expect(api.renameFile).not.toHaveBeenCalled();
    expect(unmigrated).toEqual([
      expect.objectContaining({ id: "a", reason: "unreadable-file" }),
    ]);
  });

  it("does not write a second file for a plan whose own file merely failed to download", async () => {
    // A flaky read is not proof the file is broken. Writing a.json again would leave two
    // files claiming the plan, which blocks saving it at all.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      sessions: [file("FA", "a.json", "T1")],
      read: { BLOB: blob({ a: sess("a") }) },
    });
    const good = api.readFile.getMockImplementation();
    api.readFile.mockImplementation(async (t, id) => {
      if (id === "FA") throw Object.assign(new Error("flaky"), { code: 500 });
      return good(t, id);
    });

    const { migrated, unmigrated } = await loadSessions("F1");
    expect(migrated).toBe(0);
    expect(api.createFile.mock.calls.map((c) => c[2])).toEqual(["index.json"]);
    expect(unmigrated.map((u) => u.id)).toEqual(["a"]);
    expect(api.renameFile).not.toHaveBeenCalled();
  });

  it("refuses to save a plan shown from the blob because its own file is unreadable", async () => {
    // Its edit stays in memory, where the caller holds it. Creating the file now would make
    // the second file claiming this plan — the state that blocks saving it entirely.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      sessions: [file("FA", "a.json", "T1")],
      read: { BLOB: blob({ a: sess("a") }), FA: "{{{ half-written" },
    });
    await loadSessions("F1");
    api.createFile.mockClear();
    api.writeFile.mockClear();

    const r = await saveSession({ folder: "F1", id: "a", session: sess("a"), baseModifiedTime: null });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBeFalsy();
    expect(api.createFile).not.toHaveBeenCalled();
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("still loads the migrated plans when the rename fails", async () => {
    // The rename is only tidying — every plan is already safe in its own file.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a"), b: sess("b") }) },
    });
    api.renameFile.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    const { sessions, migrated } = await loadSessions("F1");
    expect(migrated).toBe(2);
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
  });

  it("still shows a plan whose file could not be written, and reports it", async () => {
    // One flaky request during the one-time migration, plausibly on bad signal. Hiding the
    // plan would be worse than showing one whose file does not exist yet: it gets one on
    // its first save, which is exactly what the migration would have done.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a"), b: sess("b") }) },
    });
    api.createFile.mockImplementation(async (_t, _f, name) => {
      if (name === "b.json") throw Object.assign(new Error("boom"), { code: 500 });
      return { id: `F-${name}`, modifiedTime: "TN" };
    });

    const { sessions, migrated, unmigrated } = await loadSessions("F1");
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
    expect(migrated).toBe(1);
    expect(unmigrated.map((u) => u.id)).toEqual(["b"]);
    // The blob is the only copy of b, so it must stay findable for the next load to retry.
    expect(api.renameFile).not.toHaveBeenCalled();
  });

  it("creates the file on the first save of a plan the migration could not write", async () => {
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ b: sess("b") }) },
    });
    api.createFile.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 500 }));
    api.createFile.mockResolvedValue({ id: "F-b", modifiedTime: "TN" });
    await loadSessions("F1");

    api.createFile.mockClear();
    const r = await saveSession({ folder: "F1", id: "b", session: sess("b"), baseModifiedTime: null });
    expect(r).toMatchObject({ ok: true, id: "b", fileId: "F-b" });
    expect(api.createFile.mock.calls[0][2]).toBe("b.json");
  });

  it("keeps the plans it just migrated when the new index cache cannot be created", async () => {
    // Same reasoning as the load above, on the other write: every plan is in its own file
    // by now, so a failed cache write must not turn the migration into a failed load.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a"), b: sess("b") }) },
    });
    api.createFile.mockImplementation(async (_t, _f, name) => {
      if (name === "index.json") throw Object.assign(new Error("offline"), { code: 0 });
      return { id: `F-${name}`, modifiedTime: "TN" };
    });

    const { sessions, migrated } = await loadSessions("F1");
    expect(migrated).toBe(2);
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
    expect(api.renameFile).toHaveBeenCalledWith("tok", "BLOB", SESSIONS_BACKUP_NAME);
  });

  it("lets a 401 while writing a migrated plan reach the retry", async () => {
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a") }) },
    });
    let creates = 0;
    api.createFile.mockImplementation(async (_t, _f, name) => {
      creates += 1;
      if (creates === 1) throw Object.assign(new Error("auth"), { code: 401 });
      return { id: `F-${name}`, modifiedTime: "TN" };
    });
    const { sessions, migrated, unmigrated } = await loadSessions("F1");
    expect(migrated).toBe(1);
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(unmigrated).toEqual([]);
  });

  it("never renames a blob it could not parse, and says so", async () => {
    // An upload interrupted mid-write leaves exactly this. Renaming it aside would make
    // the only copy of every plan unfindable by name, so the migration could never retry.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: '{"version":1,"sessions":{"a":{"id":"a"' },
    });
    const { sessions, migrated, failed } = await loadSessions("F1");
    expect(migrated).toBe(0);
    expect(sessions).toEqual({});
    expect(api.renameFile).not.toHaveBeenCalled();
    expect(failed).toEqual([
      expect.objectContaining({ name: SESSIONS_NAME, reason: "blob" }),
    ]);
  });

  it("never renames a blob it could not download, and says so", async () => {
    mockSessionsDrive({ parent: [file("BLOB", SESSIONS_NAME, "T0")] });
    api.readFile.mockRejectedValue(Object.assign(new Error("flaky"), { code: 500 }));
    const { migrated, failed } = await loadSessions("F1");
    expect(migrated).toBe(0);
    expect(api.renameFile).not.toHaveBeenCalled();
    expect(failed.map((f) => f.reason)).toEqual(["blob"]);
  });

  it("still renames aside a blob that is genuinely empty", async () => {
    // "Nothing to move" is a real state — every plan already has its own file — and must
    // not be confused with "could not read it".
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({}) },
    });
    const { migrated, failed } = await loadSessions("F1");
    expect(migrated).toBe(0);
    expect(failed).toEqual([]);
    expect(api.renameFile).toHaveBeenCalledWith("tok", "BLOB", SESSIONS_BACKUP_NAME);
  });

  it("lets a 401 reading the blob reach the retry rather than reporting it broken", async () => {
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a") }) },
    });
    const good = api.readFile.getMockImplementation();
    let reads = 0;
    api.readFile.mockImplementation(async (t, id) => {
      reads += 1;
      if (reads === 1) throw Object.assign(new Error("auth"), { code: 401 });
      return good(t, id);
    });
    const { sessions, migrated, failed } = await loadSessions("F1");
    expect(migrated).toBe(1);
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(failed).toEqual([]);
  });

  it("keeps the blob findable when a plan's id cannot be a file name", async () => {
    // The blob accepted any key; a file name cannot. Renaming the blob away would hide a
    // plan the app has nowhere to show.
    mockSessionsDrive({
      parent: [file("BLOB", SESSIONS_NAME, "T0")],
      read: { BLOB: blob({ a: sess("a"), "13/08/2026": sess("13/08/2026") }) },
    });
    const { sessions, migrated, unmigrated } = await loadSessions("F1");
    expect(migrated).toBe(1);
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(api.renameFile).not.toHaveBeenCalled();
    // Reported, not merely counted: the banner used to say the others had moved and say
    // nothing at all about the plan that had not.
    expect(unmigrated).toEqual([
      expect.objectContaining({ id: "13/08/2026", reason: "unsafe-id" }),
    ]);
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
