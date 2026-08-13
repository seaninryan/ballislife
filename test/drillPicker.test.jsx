// @vitest-environment jsdom
// DrillPicker is presentational: given drills and what the slot wants, it renders a
// ranked, searchable, reorderable list and reports the chosen drill. All of the ordering
// rules live in lib/picker.js and are tested there — these tests are about the controls.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import DrillPicker from "../src/components/DrillPicker.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const d = (slug, title, category, minutes, tags = [], players = null, thumb = null) =>
  ({ slug, title, category, minutes, tags, players, thumb });

const THUMB = "area: 20x20 plain\nred: A@5,5 B@15,15\npass: A->B\n";

const drills = [
  d("rondo", "Rondo 4v2", "skill", 12, ["possession", "rondo"]),
  d("hk", "High knees", "warmup", 6, ["mobility"]),
  d("ssg", "SSG 6v6", "match", 25, ["possession"], "12+"),
];

let container;
let root;
const mount = (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<DrillPicker drills={drills} {...props} />); });
  return root;
};

// Every test mounts into a fresh container; without this each one stays mounted in the
// document for the rest of the file, so a stray querySelector could find another test's
// tree — and `container` would leak across tests as the file grows.
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

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

  it("draws each drill's diagram, so a drill can be picked by its shape", () => {
    mount({ slot: "skill", drills: [d("r", "Rondo 4v2", "skill", 12, [], null, THUMB)] });
    const thumb = options()[0].querySelector(".drill-picker-thumb");
    expect(thumb.querySelector("svg")).not.toBeNull();
  });

  it("keeps the row whole for a drill with no diagram", () => {
    mount({ slot: "skill", drills: [d("x", "Bare", "skill", 10)] });
    const row = options()[0];
    // The placeholder holds the same box as a diagram would: without it the titles of
    // drills either side of a diagram-less one no longer line up.
    expect(row.querySelector(".drill-picker-thumb")).not.toBeNull();
    expect(row.querySelector("svg")).toBeNull();
    expect(row.querySelector(".block-title").textContent).toBe("Bare");
  });

  it("offers a way out when given one", () => {
    const onCancel = vi.fn();
    mount({ slot: "warmup", onCancel });
    const cancel = [...container.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent));
    act(() => { cancel.click(); });
    expect(onCancel).toHaveBeenCalled();
  });
});
