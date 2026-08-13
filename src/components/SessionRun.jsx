// src/components/SessionRun.jsx
// Run a planned session as an accordion: the current block expanded with its slot,
// drill and full text (every diagram, every checklist), everything else collapsed to a
// one-line summary you can still open to refer back. Presentational, the same way
// SessionBuilder and SessionList are — App fetches each block's drill text and hands it
// in via `texts`, keyed by slug, so this component never talks to Drive and never
// writes anything back into a drill.
//
// Tonight's progress (which blocks are done or skipped, and therefore which is current)
// goes through lib/progress.js into localStorage synchronously, exactly like DrillPreview
// routes checklist ticks through lib/checklist.js: marking a drill done can never fail on
// bad signal, and a session run again next week starts clean without anyone resetting it.
// The same marks are also reported upward through `onProgress` so App can fold them into
// the session file on its usual debounce — that is what lets a session started on a phone
// be finished on a laptop. This component still never talks to Drive itself.
import React, { useState, useEffect } from "react";
import { resolveBlocks, totalMinutes } from "../lib/sessions.js";
import DrillPreview from "./DrillPreview.jsx";
import DrillPicker from "./DrillPicker.jsx";
import {
  DONE, SKIPPED, readProgress, localProgress, writeProgress, mark, reopen, currentIndex,
  counts, sessionProgress, mergeProgress, sameMarks, blockKey, migrateMarks,
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
// its summary to look at it without touching what is marked. `isCurrent` is narrower —
// true only for the actual current block — so that peeking a settled block open (to
// refer back to it) never makes it look like the one to act on next: only the current
// block gets the coloured edge and the NOW badge, whether or not anything else happens
// to be open beside it. `state` is only set once a block is settled, and its Not done
// control lives in the summary row itself so a settled block never needs to be opened
// just to be un-marked.
function RunBlock({
  block, entry, today, isOpen, isCurrent, state,
  picking, canSwap, turnout, drills, onSwapToggle, onPick,
  onDone, onSkip, onReopen, onToggle,
}) {
  const classes = [
    "card",
    "run-block",
    isOpen ? "run-block-open" : "run-block-collapsed",
    isCurrent ? "run-block-current" : "",
  ].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      <div className="row run-block-header" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="run-block-summary"
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          {isCurrent ? <span className="run-block-now-badge">NOW</span> : null}
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
          {state ? (
            <button type="button" className="chip-button" onClick={onReopen}>Not done</button>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <>
          {/* The actions row no longer belongs to Done/Skip alone: a block marked Done can
              still have its drill swapped without being un-marked first. It is skipped
              entirely when it would be empty, so a read-only mount (no onSwap) does not
              gain 20px of dead space above a settled block's body. */}
          {!state || canSwap ? (
            <div className="row run-block-actions">
              {!state ? (
                <>
                  <button type="button" className="chip-button chip-button-ok" onClick={onDone}>Done</button>
                  <button type="button" className="chip-button chip-button-warn" onClick={onSkip}>Skip</button>
                </>
              ) : null}
              {canSwap ? (
                <button type="button" className="chip-button" onClick={onSwapToggle}>
                  {picking ? "Cancel swap" : block.drill ? "Swap" : "Choose a drill"}
                </button>
              ) : null}
            </div>
          ) : null}
          {picking ? (
            <DrillPicker
              drills={drills}
              slot={block.slot}
              tags={block.drill?.tags ?? []}
              turnout={turnout}
              exclude={block.drill?.slug ?? null}
              onPick={onPick}
              // No onCancel: the actions row directly above already says "Cancel swap",
              // and the picker's list scrolls inside itself, so that button never leaves
              // the screen. Passing one here put two cancel controls one line apart.
            />
          ) : (
            <BlockContent block={block} entry={entry} today={today} />
          )}
        </>
      ) : null}
    </section>
  );
}

