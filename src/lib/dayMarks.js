// src/lib/dayMarks.js
// The day-keyed marks store, shared by progress (blocks done or skipped) and attendance
// (who turned up). Both need exactly the same thing: a map of key -> state, kept per day
// and per session, written to localStorage synchronously on the tap so a mark never waits
// on signal, and ALSO folded into the session file so a session started on a phone can be
// finished on a laptop. This module owns both shapes and the rule for reconciling them; it
// performs no I/O of its own beyond the storage object handed in.
//
// It is extracted rather than copied because the semantics below took two data-loss bugs to
// settle — a corrupt blob that silently emptied the store, and a cleared mark that came back
// from the other device. A second implementation would invite both back.
//
// Parameterised by the localStorage key, the field it occupies on a session, and the states
// it will accept. Everything else — day keying, pruning, tombstones, the merge — is common.

const readAll = (storage, storageKey) => {
  try {
    const parsed = JSON.parse(storage?.getItem(storageKey));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Only ever trust the declared states, whichever store the marks came out of: both are
// hand-editable, and one is a JSON file the owner reads. Keys are NOT validated beyond being
// non-empty, because this function does not know what they name — a mark for a slot or a
// player that no longer exists is simply never read.
function cleanMarks(raw, states) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    if (states.includes(v) && k !== "") out[k] = v;
  }
  return out;
}

const cleanStamp = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

export function createDayMarks({ storageKey, field, states }) {
  const clean = (raw) => cleanMarks(raw, states);
  const sideOf = (entry) => ({ marks: clean(entry.marks), updatedAt: cleanStamp(entry.updatedAt) });
  const entryFor = (storage, id, today) => {
    const entry = readAll(storage, storageKey)[id];
    return entry && entry.date === today ? entry : null;
  };

  const readMarks = (storage, id, today) => {
    const entry = entryFor(storage, id, today);
    return entry ? clean(entry.marks) : {};
  };

  const readStamp = (storage, id, today) => {
    const entry = entryFor(storage, id, today);
    return entry ? cleanStamp(entry.updatedAt) : null;
  };

  function writeMarks(storage, id, today, marks, updatedAt = null) {
    const store = readAll(storage, storageKey);
    const next = {};
    for (const [k, v] of Object.entries(marks ?? {})) {
      if (states.includes(v)) next[k] = v;
    }
    const stamp = cleanStamp(updatedAt);
    // A stamped clear is kept as an empty entry, not deleted: "cleared at 20:00" has to
    // outrank the other device's "done at 19:00", and a missing entry cannot say when.
    // An unstamped clear has no time worth remembering, so it just forgets the day.
    if (Object.keys(next).length === 0 && !stamp) delete store[id];
    else store[id] = { date: today, marks: next, updatedAt: stamp };
    for (const [k, v] of Object.entries(store)) if (v?.date !== today) delete store[k];
    try {
      storage?.setItem(storageKey, JSON.stringify(store));
    } catch {
      // Private browsing refuses writes. Losing a local copy is acceptable; crashing is not.
    }
    return store;
  }

  // This device's side of the merge: null when it has nothing at all for the day, an entry
  // with empty marks when the day was deliberately cleared here. The two must be told apart
  // for the same reason sessionSide tells them apart — otherwise the other device's older
  // marks win and the clear undoes itself.
  const localSide = (storage, id, today) => {
    const entry = entryFor(storage, id, today);
    return entry ? sideOf(entry) : null;
  };

  // Every session's local side for one day, from a single read of storage. localStorage
  // holds only today's entries, but a caller checking every session would otherwise parse
  // the same blob once per session on every render.
  const localSides = (storage, today) => {
    const out = {};
    for (const [id, entry] of Object.entries(readAll(storage, storageKey))) {
      if (entry?.date === today) out[id] = sideOf(entry);
    }
    return out;
  };

  // The session-file half of the same information. Returns null rather than an empty entry
  // when there is nothing for this day, so mergeSides can tell "nothing marked yet" apart
  // from "every mark was cleared" — which is the difference between un-marking working and
  // not. A day cleared everywhere is therefore kept as an empty stamped entry, never deleted.
  const sessionSide = (session, day) => {
    const entry = session?.[field]?.[day];
    if (!entry || typeof entry !== "object") return null;
    return sideOf(entry);
  };

  const withSessionSide = (session, day, marks, updatedAt) => {
    const days = { ...(session?.[field] ?? {}) };
    // An empty day is stored, not deleted — see sessionSide. Deleting it made a clear
    // indistinguishable from an untouched day, so the other device re-uploaded its marks.
    days[day] = { marks: clean(marks), updatedAt: cleanStamp(updatedAt) };
    return { ...session, [field]: days };
  };

  return {
    readMarks, readStamp, writeMarks, localSide, localSides, sessionSide, withSessionSide,
    // Exposed because a caller that transforms a marks map of its own — progress migrating
    // off its old index keys — must apply the same validation this store applies.
    cleanMarks: clean,
  };
}

// Whole-day last-writer-wins. Merging mark by mark is tempting and wrong: an unmarked key is
// the ABSENCE of a key, so a union silently resurrects a mark you deliberately cleared on the
// other device. A stamped side always beats an unstamped one (an entry written before stamps
// existed has none), and a tie prefers local so that merely opening a view does not schedule
// a save that changes nothing.
//
// A stamp more than a day in the future is treated as no stamp: a phone whose clock is set to
// next year would otherwise win every comparison forever, silencing the other device with no
// way for the coach to notice. A day of slack is deliberate — clocks are routinely minutes or
// hours out, and this is a mitigation for the pathological case only, not an attempt to
// correct skew.
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

export function mergeSides(local, remote, now = Date.now()) {
  if (!local && !remote) return { marks: {}, updatedAt: null };
  if (!local) return remote;
  if (!remote) return local;
  const limit = (Number.isFinite(now) ? now : Date.now()) + FUTURE_SLACK_MS;
  const at = (side) => {
    const t = Date.parse(side.updatedAt ?? "");
    return t <= limit ? t : NaN;
  };
  const l = at(local);
  const r = at(remote);
  if (!Number.isFinite(l) && !Number.isFinite(r)) return local;
  if (!Number.isFinite(l)) return remote;
  if (!Number.isFinite(r)) return local;
  return r > l ? remote : local;
}

export function sameMarks(a, b) {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}
