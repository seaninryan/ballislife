// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import SessionList from "../src/components/SessionList.jsx";
import { emptySession, setBlock } from "../src/lib/sessions.js";

const drills = [
  { slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8" },
  { slug: "3v2", title: "3v2 to end line", category: "skill", minutes: 15, players: "8-12" },
];

const render = (props) => renderToStaticMarkup(<SessionList {...props} />);

describe("SessionList", () => {
  it("renders one row per session, newest date first", () => {
    const sessions = [
      emptySession("2026-08-01-a", "2026-08-01", "U12s"),
      emptySession("2026-08-12-b", "2026-08-12", "U14s"),
    ];
    const html = render({ sessions, drills });
    const posA = html.indexOf("2026-08-01");
    const posB = html.indexOf("2026-08-12");
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeLessThan(posA);
  });

  it("shows the total and the session length", () => {
    let s = emptySession("s1", "2026-08-12", "U12s");
    s = setBlock(s, 0, { drill: "rondo-4v2" });
    s = setBlock(s, 1, { drill: "3v2" });
    s.length = 75;
    const html = render({ sessions: [s], drills });
    expect(html).toContain("25′");
    expect(html).toContain("75′");
  });

  it("flags a session with empty slots", () => {
    const s = emptySession("s1", "2026-08-12", "U12s");
    const html = render({ sessions: [s], drills });
    expect(html).toMatch(/empty|unfilled/i);
  });

  it("flags a session containing a broken drill reference", () => {
    let s = emptySession("s1", "2026-08-12", "U12s");
    s = setBlock(s, 0, { drill: "deleted-drill" });
    const html = render({ sessions: [s], drills });
    expect(html).toMatch(/broken|missing/i);
  });

  it("offers New session", () => {
    const html = render({ sessions: [], drills });
    expect(html).toMatch(/new session/i);
  });

  it("explains an empty list rather than rendering nothing", () => {
    const html = render({ sessions: [], drills });
    expect(html).toMatch(/no sessions/i);
  });

  it("offers a Run this session control on each row", () => {
    const sessions = [emptySession("s1", "2026-08-12", "U12s")];
    const html = render({ sessions, drills, onRun: () => {} });
    expect(html).toMatch(/run this session/i);
  });
});

describe("SessionList run control (interaction)", () => {
  it("calls onRun with the session, not onOpen", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const s = emptySession("s1", "2026-08-12", "U12s");
    let opened = null, ran = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <SessionList
          sessions={[s]}
          drills={drills}
          onOpen={(sess) => { opened = sess; }}
          onRun={(sess) => { ran = sess; }}
        />,
      );
    });
    const runButton = [...container.querySelectorAll("button")].find((b) => /run this session/i.test(b.textContent));
    act(() => { runButton.click(); });
    expect(ran?.id).toBe("s1");
    expect(opened).toBe(null);
    act(() => root.unmount());
    container.remove();
  });
});
