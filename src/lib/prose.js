// src/lib/prose.js
// Markdown prose -> sanitised HTML. The only module that knows about marked or
// DOMPurify, so swapping either is a one-file change.
//
// Sanitising is not optional even though the drills are the owner's own: they arrive as
// text pasted from an LLM, and markdown permits raw HTML.
import { marked } from "marked";
import createDOMPurify from "dompurify";

let cached = null;

// DOMPurify needs a DOM. In the browser that is `window`; under Vitest it is jsdom's,
// which is why test/prose.test.js declares `@vitest-environment jsdom`. A window can
// also be passed explicitly, which keeps the module testable without globals.
function purifier(win) {
  const w = win ?? globalThis.window;
  if (!w) throw new Error("prose: no DOM available to sanitise with");
  if (win) return createDOMPurify(win);
  if (!cached) cached = createDOMPurify(w);
  return cached;
}

export function renderProse(markdown, options = {}) {
  // The old second parameter was a window, but nothing ever passed one — every call site
  // relies on globalThis.window — so it becomes a named option rather than a positional
  // one, with no compatibility shim to maintain.
  const { interactive = false, win } = options;

  // `async: false` keeps this synchronous — marked can return a promise otherwise, and
  // a component cannot render one.
  const html = marked.parse(String(markdown ?? ""), { async: false });
  const clean = purifier(win).sanitize(html);
  return interactive ? makeTickable(clean) : clean;
}

// Runs AFTER sanitising, and only removes an attribute and adds a data- one, so it
// cannot reintroduce anything DOMPurify stripped.
function makeTickable(html) {
  let n = 0;
  return html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/g, (match, before, after) => {
    const attrs = `${before}${after}`.replace(/\sdisabled(?:=""|='')?/g, "");
    return `<input${attrs} type="checkbox" data-tick="${n++}">`;
  });
}
