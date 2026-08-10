// src/components/Filters.jsx
// Controlled: every value comes from `filter`, every change goes out through onChange.
// Holding no state keeps the filter in one place and this component SSR-testable.
import React from "react";

const CATEGORIES = ["warmup", "skill", "tactical", "match", "fun"];

// Tags actually in use, most-used first, so the common ones are reachable without
// scrolling. Ties break alphabetically so the order is stable between renders.
export function tagsOf(drills) {
  const counts = new Map();
  for (const d of drills ?? []) {
    for (const t of d.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

export default function Filters({ drills, filter, onChange }) {
  const set = (patch) => onChange?.({ ...filter, ...patch });
  const present = CATEGORIES.filter((c) => (drills ?? []).some((d) => d.category === c));
  const tags = tagsOf(drills);

  return (
    <div className="filters">
      <div className="row">
        <button
          type="button"
          className={`chip-button${!filter.category ? " active" : ""}`}
          onClick={() => set({ category: null })}
        >
          all
        </button>
        {present.map((c) => (
          <button
            type="button"
            key={c}
            className={`chip-button${filter.category === c ? " active" : ""}`}
            onClick={() => set({ category: filter.category === c ? null : c })}
          >
            {c}
          </button>
        ))}
        <input
          className="search"
          type="search"
          placeholder="Search drills"
          value={filter.query ?? ""}
          onChange={(e) => set({ query: e.target.value })}
        />
      </div>
      {tags.length ? (
        <div className="row" style={{ marginTop: 6 }}>
          {tags.map((t) => (
            <button
              type="button"
              key={t}
              className={`chip-button small${filter.tag === t ? " active" : ""}`}
              onClick={() => set({ tag: filter.tag === t ? null : t })}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
