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
  const { interactive = false, win, tickOffset = 0 } = options;

  // `async: false` keeps this synchronous — marked can return a promise otherwise, and
  // a component cannot render one.
  const html = marked.parse(String(markdown ?? ""), { async: false });
  const clean = purifier(win).sanitize(html);
  // Runs unconditionally, not just when interactive: an inline "[ ] high knees [ ] ..."
  // row should read as checkboxes the same way a real GFM task list already does in
  // read-only mode (disabled, unticked). makeTickable numbers whatever this leaves
  // behind alongside marked's own list checkboxes, so the two kinds share one sequence.
  const withInlineChecks = makeInlineCheckboxes(clean);
  return interactive ? makeTickable(withInlineChecks, tickOffset) : withInlineChecks;
}

// Turns a bare "[ ]"/"[x]"/"[X]" written in prose — not as a "- [ ] " list item, which
// marked already renders as a real checkbox by this point — into the same kind of
// <input type="checkbox"> element, so a one-line warm-up like
// "[ ] high knees [ ] butt kicker" is tickable without forcing it into a 13-line list.
//
// Runs on the SANITISED html, after marked and DOMPurify, rather than pre-processing
// the markdown source: by this point every task-list item marked recognised has already
// become a real <input>, so any "[ ]" still present as literal text is guaranteed to be
// the inline form — there is no risk of double-converting a "- [ ] item" line, which a
// pre-pass over raw markdown would have to reimplement marked's own list-item detection
// to avoid.
//
// Block-level tags marked can emit around inline content. Seeing one of these means a
// new "line" of prose has started, so a run of inline checkboxes never bleeds across a
// paragraph/list-item/heading/cell boundary — each such container restarts its own count.
// Everything marked emits *inside* one of these (em, strong, a, code, del, br, img, sup,
// sub) is inline formatting and must NOT reset the count, or "high **knees**" would read
// as two separate items.
const BLOCK_TAG = /^<\/?(p|li|blockquote|h[1-6]|td|th|tr|table|ul|ol|div|hr)(\s|>|\/)/i;

// Turns a bare "[ ]"/"[x]"/"[X]" written in prose — not as a "- [ ] " list item, which
// marked already renders as a real checkbox by this point — into the same kind of
// <input type="checkbox"> element, so a one-line warm-up like
// "[ ] high knees [ ] butt kicker" is tickable without forcing it into a 13-line list.
//
// Runs on the SANITISED html, after marked and DOMPurify, rather than pre-processing
// the markdown source: by this point every task-list item marked recognised has already
// become a real <input>, so any "[ ]" still present as literal text is guaranteed to be
// the inline form — there is no risk of double-converting a "- [ ] item" line, which a
// pre-pass over raw markdown would have to reimplement marked's own list-item detection
// to avoid.
//
// Only scans TEXT between tags: the combined regex alternates between "a whole tag"
// (passed through unchanged, but inspected to track <pre>/<code> nesting) and "a bracket
// pattern", so a bracket sequence inside a tag's attributes can never match, and one
// inside a fenced ```pitch sample (<pre><code>) or inline `code span` (<code>) is left as
// literal text — a drill documenting the pitch syntax can safely show "[ ]" in a sample.
//
// LAYOUT: the owner writes a warm-up compactly on one physical line —
// "[ ] high knees [ ] butt kicker [ ] gate ..." — and wants each item to read as its own
// row, "like a shopping list", not run across the page. A <br> is inserted before every
// checkbox that is NOT the first one seen since the last block boundary: the first item
// needs no break (it already starts the paragraph's own line), a lone "[ ]" amid ordinary
// prose gets no break at all (nothing to separate it from), and a run of several gets one
// break per item, pushing each into its own line together with the text that follows it
// up to the next break. This was chosen over wrapping each item in its own block-level
// span because item boundaries are genuinely ambiguous here: an inline checkbox row is
// unstructured prose text, not a list with real item delimiters, and the text after one
// checkbox and before the next can itself contain arbitrary inline markup (**bold**, a
// `code span`, a link) spanning tag boundaries that this single left-to-right regex pass
// only sees as opaque pass-through tokens. A <br> just before the checkbox needs no
// notion of "where the previous item ends" at all — it only has to notice "another
// checkbox is starting" — so it is correct regardless of what the intervening text
// contains. The one case this cannot help is a checkbox placed BEFORE any of its own
// label text on the same conceptual line ("prep [ ] station A [ ] station B"): "prep"
// stays glued to the first checkbox's line rather than getting a line of its own, which
// matches how the text actually reads (as a lead-in to the list, not a separate item).
function makeInlineCheckboxes(html) {
  let codeDepth = 0;
  let seenInBlock = false;
  return html.replace(/<[^>]+>|\[([ xX])\]/g, (match, mark) => {
    if (match.charCodeAt(0) === 60 /* "<" */) {
      if (/^<(pre|code)(\s|>)/i.test(match)) codeDepth++;
      else if (/^<\/(pre|code)>/i.test(match)) codeDepth = Math.max(0, codeDepth - 1);
      if (BLOCK_TAG.test(match)) seenInBlock = false;
      return match;
    }
    if (codeDepth > 0) return match;
    const checked = mark.toLowerCase() === "x";
    const box = `<input disabled="" type="checkbox"${checked ? ' checked=""' : ""}>`;
    const prefix = seenInBlock ? "<br>" : "";
    seenInBlock = true;
    return `${prefix}${box}`;
  });
}

// Runs AFTER sanitising, and only removes an attribute and adds a data- one, so it
// cannot reintroduce anything DOMPurify stripped.
//
// `start` lets a caller that renders one drill as SEVERAL separate renderProse calls
// (DrillPreview splits a body into prose segments interleaved with pitch diagrams) keep
// numbering continuous across all of them, rather than every segment restarting at 0 and
// colliding with an earlier one's indices.
function makeTickable(html, start = 0) {
  let n = start;
  return html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/g, (match, before, after) => {
    const attrs = `${before}${after}`.replace(/\sdisabled(?:=""|='')?/g, "");
    return `<input${attrs} type="checkbox" data-tick="${n++}">`;
  });
}
