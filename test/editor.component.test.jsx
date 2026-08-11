// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Editor from "../src/components/Editor.jsx";
import { openEditor, reduce, CONFLICT, FAILED } from "../src/lib/editor.js";

const base = openEditor("a", "---\ntitle: T\n---\n\nBody.\n", "T1");
const render = (state, props) => renderToStaticMarkup(<Editor state={state} {...props} />);

describe("Editor", () => {
  it("shows the markdown source in a textarea", () => {
    expect(render(base)).toContain("Body.");
    expect(render(base)).toContain("<textarea");
  });

  it("renders the live preview beside it", () => {
    const withPitch = openEditor("a", "---\ntitle: T\n---\n\n```pitch\narea: 20x20\nred: A@5,5\n```\n", "T1");
    expect(render(withPitch)).toContain("<svg");
  });

  it("says saved when clean", () => {
    expect(render(base)).toMatch(/saved/i);
  });

  it("says unsaved while dirty", () => {
    expect(render(reduce(base, { type: "edit", text: "changed" }))).toMatch(/unsaved|saving/i);
  });

  it("offers both ways out of a conflict, and says the edit is safe", () => {
    let s = reduce(base, { type: "edit", text: "mine" });
    s = reduce(s, { type: "saveConflicted", modifiedTime: "T9" });
    const html = render(s);
    expect(html).toMatch(/changed in drive|changed on drive/i);
    expect(html).toMatch(/keep mine/i);
    expect(html).toMatch(/reload/i);
    // The user's text must still be on screen — that is the whole point.
    expect(html).toContain("mine");
  });

  it("shows a save failure without implying the edit is lost", () => {
    const s = reduce(reduce(base, { type: "edit", text: "x" }), {
      type: "saveFailed", error: Object.assign(new Error("drive 500"), { code: 500 }),
    });
    const html = render(s);
    expect(html).toMatch(/could not save|having trouble/i);
    expect(html).toContain("x");
  });

  it("offers delete and back controls", () => {
    const html = render(base);
    expect(html).toMatch(/delete/i);
    expect(html).toMatch(/back/i);
  });
});
