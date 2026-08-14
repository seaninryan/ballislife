// @vitest-environment jsdom
// The register: a row per player in the squad, tapped once per player at the side of a
// pitch. Presentational — it holds no marks of its own, reports every tap through onMark,
// and SessionRun owns where they go. Fifteen rows is the real case, so the fixture is the
// owner's actual U14A squad rather than a three-row toy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Attendance from "../src/components/Attendance.jsx";
import { PRESENT, ABSENT, EXCUSED } from "../src/lib/attendance.js";
import { u14a, U14A_NAMES } from "./fixtures/squads.js";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "..", "src", "styles.css"), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

// Renders into the same root when there is one, so a test that re-renders with different
// marks (the cycle below) is a re-render rather than a second tree beside the first.
const mount = (props) => {
  root ??= createRoot(container);
  act(() => { root.render(<Attendance {...props} />); });
};

const rows = () => [...container.querySelectorAll(".attendance-row")];
const rowFor = (name) => rows().find((r) => r.textContent.includes(name));

describe("Attendance", () => {
  it("shows a row per current player, in squad order", () => {
    mount({ squad: u14a(), marks: {} });
    expect(rows()).toHaveLength(15);
    expect(rows().map((r) => r.querySelector(".attendance-name").textContent)).toEqual(U14A_NAMES);
  });

  it("keeps two players whose names differ only by a middle initial apart", () => {
    const squad = u14a();
    const daragh = squad.players.find((p) => p.name === "Daragh B Kelly");
    const darragh = squad.players.find((p) => p.name === "Darragh C Kelly");
    expect(daragh.id).not.toBe(darragh.id);
    const onMark = vi.fn();
    mount({ squad, marks: { [daragh.id]: PRESENT }, onMark });
    expect(rowFor("Daragh B Kelly").textContent).toContain("Present");
    expect(rowFor("Darragh C Kelly").textContent).not.toContain("Present");
  });

  it("says each state in words, not by colour alone — this is read in bright sun", () => {
    const squad = u14a();
    const [alfie, cillian, danny] = squad.players;
    mount({ squad, marks: { [alfie.id]: PRESENT, [cillian.id]: ABSENT, [danny.id]: EXCUSED } });
    expect(rowFor("Alfie Ryan").textContent).toContain("Present");
    expect(rowFor("Cillian Conlan").textContent).toContain("Absent");
    expect(rowFor("Danny Mitchell").textContent).toContain("Excused");
  });

  it("cycles one control per row: unmarked, present, absent, excused, unmarked again", () => {
    const squad = u14a();
    const kevin = squad.players.find((p) => p.name === "Kevin");
    const onMark = vi.fn();

    mount({ squad, marks: {}, onMark });
    act(() => { rowFor("Kevin").click(); });
    expect(onMark).toHaveBeenLastCalledWith(kevin.id, PRESENT);

    mount({ squad, marks: { [kevin.id]: PRESENT }, onMark });
    act(() => { rowFor("Kevin").click(); });
    expect(onMark).toHaveBeenLastCalledWith(kevin.id, ABSENT);

    mount({ squad, marks: { [kevin.id]: ABSENT }, onMark });
    act(() => { rowFor("Kevin").click(); });
    expect(onMark).toHaveBeenLastCalledWith(kevin.id, EXCUSED);

    // Round the cycle: excused taps back to unmarked, which is the absence of a state
    // rather than a fourth value.
    mount({ squad, marks: { [kevin.id]: EXCUSED }, onMark });
    act(() => { rowFor("Kevin").click(); });
    expect(onMark).toHaveBeenLastCalledWith(kevin.id, undefined);
  });

  it("treats a state it does not recognise as unmarked rather than trapping the row", () => {
    const squad = u14a();
    const [alfie] = squad.players;
    const onMark = vi.fn();
    mount({ squad, marks: { [alfie.id]: "injured" }, onMark });
    expect(rowFor("Alfie Ryan").textContent).not.toMatch(/injured/i);
    act(() => { rowFor("Alfie Ryan").click(); });
    expect(onMark).toHaveBeenLastCalledWith(alfie.id, PRESENT);
  });

  it("summarises the register, counting what is still to do", () => {
    const squad = u14a();
    const [a, b, c, d] = squad.players;
    mount({ squad, marks: { [a.id]: PRESENT, [b.id]: PRESENT, [c.id]: ABSENT, [d.id]: EXCUSED } });
    const summary = container.querySelector(".attendance-summary").textContent;
    expect(summary).toContain("2 present");
    expect(summary).toContain("1 absent");
    expect(summary).toContain("1 excused");
    expect(summary).toContain("11 to go");
  });

  it("says nothing is left to do once every player is marked", () => {
    const squad = u14a();
    const marks = Object.fromEntries(squad.players.map((p) => [p.id, PRESENT]));
    mount({ squad, marks });
    const summary = container.querySelector(".attendance-summary").textContent;
    expect(summary).toContain("15 present");
    expect(summary).not.toMatch(/to go/);
  });

  it("does not show a player who has left, and does not touch their mark", () => {
    // Leaving the squad is not deletion: last month's register still has to be able to
    // say they were there, so the mark stays in the data even though there is no row.
    const squad = u14a();
    const gone = squad.players.find((p) => p.name === "Bartoz Walo");
    squad.players = squad.players.map((p) => (p.id === gone.id ? { ...p, left: true } : p));
    const marks = { [gone.id]: PRESENT };
    const onMark = vi.fn();
    mount({ squad, marks, onMark });

    expect(rows()).toHaveLength(14);
    expect(container.textContent).not.toContain("Bartoz Walo");
    // Their mark is not counted against tonight either, and nothing was reported that
    // would remove it.
    expect(container.querySelector(".attendance-summary").textContent).toContain("0 present");
    expect(container.querySelector(".attendance-summary").textContent).toContain("14 to go");
    expect(onMark).not.toHaveBeenCalled();
    expect(marks).toEqual({ [gone.id]: PRESENT });
  });

  it("with no squad, says so and points at where to set one, rather than an empty box", () => {
    mount({ squad: null, marks: {} });
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toMatch(/no squad/i);
    expect(container.textContent).toMatch(/plan/i);
  });

  it("with a squad but nobody in it, says that too", () => {
    mount({ squad: { id: "u14a", name: "U14A Boys 2026-27", players: [] }, marks: {} });
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toMatch(/nobody|no players|empty/i);
    expect(container.textContent).toContain("U14A Boys 2026-27");
  });

  it("the whole row is the control, and it is thumb-sized", () => {
    mount({ squad: u14a(), marks: {} });
    expect(rows()[0].tagName).toBe("BUTTON");
    // Same 44px floor as a squad editor row: tapped standing up, one-handed, without
    // looking.
    const rule = styles.match(/\.attendance-row\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/min-height:\s*44px/);
  });
});
