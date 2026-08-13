// src/lib/picker.js
// Choosing a drill to put in a slot: which candidates to offer, and in what order.
// Pure — no React, no Drive.
//
// The builder's original picker HID everything whose category did not match the slot.
// That is wrong when swapping mid-session: you are swapping precisely because the plan
// did not survive the turnout, so the drill you need may well be a "fun" drill going
// into a tactical slot. So nothing is hidden by default — the like-for-like drills are
// sorted to the top instead, and the hard filter is an opt-in.
import { filterDrills } from "./drills.js";
import { fitsSquad } from "./sessions.js";

export const SORTS = [
  { key: "relevance", label: "Best match" },
  { key: "title", label: "Title" },
  { key: "minutes", label: "Shortest first" },
];

// A category match outranks any number of shared tags: a warm-up with three tags in
// common with the tactical drill you are replacing is still a warm-up. The tag weight
// only orders drills that are already equal on category.
const CATEGORY_SCORE = 100;
const TAG_SCORE = 10;

// Returns the DRILL's spelling of each shared tag, not the query's, so the component
// shows "Possession" if that is what the drill says.
export function sharedTags(drill, tags) {
  // Array.isArray rather than ?? []: a hand-edited `tags: possession` is a string, and
  // iterating a string here would "share" single characters.
  const want = new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase()));
  if (!want.size) return [];
  const own = Array.isArray(drill?.tags) ? drill.tags : [];
  return own.filter((t) => want.has(String(t).toLowerCase()));
}

export function scoreDrill(drill, { slot, tags } = {}) {
  let score = 0;
  if (slot && drill?.category === slot) score += CATEGORY_SCORE;
  return score + sharedTags(drill, tags).length * TAG_SCORE;
}

// A drill with no duration sorts LAST under "shortest first", never first. Number(null)
// is 0 and Number.isFinite(0) is true, so the obvious one-liner does the opposite.
const minutesOf = (drill) => {
  const raw = drill?.minutes;
  if (raw === null || raw === undefined || raw === "") return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Infinity;
};

// slot/tags describe what the slot WANTS (for scoring); query/sameCategoryOnly/turnout
// narrow what is offered at all; exclude drops the drill being replaced.
export function rankDrills(drills, options = {}) {
  const {
    slot = null, tags = [], turnout, query = "",
    sameCategoryOnly = false, exclude = null, sort = "relevance",
  } = options;

  const entries = filterDrills(drills, { query, category: sameCategoryOnly ? slot : null })
    .filter((d) => d.slug !== exclude)
    .filter((d) => fitsSquad(d, turnout))
    .map((drill) => ({
      drill,
      score: scoreDrill(drill, { slot, tags }),
      matched: sharedTags(drill, tags),
    }));

  const byTitle = (a, b) => String(a.drill.title).localeCompare(String(b.drill.title));
  if (sort === "title") return entries.sort(byTitle);
  if (sort === "minutes") {
    return entries.sort((a, b) => minutesOf(a.drill) - minutesOf(b.drill) || byTitle(a, b));
  }
  return entries.sort((a, b) => b.score - a.score || byTitle(a, b));
}
