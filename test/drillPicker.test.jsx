// @vitest-environment jsdom
// DrillPicker is presentational: given drills and what the slot wants, it renders a
// ranked, searchable, reorderable list and reports the chosen drill. All of the ordering
// rules live in lib/picker.js and are tested there — these tests are about the controls.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import DrillPicker from "../src/components/DrillPicker.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const d = (slug, title, category, minutes, tags = [], players = null) =>
  ({ slug, title, category, minutes, tags, players });

const drills = [
  d("rondo", "Rondo 4v2", "skill", 12, ["possession", "rondo"]),
  d("hk", "High knees", "warmup", 6, ["mobility"]),
  d("ssg", "SSG 6v6", "match", 25, ["possession"], "12+"),
];

let container;
const mount = (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<DrillPicker drills={drills} {...props} />); });
  return root;
};

const options = () => [...container.querySelectorAll(".drill-picker-option")];
const titles = () => options().map((b) => b.querySelector(".block-title").textContent);
const setInput = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("DrillPicker", () => {
  it("offers every drill, best match first", () => {
    mount({ slot: "warmup" });
    expect(titles()[0]).toBe("High knees");
    expect(titles()).toHaveLength(3);
  });

  it("reports the chosen drill", () => {
    const onPick = vi.fn();
    mount({ slot: "warmup", onPick });
    act(() => { options()[0].click(); });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].slug).toBe("hk");
  });

  it("filters as you type", () => {
    mount({ slot: "warmup" });
    setInput(container.querySelector(".drill-picker-search"), "rondo");
    expect(titles()).toEqual(["Rondo 4v2"]);
  });

  it("reorders when a different order is chosen", () => {
    mount({ slot: "warmup" });
    const select = container.querySelector(".drill-picker-order select");
    act(() => {
      select.value = "minutes";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(titles()).toEqual(["High knees", "Rondo 4v2", "SSG 6v6"]);
  });

  it("can be narrowed to the slot's own category", () => {
    mount({ slot: "warmup" });
    const box = container.querySelector(".drill-picker-only input[type=checkbox]");
    act(() => { box.click(); });
    expect(titles()).toEqual(["High knees"]);
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    mount({ slot: "warmup" });
    setInput(container.querySelector(".drill-picker-search"), "zzzz");
    expect(options()).toHaveLength(0);
    expect(container.textContent).toMatch(/no drill/i);
  });

  it("marks the shared tags and the matching category, so the order is explicable", () => {
    mount({ slot: "skill", tags: ["possession"] });
    const first = options()[0];
    expect(first.querySelector(".block-title").textContent).toBe("Rondo 4v2");
    expect(first.textContent).toContain("possession");
    expect(first.querySelector(".drill-picker-category").className).toContain("ok-chip");
  });

  it("shows a drill with no duration as such rather than as 0′", () => {
    mount({ slot: "skill", drills: [d("x", "Bare", "skill", null)] });
    expect(options()[0].textContent).toMatch(/no duration/i);
    expect(options()[0].textContent).not.toContain("0′");
  });

  it("offers a way out when given one", () => {
    const onCancel = vi.fn();
    mount({ slot: "warmup", onCancel });
    [...container.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent)).click();
    expect(onCancel).toHaveBeenCalled();
  });
});
