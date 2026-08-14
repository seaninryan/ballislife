// @vitest-environment jsdom
// Every squad, with how many players are actually in it. Presentational — handed data,
// reporting taps upward, no Drive.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import SquadList from "../src/components/SquadList.jsx";
import { addPlayer, emptySquad, removePlayer } from "../src/lib/squads.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
const mount = (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { createRoot(container).render(<SquadList {...props} />); });
};

const button = (re) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent));

const u14a = () => {
  let s = emptySquad("u14a", "U14A Boys");
  s = addPlayer(s, "Sean Ryan");
  s = addPlayer(s, "Ali Khan");
  return s;
};

describe("SquadList", () => {
  it("shows a row per squad, with its name", () => {
    mount({ squads: [u14a(), emptySquad("u12", "U12s")] });
    expect(container.querySelectorAll(".squad-row")).toHaveLength(2);
    expect(container.textContent).toContain("U14A Boys");
    expect(container.textContent).toContain("U12s");
  });

  it("counts the players who are still in the squad, not the ones who left", () => {
    // A departed player stays in the file so last month's session can still name them —
    // counting them here would say the squad is bigger than the group that turns up.
    mount({ squads: [removePlayer(u14a(), "ali-khan")] });
    expect(container.querySelector(".squad-row .chip").textContent).toBe("1 player");
  });

  it("opens the squad that was tapped", () => {
    const onOpen = vi.fn();
    const squads = [u14a(), emptySquad("u12", "U12s")];
    mount({ squads, onOpen });
    act(() => { button(/U12s/).click(); });
    expect(onOpen).toHaveBeenCalledWith(squads[1]);
  });

  it("offers a way to make a new squad", () => {
    const onCreate = vi.fn();
    mount({ squads: [], onCreate });
    act(() => { button(/New squad/i).click(); });
    expect(onCreate).toHaveBeenCalled();
  });

  it("says so when there are no squads yet, rather than showing an empty page", () => {
    mount({ squads: [] });
    expect(container.textContent).toMatch(/no squads yet/i);
  });
});
