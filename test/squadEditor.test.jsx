// @vitest-environment jsdom
// One squad: its name, its players, and the ones who have left. Presentational — it holds
// no copy of the squad, so every change has to come back out through onChange.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import SquadEditor from "../src/components/SquadEditor.jsx";
import { addPlayer, emptySquad, removePlayer } from "../src/lib/squads.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
const mount = (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { createRoot(container).render(<SquadEditor {...props} />); });
};

const button = (re) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent));

// A keystroke as the browser makes it: through the native setter, so React's onChange runs.
const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const squad = () => {
  let s = emptySquad("u14a", "U14A Boys");
  s = addPlayer(s, "Sean Ryan");
  s = addPlayer(s, "Ali Khan");
  return s;
};

const addField = () => container.querySelector(".squad-add input");
const playerInputs = () => [...container.querySelectorAll(".squad-player input")];

describe("SquadEditor", () => {
  it("shows the squad's name and a row per current player", () => {
    mount({ squad: squad() });
    expect(container.querySelector(".squad-name").value).toBe("U14A Boys");
    expect(playerInputs().map((i) => i.value)).toEqual(["Sean Ryan", "Ali Khan"]);
  });

  it("reports a rename of the squad itself", () => {
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    type(container.querySelector(".squad-name"), "U14A");
    expect(onChange.mock.calls.at(-1)[0].name).toBe("U14A");
  });

  it("adds a player on submit, and stays focused so the next name can be typed", () => {
    // Twenty names go in at one sitting; taking the focus away after each one would make
    // that twenty taps longer than it needs to be.
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    type(addField(), "Joe Bloggs");
    act(() => { container.querySelector(".squad-add").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    const next = onChange.mock.calls.at(-1)[0];
    expect(next.players.map((p) => p.name)).toEqual(["Sean Ryan", "Ali Khan", "Joe Bloggs"]);
    expect(addField().value).toBe("");
    expect(document.activeElement).toBe(addField());
  });

  it("adds nobody for an empty name", () => {
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    act(() => { container.querySelector(".squad-add").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renames a player without changing the row count or their id", () => {
    // The id is what attendance points at, so a spelling fix must not make a new player.
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    type(playerInputs()[0], "Seán Ryan");
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.players).toHaveLength(2);
    expect(next.players[0]).toEqual({ id: "sean-ryan", name: "Seán Ryan" });
  });

  it("removing a player marks them as having left rather than deleting them", () => {
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    act(() => { container.querySelectorAll(".squad-player")[1].querySelector("button").click(); });
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.players).toHaveLength(2);
    expect(next.players[1]).toMatchObject({ id: "ali-khan", name: "Ali Khan", left: true });
  });

  it("keeps departed players visible, out of the way, and restorable", () => {
    const onChange = vi.fn();
    mount({ squad: removePlayer(squad(), "ali-khan"), onChange });
    // Out of the current list…
    expect(playerInputs().map((i) => i.value)).toEqual(["Sean Ryan"]);
    // …but still named, since past sessions still say they were there.
    const gone = container.querySelector(".squad-departed");
    expect(gone).not.toBeNull();
    expect(gone.textContent).toContain("Ali Khan");
    expect(gone.open).toBe(false); // collapsed: they are history, not today's list

    act(() => { [...gone.querySelectorAll("button")].find((b) => /restore/i.test(b.textContent)).click(); });
    expect(onChange.mock.calls.at(-1)[0].players[1].left).toBe(false);
  });

  it("says nothing about departed players when nobody has left", () => {
    mount({ squad: squad() });
    expect(container.querySelector(".squad-departed")).toBeNull();
  });

  it("offers a way back, and a way to delete the squad", () => {
    const onBack = vi.fn();
    const onDelete = vi.fn();
    mount({ squad: squad(), onBack, onDelete });
    act(() => { button(/Back/).click(); });
    act(() => { button(/Delete/).click(); });
    expect(onBack).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it("lets a name be cleared and retyped, which the model alone would not allow", () => {
    // renamePlayer refuses a blank name — a player with no name cannot be pointed at — so
    // an input bound straight to the model snapped back the moment the last character was
    // deleted, and the name could never be replaced on a phone.
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    type(playerInputs()[0], "");
    expect(playerInputs()[0].value).toBe("");
    type(playerInputs()[0], "Sean R");
    expect(onChange.mock.calls.at(-1)[0].players[0].name).toBe("Sean R");
  });

  it("reports nothing at all when the rename changed nothing", () => {
    // renamePlayer refuses a blank name and hands back the squad it was given. Reporting
    // that as a change marks the file dirty, so deleting the last character of a name cost
    // a full write of every squad — over a phone connection, for nothing.
    const onChange = vi.fn();
    mount({ squad: squad(), onChange });
    type(playerInputs()[0], "");
    expect(onChange).not.toHaveBeenCalled();
    // The half-typed text is still the editor's business, though: the field stays cleared.
    expect(playerInputs()[0].value).toBe("");
  });
});
