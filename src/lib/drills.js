// src/lib/drills.js
// The drill model components render: index entries in, display-ready drills out.
// Owns slug rules, filtering and search. Pure — no Drive, no React.

const stripExt = (name) => String(name ?? "").replace(/\.md$/i, "");

// A title -> a filename-safe slug. Never empty, and idempotent so re-slugging a slug
// is a no-op.
export function slugify(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

// A title -> a filename that does not collide with `taken`.
export function fileNameFor(title, taken = []) {
  const base = slugify(title);
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  if (!used.has(`${base}.md`)) return `${base}.md`;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}.md`;
    if (!used.has(candidate)) return candidate;
  }
}

// Index -> drills, sorted by title. An invalid drill is included and flagged, never
// hidden: the spec requires it to be visible and openable so it can be repaired.
export function drillsFromIndex(index) {
  const entries = index?.entries ?? {};
  return Object.entries(entries)
    .map(([id, e]) => {
      const slug = stripExt(e.name);
      const meta = e.meta ?? {};
      return {
        id,
        slug,
        title: meta.title || slug,
        category: meta.category ?? null,
        minutes: meta.minutes ?? null,
        players: meta.players ?? null,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        thumb: e.thumb ?? null,
        invalid: e.invalid ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Search covers title and tags — the two things a coach recalls a drill by. Body text
// is deliberately not searched here: it is not in the index, and fetching every drill
// to search it would defeat the cache.
export function filterDrills(drills, { category, tag, query } = {}) {
  const q = String(query ?? "").trim().toLowerCase();
  return (drills ?? []).filter((d) => {
    if (category && d.category !== category) return false;
    if (tag && !d.tags.includes(tag)) return false;
    if (!q) return true;
    return (
      d.title.toLowerCase().includes(q) ||
      d.tags.some((t) => String(t).toLowerCase().includes(q))
    );
  });
}
