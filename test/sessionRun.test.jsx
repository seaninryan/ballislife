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
import {
  PRESENT, ABSENT, readAttendance, writeAttendance,
} from "../src/lib/attendance.js";
import { u14a } from "./fixtures/squads.js";

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
    writeProgress(localStorage, "settled-summary", "2026-08-12", { warmup: DONE });
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
    writeProgress(localStorage, "counts-summary", "2026-08-12", { warmup: DONE, skill: SKIPPED });
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
    writeProgress(localStorage, "finished", "2026-08-12", { warmup: DONE, skill: SKIPPED });
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
    writeProgress(localStorage, "not-done-weight", "2026-08-12", { warmup: DONE });
    const html = render({ session: s, drills, texts: {}, today: "2026-08-12" });
    expect(html).toMatch(/class="chip-button"[^>]*>Not done</);
  });

  it("Done and Skipped state chips use distinct colour classes from a plain duration chip", () => {
    const s = session([
      { slot: "warmup", drill: "a", minutes: 10, note: "" },
      { slot: "skill", drill: "b", minutes: 15, note: "" },
    ], "chip-colour");
    const drills = [drill("a", "Rondo"), drill("b", "Possession")];
    writeProgress(localStorage, "chip-colour", "2026-08-12", { warmup: DONE, skill: SKIPPED });
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
    writeProgress(localStorage, "s1", "2026-08-13", { warmup: DONE });
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
    writeProgress(localStorage, "s1", "2026-08-13", { warmup: DONE });
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
    writeProgress(localStorage, "s1", DAY, { warmup: DONE, skill: SKIPPED });
    show({ session: sessionA() });
    expect(summaries()[0].textContent).toContain("Done");

    show({ session: sessionB() }); // nothing marked for s2
    expect(summaries()[0].textContent).not.toContain("Done");
    expect(summaries()[1].textContent).not.toContain("Skipped");
    expect(container.textContent).toContain("0 done · 0 skipped");
  });

  it("writes a mark under the new session's key, leaving the old session's untouched", () => {
    writeProgress(localStorage, "s1", DAY, { skill: SKIPPED });
    show({ session: sessionA() });
    show({ session: sessionB() });
    act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Done").click(); });
    expect(readProgress(localStorage, "s2", DAY)).toEqual({ warmup: DONE });
    expect(readProgress(localStorage, "s1", DAY)).toEqual({ skill: SKIPPED });
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

  it("keeps the day it opened on when midnight passes mid-session", () => {
    // A run view's day is fixed when it opens. Recomputing it per render meant a session
    // still going at 23:59 restarted from block 0 at 00:00, and split the night's marks
    // across two day keys in sessions.json.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-13T23:59:00.000Z"));
      show({ session: sessionA(), today: undefined });
      act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Done").click(); });
      expect(summaries()[0].textContent).toContain("Done");

      vi.setSystemTime(new Date("2026-08-14T00:01:00.000Z"));
      show({ session: sessionA(), today: undefined });
      expect(summaries()[0].textContent).toContain("Done");
      expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ warmup: DONE });
      expect(readProgress(localStorage, "s1", "2026-08-14")).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads progress when the day changes under the same session", () => {
    writeProgress(localStorage, "s1", DAY, { warmup: DONE });
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
      "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    const blocks = container.querySelectorAll(".run-block");
    expect(blocks[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(blocks[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("writes those marks to this device too, so it works offline from then on", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ warmup: DONE });
  });

  it("a newer local mark wins over the session's, and is reported so Drive catches up", () => {
    writeProgress(localStorage, "s1", "2026-08-13", { warmup: SKIPPED }, at("20:00"));
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Skipped");
    expect(onProgress).toHaveBeenCalledWith("2026-08-13", { warmup: SKIPPED }, at("20:00"));
  });

  it("reports nothing when both sides already agree", () => {
    writeProgress(localStorage, "s1", "2026-08-13", { warmup: DONE }, at("19:00"));
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("reports each mark, skip and un-mark upward with the time it happened", () => {
    const onProgress = vi.fn();
    const s = session(twoBlocks());
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    act(() => { findButton("Done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { warmup: DONE }, at("21:00"));
    act(() => { findButton("Skip").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { warmup: DONE, skill: SKIPPED }, at("21:00"));
    act(() => { findButton("Not done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { skill: SKIPPED }, at("21:00"));
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

  it("reconciles tonight's stored progress and ignores another day's", () => {
    // Both days present, so this fails if the wrong day is read AND if reconciliation is
    // skipped altogether — asserting only that block 0 is current proved neither.
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-12": { marks: { warmup: DONE, skill: DONE }, updatedAt: at("19:00") },
      "2026-08-13": { marks: { skill: SKIPPED }, updatedAt: at("20:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    const summaries = [...container.querySelectorAll(".run-block-summary")];
    expect(summaries[0].textContent).not.toContain("Done");
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-now-badge")).not.toBeNull();
    expect(summaries[1].textContent).toContain("Skipped");
    // Tonight's marks were adopted onto this device; yesterday's were not written anywhere.
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ skill: SKIPPED });
    expect(readProgress(localStorage, "s1", "2026-08-12")).toEqual({});
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("adopts the other device's marks even when this device's clock is wildly fast", () => {
    // A local stamp in 2027 beat every real stamp forever, so the other device could never
    // be adopted and the stale local marks were re-reported on every reconcile.
    writeProgress(localStorage, "s1", "2026-08-13", { warmup: SKIPPED }, "2027-01-01T00:00:00.000Z");
    const onProgress = vi.fn();
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("20:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Done");
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ warmup: DONE });
    expect(onProgress).not.toHaveBeenCalled();
  });

  // The owner reads and hand-edits sessions.json, so an entry he typed himself — with no
  // stamp, or a stamp we cannot parse — must still be shown and must above all SURVIVE.
  // Reporting {} upward for it made App save the session with the entry emptied out.
  describe("a hand-edited progress entry", () => {
    const cases = {
      "no updatedAt at all": { marks: { 0: DONE, 1: SKIPPED } },
      "an unparseable updatedAt": { marks: { 0: DONE, 1: SKIPPED }, updatedAt: "last night" },
      "a numeric updatedAt": { marks: { 0: DONE, 1: SKIPPED }, updatedAt: 1770000000000 },
      "a date-only updatedAt": { marks: { 0: DONE, 1: SKIPPED }, updatedAt: "2026-08-13" },
    };

    for (const [label, entry] of Object.entries(cases)) {
      it(`with ${label} is shown, and is never overwritten from this device`, () => {
        const onProgress = vi.fn();
        const s = { ...session(twoBlocks()), progress: { "2026-08-13": entry } };
        mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
        const summaries = [...container.querySelectorAll(".run-block-summary")];
        expect(summaries[0].textContent).toContain("Done");
        expect(summaries[1].textContent).toContain("Skipped");
        // Nothing reported means App writes nothing, which is what keeps the file intact.
        expect(onProgress.mock.calls.filter(([, marks]) => Object.keys(marks).length === 0))
          .toEqual([]);
      });
    }

    it("stays intact when this device's own marks are unstamped too", () => {
      // An entry written before stamps existed wins on screen here, but has nothing to
      // prove it is newer, so it must stay silent until the next tap stamps it.
      localStorage.setItem("ballislife_progress", JSON.stringify({
        s1: { date: "2026-08-13", marks: { 1: DONE } },
      }));
      const onProgress = vi.fn();
      const s = { ...session(twoBlocks()), progress: {
        "2026-08-13": { marks: { 0: DONE, 1: SKIPPED } },
      } };
      mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress, now });
      expect([...container.querySelectorAll(".run-block-summary")][1].textContent).toContain("Done");
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  it("works with no onProgress at all, exactly as before", () => {
    const s = session(twoBlocks());
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13" });
    act(() => { findButton("Done").click(); });
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ warmup: DONE });
  });
});

// The bug this suite exists for: marks used to be keyed by a block's position, so
// reordering the plan moved a "Done" onto whatever drill took that position — and, since
// the marks reach the session file, onto the other device as well.
describe("SessionRun marks follow the drill, not the position", () => {
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

  const mount = (props) => {
    if (root) act(() => root.unmount());
    root = createRoot(container);
    act(() => { root.render(<SessionRun {...props} />); });
  };

  const findButton = (text) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  const twoBlocks = () => [
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ];
  const at = (t) => `2026-08-13T${t}:00.000Z`;
  const now = () => at("21:00");

  it("a reordered plan keeps each mark on its own drill", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { warmup: DONE }, updatedAt: at("19:00") },
    } };
    // Same session, blocks swapped — exactly what moveBlock produces.
    const swapped = { ...s, blocks: [s.blocks[1], s.blocks[0]] };
    mount({ session: swapped, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    const rows = container.querySelectorAll(".run-block");
    // Row 0 is now the skill block, and it is the one to do next.
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("skill");
    expect(rows[0].querySelector(".run-block-now-badge")).not.toBeNull();
    // Row 1 is the warmup, still Done.
    expect(rows[1].querySelector(".run-block-summary").textContent).toContain("Done");
  });

  it("marks are stored by slot", () => {
    const onProgress = vi.fn();
    mount({
      session: session(twoBlocks()), drills: runDrills(), texts: {},
      today: "2026-08-13", onProgress, now,
    });
    act(() => { findButton("Done").click(); });
    expect(onProgress).toHaveBeenLastCalledWith("2026-08-13", { warmup: DONE }, at("21:00"));
    expect(readProgress(localStorage, "s1", "2026-08-13")).toEqual({ warmup: DONE });
  });

  it("an index-keyed mark left by the previous version still loads, onto the right drill", () => {
    // A deploy can land between two drills. Tonight's progress must not evaporate.
    writeProgress(localStorage, "s1", "2026-08-13", { 0: DONE }, at("19:00"));
    mount({
      session: session(twoBlocks()), drills: runDrills(), texts: {},
      today: "2026-08-13", onProgress: () => {}, now,
    });
    const rows = container.querySelectorAll(".run-block");
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("Done");
    expect(rows[1].querySelector(".run-block-now-badge")).not.toBeNull();
  });

  it("an index-keyed mark in the session file loads too", () => {
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    mount({ session: s, drills: runDrills(), texts: {}, today: "2026-08-13", onProgress: () => {}, now });
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Done");
  });

  it("repairs an index-keyed session file when the plan is reordered under it", () => {
    // The effect's remoteKey is built from the MIGRATED marks, not the raw ones. Raw, the
    // key would be identical before and after a reorder — index 0 either way — so the
    // effect would not re-run and the stale index-keyed marks would stay in Drive, where
    // another device would read index 0 as whichever drill now sits there. Migrating first
    // makes the key change, which re-runs the reconciliation and reports the slot-keyed
    // correction upward.
    const s = { ...session(twoBlocks()), progress: {
      "2026-08-13": { marks: { 0: DONE }, updatedAt: at("19:00") },
    } };
    const onProgress = vi.fn();
    root = createRoot(container);
    act(() => { root.render(<SessionRun session={s} drills={runDrills()} texts={{}} today="2026-08-13" onProgress={onProgress} now={now} />); });
    // Index 0 was the warm-up when the mark was made, so that is where it lands.
    expect(container.querySelectorAll(".run-block")[0].querySelector(".run-block-summary").textContent)
      .toContain("Done");
    onProgress.mockClear();

    // Now the blocks are swapped in place, as moveBlock does.
    const swapped = { ...s, blocks: [s.blocks[1], s.blocks[0]] };
    act(() => { root.render(<SessionRun session={swapped} drills={runDrills()} texts={{}} today="2026-08-13" onProgress={onProgress} now={now} />); });
    const rows = container.querySelectorAll(".run-block");
    // The mark stays on the warm-up, which is now the second row. The skill block, which
    // moved into position 0, is emphatically NOT done.
    expect(rows[0].querySelector(".run-block-summary").textContent).toContain("skill");
    expect(rows[0].querySelector(".run-block-now-badge")).not.toBeNull();
    expect(rows[1].querySelector(".run-block-summary").textContent).toContain("Done");
    // And Drive is told to store it by slot, so the next device to read it agrees.
    expect(onProgress).toHaveBeenCalledWith("2026-08-13", { warmup: DONE }, at("19:00"));
  });
});

// The register is the first section of the run view: the thing you do before anything
// else on the pitch. It is NOT a block — the accordion's NOW badge and current-block
// logic are about drills, and an untaken register must not stop one being current — and
// its marks take exactly the path progress takes: localStorage first, then upward.
describe("SessionRun attendance", () => {
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

  const mount = (props) => {
    if (root) act(() => root.unmount());
    root = createRoot(container);
    act(() => { root.render(<SessionRun {...props} />); });
    return root;
  };

  const twoBlocks = () => [
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ];
  const DAY = "2026-08-13";
  const at = (t) => `${DAY}T${t}:00.000Z`;
  const now = () => at("19:00");
  const squad = u14a();
  const idOf = (name) => squad.players.find((p) => p.name === name).id;
  const base = (props = {}) => ({
    session: session(twoBlocks()), drills: runDrills(), texts: {}, today: DAY,
    squad, now, ...props,
  });
  const rows = () => [...container.querySelectorAll(".attendance-row")];
  const rowFor = (name) => rows().find((r) => r.textContent.includes(name));

  it("is the first section, above the first block", () => {
    mount(base());
    const html = container.innerHTML;
    expect(html.indexOf("run-attendance")).toBeLessThan(html.indexOf("run-block"));
    expect(rows()).toHaveLength(15);
  });

  it("is open when nothing is marked yet — it is the first thing you do", () => {
    mount(base());
    expect(container.querySelector(".run-attendance-summary").getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(15);
  });

  it("starts with everybody absent, and says so", () => {
    // Mark by exception: he ticks the ones who arrive or send word. Nothing is stored for
    // any of them yet — the screen is showing the assumption, not a record.
    mount(base());
    for (const row of rows()) expect(row.textContent).toContain("Absent");
    expect(readAttendance(localStorage, "s1", DAY)).toEqual({});
  });

  it("is closed once the register has been taken — and then not again", () => {
    writeAttendance(localStorage, "s1", DAY, { [idOf("Kevin")]: PRESENT }, at("18:50"));
    mount(base());
    expect(container.querySelector(".run-attendance-summary").getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toHaveLength(0);
    // Still reachable, and it says what it holds without being opened.
    expect(container.querySelector(".run-attendance").textContent).toMatch(/1 present/);
  });

  it("collapsed, shows the one number the rest of the night uses and nothing else", () => {
    // Nothing is outstanding any more — an untouched name is an absence, not a gap — so
    // there is no "N to go" to show. What is left is the present count, which is what the
    // swap picker means by turnout; the breakdown is one tap away in the register itself.
    writeAttendance(localStorage, "s1", DAY, {
      [idOf("Kevin")]: PRESENT, [idOf("Alfie Ryan")]: PRESENT, [idOf("Jack Melia")]: ABSENT,
    }, at("18:50"));
    mount(base());
    const summary = container.querySelector(".run-attendance").textContent;
    expect(summary).toMatch(/2 present/);
    expect(summary).not.toMatch(/to go/);
  });

  it("collapsed, still says nothing was taken when nothing was touched", () => {
    // The distinction that survives the change: a night he never took the register on
    // records nothing at all, and must not read as fifteen absences he stood over.
    mount(base());
    expect(container.querySelector(".run-attendance-summary").textContent).toMatch(/not taken/);
  });

  // The collapsed header and the register open beneath it are the same screen: two numbers
  // for the same question is a bug however each is arrived at. Nothing compared them before,
  // which is how they came to disagree.
  it("the collapsed header and the open register agree once a marked player leaves the squad", () => {
    const gone = idOf("Alfie Ryan");
    const shrunk = {
      ...squad,
      players: squad.players.map((p) => (p.id === gone ? { ...p, left: true } : p)),
    };
    writeAttendance(localStorage, "s1", DAY,
      { [gone]: PRESENT, [idOf("Kevin")]: PRESENT }, at("18:50"));
    mount(base({ squad: shrunk }));

    const header = container.querySelector(".run-attendance-summary").textContent;
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    const open = container.querySelector(".attendance-summary").textContent;

    // 14 in the squad, one of them ticked: the departed player's mark is last month's
    // record, not tonight's count. The other 13 are absent, marked or not.
    expect(header).toMatch(/1 present/);
    expect(open).toMatch(/1 present/);
    expect(open).toMatch(/13 absent/);
  });

  it("is closed when the register was taken on the other device", () => {
    const s = { ...session(twoBlocks()), attendance: {
      [DAY]: { marks: { [idOf("Alfie Ryan")]: PRESENT }, updatedAt: at("18:50") },
    } };
    mount(base({ session: s, onAttendance: () => {} }));
    expect(container.querySelector(".run-attendance-summary").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a register taken on the laptop from the very first frame", () => {
    // renderToStaticMarkup runs no effects, so this is the frame before reconciliation.
    // The open/closed state was already derived from local+remote while the marks came
    // from this device alone: the section rendered once as collapsed-and-"not taken",
    // then flickered to "1 present" when the effect adopted what Drive held.
    const s = { ...session(twoBlocks()), attendance: {
      [DAY]: { marks: { [idOf("Alfie Ryan")]: PRESENT }, updatedAt: at("18:50") },
    } };
    const html = renderToStaticMarkup(<SessionRun {...base({ session: s, onAttendance: () => {} })} />);
    expect(html).toContain("1 present");
    expect(html).not.toMatch(/not taken/);
  });

  it("opens and closes on its summary, like a block", () => {
    writeAttendance(localStorage, "s1", DAY, { [idOf("Kevin")]: PRESENT }, at("18:50"));
    mount(base());
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    expect(rows()).toHaveLength(15);
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    expect(rows()).toHaveLength(0);
  });

  it("an untaken register does not stop a drill being current, or shift which one it is", () => {
    mount(base());
    const attendance = container.querySelector(".run-attendance");
    expect(attendance.querySelector(".run-block-now-badge")).toBeNull();
    expect(attendance.classList.contains("run-block-current")).toBe(false);
    // Exactly one thing on screen is current, and it is the first drill.
    const current = container.querySelectorAll(".run-block-current");
    expect(current).toHaveLength(1);
    expect(current[0].querySelector(".run-block-summary").textContent).toContain("warmup");
    expect(container.querySelectorAll(".run-block-now-badge")).toHaveLength(1);
  });

  it("a tap writes to this device first, then reports the register upward with its time", () => {
    const onAttendance = vi.fn();
    mount(base({ onAttendance }));
    act(() => { rowFor("Cillian Conlan").click(); });
    expect(readAttendance(localStorage, "s1", DAY)).toEqual({ [idOf("Cillian Conlan")]: PRESENT });
    expect(onAttendance).toHaveBeenLastCalledWith(DAY, { [idOf("Cillian Conlan")]: PRESENT }, at("19:00"));
    // And the row shows it, without waiting for anything to come back.
    expect(rowFor("Cillian Conlan").textContent).toContain("Present");
  });

  it("cycling a player round from excused stores an explicit absent, not an empty register", () => {
    // Removing the key would leave the row showing exactly what it showed before — absent —
    // while quietly emptying the register, and an empty register is how a night he never
    // took one is recognised. So the last stop on the cycle is a stored value like the rest.
    const onAttendance = vi.fn();
    const kevin = idOf("Kevin");
    writeAttendance(localStorage, "s1", DAY, { [kevin]: "excused" }, at("18:50"));
    mount(base({ onAttendance }));
    act(() => { container.querySelector(".run-attendance-summary").click(); }); // it opens closed
    act(() => { rowFor("Kevin").click(); });
    expect(readAttendance(localStorage, "s1", DAY)).toEqual({ [kevin]: ABSENT });
    expect(onAttendance).toHaveBeenLastCalledWith(DAY, { [kevin]: ABSENT }, at("19:00"));
    expect(rowFor("Kevin").textContent).toContain("Absent");
  });

  it("stores only what he actually tapped: the other fourteen absences are not invented", () => {
    // Default-absent is a reading of the register, never a write to it. Storing fifteen
    // absences on the first tap would record a claim he never made about anyone else.
    mount(base());
    act(() => { rowFor("Kevin").click(); });
    expect(readAttendance(localStorage, "s1", DAY)).toEqual({ [idOf("Kevin")]: PRESENT });
  });

  it("works with no onAttendance at all: the tap is still kept on this device", () => {
    mount(base());
    act(() => { rowFor("Jack Melia").click(); });
    expect(readAttendance(localStorage, "s1", DAY)).toEqual({ [idOf("Jack Melia")]: PRESENT });
  });

  it("shows a register taken on another device, and adopts it onto this one", () => {
    const s = { ...session(twoBlocks()), attendance: {
      [DAY]: { marks: { [idOf("Alfie Ryan")]: PRESENT, [idOf("Kevin")]: ABSENT }, updatedAt: at("18:50") },
    } };
    const onAttendance = vi.fn();
    mount(base({ session: s, onAttendance }));
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    expect(rowFor("Alfie Ryan").textContent).toContain("Present");
    expect(rowFor("Kevin").textContent).toContain("Absent");
    expect(readAttendance(localStorage, "s1", DAY))
      .toEqual({ [idOf("Alfie Ryan")]: PRESENT, [idOf("Kevin")]: ABSENT });
    expect(onAttendance).not.toHaveBeenCalled();
  });

  it("a newer register on this device wins, and is reported so Drive catches up", () => {
    writeAttendance(localStorage, "s1", DAY, { [idOf("Kevin")]: PRESENT }, at("19:30"));
    const s = { ...session(twoBlocks()), attendance: {
      [DAY]: { marks: { [idOf("Kevin")]: ABSENT }, updatedAt: at("18:50") },
    } };
    const onAttendance = vi.fn();
    mount(base({ session: s, onAttendance, now: () => at("20:00") }));
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    expect(rowFor("Kevin").textContent).toContain("Present");
    expect(onAttendance).toHaveBeenCalledWith(DAY, { [idOf("Kevin")]: PRESENT }, at("19:30"));
  });

  it("settles rather than looping when the session comes back with what was reported", () => {
    const onAttendance = vi.fn();
    let s = session(twoBlocks());
    const r = mount(base({ session: s, onAttendance }));
    act(() => { rowFor("Mikey Gilligan").click(); });
    const [day, marks, stamp] = onAttendance.mock.calls.at(-1);
    onAttendance.mockClear();
    s = { ...s, attendance: { [day]: { marks, updatedAt: stamp } } };
    act(() => {
      r.render(
        <SessionRun
          session={s} drills={runDrills()} texts={{}} today={DAY}
          squad={squad} onAttendance={onAttendance} now={now}
        />,
      );
    });
    expect(onAttendance).not.toHaveBeenCalled();
    expect(rowFor("Mikey Gilligan").textContent).toContain("Present");
  });

  it("keeps a register for another day out of tonight's", () => {
    const s = { ...session(twoBlocks()), attendance: {
      "2026-08-12": { marks: { [idOf("Kevin")]: PRESENT }, updatedAt: "2026-08-12T19:00:00.000Z" },
    } };
    const onAttendance = vi.fn();
    mount(base({ session: s, onAttendance }));
    expect(rowFor("Kevin").textContent).not.toContain("Present");
    expect(onAttendance).not.toHaveBeenCalled();
  });

  it("shows the register of the session on screen when a different one is handed in", () => {
    // Same re-render-not-remount case the progress suite pins: Catalogue renders one
    // SessionRun whichever plan is being run.
    writeAttendance(localStorage, "s1", DAY, { [idOf("Kevin")]: PRESENT }, at("18:50"));
    const r = mount(base());
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    expect(rowFor("Kevin").textContent).toContain("Present");
    act(() => {
      r.render(
        <SessionRun
          session={session(twoBlocks(), "s2")} drills={runDrills()} texts={{}} today={DAY}
          squad={squad} now={now}
        />,
      );
    });
    expect(rowFor("Kevin").textContent).not.toContain("Present");
  });

  it("a session with no squad says so and offers no register", () => {
    mount(base({ squad: null }));
    expect(rows()).toHaveLength(0);
    expect(container.querySelector(".run-attendance").textContent).toMatch(/no squad/i);
    // And the drills are entirely unaffected by there being nobody to tick.
    expect(container.querySelectorAll(".run-block")).toHaveLength(2);
    expect(container.querySelectorAll(".run-block-now-badge")).toHaveLength(1);
  });

  // Swapping mid-session is the moment turnout matters most: the plan did not survive the
  // eleven who actually turned up, and the picker must stop offering the drill that needs
  // twenty. So the register answers it, unless a number was typed on the plan.
  describe("turnout for the swap picker", () => {
    const sizedDrills = () => [
      { ...drill("a", "Alpha", 10, "warmup"), players: "6-8" },
      { ...drill("b", "Bravo", 10, "skill"), players: null },
      { ...drill("c", "Charlie", 5, "warmup"), players: "6-8" },
      { ...drill("d", "Delta", 5, "warmup"), players: "20+" },
    ];
    const offered = () => [...container.querySelectorAll(".drill-picker-option .block-title")]
      .map((e) => e.textContent);
    const swap = () => {
      act(() => {
        [...container.querySelectorAll("button")].find((b) => b.textContent === "Swap").click();
      });
    };
    // Six here, the other nine marked absent. Since default-absent this is the same answer
    // as sixPresent() below — both are a register that says six.
    const sixOfFifteen = () => Object.fromEntries(
      squad.players.map((p, i) => [p.id, i < 6 ? PRESENT : ABSENT]),
    );
    const sixPresent = () => Object.fromEntries(
      squad.players.slice(0, 6).map((p) => [p.id, PRESENT]),
    );

    it("uses the register's count when the plan has no turnout typed on it", () => {
      writeAttendance(localStorage, "s1", DAY, sixOfFifteen(), at("18:50"));
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toContain("Charlie"); // 6-8 fits the six who came
      expect(offered()).not.toContain("Delta"); // 20+ does not
    });

    it("a turnout typed on the plan still wins over the register", () => {
      writeAttendance(localStorage, "s1", DAY, sixOfFifteen(), at("18:50"));
      const s = { ...session(twoBlocks()), turnout: 22 };
      mount(base({ session: s, drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toContain("Delta");
      expect(offered()).not.toContain("Charlie");
    });

    it("a typed turnout wins over a register of a few ticks too", () => {
      writeAttendance(localStorage, "s1", DAY, sixPresent(), at("18:50"));
      const s = { ...session(twoBlocks()), turnout: 22 };
      mount(base({ session: s, drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toContain("Delta");
      expect(offered()).not.toContain("Charlie");
    });

    it("offers everything while the register is untaken, rather than nothing", () => {
      // An untaken register is not a turnout of zero, which would hide every drill that
      // says how many it needs. This is the one case that stays unknown: there is no entry
      // for the night at all, so nothing has been said about who is here.
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      expect(offered()).toEqual([]); // the picker is not open yet
      swap();
      expect(offered()).toEqual(expect.arrayContaining(["Charlie", "Delta"]));
    });

    it("six ticked present IS a turnout of six: there is no half-taken register any more", () => {
      // The old rule waited for every player to be marked, because an unmarked player was
      // unaccounted for. Now he is absent — six ticked among fifteen absences is a squad of
      // six, and that is what the picker should be sized to.
      writeAttendance(localStorage, "s1", DAY, sixPresent(), at("18:50"));
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toContain("Charlie");
      expect(offered()).not.toContain("Delta");
    });

    it("a register of one arrival sizes the picker to one — and says so, escapably", () => {
      // The cost of the rule above, and it is real: one tick then Swap offers almost
      // nothing. The picker's own turnout toggle is the way out, and it names the number
      // so a wrong one is recognisable rather than mysterious.
      writeAttendance(localStorage, "s1", DAY, { [idOf("Kevin")]: PRESENT }, at("18:50"));
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toEqual(["Bravo"]);
      const box = container.querySelector(".drill-picker-fits input[type=checkbox]");
      expect(container.querySelector(".drill-picker-fits").textContent).toContain("1");
      act(() => { box.click(); });
      expect(offered()).toEqual(expect.arrayContaining(["Charlie", "Delta"]));
    });

    it("a register where nobody came IS a turnout of zero", () => {
      const marks = Object.fromEntries(squad.players.map((p) => [p.id, ABSENT]));
      writeAttendance(localStorage, "s1", DAY, marks, at("18:50"));
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      swap();
      // Nothing sized fits nobody; the drill that says nothing about numbers still does.
      expect(offered()).toEqual(["Bravo"]);
    });

    it("one absence marked is a taken register, and its answer is nobody yet", () => {
      // Two taps on one row used to leave the turnout unknown. It is a turnout of zero now,
      // which is the honest reading of "the register says nobody is here" — and the toggle
      // above is what makes that safe.
      writeAttendance(localStorage, "s1", DAY, { [idOf("Kevin")]: ABSENT }, at("18:50"));
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toEqual(["Bravo"]);
    });

    it("follows the register as it is taken, without leaving the run view", () => {
      writeAttendance(localStorage, "s1", DAY, Object.fromEntries(
        squad.players.slice(6).map((p) => [p.id, ABSENT]),
      ), at("18:50"));
      mount(base({ drills: sizedDrills(), onSwap: () => {} }));
      act(() => { container.querySelector(".run-attendance-summary").click(); });
      for (const name of ["Alfie Ryan", "Cillian Conlan", "Danny Mitchell", "Aaron Cummins",
        "Matthew Drysdale", "Daragh B Kelly"]) {
        act(() => { rowFor(name).click(); });
      }
      swap();
      expect(offered()).toContain("Charlie");
      expect(offered()).not.toContain("Delta");
    });

    it("a plan with no squad is never sized by a register it cannot have", () => {
      // Nobody to tick is not nobody there: an empty roster must read as unknown, not zero.
      mount(base({ squad: null, drills: sizedDrills(), onSwap: () => {} }));
      swap();
      expect(offered()).toEqual(expect.arrayContaining(["Charlie", "Delta"]));
    });
  });

  it("a register survives a remount on the same day, and a new day starts clean", () => {
    mount(base());
    act(() => { rowFor("Sean Coughlan").click(); });

    mount(base());
    act(() => { container.querySelector(".run-attendance-summary").click(); });
    expect(rowFor("Sean Coughlan").textContent).toContain("Present");

    mount(base({ today: "2026-08-14", now: () => "2026-08-14T19:00:00.000Z" }));
    expect(rowFor("Sean Coughlan").textContent).not.toContain("Present");
  });
});

// The register collapsed correctly from the day it shipped — aria-expanded flipped, the
// rows went away — and the owner never found it, because nothing about the summary row
// looked tappable. Everything below is about making the affordance visible; none of it
// changes what the toggle does.
describe("SessionRun disclosure affordance", () => {
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

  const twoBlocks = () => [
    { slot: "warmup", drill: "a", minutes: null, note: "" },
    { slot: "skill", drill: "b", minutes: null, note: "" },
  ];
  const mount = () => {
    root = createRoot(container);
    act(() => {
      root.render(
        <SessionRun
          session={session(twoBlocks())} drills={runDrills()} texts={{}}
          today="2026-08-13" squad={u14a()} now={() => "2026-08-13T19:00:00.000Z"}
        />,
      );
    });
  };

  it("marks the register's summary with a disclosure caret", () => {
    mount();
    const summary = container.querySelector(".run-attendance-summary");
    expect(summary.querySelector(".disclosure")).not.toBeNull();
  });

  it("gives every block summary the same caret — they collapse the same way", () => {
    // The blocks have always had exactly this problem; he is only used to them. One
    // convention for "this row opens" beats two.
    mount();
    for (const summary of container.querySelectorAll(".run-block-summary")) {
      expect(summary.querySelector(".disclosure")).not.toBeNull();
    }
  });

  it("says nothing to a screen reader: aria-expanded on the button already does", () => {
    mount();
    expect(container.querySelector(".disclosure").getAttribute("aria-hidden")).toBe("true");
    // And it adds no words to the summary, which several tests read as text.
    expect(container.querySelector(".disclosure").textContent).toBe("");
  });

  it("turns to face the way the section is going, from the expanded state itself", () => {
    // Driven off aria-expanded rather than a class of its own, so the caret cannot get out
    // of step with what the button reports.
    expect(styles).toMatch(/\[aria-expanded="true"\]\s+\.disclosure\s*\{[^}]*rotate/);
    const rule = styles.match(/\.disclosure\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    // Drawn, not typed: a border triangle is not selectable, not announced, and not text.
    expect(rule[1]).toMatch(/border-left:/);
  });

  it("does not animate under prefers-reduced-motion, and does not print", () => {
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
    expect(reduced.some((b) => /\.disclosure[^}]*transition:\s*none/.test(b))).toBe(true);
    const print = styles.slice(styles.indexOf("@media print"));
    expect(print).toMatch(/\.disclosure\s*\{\s*display:\s*none/);
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
