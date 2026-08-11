// The edit/save lifecycle as a pure state machine: no React, no timers, no Drive.
// Every rule about when we are dirty, when a save may start, and what a conflict means
// lives here, which is what makes the hardest logic in this project testable.
export const CLEAN = "clean";
export const DIRTY = "dirty";
export const SAVING = "saving";
export const SAVED = "saved";
export const CONFLICT = "conflict";
export const FAILED = "failed";

export function openEditor(id, text, modifiedTime) {
  return { id, text, baseText: text, baseModifiedTime: modifiedTime, status: CLEAN, error: null };
}

export const isDirty = (s) => s.text !== s.baseText;

export function reduce(state, action) {
  switch (action.type) {
    case "open":
      return openEditor(action.id, action.text, action.modifiedTime);

    case "edit": {
      if (action.text === state.text) return state;
      // A conflict is not cleared by typing: Drive is still ahead of us, so the next
      // save would conflict again. Only keepMine or reloaded resolve it.
      const status = state.status === CONFLICT ? CONFLICT : DIRTY;
      return { ...state, text: action.text, status };
    }

    case "saveStarted":
      return { ...state, status: SAVING, error: null };

    case "saveSucceeded": {
      // savedText is the text that actually landed, not necessarily the current text:
      // the user may have typed on while the write was in flight. Marking clean here
      // would silently strand those keystrokes.
      const base = action.savedText;
      return {
        ...state,
        baseText: base,
        baseModifiedTime: action.modifiedTime ?? state.baseModifiedTime,
        status: state.text !== base ? DIRTY : SAVED,
        error: null,
      };
    }

    case "saveConflicted":
      // Never touch `text`. The user's work is the one thing that must survive.
      return {
        ...state,
        status: CONFLICT,
        baseModifiedTime: action.modifiedTime ?? state.baseModifiedTime,
      };

    case "saveFailed":
      return { ...state, status: FAILED, error: action.error };

    case "reloaded":
      // The user chose Drive's version over their own.
      return openEditor(state.id, action.text, action.modifiedTime);

    case "keepMine":
      // The user chose to overwrite Drive. Adopt Drive's modifiedTime so the next save
      // passes the conflict check, but keep their text as the pending edit.
      return { ...state, status: DIRTY, baseModifiedTime: action.modifiedTime };

    default:
      return state;
  }
}

// May a save start right now?
export const shouldSave = (s) => s.status === DIRTY && isDirty(s);
