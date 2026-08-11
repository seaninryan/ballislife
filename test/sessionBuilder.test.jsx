// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import React from "react";
import SessionBuilder from "../src/components/SessionBuilder.jsx";
import { emptySession, setBlock } from "../src/lib/sessions.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const drills = [
  { slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8" },
  { slug: "cone-weave", title: "Cone weave", category: "warmup", minutes: 8, players: "20+" },
  { slug: "3v2", title: "3v2 to end line", category: "skill", minutes: 15, players: "8-12" },
  { slug: "ssg", title: "SSG 6v6", category: "match", minutes: 25, players: "12+" },
];

let container;
const mount = (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<SessionBuilder {...props} />); });
  return root;
};

const baseSession = () => emptySession("s1", "2026-08-12", "U12s");

describe("SessionBuilder", () => {
  it("renders a row per block, in order, labelled with its slot", () => {
    mount({ session: baseSession(), drills });
    const text = container.textContent;
    const order = ["warmup", "skill", "tactical", "match", "fun"].map((s) => text.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it("shows the chosen drill's title, and a picker where the slot is empty", () => {
    let s = setBlock(baseSession(), 0, { drill: "rondo-4v2" });
    mount({ session: s, drills });
    expect(container.textContent).toContain("Rondo 4v2");
    // The still-empty skill slot offers a select picker.
    const selects = container.querySelectorAll("select");
    expect(selects.length).toBeGreaterThan(0);
  });

  it("the picker offers drills matching the slot's category", () => {
    mount({ session: baseSession(), drills });
    const selects = container.querySelectorAll("select");
    const warmupSelect = selects[0]; // first block is warmup
    const options = [...warmupSelect.querySelectorAll("option")].map((o) => o.textContent);
    expect(options.some((o) => o.includes("Rondo 4v2"))).toBe(true);
    expect(options.some((o) => o.includes("3v2"))).toBe(false);
  });

  it("with a turnout set, a drill that does not fit is not offered", () => {
    mount({ session: baseSession(), drills });
    const turnoutInput = container.querySelector("input[type=number]");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(turnoutInput, "22");
      turnoutInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const warmupSelect = container.querySelectorAll("select")[0];
    const options = [...warmupSelect.querySelectorAll("option")].map((o) => o.textContent);
    // rondo-4v2 needs 6-8 players, 22 turnout does not fit; cone-weave needs 20+, fits.
    expect(options.some((o) => o.includes("Rondo 4v2"))).toBe(false);
    expect(options.some((o) => o.includes("Cone weave"))).toBe(true);
  });

  it("the show all toggle offers drills from other categories", () => {
    mount({ session: baseSession(), drills });
    const toggles = [...container.querySelectorAll("input[type=checkbox]")];
    act(() => { toggles[0].click(); });
    const warmupSelect = container.querySelectorAll("select")[0];
    const options = [...warmupSelect.querySelectorAll("option")].map((o) => o.textContent);
    expect(options.some((o) => o.includes("3v2"))).toBe(true);
  });

  it("shows the running total against the session length", () => {
    let s = setBlock(baseSession(), 0, { drill: "rondo-4v2" });
    s = setBlock(s, 2, { drill: "3v2" });
    mount({ session: s, drills });
    expect(container.textContent).toContain("25′");
    expect(container.textContent).toContain("75′");
  });

  it("warns when the total exceeds the length", () => {
    let s = baseSession();
    s.length = 20;
    s = setBlock(s, 3, { drill: "ssg" }); // 25 minutes
    mount({ session: s, drills });
    expect(container.textContent).toMatch(/over|exceeds/i);
  });

  it("warns which slots are still empty", () => {
    let s = setBlock(baseSession(), 0, { drill: "rondo-4v2" });
    mount({ session: s, drills });
    expect(container.textContent).toMatch(/skill.*empty|empty.*skill/is);
  });

  it("shows a broken reference as broken, with the missing slug, and offers to clear it", () => {
    let s = setBlock(baseSession(), 0, { drill: "deleted-drill" });
    mount({ session: s, drills });
    expect(container.textContent).toMatch(/broken|missing/i);
    expect(container.textContent).toContain("deleted-drill");
    const clearBtn = [...container.querySelectorAll("button")].find((b) => /clear/i.test(b.textContent));
    expect(clearBtn).toBeTruthy();
  });

  it("clearing a broken reference removes the drill from the block", () => {
    let s = setBlock(baseSession(), 0, { drill: "deleted-drill" });
    const onChange = vi.fn();
    mount({ session: s, drills, onChange });
    const clearBtn = [...container.querySelectorAll("button")].find((b) => /clear/i.test(b.textContent));
    act(() => { clearBtn.click(); });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    expect(updated.blocks[0].drill).toBe(null);
  });

  it("↑ is absent on the first block and ↓ on the last", () => {
    mount({ session: baseSession(), drills });
    const rows = container.querySelectorAll(".session-block");
    const first = rows[0];
    const last = rows[rows.length - 1];
    expect([...first.querySelectorAll("button")].some((b) => b.textContent === "↑")).toBe(false);
    expect([...first.querySelectorAll("button")].some((b) => b.textContent === "↓")).toBe(true);
    expect([...last.querySelectorAll("button")].some((b) => b.textContent === "↓")).toBe(false);
    expect([...last.querySelectorAll("button")].some((b) => b.textContent === "↑")).toBe(true);
  });

  it("reordering with ↓ calls onChange with the blocks swapped", () => {
    const onChange = vi.fn();
    mount({ session: baseSession(), drills, onChange });
    const rows = container.querySelectorAll(".session-block");
    const downBtn = [...rows[0].querySelectorAll("button")].find((b) => b.textContent === "↓");
    act(() => { downBtn.click(); });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    expect(updated.blocks.map((b) => b.slot)).toEqual(["skill", "warmup", "tactical", "match", "fun"]);
  });
});
