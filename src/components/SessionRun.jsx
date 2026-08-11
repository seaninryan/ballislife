// src/components/SessionRun.jsx
// Run a planned session, block by block: date/squad/total header, then each block in
// plan order with its slot, the drill's full text (every diagram, every checklist),
// and a running "so far" total. Presentational, the same way SessionBuilder and
// SessionList are — App fetches each block's drill text and hands it in via `texts`,
// keyed by slug, so this component never talks to Drive and never writes anything
// back into a drill: DrillPreview's interactive mode routes every tick through
// lib/checklist.js into localStorage only.
import React from "react";
import { resolveBlocks, totalMinutes } from "../lib/sessions.js";
import DrillPreview from "./DrillPreview.jsx";

function RunBlock({ block, soFar, entry, today }) {
  return (
    <section className="card run-block">
      <div className="row run-block-header" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <strong className="block-slot">{block.slot}</strong>
          {block.drill ? <span className="block-title">{block.drill.title}</span> : null}
          {block.drill ? <span className="chip">{block.minutes}′</span> : null}
        </div>
        <span className="chip dim">{soFar}′ so far</span>
      </div>

      {block.missing ? (
        <div className="banner err">
          Drill "{block.drillRef}" is missing — it may have been deleted.
        </div>
      ) : !block.drill ? (
        <div className="banner warn">No drill chosen for this slot.</div>
      ) : !entry || entry.status === "loading" ? (
        <div className="dim">Loading…</div>
      ) : entry.status === "error" ? (
        <div className="banner err">
          Could not load "{block.drill.title}": {String(entry.error ?? "unknown error")}
        </div>
      ) : (
        <DrillPreview source={entry.text} interactive slug={block.drill.slug} today={today} />
      )}
    </section>
  );
}

export default function SessionRun({ session, drills = [], texts = {}, onBack, today }) {
  const day = today ?? new Date().toISOString().slice(0, 10);
  const blocks = resolveBlocks(session, drills);
  const total = totalMinutes(session, drills);

  let soFar = 0;
  const rows = blocks.map((block) => {
    soFar += block.minutes;
    return (
      <RunBlock
        key={block.slot}
        block={block}
        soFar={soFar}
        entry={block.drill ? texts[block.drill.slug] : null}
        today={day}
      />
    );
  });

  return (
    <div className="session-run">
      <div className="row run-controls" style={{ justifyContent: "space-between" }}>
        <button type="button" onClick={onBack}>← Back to plan</button>
        <div className="row">
          <strong>{session.date}</strong>
          {session.squad ? <span className="chip">{session.squad}</span> : null}
          {session.theme ? <span className="chip">{session.theme}</span> : null}
          <span className="chip">{total}′ total</span>
        </div>
      </div>
      {rows}
    </div>
  );
}
