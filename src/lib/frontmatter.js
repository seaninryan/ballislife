// Document structure only: splitting YAML frontmatter from a markdown body.
// Knows nothing about drills.
import yaml from "js-yaml";

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/;

// -> { meta, body, error }. Never throws: a document with broken frontmatter still
// returns its body so it can be opened and repaired in the editor.
export function parseDoc(src) {
  const text = String(src ?? "");
  const m = text.match(FENCE);
  if (!m) return { meta: {}, body: text, error: null };

  const body = text.slice(m[0].length);
  try {
    const meta = yaml.load(m[1]);
    if (meta === null || meta === undefined) return { meta: {}, body, error: null };
    if (typeof meta !== "object" || Array.isArray(meta)) {
      return { meta: {}, body, error: "yaml: frontmatter must be a mapping" };
    }
    return { meta, body, error: null };
  } catch (e) {
    return { meta: {}, body, error: `yaml: ${e.reason || e.message}` };
  }
}