export default function SessionRun({
  session, drills = [], texts = {}, onBack, onSwap, onProgress, today,
  // Injectable so tests can assert on an exact stamp; the app never passes one.
  now = () => new Date().toISOString(),
}) {
  // Frozen at mount, not recomputed per render: a session still going at midnight would
  // otherwise change day under itself, reset to block 0, and split the night's marks across
  // two day keys in sessions.json. Tonight's run belongs to the day it started on.
  const [openedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const day = today ?? openedOn;
  const blocks = resolveBlocks(session, drills);
  const total = totalMinutes(session, drills);

  // Read from storage, the same way DrillPreview reads ticks — but NOT once per mount.
  // Catalogue renders SessionRun at the same position whichever session is being run,
  // so browser back/forward between two sessions' run views re-renders this component
  // instead of remounting it. Read once per mount and session A's marks would render
  // against session B's blocks, and the next persist would write A's marks under B's
  // key. Everything below is scoped to one session on one night, so it all reloads
  // together when either changes.
  // Every read of either store goes through a migration: marks written before v0.10 are
  // keyed by block index, and a mark must land on the drill it was made against even if
  // the plan has been reordered since. One helper per store so the migration cannot be
  // forgotten at one of the four places a store is read.
  const readLocalMarks = () => migrateMarks(readProgress(storage(), session?.id, day), blocks);
  const readSide = (side) => (side ? { ...side, marks: migrateMarks(side.marks, blocks) } : side);

  const [marks, setMarks] = useState(readLocalMarks);
  // Blocks opened by hand to look back or peek ahead, independent of what is marked.
  // The current block is always open regardless of this set.
  const [opened, setOpened] = useState(() => new Set());
  // Which block is choosing a replacement drill, or null. One at a time: two open
  // pickers on a phone is two scrolling lists competing for the same thumb.
  const [picking, setPicking] = useState(null);

  // \0 as the separator because it cannot occur in a session id or a date, so no pair of
  // (id, day) can collide with another. Written as the escape, not as a literal NUL byte:
  // a raw one in the source makes git treat this whole file as binary and stop showing
  // diffs for it.
  const progressKey = `${session?.id ?? ""}\0${day}`;
  const [shownKey, setShownKey] = useState(progressKey);
  if (shownKey !== progressKey) {
    // React's "adjusting state when a prop changes" pattern: set during render so the
    // re-render happens before anything is committed, rather than showing the wrong
    // session's progress for one frame and then correcting it in an effect.
    setShownKey(progressKey);
    setMarks(readLocalMarks());
    setOpened(new Set());
    setPicking(null);
  }

  // Reconcile this device against what the session file says. An effect rather than part of
  // render because it may write localStorage and call onProgress. The session's stored
  // progress is always in hand by the first render — App only reaches "ready" once
  // loadSessions has resolved — so remoteKey is not there to catch a late load: it is there
  // for "Reload Drive's version", which replaces the data underneath a running session.
  //
  // It cannot loop: reporting upward makes App write those same marks into the session,
  // which re-renders this component, at which point sameMarks finds the two sides in
  // agreement and nothing further happens.
  const remote = readSide(sessionProgress(session, day));
  const remoteKey = remote ? `${remote.updatedAt} ${JSON.stringify(remote.marks)}` : "";
  useEffect(() => {
    // localProgress, not readProgress: null here means this device has nothing for tonight,
    // which must not be confused with this device having deliberately cleared everything.
    const local = readSide(localProgress(storage(), session?.id, day));
    // `now` goes in so mergeProgress can disbelieve a stamp far in the future, and so a
    // test with an injected clock is judged against that clock rather than the real one.
    const winner = mergeProgress(local, remote, Date.parse(now()));
    if (winner === remote) {
      // The other device is ahead. Adopt it here, storage included, so the rest of
      // tonight works with no signal at all.
      if (!sameMarks(winner.marks, local?.marks ?? {})) {
        writeProgress(storage(), session?.id, day, winner.marks, winner.updatedAt);
      }
      if (!sameMarks(winner.marks, marks)) setMarks(winner.marks);
      return;
    }
    // This device is ahead, or is the only one with anything. Let Drive catch up — but only
    // if it has a stamp of its own. An unstamped local entry (written before this feature
    // existed, or typed into the file by hand) has nothing to prove it is newer, so it wins
    // on screen here and stays silent until the next tap stamps it. Manufacturing a stamp
    // here instead reported the whole day upward, which overwrote what Drive held.
    if (winner.updatedAt && !sameMarks(winner.marks, remote?.marks ?? {})) {
      onProgress?.(day, winner.marks, winner.updatedAt);
    }
    // Deliberately narrow: `marks` would re-run this on every tap (where local has just
    // won by construction) and `onProgress` would re-run it whenever App re-creates the
    // callback. Neither can change who wins.
  }, [session?.id, day, remoteKey]);

  const current = currentIndex(marks, blocks);
  const { done, skipped, remaining } = counts(marks, blocks);

  // localStorage first and synchronously: marking a drill done must never wait on signal
  // or be able to fail. Reporting upward is what eventually reaches Drive, on App's
  // existing debounce — a consequence of the tap, never a precondition for it.
  const persist = (next) => {
    const stamp = now();
    setMarks(next);
    writeProgress(storage(), session?.id, day, next, stamp);
    onProgress?.(day, next, stamp);
  };

  const collapse = (index) => {
    setOpened((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };

  // A block that is being marked or collapsed has stopped choosing a drill. Without
  // this, marking Done with the picker open left `picking` pointing at a block that is
  // no longer even open, so peeking it back later showed the picker instead of the drill.
  const stopPicking = (index) => setPicking((cur) => (cur === index ? null : cur));

  // Both an index and a key: the index drives `opened`/`picking` and the accordion, the
  // key drives `marks`. They are not interchangeable — that conflation was the bug.
  const handleMark = (index, key, state) => {
    persist(mark(marks, key, state));
    stopPicking(index);
    collapse(index);
  };

  const handleReopen = (index, key) => {
    persist(reopen(marks, key));
    stopPicking(index);
    collapse(index);
  };

  // A swap replaces the work, so whatever was marked no longer refers to anything that
  // happened — clear it. App owns the write to the plan itself; this component only
  // reports the choice and cleans up tonight's progress for that block. The slot keeps its
  // key across a swap, so the mark to clear is the one under that key.
  const handlePick = (index, key, drill) => {
    setPicking(null);
    persist(reopen(marks, key));
    onSwap?.(index, drill.slug);
  };

  const handleToggle = (index) => {
    stopPicking(index);
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // The accordion's only section today is the block list. Once squads exist, Sean
  // wants a player list with attendance ticks as the FIRST collapsible section, above
  // `rows` — this loop is deliberately just the blocks so that section can be
  // prepended later without restructuring anything here.
  const rows = blocks.map((block, index) => {
    const isCurrent = index === current;
    const isOpen = isCurrent || opened.has(index);
    const markKey = blockKey(block, index);
    return (
      <RunBlock
        key={block.slot}
        block={block}
        entry={block.drill ? texts[block.drill.slug] : null}
        today={day}
        isOpen={isOpen}
        isCurrent={isCurrent}
        state={marks[markKey]}
        picking={picking === index}
        canSwap={Boolean(onSwap)}
        turnout={Number.isFinite(session?.turnout) ? session.turnout : undefined}
        drills={drills}
        onSwapToggle={() => setPicking((cur) => (cur === index ? null : index))}
        onPick={(drill) => handlePick(index, markKey, drill)}
        onDone={() => handleMark(index, markKey, DONE)}
        onSkip={() => handleMark(index, markKey, SKIPPED)}
        onReopen={() => handleReopen(index, markKey)}
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
