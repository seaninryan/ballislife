// src/lib/markdown.js
// Splits a markdown body into prose runs and ```pitch blocks. Pure string work.
// `line` is the 1-based line of the body where the block's CONTENT starts, so a
// parse error at pitch-line N can be reported as body-line (line + N - 1).

// Three or more backticks, because CommonMark allows a longer run and an LLM pasting
// a drill sometimes emits four when it thinks it needs to nest. With a fixed run of
// exactly three, a four-backtick close never matches and the unterminated-fence path
// silently swallows the rest of the drill as diagram source.
// `\r` is matched explicitly so a CRLF file's fence lines still close: lines come from
// splitting on "\n", so each one retains its trailing carriage return.
const OPEN = /^`{3,}pitch[ \t\r]*$/;
const CLOSE = /^`{3,}[ \t\r]*$/;

// Segments are cut by character offset rather than rebuilt by joining lines. Joining
// loses the newline that separated the last prose line from the fence, and getting it
// back by appending "\n" is wrong for the final segment.
//
// Slicing preserves prose and pitch *content* exactly, including CRLF. The fence
// delimiter lines themselves are discarded rather than preserved, so a caller that
// rebuilds a document from segments must re-emit them and cannot recover non-canonical
// fence formatting (trailing whitespace, CRLF, a longer backtick run). Nothing
// reconstructs documents this way today — the editor holds the raw text.
export function splitSegments(body) {
  const text = String(body ?? "");
  const lines = text.split("\n");
  const segments = [];

  // Character offset where each line begins.
  const offsets = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1; // + the "\n" that split consumed
  }

  let proseStart = 0;
  const pushProse = (end) => {
    if (end > proseStart) segments.push({ kind: "prose", text: text.slice(proseStart, end) });
  };

  for (let i = 0; i < lines.length; i++) {
    if (!OPEN.test(lines[i])) continue;

    pushProse(offsets[i]);

    const contentStart = i + 1;
    let j = contentStart;
    while (j < lines.length && !CLOSE.test(lines[j])) j++;

    // An unterminated fence runs to the end of the body rather than being discarded,
    // so a half-typed diagram still renders while the user is mid-edit.
    const from = contentStart < lines.length ? offsets[contentStart] : text.length;
    const to = j < lines.length ? offsets[j] : text.length;
    segments.push({ kind: "pitch", text: text.slice(from, to), line: contentStart + 1 });

    i = j; // skip the closing fence; if absent, j === lines.length and the loop ends
    proseStart = j < lines.length ? offsets[j] + lines[j].length + 1 : text.length;
  }

  pushProse(text.length);
  return segments;
}
