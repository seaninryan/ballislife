import { describe, it, expect } from "vitest";
import {
  openEditor, reduce, isDirty, shouldSave,
  CLEAN, DIRTY, SAVING, SAVED, CONFLICT, FAILED,
} from "../src/lib/editor.js";

describe("openEditor", () => {
  it("starts clean and not needing a save", () => {
    const s = openEditor("a", "hello", "T1");
    expect(s.status).toBe(CLEAN);
    expect(isDirty(s)).toBe(false);
    expect(shouldSave(s)).toBe(false);
  });
});

describe("editing", () => {
  it("becomes dirty and wants saving", () => {
    const s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hello world" });
    expect(s.status).toBe(DIRTY);
    expect(isDirty(s)).toBe(true);
    expect(shouldSave(s)).toBe(true);
  });

  it("ignores an edit that changes nothing", () => {
    const a = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "x" });
    expect(reduce(a, { type: "edit", text: "x" })).toBe(a);
  });

  it("is not dirty after typing back to the saved text", () => {
    let s = reduce(openEditor("a", "z", "T1"), { type: "edit", text: "zz" });
    s = reduce(s, { type: "edit", text: "z" });
    expect(isDirty(s)).toBe(false);
  });
});

describe("saving", () => {
  it("does not try to save while a save is in flight", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    expect(s.status).toBe(SAVING);
    expect(shouldSave(s)).toBe(false);
  });

  it("stays dirty when the user types while a save is in flight", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "edit", text: "hi!" });
    expect(s.status).toBe(DIRTY);
  });

  it("stays dirty when the text that landed is not the current text", () => {
    // The whole reason saveSucceeded carries savedText: marking clean here would
    // silently drop whatever the user typed while the write was in flight.
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "edit", text: "hi!" });
    s = reduce(s, { type: "saveSucceeded", savedText: "hi", modifiedTime: "T2" });
    expect(s.status).toBe(DIRTY);
    expect(s.baseText).toBe("hi");
    expect(s.baseModifiedTime).toBe("T2");
    expect(shouldSave(s)).toBe(true);
  });

  it("becomes saved when the current text lands", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "saveSucceeded", savedText: "hi", modifiedTime: "T2" });
    expect(s.status).toBe(SAVED);
    expect(isDirty(s)).toBe(false);
    expect(shouldSave(s)).toBe(false);
  });

  it("keeps the previous baseline when a coalesced save reports no time", () => {
    let s = reduce(openEditor("a", "hello", "T1"), { type: "edit", text: "hi" });
    s = reduce(s, { type: "saveStarted" });
    s = reduce(s, { type: "saveSucceeded", savedText: "hi", modifiedTime: null });
    expect(s.baseModifiedTime).toBe("T1");
  });

  it("records a failure without losing the text", () => {
    let s = reduce(openEditor("a", "x", "T1"), { type: "edit", text: "y" });
    s = reduce(s, { type: "saveFailed", error: new Error("drive 500") });
    expect(s.status).toBe(FAILED);
    expect(s.text).toBe("y");
    expect(s.error.message).toBe("drive 500");
  });
});

describe("conflict", () => {
  const conflicted = () => {
    let s = reduce(openEditor("b", "mine", "T1"), { type: "edit", text: "my precious edit" });
    s = reduce(s, { type: "saveStarted" });
    return reduce(s, { type: "saveConflicted", modifiedTime: "T9" });
  };

  it("never discards the user's text", () => {
    const s = conflicted();
    expect(s.status).toBe(CONFLICT);
    expect(s.text).toBe("my precious edit");
  });

  it("is not cleared by typing, because Drive is still ahead", () => {
    const s = reduce(conflicted(), { type: "edit", text: "more" });
    expect(s.status).toBe(CONFLICT);
    expect(s.text).toBe("more");
  });

  it("keepMine adopts Drive's baseline but keeps the user's text", () => {
    const s = reduce(conflicted(), { type: "keepMine", modifiedTime: "T9" });
    expect(s.status).toBe(DIRTY);
    expect(s.text).toBe("my precious edit");
    expect(s.baseModifiedTime).toBe("T9");
  });

  it("reloaded takes Drive's version, deliberately discarding the user's", () => {
    const s = reduce(conflicted(), { type: "reloaded", text: "theirs", modifiedTime: "T9" });
    expect(s.status).toBe(CLEAN);
    expect(s.text).toBe("theirs");
    expect(s.baseModifiedTime).toBe("T9");
  });
});

describe("robustness", () => {
  it("returns the same object for an unknown action", () => {
    const s = openEditor("a", "x", "T1");
    expect(reduce(s, { type: "nonsense" })).toBe(s);
  });
});
