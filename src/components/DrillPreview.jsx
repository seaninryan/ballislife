// src/components/DrillPreview.jsx
// Renders one drill document: metadata header, prose, and every pitch diagram.
// Prose is rendered as sanitised markdown HTML via lib/prose.js.
import React, { useMemo, useRef, useEffect, useCallback } from "react";
import { parseDoc } from "../lib/frontmatter.js";
import { splitSegments } from "../lib/markdown.js";
import { renderProse } from "../lib/prose.js";
import { readTicks, writeTicks, toggle } from "../lib/checklist.js";
import PitchDiagram from "./PitchDiagram.jsx";

// The pitch block's line within the FILE = frontmatter lines + its line in the body.
function frontmatterLines(source, body) {
  const consumed = source.length - body.length;
  if (consumed <= 0) return 0;
  return source.slice(0, consumed).split("\n").length - 1;
}

const storage = () => (typeof window !== "undefined" ? window.localStorage : null);

// `interactive` opts a drill's checklists into being tickable. It requires `slug` and
// `today` — the tick store is keyed by both, per lib/checklist.js. Ticks are NEVER
// written back into `source`; they go to localStorage only (see lib/checklist.js's
// header comment for why: a drill is reused every season, so `- [ ] cones out` must
// still say that next time).
export default function DrillPreview({ source = "", interactive = false, slug, today }) {
  const doc = useMemo(() => parseDoc(source), [source]);
  const segments = useMemo(() => splitSegments(doc.body), [doc.body]);
  const offset = useMemo(() => frontmatterLines(source, doc.body), [source, doc.body]);
  const containerRef = useRef(null);

  const meta = doc.meta ?? {};
  const chips = [meta.category, meta.minutes ? `${meta.minutes}′` : null, meta.players]
    .filter(Boolean)
    .concat(Array.isArray(meta.tags) ? meta.tags : []);

  // Every checkbox across every segment gets a globally-unique data-tick index: the
  // body is split into several SEPARATE renderProse calls (one per prose run, around
  // each pitch diagram), so without a running offset the second run's boxes would
  // collide with the first's.
  let tickCursor = 0;
  const rendered = segments.map((seg, i) => {
    if (seg.kind === "pitch") {
      return <PitchDiagram key={i} source={seg.text} baseLine={seg.line + offset} />;
    }
    const html = interactive
      ? renderProse(seg.text, { interactive: true, tickOffset: tickCursor })
      : renderProse(seg.text);
    if (interactive) tickCursor += (html.match(/data-tick="\d+"/g) ?? []).length;
    return <div key={i} className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
  });

  // Applies persisted ticks to the rendered inputs after mount. The HTML is injected
  // via dangerouslySetInnerHTML, so there are no React elements to set `checked` on
  // directly — this reaches into the real DOM through the ref instead. Never forces a
  // box to false: that would fight a checklist item the drill's own markdown wrote as
  // already checked. A new day (or a slug with nothing ticked) simply ticks nothing,
  // which is how the boxes end up clear again without anyone clearing them.
  useEffect(() => {
    if (!interactive || !containerRef.current) return;
    const ticked = readTicks(storage(), slug, today);
    for (const box of containerRef.current.querySelectorAll("input[data-tick]")) {
      if (ticked.has(Number(box.dataset.tick))) box.checked = true;
    }
  }, [interactive, slug, today, source]);

  // A single delegated listener on the container, per the plan: the checklist markup
  // is injected via dangerouslySetInnerHTML, so React never creates elements for it
  // and its own synthetic event system — which walks up the DOM looking for a node it
  // rendered — never finds a handler on the checkbox itself. A plain addEventListener
  // on the container (a real React-rendered node) is what actually receives the
  // native, bubbled `change` event from an injected descendant.
  const onContainerChange = useCallback((e) => {
    const target = e.target;
    if (target.tagName !== "INPUT" || target.type !== "checkbox" || target.dataset.tick === undefined) return;
    const index = Number(target.dataset.tick);
    const current = readTicks(storage(), slug, today);
    writeTicks(storage(), slug, today, toggle(current, index));
  }, [slug, today]);

  useEffect(() => {
    if (!interactive) return undefined;
    const node = containerRef.current;
    node?.addEventListener("change", onContainerChange);
    return () => node?.removeEventListener("change", onContainerChange);
  }, [interactive, onContainerChange]);

  return (
    <div className="card" ref={containerRef}>
      <h2 style={{ margin: "0 0 6px" }}>{meta.title || "Untitled drill"}</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>

      {doc.error ? <div className="banner warn mono">{doc.error}</div> : null}

      {rendered}
    </div>
  );
}
