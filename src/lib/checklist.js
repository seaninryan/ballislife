// src/lib/checklist.js
// Which checklist items are ticked, kept locally and keyed by drill AND day.
//
// Ticks are deliberately NOT written back into the drill markdown. A drill is reused
// every season, so `- [ ] cones out` describes what you do each time you run it — writing
// `- [x]` would mean next season's session started with everything already ticked and the
// checklist was worthless. Keying by day also means the boxes clear themselves before the
// next session without anyone clearing them.
const KEY = "ballislife_ticks";

export function readStore(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function readTicks(storage, slug, today) {
  const entry = readStore(storage)[slug];
  if (!entry || entry.date !== today) return new Set();
  return new Set(Array.isArray(entry.ticked) ? entry.ticked : []);
}

export function writeTicks(storage, slug, today, ticked) {
  const store = readStore(storage);
  const list = [...ticked].filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => a - b);
  if (list.length === 0) delete store[slug];
  else store[slug] = { date: today, ticked: list };
  for (const [k, v] of Object.entries(store)) if (v?.date !== today) delete store[k];
  try {
    storage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private browsing refuses writes. Losing ticks is acceptable; crashing is not.
  }
  return store;
}

export function toggle(ticked, index) {
  const next = new Set(ticked);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}
