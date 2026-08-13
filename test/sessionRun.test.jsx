// @vitest-environment jsdom
// SessionRun is presentational, like SessionBuilder/SessionList: given a session, the
// catalogue's lightweight drill metadata, and a map of each referenced drill's full
// text (fetched separately by App), it renders the plan as an accordion for use at the
// pitch side — the current block expanded, the rest collapsed but reopenable. It never
// fetches anything itself and never writes to Drive; tonight's progress goes through
// lib/progress.js into localStorage only, exactly like DrillPreview's checklist ticks.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import SessionRun from "../src/components/SessionRun.jsx";
import { DONE, SKIPPED, readProgress, writeProgress } from "../src/lib/progress.js";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "..", "src", "styles.css"), "utf8");

const drill = (slug, title, minutes = 10, category = "warmup") => ({
  id: slug, slug, title, category, minutes, players: null, tags: [], thumb: null, invalid: null,
});

const drillText = (title, checklistItems = []) => {
  const list = checklistItems.map((c) => `- [ ] ${c}`).join("\n");
  return `---\ntitle: ${title}\n---\n\n${list ? list + "\n\n" : ""}Coaching points here.\n\n\`\`\`pitch\narea: 20x20 plain\nred: A@5,5\n\`\`\`\n`;
};

const session = (blocks, id = "s1") => ({
  id, date: "2026-08-12", squad: "U12s", theme: "pressing", length: 75, blocks,
});

// Two warmups sharing a tag and one skill drill: enough for the swap suite's ranking
// assertions, and shared with the reconciliation suite so there is one drill fixture for
// the interactive tests rather than three.
const runDrills = () => [
  { ...drill("a", "Alpha", 10, "warmup"), tags: ["mobility"] },
  { ...drill("b", "Bravo", 10, "skill"), tags: [] },
  { ...drill("c", "Charlie", 5, "warmup"), tags: ["mobility"] },
];

const render = (props) => renderToStaticMarkup(<SessionRun {...props} />);

beforeEach(() => {
  localStorage.clear();
});

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

  it("shows a loading state while a block's drill is being fetched", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: null, note: "" }]);
    const drills = [drill("a", "Rondo")];
    const texts = { a: { status: "loading" } };
    const html = render({ session: s, drills, texts });
    expect(html).toMatch(/loading/i);
  });

  // Shape change from the flat layout: block b is no longer current (block a, unsettled,
  // is), so it collapses to a one-line summary instead of rendering fully. "The rest is
  // usable" is still true — b's title is right there and it did not crash because a
  // failed — but "usable" now means "collapsed and reachable", not "fully rendered".
  // Interactive coverage below (accordion > "opening a collapsed block") proves opening
  // it still shows the full text.
  it("a drill that fails to load says so for that block only; the rest collapses but stays reachable", () => {
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
    expect(html).toContain("Possession"); // block b's title is visible, collapsed
    expect(html).not.toContain("Coaching points here"); // but not opened
  });

  it("offers a way back to the plan", () => {
    const s = session([{ slot: "warmup", drill: null, minutes: null, note: "" }]);
    expect(render({ session: s, drills: [], texts: {}, onBack: () => {} })).toMatch(/back/i);
  });
});

