// The URL hash <-> { view, slug }. Hash routing rather than a router dependency: it
// needs no server rewrites, which matters on GitHub Pages.
const BROWSE = { view: "browse", slug: null };

// Never throws: a malformed percent escape in a hand-edited URL must not blank the app.
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function parseHash(hash) {
  const parts = String(hash ?? "").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] !== "drill" || !parts[1]) return { ...BROWSE };
  return { view: parts[2] === "edit" ? "edit" : "read", slug: decode(parts[1]) };
}

export function formatHash({ view, slug }) {
  if (!slug || view === "browse") return "#/";
  const base = `#/drill/${encodeURIComponent(slug)}`;
  return view === "edit" ? `${base}/edit` : base;
}
