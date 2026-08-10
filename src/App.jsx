import React, { useState } from "react";
import DrillPreview from "./components/DrillPreview.jsx";

const SAMPLE = `---
title: 3v2 to end line
category: skill
minutes: 15
players: 8-12
tags: [transition, finishing]
---

Reds attack, blues defend. Score by dribbling over the end line.

\`\`\`pitch
area: 40x25 half
zone: 28,0 12x25 "scoring zone"
goal: 0,12 small
cone: 5,5 5,20 35,5
red: A@10,20 B@25,14 C@34,20
blue: X@18,8 Y@30,7
pass: A->B
run: C~>28,4
dribble: B=>32,12
label: "3v2 to end line"
\`\`\`

Progression: add a recovering defender after ten seconds.
`;

export default function App() {
  const [source, setSource] = useState(SAMPLE);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: "10px 0" }}>ballislife</h1>
        <span className="dim">v{__APP_VERSION__} · pitch language preview</span>
      </div>
      <div className="split">
        <textarea
          className="mono"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          style={{ height: "70vh", width: "100%", resize: "vertical" }}
        />
        <DrillPreview source={source} />
      </div>
    </div>
  );
}