describe("SessionRun accordion (static shape)", () => {
  it("only the current block renders fully; the rest collapse to slot, title and duration", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
      { slot: "tactical", drill: "c", minutes: 20, note: "" },
    ]);
    const drills = [drill("a", "Rondo"), drill("b", "Possession"), drill("c", "Shape")];
    const texts = {
      a: { status: "ready", text: drillText("Rondo") },
      b: { status: "ready", text: drillText("Possession") },
      c: { status: "ready", text: drillText("Shape") },
    };
    const html = render({ session: s, drills, texts, today: "2026-08-12" });
    // block a (current, first unsettled) is fully open
    expect(html).toContain("Coaching points here");
    // b and c are named with slot/title/duration but not opened
    expect(html).toContain("Possession");
    expect(html).toContain("Shape");
    expect(html).toContain("skill");
    expect(html).toContain("tactical");
    expect(html).toContain("15");
    expect(html).toContain("20");
    // only one full drill body rendered (a's "Coaching points here" occurs once)
    expect(html.split("Coaching points here").length - 1).toBe(1);
  });

  it("a settled block's summary names its state and offers Not done, without opening it", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
    ], "settled-summary");
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    const texts = {
      a: { status: "ready", text: drillText("Rondo") },
      b: { status: "ready", text: drillText("Possession") },
    };
    writeProgress(localStorage, "settled-summary", "2026-08-12", { 0: DONE });
    const html = render({ session: s, drills, texts, today: "2026-08-12" });
    expect(html).toMatch(/done/i);
    expect(html).toMatch(/not done/i);
    // block a is settled and collapsed: its full body should not render
    expect(html.split("Coaching points here").length - 1).toBe(1); // only b, which is current
  });

  it("a header summary shows done, skipped and remaining", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
      { slot: "tactical", drill: "c", minutes: 20, note: "" },
    ], "counts-summary");
    const drills = [drill("a", "Rondo"), drill("b", "Possession"), drill("c", "Shape")];
    writeProgress(localStorage, "counts-summary", "2026-08-12", { 0: DONE, 1: SKIPPED });
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/1\D+done/i);
    expect(html).toMatch(/1\D+skipped/i);
    expect(html).toMatch(/1\D+remaining/i);
  });

  it("says the session is finished and offers to start over once every block is settled", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
    ], "finished");
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    writeProgress(localStorage, "finished", "2026-08-12", { 0: DONE, 1: SKIPPED });
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/finished/i);
    expect(html).toMatch(/start over/i);
  });

  it("tap targets for Done, Skip and Not done reuse .chip-button, sized for a thumb", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: 10, note: "" }], "chip-check");
    const drills = [drill("a", "Rondo")];
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/class="chip-button[^"]*"[^>]*>Done</);
    expect(html).toMatch(/class="chip-button[^"]*"[^>]*>Skip</);
  });

  it("Done and Skip are coloured — positive green for Done, muted amber for Skip — reusing the ok-chip/warn-chip recipe", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: 10, note: "" }], "chip-colour-actions");
    const drills = [drill("a", "Rondo")];
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/class="chip-button[^"]*chip-button-ok[^"]*"[^>]*>Done</);
    expect(html).toMatch(/class="chip-button[^"]*chip-button-warn[^"]*"[^>]*>Skip</);
  });

  it("Done and Skip sit at the top of the expanded block, before the drill body", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: 10, note: "" }], "actions-at-top");
    const drills = [drill("a", "Rondo")];
    const texts = { a: { status: "ready", text: drillText("Rondo") } };
    const html = render({ session: s, drills, texts, today: "2026-08-12" });
    expect(html.indexOf(">Done<")).toBeLessThan(html.indexOf("Coaching points here"));
  });

  it("Not done is normal button weight, not the small chip variant — it should be easy to find", () => {
    const s = session(
      [{ slot: "warmup", drill: "a", minutes: 10, note: "" }, { slot: "skill", drill: "b", minutes: 15, note: "" }],
      "not-done-weight",
    );
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    writeProgress(localStorage, "not-done-weight", "2026-08-12", { 0: DONE });
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/class="chip-button"[^>]*>Not done</);
  });

  it("Done and Skipped state chips use distinct colour classes from a plain duration chip", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
    ], "chip-colour");
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    writeProgress(localStorage, "chip-colour", "2026-08-12", { 0: DONE, 1: SKIPPED });
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/class="chip ok-chip"[^>]*>Done</);
    expect(html).toMatch(/class="chip warn-chip"[^>]*>Skipped</);
  });

  it("marks the current block with a NOW badge and a distinct class, even when it is the only block open", () => {
    const s = session([{ slot: "warmup", drill: "a", minutes: 10, note: "" }], "now-badge");
    const drills = [drill("a", "Rondo")];
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/run-block-current/);
    expect(html).toMatch(/run-block-now-badge/);
    expect(html).toMatch(/NOW/);
  });
});

describe("SessionRun NOW badge motion", () => {
  it("pulses the NOW badge but disables the animation under prefers-reduced-motion", () => {
    expect(styles).toMatch(/run-block-now-badge/);
    expect(styles).toMatch(/animation:/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
    // The reduced-motion block must actually turn the animation off, not just exist.
    const reducedMotionBlock = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*{([^}]*)}/s);
    expect(reducedMotionBlock).toBeTruthy();
    expect(reducedMotionBlock[1]).toMatch(/animation:\s*none/);
  });
});

