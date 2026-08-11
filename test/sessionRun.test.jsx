// @vitest-environment jsdom
// SessionRun is presentational, like SessionBuilder/SessionList: given a session, the
// catalogue's lightweight drill metadata, and a map of each referenced drill's full
// text (fetched separately by App), it renders the plan block by block for use at the
// pitch side. It never fetches anything itself and never writes to Drive.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import SessionRun from "../src/components/SessionRun.jsx";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "..", "src", "styles.css"), "utf8");

const drill = (slug, title, minutes = 10, category = "warmup") => ({
  id: slug, slug, title, category, minutes, players: null, tags: [], thumb: null, invalid: null,
});

const drillText = (title, checklistItems = []) => {
  const list = checklistItems.map((c) => `- [ ] ${c}`).join("\n");
  return `---\ntitle: ${title}\n---\n\n${list ? list + "\n\n" : ""}Coaching points here.\n\n\`\`\`pitch\narea: 20x20 plain\nred: A@5,5\n\`\`\`\n`;
};

const session = (blocks) => ({
  id: "s1", date: "2026-08-12", squad: "U12s", theme: "pressing", length: 75, blocks,
});

const render = (props) => renderToStaticMarkup(<SessionRun {...props} />);

describe("SessionRun", () => {
  it("renders a section per block, in plan order, labelled with its slot", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: "b", minutes: null, note: "" },
    ]);
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    const html = render({ session: s, drills, texts: {} });
    expect(html.indexOf("warmup")).toBeLessThan(html.indexOf("skill"));
    expect(html.indexOf("Rondo")).toBeLessThan(html.indexOf("Possession"));
  });

  it("shows the drill title and the block's duration", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: 12, note: "" }]);
    const drills = [drill("a", "Rondo", 10)];
    const html = render({ session: s, drills, texts: {} });
    expect(html).toContain("Rondo");
    expect(html).toContain("12");
  });

  it("shows the drill's full text, not just a thumbnail — the diagram is present", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: null, note: "" }]);
    const drills = [drill("a", "Rondo")];
    const texts = { a: { status: "ready", text: drillText("Rondo") } };
    const html = render({ session: s, drills, texts });
    expect(html).toContain("Coaching points here");
    expect(html).toContain("<svg");
  });

  it("says a block with no drill chosen has none, rather than an empty section", () => {
    const s = session([{ slot: "warmup", drill: null, minutes: null, note: "" }]);
    const html = render({ session: s, drills: [], texts: {} });
    expect(html).toMatch(/no drill/i);
    expect(html).toContain("warmup");
  });

  it("says a broken reference is missing, naming the slug", () => {
    const s = session([{ slot: "warmup", drill: "ghost", minutes: null, note: "" }]);
    const html = render({ session: s, drills: [], texts: {} });
    expect(html).toMatch(/missing/i);
    expect(html).toContain("ghost");
  });

  it("shows a running so-far time beside each block", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
    ]);
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    const html = render({ session: s, drills, texts: {} });
    expect(html).toContain("10");
    expect(html).toContain("25");
  });

  it("shows a loading state while a block's drill is being fetched", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: null, note: "" }]);
    const drills = [drill("a", "Rondo")];
    const texts = { a: { status: "loading" } };
    const html = render({ session: s, drills, texts });
    expect(html).toMatch(/loading/i);
  });

  it("a drill that fails to load says so for that block only, leaving the rest usable", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: null, note: "" },
      { slot: "skill", drill: "b", minutes: null, note: "" },
    ]);
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    const texts = {
      a: { status: "error", error: "drive 500" },
      b: { status: "ready", text: drillText("Possession") },
    };
    const html = render({ session: s, drills, texts });
    expect(html).toMatch(/could not load|failed|trouble/i);
    expect(html).toContain("Coaching points here"); // block b still renders fully
  });

  it("offers a way back to the plan", () => {
    const s = session([{ slot: "warmup", drill: null, minutes: null, note: "" }]);
    expect(render({ session: s, drills: [], texts: {}, onBack: () => {} })).toMatch(/back/i);
  });
});

describe("SessionRun tickable checklists", () => {
  let container, root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("checklists inside a drill are tickable", async () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: null, note: "" }]);
    const drills = [drill("a", "Rondo")];
    const texts = { a: { status: "ready", text: drillText("Rondo", ["cones out"]) } };

    root = createRoot(container);
    await act(async () => {
      root.render(<SessionRun session={s} drills={drills} texts={texts} today="2026-08-12" />);
    });

    const box = container.querySelector('input[type="checkbox"]');
    expect(box.disabled).toBe(false);
    await act(async () => { box.click(); });
    expect(box.checked).toBe(true);
  });
});

describe("SessionRun print stylesheet", () => {
  it("hides run-view controls and avoids breaking a block across a page", () => {
    expect(styles).toMatch(/@media print/);
    expect(styles).toMatch(/break-inside:\s*avoid/);
  });
});
