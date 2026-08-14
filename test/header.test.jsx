// @vitest-environment jsdom
// The header is the only chrome that is on screen everywhere, so it is the only place a
// session that is under way can be advertised from.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import React, { act } from "react";
import Header from "../src/components/Header.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
const mount = (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => { createRoot(container).render(<Header version="1.2.3" {...props} />); });
};
const button = (re) => [...container.querySelectorAll("button")].find((b) => re.test(b.textContent));

describe("Header", () => {
  it("shows the mark, the name and the version", () => {
    mount();
    const mark = container.querySelector("svg.app-mark");
    expect(mark).not.toBeNull();
    // The mark carries the name for anyone who cannot see it, so it has to say the same
    // thing the wordmark beside it does.
    expect(mark.getAttribute("aria-label")).toBe("ball.is.life");
    expect(container.textContent).toContain("ball.is.life");
    expect(container.textContent).toContain("1.2.3");
  });

  it("the name is the way home", () => {
    const onHome = vi.fn();
    mount({ onHome });
    act(() => { button(/ball\.is\.life/).click(); });
    expect(onHome).toHaveBeenCalled();
  });

  it("offers both sections wherever it is, and marks the current one", () => {
    mount({ mode: "sessions" });
    expect(button(/Drills/)).toBeDefined();
    expect(button(/Sessions/).className).toContain("active");
    expect(button(/Drills/).className).not.toContain("active");
  });

  it("switches section", () => {
    const onModeChange = vi.fn();
    mount({ mode: "drills", onModeChange });
    act(() => { button(/Sessions/).click(); });
    expect(onModeChange).toHaveBeenCalledWith("sessions");
  });

  it("says a session is under way, in words as well as with a dot", () => {
    mount({ activeCount: 1 });
    const sessions = button(/Sessions/);
    expect(sessions.querySelector(".nav-dot")).not.toBeNull();
    // Colour alone would not survive a glance in bright sun, let alone a screen reader.
    expect(sessions.getAttribute("aria-label")).toMatch(/under way|in progress/i);
  });

  it("says nothing when no session is under way", () => {
    mount({ activeCount: 0 });
    expect(button(/Sessions/).querySelector(".nav-dot")).toBeNull();
  });
});