describe("SessionRun accordion (interactive)", () => {
  let container, root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  const mountSession = async (props) => {
    root = createRoot(container);
    await act(async () => {
      root.render(<SessionRun {...props} />);
    });
  };

  const threeBlocks = () =>
    session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
      { slot: "tactical", drill: "c", minutes: 20, note: "" },
    ], "interactive");

  const threeDrills = () => [drill("a", "Rondo"), drill("b", "Possession"), drill("c", "Shape")];
  const threeTexts = () => ({
    a: { status: "ready", text: drillText("Rondo") },
    b: { status: "ready", text: drillText("Possession") },
    c: { status: "ready", text: drillText("Shape") },
  });

  it("marking the current block Done collapses it and opens the next unsettled block", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    expect(container.textContent).toContain("Coaching points here"); // block a open

    const doneButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Done");
    await act(async () => { doneButtons[0].click(); });

    // block a is now settled and collapsed; block b (next unsettled) is open
    expect(container.querySelector(".run-block")).toBeTruthy();
    const bodies = container.querySelectorAll(".run-block");
    expect(bodies[0].textContent).toMatch(/done/i);
    expect(bodies[0].textContent).not.toContain("Coaching points here");
    expect(bodies[1].textContent).toContain("Coaching points here");
  });

  it("Skip advances the session the same way Done does", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    const skipButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Skip");
    await act(async () => { skipButtons[0].click(); });

    const bodies = container.querySelectorAll(".run-block");
    expect(bodies[0].textContent).toMatch(/skipped/i);
    expect(bodies[1].textContent).toContain("Coaching points here");
  });

  it("opening a collapsed block shows it in full without changing what is marked", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    const bodiesBefore = container.querySelectorAll(".run-block");
    expect(bodiesBefore[2].textContent).not.toContain("Coaching points here"); // block c collapsed

    const toggle = bodiesBefore[2].querySelector(".run-block-summary");
    await act(async () => { toggle.click(); });

    const bodiesAfter = container.querySelectorAll(".run-block");
    expect(bodiesAfter[2].textContent).toContain("Coaching points here"); // now opened
    // block a is still the current one — opening c did not mark or advance anything
    expect(bodiesAfter[0].textContent).toContain("Coaching points here");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Not done")).toBe(false);
  });

  it("peeking open a settled block while another is current leaves only the current one marked current", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    const doneButtons = () => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Done");
    await act(async () => { doneButtons()[0].click(); }); // settle a; b becomes current

    // Peek block a back open to refer to it, without touching what is marked.
    const bodiesBefore = container.querySelectorAll(".run-block");
    const toggleA = bodiesBefore[0].querySelector(".run-block-summary");
    await act(async () => { toggleA.click(); });

    const bodies = container.querySelectorAll(".run-block");
    expect(bodies[0].textContent).toContain("Coaching points here"); // a is open again (peeked)
    expect(bodies[1].textContent).toContain("Coaching points here"); // b (current) still open too
    // Only b — the actually current block — carries the current marker; a is open but not current.
    expect(bodies[0].classList.contains("run-block-current")).toBe(false);
    expect(bodies[1].classList.contains("run-block-current")).toBe(true);
  });

  it("reopening a settled block makes it current again", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    const doneButtons = () => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Done");
    await act(async () => { doneButtons()[0].click(); }); // settle block a

    const notDoneButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Not done");
    expect(notDoneButtons.length).toBe(1);
    await act(async () => { notDoneButtons[0].click(); });

    const bodies = container.querySelectorAll(".run-block");
    expect(bodies[0].textContent).toContain("Coaching points here"); // a is current again
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Not done")).toBe(false);
  });

  it("says the session is finished and offers to start over once every block is settled", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    for (let i = 0; i < 3; i += 1) {
      const doneButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Done");
      await act(async () => { doneButtons[0].click(); });
    }
    expect(container.textContent).toMatch(/finished/i);
    const startOver = [...container.querySelectorAll("button")].find((b) => b.textContent === "Start over");
    expect(startOver).toBeTruthy();
  });

  it("progress survives a remount on the same day", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    const doneButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Done");
    await act(async () => { doneButtons[0].click(); }); // settle a
    const skipButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Skip");
    await act(async () => { skipButtons[0].click(); }); // skip b (now current)

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SessionRun
          session={threeBlocks()} drills={threeDrills()} texts={threeTexts()} today="2026-08-12"
        />,
      );
    });

    const bodies = container.querySelectorAll(".run-block");
    expect(bodies[0].textContent).toMatch(/done/i);
    expect(bodies[1].textContent).toMatch(/skipped/i);
    expect(bodies[2].textContent).toContain("Coaching points here"); // c is now current
  });

  it("a new day starts clean, from the first block", async () => {
    await mountSession({
      session: threeBlocks(), drills: threeDrills(), texts: threeTexts(), today: "2026-08-12",
    });
    const doneButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Done");
    await act(async () => { doneButtons[0].click(); });

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SessionRun
          session={threeBlocks()} drills={threeDrills()} texts={threeTexts()} today="2026-08-13"
        />,
      );
    });

    const bodies = container.querySelectorAll(".run-block");
    expect(bodies[0].textContent).toContain("Coaching points here"); // a is current again
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Not done")).toBe(false);
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

