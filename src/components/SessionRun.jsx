// src/components/SessionRun.jsx
// Run a planned session as an accordion: the current block expanded with its slot,
// drill and full text (every diagram, every checklist), everything else collapsed to a
// one-line summary you can still open to refer back. Presentational, the same way
// SessionBuilder and SessionList are — App fetches each block's drill text and hands it
// in via `texts`, keyed by slug, so this component never talks to Drive and never
// writes anything back into a drill.
//
// Tonight's progress (which blocks are done or skipped, and therefore which is current)
// goes through lib/progress.js into localStorage only — exactly like DrillPreview routes
// checklist ticks through lib/checklist.js. Nothing here calls saveSessions: marking a
// drill done can never fail on bad signal, and a session run again next week starts
// clean without anyone resetting it.
import React, { useState } from "react";
import { resolveBlocks, totalMinutes } from "../lib/sessions.js";
import DrillPreview from "./DrillPreview.jsx";
import {
  DONE, SKIPPED, readProgress, writeProgress, mark, reopen, currentIndex, counts, soFarMinutes,
} from "../lib/progress.js";

const storage = () => (typeof window !== "undefined" ? window.localStorage : null);

const STATE_LABEL = { [DONE]: "Done", [SKIPPED]: "Skipped" };

function BlockContent({ block, entry, today }) {
  if (block.missing) {
    return (
      <div className="banner err">
        Drill "{block.drillRef}" is missing — it may have been deleted.
      </div>
    );
  }
  if (!block.drill) {
    return <div className="banner warn">No drill chosen for this slot.</div>;
  }
  if (!entry || entry.status === "loading") return <div className="dim">Loading…</div>;
  if (entry.status === "error") {
    return (
      <div className="banner err">
        Could not load "{block.drill.title}": {String(entry.error ?? "unknown error")}
      </div>
    );
  }
  return <DrillPreview source={entry.text} interactive slug={block.drill.slug} today={today} />;
}

// One block of the accordion. `isOpen` covers both reasons a block might be showing its
// full content: it is the current one (the first not yet settled), or someone tapped
// its summary to look at it without touching what is marked. `state` is only set once a
// block is settled, and its Reopen control lives in the summary row itself so a settled
// block never needs to be opened just to be reopened.
function RunBlock({ block, soFar, entry, today, isOpen, state, onDone, onSkip, onReopen, onToggle }) {
  return (
    <section className={`card run-block${isOpen ? " run-block-open" : " run-block-collapsed"}`}>
      <div className="row run-block-header" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="run-block-summary"
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          <strong className="block-slot">{block.slot}</strong>
          {block.drill ? <span className="block-title">{block.drill.title}</span> : null}
          {block.drill ? <span className="chip">{block.minutes}′</span> : null}
          {state ? (
            <span className={`chip ${state === DONE ? "ok-chip" : "warn-chip"}`}>
              {STATE_LABEL[state]}
            </span>
          ) : null}
        </button>
        <div className="row">
          <span className="chip dim">{soFar === null ? "—" : `${soFar}′ so far`}</span>
          {state ? (
            <button type="button" className="chip-button small" onClick={onReopen}>Reopen</button>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <>
          <BlockContent block={block} entry={entry} today={today} />
          {!state ? (
            <div className="row run-block-actions">
              <button type="button" className="chip-button" onClick={onDone}>Done</button>
              <button type="button" className="chip-button" onClick={onSkip}>Skip</button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default function SessionRun({ session, drills = [], texts = {}, onBack, today }) {
  const day = today ?? new Date().toISOString().slice(0, 10);
  const blocks = resolveBlocks(session, drills);
  const total = totalMinutes(session, drills);

  // Loaded once, on mount, the same way DrillPreview reads ticks: a fresh mount for a
  // new day (or a session with nothing marked yet) simply starts with nothing settled.
  const [marks, setMarks] = useState(() => readProgress(storage(), session?.id, day));
  // Blocks opened by hand to look back or peek ahead, independent of what is marked.
  // The current block is always open regardless of this set.
  const [opened, setOpened] = useState(() => new Set());

  const current = currentIndex(marks, blocks.length);
  const { done, skipped, remaining } = counts(marks, blocks.length);

  const persist = (next) => {
    setMarks(next);
    writeProgress(storage(), session?.id, day, next);
  };

  const collapse = (index) => {
    setOpened((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };

  const handleMark = (index, state) => {
    persist(mark(marks, index, state));
    collapse(index);
  };

  const handleReopen = (index) => {
    persist(reopen(marks, index));
    collapse(index);
  };

  const handleToggle = (index) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // A skipped block contributes zero to the running total — see soFarMinutes for why.
  const soFarByIndex = soFarMinutes(blocks, marks);
  // The accordion's only section today is the block list. Once squads exist, Sean
  // wants a player list with attendance ticks as the FIRST collapsible section, above
  // `rows` — this loop is deliberately just the blocks so that section can be
  // prepended later without restructuring anything here.
  const rows = blocks.map((block, index) => {
    const isOpen = index === current || opened.has(index);
    return (
      <RunBlock
        key={block.slot}
        block={block}
        soFar={soFarByIndex[index]}
        entry={block.drill ? texts[block.drill.slug] : null}
        today={day}
        isOpen={isOpen}
        state={marks[index]}
        onDone={() => handleMark(index, DONE)}
        onSkip={() => handleMark(index, SKIPPED)}
        onReopen={() => handleReopen(index)}
        onToggle={() => handleToggle(index)}
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
          <span className="chip dim">{done} done · {skipped} skipped · {remaining} remaining</span>
        </div>
      </div>

      {current === -1 ? (
        <div className="card banner ok run-finished">
          Session finished — {done} done, {skipped} skipped.
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="chip-button" onClick={() => persist({})}>Start over</button>
          </div>
        </div>
      ) : null}

      {rows}
    </div>
  );
}
