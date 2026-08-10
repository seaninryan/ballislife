// src/components/DrillPreview.jsx
// Renders one drill document: metadata header, prose, and every pitch diagram.
// Prose is rendered as sanitised markdown HTML via lib/prose.js.
import React, { useMemo } from "react";
import { parseDoc } from "../lib/frontmatter.js";
import { splitSegments } from "../lib/markdown.js";
import { renderProse } from "../lib/prose.js";
import PitchDiagram from "./PitchDiagram.jsx";

// The pitch block's line within the FILE = frontmatter lines + its line in the body.
function frontmatterLines(source, body) {
  const consumed = source.length - body.length;
  if (consumed <= 0) return 0;
  return source.slice(0, consumed).split("\n").length - 1;
}

export default function DrillPreview({ source = "" }) {
  const doc = useMemo(() => parseDoc(source), [source]);
  const segments = useMemo(() => splitSegments(doc.body), [doc.body]);
  const offset = useMemo(() => frontmatterLines(source, doc.body), [source, doc.body]);

  const meta = doc.meta ?? {};
  const chips = [meta.category, meta.minutes ? `${meta.minutes}′` : null, meta.players]
    .filter(Boolean)
    .concat(Array.isArray(meta.tags) ? meta.tags : []);

  return (
    <div className="card">
      <h2 style={{ margin: "0 0 6px" }}>{meta.title || "Untitled drill"}</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>

      {doc.error ? <div className="banner warn mono">{doc.error}</div> : null}

      {segments.map((seg, i) =>
        seg.kind === "pitch" ? (
          <PitchDiagram key={i} source={seg.text} baseLine={seg.line + offset} />
        ) : (
          <div
            key={i}
            className="prose"
            dangerouslySetInnerHTML={{ __html: renderProse(seg.text) }}
          />
        ),
      )}
    </div>
  );
}
