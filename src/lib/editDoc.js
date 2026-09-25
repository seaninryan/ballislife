// src/lib/editDoc.js
// Where the pitch blocks sit inside a whole drill document, and small text edits on it.
// Pure: the editor applies the results to its textarea.
import { parseDoc } from "./frontmatter.js";
import { splitSegments } from "./markdown.js";

// -> [{ start, from, to, end, line }] as offsets into `doc`: from/to bound the content,
// start/end include the fence lines, and `line` is the file line where the content
// starts — the number DrillPreview hands each diagram as its baseLine.
export function pitchBlocks(doc) {
  const body = parseDoc(doc).body;
  const bodyStart = doc.length - body.length;
  const frontLines = doc.slice(0, bodyStart).split("\n").length - 1;
  const lineStarts = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === "\n") lineStarts.push(i + 1);
  return splitSegments(body)
    .filter((s) => s.kind === "pitch")
    .map((s) => {
      // splitSegments gives the content's 1-based starting line, and the content is an
      // exact slice, so its length ends it.
      const from = lineStarts[s.line - 1] ?? body.length;
      const to = from + s.text.length;
      const nl = body.indexOf("\n", to);
      return {
        start: lineStarts[s.line - 2] + bodyStart,
        from: from + bodyStart,
        to: to + bodyStart,
        end: (nl === -1 ? body.length : nl) + bodyStart,
        line: s.line + frontLines,
      };
    });
}

// The document with the content of the block starting at file line `line` replaced,
// or null when no block starts there.
export function replaceBlock(doc, line, content) {
  const b = pitchBlocks(doc).find((x) => x.line === line);
  return b ? doc.slice(0, b.from) + content + doc.slice(b.to) : null;
}

// Inserts `text` over [start, end) -> { text, cursor after it }. A picked coordinate is
// spaced from a token it would otherwise run into — but not after whitespace, `@`
// (a player's position) or `>` (the end of every arrow). It is spaced from a token right
// after it too: "cone: |5,5" must not become "cone: 1,15,5", which parses as the wrong cone.
export function insertText(doc, start, end, text) {
  const before = start > 0 ? doc[start - 1] : "\n";
  const after = end < doc.length ? doc[end] : "\n";
  const sep = /[\s@>]/.test(before) ? "" : " ";
  const tail = /\s/.test(after) ? "" : " ";
  return {
    text: doc.slice(0, start) + sep + text + tail + doc.slice(end),
    cursor: start + sep.length + text.length,
  };
}

// A 1-based line's offsets in `doc`, for selecting it — the line an error message names.
export function lineRange(doc, line) {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const nl = doc.indexOf("\n", start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  const nl = doc.indexOf("\n", start);
  let end = nl === -1 ? doc.length : nl;
  if (doc[end - 1] === "\r") end -= 1;
  return { start, end };
}
