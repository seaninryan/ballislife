// Document structure only: splitting YAML frontmatter from a markdown body.
// Knows nothing about drills.
import yaml from "js-yaml";

// Consumes the blank line(s) between the closing fence and the body, so the body
// starts at real content. `*` rather than `+` so a document that ends at the closing
// fence with no body still matches. `[ \t]*` tolerates trailing whitespace on either
// fence line, which copy-paste and editor auto-formatting both introduce.
const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)*/;

// -> { meta, body, error, front }. Never throws: a document with broken frontmatter still
// returns its body so it can be opened and repaired in the editor.
//
// KNOWN LIMITATION, shared with every frontmatter parser (Jekyll, Hugo, gray-matter):
// in a document whose FIRST line is `---`, the text up to the next `---` is read as
// frontmatter even if it was meant as a horizontal rule. This only affects documents
// with no real frontmatter that open with a rule — a `---` rule anywhere after real
// frontmatter is left alone. Pinned by tests rather than guarded against, because
// every heuristic for detecting intent (e.g. requiring `key:` on the next line)
// breaks legitimate frontmatter that opens with a YAML comment.
// `front` is the raw frontmatter source (or null when the document has no fence).
// Every return has the same four keys — a uniform shape, so no caller has to guess
// whether a property is present. `front` exists so that a document whose YAML cannot
// be parsed can still be written back with its original frontmatter intact: without
// it, saving an invalid drill would delete the very text the user opened it to repair.
export function parseDoc(src) {
  if (src === null || src === undefined) return { meta: {}, body: "", error: null, front: null };
  if (typeof src !== "string") {
    // A non-string is a caller bug, not a malformed drill. Report it rather than
    // coercing it into an "[object Object]" body that reaches the catalogue.
    return { meta: {}, body: "", error: "expected a string", front: null };
  }

  const m = src.match(FENCE);
  if (!m) return { meta: {}, body: src, error: null, front: null };

  const body = src.slice(m[0].length);
  const front = m[1];
  try {
    const meta = yaml.load(front);
    if (meta === null || meta === undefined) return { meta: {}, body, error: null, front };
    if (typeof meta !== "object" || Array.isArray(meta)) {
      return { meta: {}, body, error: "yaml: frontmatter must be a mapping", front };
    }
    return { meta, body, error: null, front };
  } catch (e) {
    // mark.line is 0-based within the frontmatter block, not the file. For
    // unterminated-flow-collection errors js-yaml reports where the parser gave up,
    // which is one line past the offending construct — a known cosmetic off-by-one
    // for that error class only, relevant if Plan 2's editor adds jump-to-line.
    const where = e.mark ? ` (line ${e.mark.line + 1})` : "";
    return { meta: {}, body, error: `yaml: ${e.reason || e.message}${where}`, front };
  }
}

// { meta, body, error, front } -> markdown text. Inverse of parseDoc at the model level.
//
// Assumes a well-formed document object, e.g. straight from parseDoc or from the
// editor's own state. Unlike parseDoc it is deliberately NOT defensive: passing
// undefined throws. That asymmetry is intentional — parseDoc reads untrusted file
// content and must never crash the catalogue, whereas a missing document here is a
// caller bug, and failing loudly beats writing an empty file over a real drill.
export function serialiseDoc({ meta, body, error, front }) {
  const text = body ?? "";
  const keys = Object.keys(meta ?? {});

  // A document whose frontmatter could not be parsed is written back with its original
  // frontmatter text intact — dropping it would delete the very thing the editor exists
  // to let the user repair. Guarded on `meta` being empty as well, so that once a caller
  // supplies replacement metadata the repair wins over the unparseable original.
  if (error && front != null && keys.length === 0) {
    return `---\n${front}\n---\n\n${text.replace(/^\n+/, "")}`;
  }

  // No frontmatter: leading blank lines belong to the body, and parseDoc would not
  // strip them either, so leave them be.
  if (keys.length === 0) return text;

  const dumped = yaml.dump(meta, { lineWidth: 0, noRefs: true, flowLevel: -1 });
  // Stripping leading blank lines mirrors the FENCE regex's blank-line consumption in
  // parseDoc, which is what keeps the round trip stable. Do not remove without
  // re-reading parseDoc.
  return `---\n${dumped}---\n\n${text.replace(/^\n+/, "")}`;
}
