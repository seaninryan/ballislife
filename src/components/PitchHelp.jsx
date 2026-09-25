// src/components/PitchHelp.jsx
// A reference card for writing a drill, shown at the top of the editor.
//
// Collapsed by default via <details>: it needs no JavaScript, and on a phone it must not
// push the source pane off screen before you have even started typing.
//
// Laid out as a definition list rather than a two-column table: at phone width a table
// squeezed the code column until `shot: C->>goal` wrapped mid-token, and ran each
// example into its description as one run-on sentence. Code on its own line, meaning
// beneath, reads at every width.
//
// The vocabulary is built from pitch.js's own exported constants rather than retyped, so
// the card cannot quietly drift out of step with what the parser accepts.
import React from "react";
import { MARKINGS, TEAMS, GOAL_SIZES, POINT_MARKS, ARROWS, CLEAR_TARGETS } from "../lib/pitch.js";

const FRONTMATTER = [
  ["title: Rondo 4v2", "What the drill is called."],
  ["category: warmup", `Groups it in the catalogue. One of: ${["warmup", "skill", "tactical", "match", "fun"].join(", ")}.`],
  ["minutes: 15", "How long it runs."],
  ["players: 8-12", "How many it needs."],
  ["tags: [possession, rondo]", "Anything you might search for later."],
];

const SURFACE = [
  ["area: 40x25 half", `The pitch, in metres, then its markings. One of: ${MARKINGS.join(", ")}.`],
  ['zone: 28,0 12x25 "scoring zone"', "A shaded area: top-left corner, then size, then an optional label."],
  ["goal: 0,12 small", `A goal. Sizes: ${GOAL_SIZES.join(", ")}.`],
];

const THINGS = [
  [`${POINT_MARKS[0]}: 5,5 5,20 35,5`, "Cones. Repeat the coordinates for as many as you need."],
  [`${POINT_MARKS[1]}: 10,12`, "A ball."],
  [`${POINT_MARKS[2]}: 36,4`, "A corner flag or pole."],
  [`${TEAMS[0]}: A@10,20 B@25,14`, "Players on the attacking team, each with a short label."],
  [`${TEAMS[1]}: X@18,8`, "The other team."],
  [`${TEAMS[2]}: N@20,20`, "A third team, if you need one."],
  [`${TEAMS[3]}: K@1,12`, "A keeper, drawn as a square rather than a circle."],
];

const MOVES = [
  [`pass: A${ARROWS.pass}B`, "A solid line: the ball travels."],
  [`run: C${ARROWS.run}28,4`, "A dashed line: a player moves without the ball."],
  [`dribble: B${ARROWS.dribble}32,12`, "A wavy line: a player carries the ball."],
  [`shot: C${ARROWS.shot}goal`, "A thick line: a shot or a long delivery."],
];

const SLIDES = [
  ['slide: "B finds C"', "Starts the next slide, with an optional caption. Everything below it, up to the next slide, is what changes."],
  ["red: C@28,4", "Naming a player who is already on moves them there — they glide. A new label adds a player."],
  ["ball: C", "Replaces every ball. A player's label puts the ball at their feet, and it follows them."],
  [`pass: B${ARROWS.pass}C`, "Adds an arrow. Arrows from earlier slides stay, drawn fainter."],
  [`clear: ${CLEAR_TARGETS.join(" ")}`, "Wipes the arrows, the balls, or both, carried over from the slide before."],
  [`remove: X B${ARROWS.pass}C`, "Takes a player off, or an arrow — write the arrow as it was added."],
  ["loop: on", "Before the first slide line: play round again after the last slide. Off by default."],
];

const CHECKLISTS = [
  ["- [ ] cones out", "One item per line, ticked off one at a time before or during a session."],
  ["[ ] high knees [ ] butt kicker [ ] gate", "Several short items on one line — good for a warm-up's list of moves."],
];

const EXAMPLE = `\`\`\`pitch
area: 40x25 half
goal: 0,12 small
cone: 5,5 5,20
red: A@10,20 B@25,14 C@34,20
blue: X@18,8 Y@30,7
pass: A->B
run: C~>28,4
label: "3v2 to end line"

slide: "B finds C in the zone"
clear: arrows
red: C@28,4
ball: B
pass: B->C
\`\`\``;

function Lines({ rows }) {
  return (
    <dl className="help-list">
      {rows.map(([syntax, meaning]) => (
        <React.Fragment key={syntax}>
          <dt><code>{syntax}</code></dt>
          <dd>{meaning}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export default function PitchHelp() {
  return (
    <details className="card help">
      <summary>How to write a drill</summary>

      <p className="dim">
        A drill is markdown. The part between the <code>---</code> lines at the top is its
        details; everything after is what you would tell the players. A fenced{" "}
        <code>pitch</code> block becomes a diagram.
      </p>

      <h4>Details at the top</h4>
      <Lines rows={FRONTMATTER} />

      <h4>The pitch</h4>
      <Lines rows={SURFACE} />

      <h4>Things on it</h4>
      <Lines rows={THINGS} />

      <h4>Movement</h4>
      <Lines rows={MOVES} />
      <p className="dim">
        A movement can point at another player, at <code>goal</code>, or at a coordinate.
        They are numbered in the order you write them.
      </p>

      <h4>Animating it</h4>
      <Lines rows={SLIDES} />
      <p className="dim">
        What you write before the first <code>slide:</code> is the first slide. Cones,
        goals, zones and flags are set on the first slide and stay put — only players,
        balls and arrows change. The drill view gets a Play button; thumbnails show the
        first slide. The <strong>Add slide</strong> button above the source starts one for
        you, with where everything is now written out as notes to uncomment.
      </p>

      <h4>Two things that are not obvious</h4>
      <ul>
        <li>
          Coordinates are in <strong>metres</strong>, measured from the top-left corner —
          not pixels. <code>A@10,20</code> is ten metres across and twenty down.
        </li>
        <li>
          A player label is at most <strong>4 characters</strong>, because it has to fit
          inside the circle. <code>A</code>, <code>CB</code> and <code>GK1</code> all work.
        </li>
      </ul>

      <h4>Checklists</h4>
      <Lines rows={CHECKLISTS} />
      <p className="dim">
        Ticking a box never changes the drill itself — nothing is written back into its
        text. The ticks live only on this device and only for today; they are cleared
        again the next time you open the drill on a different day.
      </p>

      <h4>A whole example</h4>
      <pre className="help-example">{EXAMPLE}</pre>

      <p className="dim">
        A line starting with <code>#</code> inside a <code>pitch</code> block is a note to
        yourself and is not drawn. If you mistype something, the preview tells you which
        line and keeps drawing everything else.
      </p>
    </details>
  );
}
