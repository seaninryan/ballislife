// The picker's ordering rules. Pure, so no jsdom: the whole point of keeping this out of
// DrillPicker.jsx is that "what should be near the top" is testable without a DOM.
import { describe, it, expect } from "vitest";
import { rankDrills, scoreDrill, sharedTags, SORTS } from "../src/lib/picker.js";

const d = (slug, title, category, minutes, tags = [], players = null) =>
  ({ slug, title, category, minutes, tags, players });

const pool = [
  d("rondo", "Rondo 4v2", "skill", 12, ["possession", "rondo"]),
  d("gates", "Passing gates", "skill", 8, ["passing"]),
  d("hk", "High knees", "warmup", 6, ["mobility"]),
  d("ssg", "SSG 6v6", "match", 25, ["possession"], "12+"),
  d("dribble", "Dribble squares", "skill", 10, ["possession", "dribbling"]),
  d("nomin", "No duration drill", "skill", null, []),
];
const slugs = (entries) => entries.map((e) => e.drill.slug);

describe("scoreDrill / sharedTags", () => {
  it("a matching category outweighs any number of shared tags", () => {
    const sameCategory = scoreDrill(d("x", "X", "skill", 5), { slot: "skill", tags: ["a", "b"] });
    const allTags = scoreDrill(d("y", "Y", "fun", 5, ["a", "b"]), { slot: "skill", tags: ["a", "b"] });
    expect(sameCategory).toBeGreaterThan(allTags);
  });

  it("compares tags case-insensitively but reports the drill's own spelling", () => {
    expect(sharedTags({ tags: ["Possession"] }, ["possession"])).toEqual(["Possession"]);
  });

  it("is total: no drill, no slot and no tags all score 0 rather than throwing", () => {
    expect(scoreDrill(undefined, { slot: "skill" })).toBe(0);
    expect(scoreDrill(d("x", "X", "skill", 5), {})).toBe(0);
    expect(sharedTags({ tags: ["a"] }, [])).toEqual([]);
  });
});

describe("rankDrills", () => {
  it("puts the slot's own category first, then most shared tags, then title", () => {
    const ranked = rankDrills(pool, { slot: "skill", tags: ["possession", "rondo"] });
    expect(slugs(ranked)).toEqual(["rondo", "dribble", "nomin", "gates", "ssg", "hk"]);
    // "nomin" before "gates" is title order among equal scores: both are skill drills
    // with no shared tag, and "No duration drill" < "Passing gates". "hk" is last and
    // still offered: nothing is hidden, a warm-up is just a poor match for a skill slot.
  });

  it("reports which tags matched, for the component to show", () => {
    const ranked = rankDrills(pool, { slot: "skill", tags: ["possession", "rondo"] });
    expect(ranked[0].matched).toEqual(["possession", "rondo"]);
    expect(ranked.find((e) => e.drill.slug === "gates").matched).toEqual([]);
  });

  it("excludes the drill being replaced — swapping a drill for itself is not a swap", () => {
    const withSelf = [...pool, d("keepaway", "Keep away", "skill", 12)];
    expect(slugs(rankDrills(withSelf, { slot: "skill", exclude: "keepaway" })))
      .not.toContain("keepaway");
  });

  it("drops a drill that does not fit the turnout, and keeps one with no players field", () => {
    const ranked = rankDrills(pool, { slot: "match", turnout: 8 });
    expect(slugs(ranked)).not.toContain("ssg"); // needs 12+
    expect(slugs(ranked)).toContain("rondo");   // no players field: unknown means fits
  });

  it("searches titles and tags", () => {
    expect(slugs(rankDrills(pool, { query: "knee" }))).toEqual(["hk"]);
    expect(slugs(rankDrills(pool, { query: "dribbl" }))).toEqual(["dribble"]);
  });

  it("restricts to the slot's category only when asked", () => {
    expect(slugs(rankDrills(pool, { slot: "warmup", sameCategoryOnly: true }))).toEqual(["hk"]);
    expect(slugs(rankDrills(pool, { slot: "warmup" })).length).toBe(pool.length);
  });

  it("orders by title, ignoring category and tags", () => {
    // Dribble squares, High knees, No duration drill, Passing gates, Rondo 4v2, SSG 6v6.
    expect(slugs(rankDrills(pool, { slot: "skill", sort: "title" })))
      .toEqual(["dribble", "hk", "nomin", "gates", "rondo", "ssg"]);
  });

  it("orders by duration, with a drill that has no duration last rather than first", () => {
    // Number(null) is 0 and Number.isFinite(0) is true, so the naive comparator puts
    // every duration-less drill at the very top of "shortest first".
    expect(slugs(rankDrills(pool, { slot: "skill", sort: "minutes" })))
      .toEqual(["hk", "gates", "dribble", "rondo", "ssg", "nomin"]);
  });

  it("with no slot and no tags, relevance order is just title order", () => {
    expect(slugs(rankDrills(pool, {}))).toEqual(slugs(rankDrills(pool, { sort: "title" })));
  });

  it("survives no drills at all and an unknown sort", () => {
    expect(rankDrills(undefined, { slot: "skill" })).toEqual([]);
    expect(slugs(rankDrills(pool, { sort: "nonsense" }))).toEqual(slugs(rankDrills(pool, {})));
  });

  it("exposes an order for every sort it accepts", () => {
    expect(SORTS.map((s) => s.key)).toEqual(["relevance", "title", "minutes"]);
    for (const { key, label } of SORTS) {
      expect(typeof label).toBe("string");
      expect(rankDrills(pool, { sort: key }).length).toBe(pool.length);
    }
  });
});
