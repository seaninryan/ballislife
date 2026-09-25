// src/components/Editor.jsx
// Renders the editor state machine's state. Presentational: no Drive, no timers, no
// rules about when to save — App owns those.
import React, { useEffect, useMemo, useRef } from "react";
import DrillPreview from "./DrillPreview.jsx";
import PitchHelp from "./PitchHelp.jsx";
import { DIRTY, SAVING, CONFLICT, FAILED } from "../lib/editor.js";
import { friendlyError } from "../lib/errors.js";
import { addSlide, hasPitchBlock } from "../lib/slideTemplate.js";
import { replaceBlock, insertText, lineRange } from "../lib/editDoc.js";

function Status({ state }) {
  if (state.status === CONFLICT) return <span className="chip warn-chip">conflict</span>;
  if (state.status === FAILED) return <span className="chip err-chip">not saved</span>;
  if (state.status === SAVING) return <span className="chip dim">saving…</span>;
  if (state.status === DIRTY) return <span className="chip dim">unsaved</span>;
  return <span className="chip dim">saved</span>;
}

export default function Editor({ state, onEdit, onBack, onDelete, onKeepMine, onReload }) {
  const sourceRef = useRef(null);
  const pendingSelect = useRef(null);
  const gutterRef = useRef(null);
  const canAddSlide = useMemo(() => hasPitchBlock(state.text), [state.text]);
  const lineCount = state.text.split("\n").length;

  // Focus the source, select [start, end) and bring it into view: selecting text does not
  // scroll a textarea to it.
  const reveal = (el, start, end) => {
    el.focus();
    el.setSelectionRange(start, end);
    const line = el.value.slice(0, start).split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3);
  };

  // Applied after the edit re-renders the textarea: React writing the new value moves
  // the cursor to the end, so selecting any earlier would be undone.
  useEffect(() => {
    const range = pendingSelect.current;
    const el = sourceRef.current;
    if (!range || !el) return;
    pendingSelect.current = null;
    // On a long drill the new slide is well below the fold.
    reveal(el, range[0], range[1]);
  }, [state.text]);

  const onAddSlide = () => {
    const el = sourceRef.current;
    const r = addSlide(state.text, el ? el.selectionStart : state.text.length);
    if (!r) return;
    pendingSelect.current = r.select;
    onEdit?.(r.text);
  };

  // A drag on the preview hands back the whole new block; splice it into the drill.
  const onBlockChange = (line, content) => {
    const next = replaceBlock(state.text, line, content);
    if (next !== null) onEdit?.(next);
  };
  // A click on the preview writes that coordinate where the coach is typing.
  const onPick = (coord) => {
    const el = sourceRef.current;
    const start = el ? el.selectionStart : state.text.length;
    const end = el ? el.selectionEnd : start;
    const r = insertText(state.text, start, end, coord);
    pendingSelect.current = [r.cursor, r.cursor];
    onEdit?.(r.text);
  };
  // A click on a diagram error selects the line it names.
  const onErrorLine = (line) => {
    const r = lineRange(state.text, line);
    if (r && sourceRef.current) reveal(sourceRef.current, r.start, r.end);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={onBack}>← Back</button>
        <Status state={state} />
        <span style={{ marginLeft: "auto" }} />
        <button type="button" onClick={onDelete}>Delete</button>
      </div>

      {state.status === CONFLICT ? (
        <div className="banner warn">
          This drill changed in Drive since you opened it. Your edit is safe and still
          below — choose which version to keep.
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="primary" onClick={onKeepMine}>Keep mine</button>
            <button type="button" onClick={onReload}>Reload Drive’s version</button>
          </div>
        </div>
      ) : null}

      {state.status === FAILED ? (
        <div className="banner err">
          Could not save: {friendlyError(state.error)} Your edit is still here and will be
          retried when you type again.
        </div>
      ) : null}

      <PitchHelp />

      <div className="row" style={{ marginBottom: 6 }}>
        <button
          type="button" onClick={onAddSlide} disabled={!canAddSlide}
          title={canAddSlide ? "Add a slide to the diagram the cursor is in" : "Add a pitch diagram first"}
        >
          Add slide
        </button>
      </div>

      <div className="split">
        <div className="editor-source-wrap">
          {/* Numbers the lines as error messages count them. The textarea does not wrap,
              so each number stays beside its line; scrolling moves both together. */}
          <pre className="mono editor-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
          </pre>
          <textarea
            ref={sourceRef}
            className="mono editor-source"
            value={state.text}
            onChange={(e) => onEdit?.(e.target.value)}
            onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
            spellCheck={false}
            wrap="off"
          />
        </div>
        <div className="editor-preview">
          <DrillPreview source={state.text} onBlockChange={onBlockChange} onPick={onPick} onErrorLine={onErrorLine} />
        </div>
      </div>
    </div>
  );
}
