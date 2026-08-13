// The sessions index is a CACHE. Every load diffs it against a real listing and repairs
// any drift, so it can never serve a stale plan after one is edited in Drive directly —
// the same invariant driveIndex.js documents for drills.
import { describe, it, expect } from "vitest";
import {
  EMPTY_SESSIONS_INDEX, readSessionsIndex, diffSessionsIndex, applySessionsDiff,
  sessionsFromIndex,
} from "../src/lib/sessionsIndex.js";

const entry = (name, modifiedTime, session) => ({ name, modifiedTime, session });
const file = (id, name, modifiedTime) => ({ id, name, modifiedTime });
const sess = (id) => ({ id, date: id, squad: "", theme: "", length: 60, turnout: null, blocks: [] });

describe("readSessionsIndex", () => {
  it("reads a well-formed index", () => {
    const raw = JSON.stringify({ version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } });
    expect(readSessionsIndex(raw).entries.F1.session.id).toBe("a");
  });

  it("rebuilds from scratch rather than throwing on anything unusable", () => {
    for (const raw of [null, "", "{", "[]", '{"version":9,"entries":{}}', '{"version":1}']) {
      expect(readSessionsIndex(raw)).toEqual(EMPTY_SESSIONS_INDEX);
    }
  });
});

describe("diffSessionsIndex", () => {
  it("keeps an entry whose file has not changed", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    const { keep, refetch, dropped } = diffSessionsIndex(index, [file("F1", "a.json", "T1")]);
    expect(Object.keys(keep)).toEqual(["F1"]);
    expect(refetch).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("refetches when modifiedTime moved — the plan was edited elsewhere", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    const { keep, refetch } = diffSessionsIndex(index, [file("F1", "a.json", "T2")]);
    expect(keep).toEqual({});
    expect(refetch.map((f) => f.id)).toEqual(["F1"]);
  });

  it("refetches on a rename too, since Drive does not always bump modifiedTime for one", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    const { refetch } = diffSessionsIndex(index, [file("F1", "b.json", "T1")]);
    expect(refetch.map((f) => f.name)).toEqual(["b.json"]);
  });

  it("refetches a file the index has never seen", () => {
    const { refetch } = diffSessionsIndex(EMPTY_SESSIONS_INDEX, [file("F2", "b.json", "T1")]);
    expect(refetch.map((f) => f.id)).toEqual(["F2"]);
  });

  it("drops an entry whose file is gone", () => {
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("a")) } };
    expect(diffSessionsIndex(index, []).dropped).toEqual(["F1"]);
  });

  it("ignores index.json and anything that is not a session file", () => {
    const files = [file("I", "index.json", "T"), file("N", "notes.txt", "T"), file("F1", "a.json", "T1")];
    const { refetch } = diffSessionsIndex(EMPTY_SESSIONS_INDEX, files);
    expect(refetch.map((f) => f.name)).toEqual(["a.json"]);
  });

  it("survives a junk listing", () => {
    expect(diffSessionsIndex(EMPTY_SESSIONS_INDEX, null).refetch).toEqual([]);
    expect(diffSessionsIndex(null, [file("F1", "a.json", "T")]).refetch.map((f) => f.id)).toEqual(["F1"]);
  });
});

describe("applySessionsDiff / sessionsFromIndex", () => {
  it("merges kept and freshly read entries", () => {
    const kept = { F1: entry("a.json", "T1", sess("a")) };
    const fetched = { F2: entry("b.json", "T2", sess("b")) };
    const next = applySessionsDiff(kept, fetched);
    expect(Object.keys(next.entries).sort()).toEqual(["F1", "F2"]);
    expect(next.version).toBe(1);
  });

  it("turns an index into the id-keyed map the app renders, plus each file's metadata", () => {
    const index = {
      version: 1,
      entries: { F1: entry("a.json", "T1", sess("a")), F2: entry("b.json", "T2", sess("b")) },
    };
    const { sessions, meta } = sessionsFromIndex(index);
    expect(Object.keys(sessions).sort()).toEqual(["a", "b"]);
    expect(meta.a).toEqual({ fileId: "F1", modifiedTime: "T1" });
  });

  it("skips an entry with nothing that could be a session, rather than making a bad key", () => {
    const index = {
      version: 1,
      entries: {
        F1: entry("a.json", "T1", sess("a")),
        F2: entry("b.json", "T2", null),
        F3: entry("c.json", "T3", "not an object"),
        F4: entry("d.json", "T4", []),
      },
    };
    expect(Object.keys(sessionsFromIndex(index).sessions)).toEqual(["a"]);
  });

  it("keeps a hand-edited plan that lost its stored id, taking the id from the file name", () => {
    // The file name is the authority everywhere else in this function, so it has to be here
    // too: dropping the entry would make a file the owner can see in Drive disappear from
    // the app with nothing to explain it.
    const index = { version: 1, entries: { F3: entry("c.json", "T3", { date: "x" }) } };
    const { sessions, meta } = sessionsFromIndex(index);
    expect(sessions.c).toEqual({ date: "x", id: "c" });
    expect(meta.c).toEqual({ fileId: "F3", modifiedTime: "T3" });
  });

  it("prefers the id in the file NAME when the stored session disagrees with it", () => {
    // The file name is the authority: it is what the id was resolved from on save. A
    // session whose stored id drifted (hand-edited) must not shadow another file.
    const index = { version: 1, entries: { F1: entry("a.json", "T1", sess("zzz")) } };
    const { sessions } = sessionsFromIndex(index);
    expect(Object.keys(sessions)).toEqual(["a"]);
    expect(sessions.a.id).toBe("a");
  });
});
