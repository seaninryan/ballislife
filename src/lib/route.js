// The URL hash <-> { view, slug }. Hash routing rather than a router dependency: it
// needs no server rewrites, which matters on GitHub Pages.
const BROWSE = { view: "browse", slug: null };

// Never throws: a malformed percent escape in a hand-edited URL must not blank the app.
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

const SESSIONS = { view: "sessions", slug: null };
const SQUADS = { view: "squads", slug: null };

export function parseHash(hash) {
  // Deliberately NOT .filter(Boolean): collapsing empty segments made "#/drill//edit"
  // parse as a drill named "edit" rather than a malformed URL. Position matters here.
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/");
  if (parts[0] === "sessions") return { ...SESSIONS };
  if (parts[0] === "session") {
    if (!parts[1]) return { ...SESSIONS };
    return { view: parts[2] === "run" ? "run" : "session", slug: decode(parts[1]) };
  }
  if (parts[0] === "squads") return { ...SQUADS };
  if (parts[0] === "squad") {
    // A squad has no second view, so anything after the id is ignored rather than
    // meaningful — but an EMPTY id still falls back to the list, as a session does.
    if (!parts[1]) return { ...SQUADS };
    return { view: "squad", slug: decode(parts[1]) };
  }
  if (parts[0] !== "drill" || !parts[1]) return { ...BROWSE };
  return { view: parts[2] === "edit" ? "edit" : "read", slug: decode(parts[1]) };
}

export function formatHash({ view, slug }) {
  if (view === "sessions") return "#/sessions";
  if (view === "run" && slug) return `#/session/${encodeURIComponent(slug)}/run`;
  if (view === "run") return "#/sessions";
  if (view === "session" && slug) return `#/session/${encodeURIComponent(slug)}`;
  if (view === "squads") return "#/squads";
  if (view === "squad" && slug) return `#/squad/${encodeURIComponent(slug)}`;
  if (view === "squad") return "#/squads";
  if (!slug || view === "browse") return "#/";
  const base = `#/drill/${encodeURIComponent(slug)}`;
  return view === "edit" ? `${base}/edit` : base;
}
