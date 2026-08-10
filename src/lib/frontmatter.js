// Document structure only: splitting YAML frontmatter from a markdown body.
// Knows nothing about drills.
import yaml from "js-yaml";

// Consumes the blank line(s) between the closing fence and the body, so the body
// starts at real content. `*` rather than `+` so a document that ends at the closing
// fence with no body still matches. `[ \t]*` tolerates trailing whitespace on either
// fence line, which copy-paste and editor auto-formatting both introduce.
const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)*/;

// -> { meta, body, error }. Never throws: a document with broken frontmatter still
// returns its body so it can be opened and repaired in the editor.
//
// KNOWN LIMITATION, shared with every frontmatter parser (Jekyll, Hugo, gray-matter):
// in a document whose FIRST line is `---`, the text up to the next `---` is read as
// frontmatter even if it was meant as a horizontal rule. This only affects documents
// with no real frontmatter that open with a rule — a `---` rule anywhere after real
// frontmatter is left alone. Pinned by tests rather than guarded against, because
// every heuristic for detecting intent (e.g. requiring `key:` on the next line)
// breaks legitimate frontmatter that opens with a YAML comment.
export function parseDoc(src) {
  if (src === null || src === undefined) return { meta: {}, body: "", error: null };
  if (typeof src !== "string") {
    // A non-string is a caller bug, not a malformed drill. Report it rather than
    // coercing it into an "[object Object]" body that reaches the catalogue.
    return { meta: {}, body: "", error: "expected a string" };
  }

  const m = src.match(FENCE);
  if (!m) return { meta: {}, body: src, error: null };

  const body = src.slice(m[0].length);
  try {
    const meta = yaml.load(m[1]);
    if (meta === null || meta === undefined) return { meta: {}, body, error: null };
    if (typeof meta !== "object" || Array.isArray(meta)) {
      return { meta: {}, body, error: "yaml: frontmatter must be a mapping" };
    }
    return { meta, body, error: null };
  } catch (e) {
    // mark.line is 0-based within the frontmatter block, not the file.
    const where = e.mark ? ` (line ${e.mark.line + 1})` : "";
    return { meta: {}, body, error: `yaml: ${e.reason || e.message}${where}` };
  }
}