// Swapping is the one thing the run view does that changes the PLAN rather than tonight's
// progress, so these tests pin both halves: what is reported upwards (App writes it), and
// what this component cleans up locally (the block's mark).
describe("SessionRun swapping a drill", () => {
  let container, root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  // Synchronous sibling of the accordion suite's mountSession: nothing here awaits Drive,
  // and remounting into the same container (the onSwap-present/absent pair below) has to
  // replace the previous tree rather than render a second one beside it.
  const mount = (props) => {
    if (root) act(() => root.unmount());
    root = createRoot(container);
    act(() => { root.render(<SessionRun {...props} />); });
  };

  const findButton = (text) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  const swapSession = () => session([
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ]);
  const swapDrills = runDrills;
  const texts = {
    a: { status: "ready", text: drillText("Alpha") },
    b: { status: "ready", text: drillText("Bravo") },
  };

  it("offers Swap on the open block only when onSwap is given", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts });
    expect(findButton("Swap")).toBeUndefined();
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    expect(findButton("Swap")).toBeDefined();
    // On the OPEN block only: block 1 is collapsed, and a collapsed block offers no
    // controls at all — hence exactly one Swap for the two blocks.
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Swap"))
      .toHaveLength(1);
    expect(container.querySelectorAll(".run-block-collapsed")[0].querySelector(".run-block-actions"))
      .toBeNull();
  });

  it("labels it Choose a drill when the slot is empty", () => {
    const s = session([{ slot: "warmup", drill: null, minutes: null, note: "" }]);
    mount({ session: s, drills: swapDrills(), texts, onSwap: () => {} });
    expect(findButton("Choose a drill")).toBeDefined();
  });

  it("shows the picker in place of the drill body, and hides it again on cancel", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    expect(container.textContent).toContain("Coaching points here");
    act(() => { findButton("Swap").click(); });
    expect(container.querySelector(".drill-picker")).not.toBeNull();
    expect(container.textContent).not.toContain("Coaching points here");
    act(() => { findButton("Cancel swap").click(); });
    expect(container.querySelector(".drill-picker")).toBeNull();
    expect(container.textContent).toContain("Coaching points here");
  });

  it("does not offer the drill already in the block", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { findButton("Swap").click(); });
    const offered = [...container.querySelectorAll(".drill-picker-option .block-title")]
      .map((e) => e.textContent);
    expect(offered).not.toContain("Alpha");
    expect(offered).toContain("Charlie");
  });

  it("puts a like-for-like drill first: same category and a shared tag", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { findButton("Swap").click(); });
    const first = container.querySelector(".drill-picker-option .block-title").textContent;
    expect(first).toBe("Charlie"); // warmup + mobility, like Alpha; Bravo is a skill drill
  });

  it("reports the block index and the chosen slug, then closes the picker", () => {
    const onSwap = vi.fn();
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap });
    act(() => { findButton("Swap").click(); });
    act(() => { container.querySelector(".drill-picker-option").click(); });
    expect(onSwap).toHaveBeenCalledWith(0, "c");
    expect(container.querySelector(".drill-picker")).toBeNull();
  });

  it("clears the block's mark: a swapped drill was never done", () => {
    // Block 0 marked done, so block 1 is current. Peek block 0 open and swap its drill:
    // its "Done" chip must go, and block 0 becomes current again.
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE });
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {}, today: "2026-08-13" });
    act(() => { container.querySelectorAll(".run-block-summary")[0].click(); });
    act(() => { findButton("Swap").click(); });
    act(() => { container.querySelector(".drill-picker-option").click(); });
    const first = container.querySelectorAll(".run-block")[0];
    // The summary row, not the whole block: an unsettled block's body carries a Done
    // BUTTON, which is the opposite of a Done mark.
    expect(first.querySelector(".run-block-summary").textContent).not.toContain("Done");
    expect(first.querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("marking a block Done while its picker is open leaves it showing the drill, not the picker", () => {
    // Done collapses the block. Reopening it must show the drill it now holds — a block
    // that is being marked has stopped choosing.
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { findButton("Swap").click(); });
    act(() => { findButton("Done").click(); });
    act(() => { container.querySelectorAll(".run-block-summary")[0].click(); }); // peek it open
    const first = container.querySelectorAll(".run-block")[0];
    expect(first.querySelector(".drill-picker")).toBeNull();
    expect(first.textContent).toContain("Coaching points here");
  });

  it("collapsing a block while its picker is open leaves it showing the drill, not the picker", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { container.querySelectorAll(".run-block-summary")[1].click(); }); // peek block 1
    const swaps = () => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Swap");
    act(() => { swaps()[1].click(); }); // block 1's Swap
    act(() => { container.querySelectorAll(".run-block-summary")[1].click(); }); // collapse it
    act(() => { container.querySelectorAll(".run-block-summary")[1].click(); }); // and open again
    const second = container.querySelectorAll(".run-block")[1];
    expect(second.querySelector(".drill-picker")).toBeNull();
    expect(second.textContent).toContain("Coaching points here");
  });

  it("un-marking a block while its picker is open leaves it showing the drill, not the picker", () => {
    // Same stranding as Done, from the other direction: Not done re-settles the block
    // and collapses it, so it too has stopped choosing.
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE });
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {}, today: "2026-08-13" });
    act(() => { container.querySelectorAll(".run-block-summary")[0].click(); }); // peek block 0
    act(() => { findButton("Swap").click(); });
    act(() => { findButton("Not done").click(); });
    const first = container.querySelectorAll(".run-block")[0];
    expect(first.querySelector(".drill-picker")).toBeNull();
    expect(first.textContent).toContain("Coaching points here");
  });

  it("only one block can be picking at a time", () => {
    mount({ session: swapSession(), drills: swapDrills(), texts, onSwap: () => {} });
    act(() => { container.querySelectorAll(".run-block-summary")[1].click(); }); // peek block 1
    const swaps = () => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Swap");
    act(() => { swaps()[0].click(); });
    act(() => { swaps()[0].click(); }); // the remaining Swap belongs to the other block
    expect(container.querySelectorAll(".drill-picker")).toHaveLength(1);
  });
});

