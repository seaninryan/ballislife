import { describe, it, expect } from "vitest";
import { step, initial, GLIDE_MS, HOLD_MS, START_MS } from "../src/lib/playback.js";

const run = (events, from = initial) => events.reduce(step, from);
const tick = (n, loop = false) => ({ type: "tick", n, loop });

describe("playback", () => {
  it("starts paused on slide 1", () => {
    expect(initial).toEqual({ index: 0, from: null, playing: false, ended: false, delay: 0 });
  });

  it("starts moving soon after Play", () => {
    expect(run([{ type: "play" }])).toMatchObject({ playing: true, delay: START_MS, index: 0 });
  });

  it("glides to the next slide on each tick, then holds", () => {
    const s = run([{ type: "play" }, tick(3)]);
    expect(s).toMatchObject({ index: 1, from: 0, delay: GLIDE_MS + HOLD_MS, playing: true });
    expect(run([tick(3)], s)).toMatchObject({ index: 2, from: 1 });
  });

  it("stops on the last slide and offers Replay when not looping", () => {
    const s = run([{ type: "play" }, tick(2), tick(2)]);
    expect(s).toMatchObject({ index: 1, playing: false, ended: true });
  });

  it("cuts back to slide 1 when looping", () => {
    const s = run([{ type: "play" }, tick(2, true), tick(2, true)]);
    expect(s).toMatchObject({ index: 0, from: null, playing: true, ended: false, delay: HOLD_MS });
  });

  it("replays from slide 1 with a cut", () => {
    const ended = run([{ type: "play" }, tick(2), tick(2)]);
    expect(run([{ type: "play" }], ended)).toEqual({
      index: 0, from: null, playing: true, ended: false, delay: HOLD_MS,
    });
  });

  it("pauses without moving, and ignores ticks while paused", () => {
    const s = run([{ type: "play" }, tick(3), { type: "pause" }]);
    expect(s).toMatchObject({ index: 1, playing: false });
    expect(run([tick(3)], s)).toBe(s);
  });

  it("resets to the start", () => {
    expect(run([{ type: "play" }, tick(3), { type: "reset" }])).toEqual(initial);
  });

  it("starts again from slide 1 when Play is pressed on the last slide", () => {
    const onLast = run([{ type: "seek", index: 2 }]);
    expect(run([{ type: "play", n: 3 }], onLast)).toEqual({
      index: 0, from: null, playing: true, ended: false, delay: HOLD_MS,
    });
  });

  it("replays from slide 1 whatever the state", () => {
    const mid = run([{ type: "play", n: 3 }, tick(3)]);
    expect(run([{ type: "replay" }], mid)).toEqual({
      index: 0, from: null, playing: true, ended: false, delay: HOLD_MS,
    });
  });

  it("seeks to a slide with a cut, paused", () => {
    const mid = run([{ type: "play", n: 3 }, tick(3)]);
    expect(run([{ type: "seek", index: 2 }], mid)).toEqual({
      index: 2, from: null, playing: false, ended: false, delay: 0,
    });
  });

  it("stays on the slide shown after an edit, paused, clamped to what is left", () => {
    const onThird = run([{ type: "seek", index: 2 }]);
    expect(run([{ type: "edited", n: 3 }], onThird)).toMatchObject({ index: 2, playing: false, from: null });
    expect(run([{ type: "edited", n: 2 }], onThird)).toMatchObject({ index: 1 });
  });
});
