# Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take attendance for a session's squad at the side of a pitch, as the first section of the run view, and keep it as a permanent record on the session.

**Architecture:** Attendance is a day-keyed map of player id → present/absent/excused, stored on the session exactly as progress is. The day-keyed store that progress already uses — local write first, folded into the session file on the existing debounce, reconciled by timestamp — is extracted so both share it rather than being written twice. Turnout, which already decides which drills the picker offers, comes from the present count.

**Tech Stack:** React 18, Vitest 2, no new dependencies.

---

## Why it works this way

**Extract the day-marks store, do not copy it.** Attendance needs precisely the semantics progress has: a tick must never wait on signal, must survive the app being closed, must reach the other device, and must not be resurrected after being cleared. That machinery took three review rounds and two data-loss bugs to get right — a corrupt-blob case that silently emptied the list, and a cleared mark that came back from the other device. Writing it a second time for attendance would be inviting both bugs back. So `progress.js`'s store becomes a shared module parameterised by its storage key, its field on the session, and its allowed states.

**Three states, and unmarked is a fourth thing.** Present, absent, excused — where excused means only that the player let the coach know, with no reason recorded. Unmarked is not "absent": before the register is taken nobody is anything, and a screen that starts everyone at absent would record twenty false absences for a session where attendance was never taken.

**Attendance is a record; progress is not.** Progress deliberately starts clean when a plan is run again next week. Attendance is the opposite: it is kept per date on the session and is the whole point of taking it. The two share a store but not that policy — the local copy is still pruned to the current day (it is only a cache), while the session file keeps every date.

**Turnout comes from the count.** `session.turnout` is typed by hand today and already drives `fitsSquad` in the drill picker. Once the register is taken, the present count answers it — still overridable, because a hand-typed number should always win over a derived one.

---

## Data shape

On a session, beside `progress`:

```json
"attendance": { "2026-08-14": { "marks": { "sean-ryan": "present", "ali-khan": "excused" },
                                "updatedAt": "2026-08-14T18:58:04.000Z" } }
```

