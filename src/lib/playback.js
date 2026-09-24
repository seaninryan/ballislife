// src/lib/playback.js
// What an animated diagram does next, as a pure reducer. The component only turns
// `delay` into a timer that dispatches `tick`; every rule about order, looping and
// replay lives here, where it is testable without a DOM or a clock.
//
// `from` is the slide just left, or null after a cut (first render, loop, replay) —
// the renderer glides only when there is somewhere to glide from.

// GLIDE_MS must match the transform transition on .pitch-glide in styles.css.
export const GLIDE_MS = 1000;
export const HOLD_MS = 1500;
// Pressing Play should visibly do something almost at once, not after a full hold.
export const START_MS = 300;

export const initial = { index: 0, from: null, playing: false, ended: false, delay: 0 };

export function step(state, event) {
  switch (event.type) {
    case "play":
      if (state.ended) return { index: 0, from: null, playing: true, ended: false, delay: HOLD_MS };
      return { ...state, playing: true, delay: START_MS };
    case "pause":
      return { ...state, playing: false };
    case "tick": {
      if (!state.playing) return state;
      if (state.index < event.n - 1) {
        return { ...state, index: state.index + 1, from: state.index, delay: GLIDE_MS + HOLD_MS };
      }
      if (event.loop) return { ...state, index: 0, from: null, delay: HOLD_MS };
      return { ...state, playing: false, ended: true };
    }
    case "reset":
      return initial;
    default:
      return state;
  }
}