// Catalogue renders <SessionRun> at the same position whichever session is being run,
// so browser back/forward between #/session/a/run and #/session/b/run RE-RENDERS this
// component rather than remounting it. Everything read once at mount — tonight's marks
// above all — has to notice that the session underneath it changed.
describe("SessionRun handed a different session", () => {
  let container, root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  const DAY = "2026-08-13";
  const drills = () => [
    { ...drill("a", "Alpha", 10, "warmup"), tags: [] },
    { ...drill("b", "Bravo", 10, "skill"), tags: [] },
    { ...drill("c", "Charlie", 5, "warmup"), tags: [] },
  ];
  const texts = {
    a: { status: "ready", text: drillText("Alpha") },
    b: { status: "ready", text: drillText("Bravo") },
    c: { status: "ready", text: drillText("Charlie") },
  };
  const sessionA = () => session([
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ], "s1");
  const sessionB = () => session([
    { slot: "warmup", drill: "c", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ], "s2");

  // Renders into the SAME root, so the second call is a re-render of a mounted
  // component — the whole point of this suite.
  const show = (props) => {
    root ??= createRoot(container);
    act(() => { root.render(<SessionRun drills={drills()} texts={texts} today={DAY} {...props} />); });
  };
  const summaries = () => [...container.querySelectorAll(".run-block-summary")];

  it("shows the new session's progress, not the old session's", () => {
    writeProgress(localStorage, "s1", DAY, { 0: DONE, 1: SKIPPED });
    show({ session: sessionA() });
    expect(summaries()[0].textContent).toContain("Done");

    show({ session: sessionB() }); // nothing marked for s2
    expect(summaries()[0].textContent).not.toContain("Done");
    expect(summaries()[1].textContent).not.toContain("Skipped");
    expect(container.textContent).toContain("0 done · 0 skipped");
  });

  it("writes a mark under the new session's key, leaving the old session's untouched", () => {
    writeProgress(localStorage, "s1", DAY, { 1: SKIPPED });
    show({ session: sessionA() });
    show({ session: sessionB() });
    act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Done").click(); });
    expect(readProgress(localStorage, "s2", DAY)).toEqual({ 0: DONE });
    expect(readProgress(localStorage, "s1", DAY)).toEqual({ 1: SKIPPED });
  });

  it("drops what was peeked open and any half-finished swap", () => {
    show({ session: sessionA(), onSwap: () => {} });
    act(() => { summaries()[1].click(); }); // peek block 1 open
    act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Swap").click(); });
    expect(container.querySelector(".drill-picker")).not.toBeNull();

    show({ session: sessionB(), onSwap: () => {} });
    expect(container.querySelector(".drill-picker")).toBeNull();
    expect(container.querySelectorAll(".run-block-open")).toHaveLength(1); // only the current one
  });

  it("reloads progress when the day changes under the same session", () => {
    writeProgress(localStorage, "s1", DAY, { 0: DONE });
    show({ session: sessionA() });
    expect(summaries()[0].textContent).toContain("Done");
    show({ session: sessionA(), today: "2026-08-14" }); // a new night, nothing settled
    expect(summaries()[0].textContent).not.toContain("Done");
  });
});

// The run view now has a second source of truth for tonight's marks: the session file,
// which another device may have written. These pin the reconciliation — who wins, what is
// adopted locally, what is reported upward — and above all that it SETTLES, because
// reporting upward comes back as a new session prop.
describe("SessionRun progress reconciliation", () => {
  let container, root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  // Returns the root so a test can re-render into it: App handing back a session that now
  // carries the marks just reported is a re-render, not a remount.
  const mount = (props) => {
    if (root) act(() => root.unmount());
    root = createRoot(container);
    act(() => { root.render(<SessionRun {...props} />); });
    return root;
  };

  const findButton = (text) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  const twoBlocks = () => [
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ];
  const at = (t) => `2026-08-13T${t}:00.000Z`;
  const now = () => at("21:00");

  it("shows marks that were made on another device", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    const blocks = container.querySelectorAll(".run-block");
    expect(blocks[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(blocks[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("writes those marks to this device too, so it works offline from then on", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ 0: DONE });
  });

  it("a newer local mark wins over the session's, and is reported so Drive catches up", () => {
    writeProgress(localStorage, "s1", "2026-08-13", { 0: SKIPPED }, at("20:00"));
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Skipped");
    expect(onProgress).toHaveBeenCalledWith("2026-08-13", { 0: SKIPPED }, at("20:00"));
  });

  it("reports nothing when both sides already agree", () => {
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE }, at("19:00"));
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("reports each mark, skip and un-mark upward with the time it happened", () => {
    const onProgress = vi.fn();
    const s = session(twoBlocks());
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    act(() => { findButton("Done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { 0: DONE }, at("21:00"));
    act(() => { findButton("Skip").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { 0: DONE, 1: SKIPPED }, at("21:00"));
    act(() => { findButton("Not done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { 1: SKIPPED }, at("21:00"));
  });

  it("settles rather than looping when the session prop comes back with what was reported", () => {
    // App writes the reported marks into the session, which re-renders this component.
    // The effect must then find both sides in agreement and do nothing.
    const onProgress = vi.fn();
    let s = session(twoBlocks());
    const r = mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    act(() => { findButton("Done").click(); });
    const [day, marks, stamp] = onProgress.mock.calls.at(-1);
    onProgress.mockClear();
    s = { ...s, progress: { [day]: { marks, updatedAt: stamp } } };
    act(() => {
      r.render(
        <SessionRun
          session={s} drills={runDrills()} texts={{}} today="2026-08-13"
          onProgress={onProgress} now={now}
        />,
      );
    });
    expect(onProgress).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Done");
  });

  it("ignores another day's stored progress", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-12": { marks: { 0: DONE, 1: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("works with no onProgress at all, exactly as before", () => {
    const s = session(twoBlocks());
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13" });
    act(() => { findButton("Done").click(); });
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ 0: DONE });
  });
});

describe("SessionRun print stylesheet", () => {
  it("hides run-view controls and avoids breaking a block across a page", () => {
    expect(styles).toMatch(/@media print/);
    expect(styles).toMatch(/break-inside:\s*avoid/);
  });

  it("hides a half-finished swap entirely: the picker and the buttons above it", () => {
    // The picker renders INSTEAD of the drill body, so on paper a mid-swap block is
    // just its header line. Leaving the Swap/Cancel swap row visible above that gap
    // would print a control that means nothing on paper.
    const print = styles.slice(styles.indexOf("@media print"));
    expect(print).toMatch(/\.drill-picker\s*\{\s*display:\s*none/);
    expect(print).toMatch(/\.run-block-actions\s*\{\s*display:\s*none/);
  });
});