Keys are player ids, which `squads.js` fixes at creation precisely so this survives a rename.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/dayMarks.js` (create) | The shared day-keyed marks store: local read/write, the session-embedded shape, the merge rule. Parameterised by storage key, session field and allowed states. |
| `src/lib/progress.js` (modify) | Uses `dayMarks` for its store; keeps its own block/slot logic and its exported names. |
| `src/lib/attendance.js` (create) | States, counts, turnout. |
| `src/components/Attendance.jsx` (create) | The register: a row per current player, three states. |
| `src/components/SessionRun.jsx` (modify) | Attendance as the first collapsible section. |
| `src/components/SessionBuilder.jsx` (modify) | Turnout shows the register's count when not overridden. |
| `src/components/Catalogue.jsx`, `src/App.jsx` (modify) | Wire squad, attendance and its save. |
| `src/styles.css` (modify) | Register rules. |
| Tests | `test/dayMarks.test.js`, `test/attendance.test.js`, `test/attendanceComponent.test.jsx` (create); `test/progress.test.js`, `test/sessionRun.test.jsx`, `test/sessionBuilder.test.jsx`, `test/app.test.jsx` (modify). |

---

### Task 1: extract the day-marks store

**This task must not change any behaviour.** Its whole value is that `progress.js`'s hard-won semantics get reused rather than reimplemented, so the existing progress tests are the specification: they must pass unchanged, without being edited to accommodate the refactor. If one needs changing, stop and report why — that is a behaviour change, not a refactor.

**Files:**
- Create: `src/lib/dayMarks.js`
- Modify: `src/lib/progress.js`
- Test: `test/dayMarks.test.js` (create), `test/progress.test.js` (unchanged)

- [ ] **Step 1: Read `src/lib/progress.js` in full** and identify precisely what is generic. It is: `readAll`, `cleanMarks`, `cleanStamp`, `readProgress`, `readStamp`, `writeProgress`, `localProgress`, `sessionProgress`, `withSessionProgress`, `mergeProgress`, `sameMarks`. It is NOT: `mark`, `reopen`, `blockKey`, `migrateMarks`, `currentIndex`, `counts`, `activeSessionIds`, which are about blocks and slots.

- [ ] **Step 2: Write `src/lib/dayMarks.js`**

A factory, so call sites read plainly:

```js
export function createDayMarks({ storageKey, field, states }) {
  // -> { readMarks, readStamp, writeMarks, localSide, sessionSide, withSessionSide }
}
```

plus `mergeSides(local, remote, now)` and `sameMarks(a, b)` as plain exports, since neither depends on the key.

Preserve every property the progress tests pin, including the ones that look like details and are not:
- an entry for another day reads as nothing
- writing prunes entries for other days (the local copy is a cache, not the record)
- **an empty map with a stamp is kept as a tombstone; an empty map with no stamp deletes the entry** — this is what stops a cleared register coming back from the other device
- `localSide` returns **null** when this device has nothing, which is not the same as `{marks:{}}`
- a stamped side beats an unstamped one; a tie prefers local; a stamp more than 24h in the future is treated as unstamped
- values are validated against `states`; keys are any non-empty string

- [ ] **Step 3: Write `test/dayMarks.test.js`** — test the factory directly with a made-up key, field and states, so the shared module is specified in its own right rather than only through progress.

- [ ] **Step 4: Rewrite `progress.js` to use it**, re-exporting its current names so no caller changes.

- [ ] **Step 5: Run the full suite.** `test/progress.test.js`, `test/sessionRun.test.jsx` and `test/app.test.jsx` must pass **unedited**.

- [ ] **Step 6: Commit** — `git commit -m "refactor: share the day-keyed marks store"`

---

### Task 2: `src/lib/attendance.js`

**Files:**
- Create: `src/lib/attendance.js`
- Test: `test/attendance.test.js`

```js
export const PRESENT = "present";
export const ABSENT = "absent";
export const EXCUSED = "excused";   // they let me know; no reason recorded
export const STATES = [PRESENT, ABSENT, EXCUSED];
```

Built on `createDayMarks({ storageKey: "ballislife_attendance", field: "attendance", states: STATES })`, exporting the same shape of helpers progress does (read/write/local/session/with).

Plus:
- `attendanceCounts(marks, players)` → `{ present, absent, excused, unmarked }`, counting only players passed in, so a player who has left does not inflate tonight's numbers.
- `turnout(marks)` → the number marked present.
- `nextState(state)` → the cycle for tapping one control: unmarked → present → absent → excused → unmarked. Taking a register is twenty taps; one control per player that cycles beats three buttons per row.

- [ ] **Step 1: Write the failing tests.** Cover: counts with players absent from the map (unmarked); a mark for a player not in the list is ignored by counts; turnout counts only present; the cycle including wrapping and an unknown state; junk input (no marks, no players, null).
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `git commit -m "feat: the attendance model"`

---

### Task 3: the register

**Files:**
- Create: `src/components/Attendance.jsx`
- Modify: `src/styles.css`
- Test: `test/attendanceComponent.test.jsx`

`Attendance({ squad, marks, onMark })` — presentational.

- A row per **current** player (`currentPlayers`), in squad order.
- One control per row, showing the state and cycling it on tap: unmarked shows the name plainly, then Present, Absent, Excused. State must be readable as text, not colour alone — this is used outdoors in bright sun.
- A summary line: "9 present · 2 absent · 1 excused · 3 to go".
- No squad: say so plainly and point at where to set one, rather than rendering an empty box.
- A squad with no current players: say that too.
- A mark for a player who has since left is **not** shown in the register (they are not at training tonight) but must not be deleted from the data.

- [ ] **Step 1: Write the failing tests** (jsdom, modelled on `test/sessionRun.test.jsx`'s interactive suite)
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Style** — rows must be thumb-sized; the whole row is the control.
- [ ] **Step 5: Run the tests**
- [ ] **Step 6: Commit** — `git commit -m "feat: a register for a squad"`

---

### Task 4: attendance in the run view

**Files:**
- Modify: `src/components/SessionRun.jsx`, `src/components/Catalogue.jsx`, `src/App.jsx`
- Test: `test/sessionRun.test.jsx`, `test/app.test.jsx`

The owner asked for this a while ago, in these words: *"When we start to manage squads it would be good to have the first (collapsable) section the list of players so you can tick their attendance."* `SessionRun`'s block loop was deliberately written so a section could be prepended — there is a comment in it saying so.

- Attendance is the **first** section, collapsible like a block, and open by default when nothing is marked yet and closed once the register is taken — it is the first thing you do and then not again.
- It must not become "the current block": the NOW badge and `currentIndex` are about drills. Attendance being unfinished must not stop a drill being current.
- Marks go through the same path as progress: local write first, then `onAttendance(day, marks, updatedAt)` upward, which App folds into the session and saves on the existing debounce.
- No squad on the session → the section says so and offers no register.

`App` gets `onRunAttendance` mirroring `onRunProgress` exactly, and passes the session's squad down.

- [ ] **Step 1: Write the failing tests** — including that marking attendance saves the session, that it reconciles across devices the way progress does, and that an unfinished register does not change which drill is current.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the full suite and the build**
- [ ] **Step 5: Commit** — `git commit -m "feat: take the register at the top of a session"`

---

### Task 5: turnout from the register

**Files:**
- Modify: `src/components/SessionBuilder.jsx`, `src/components/SessionRun.jsx` (whatever computes turnout for the picker)
- Test: `test/sessionBuilder.test.jsx`, `test/sessionRun.test.jsx`

Effective turnout = the hand-typed `session.turnout` when it is a number, otherwise the count present in today's register, otherwise nothing.

- The builder's Turnout input keeps showing the typed value, with the derived count as its **placeholder**, so it is obvious where the number came from and that typing overrides it.
- The mid-session swap picker uses the effective turnout, so a drill that no longer fits the eleven who actually turned up stops being offered.
- Clearing the input returns to the derived value rather than to nothing.

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the full suite and the build**
- [ ] **Step 5: Commit** — `git commit -m "feat: turnout comes from the register"`

---

### Task 6: Look at it

- [ ] Render at 390px: the run view with the register open above the drills, the register half-taken, a session with no squad, and the builder showing a derived turnout. View them, fix what they expose, commit any fix.

---

## Deliberately not in this plan

- **Attendance history** — who has been turning up over a term. It is the obvious next question and needs the records to exist first; designing a view of data that does not exist yet is guesswork.
- **A reason for an absence.** The owner was explicit: knowing they let him know is enough.
- **Taking the register from the builder.** You take it when the players are in front of you, which is the run view.
- **Marking a player who is not in the squad** (a trialist, a player borrowed from another team). Real, but it needs a squad-editing flow mid-session; note it and see whether it comes up.
