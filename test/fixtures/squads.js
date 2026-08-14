// The owner's real squads, so the register is tested against the thing rather than
// against ["Player One"]. Worth having verbatim: fifteen players is the real height of
// the screen, two names differ only by a middle initial (Daragh B / Darragh C Kelly),
// several players are known by one name only, and Alfie Ryan is in BOTH squads under the
// same id — which is exactly the case where marks keyed by name would cross over.
import { playerId } from "../../src/lib/squads.js";

const players = (names) => {
  const taken = [];
  return names.map((name) => {
    const id = playerId(name, taken);
    taken.push(id);
    return { id, name };
  });
};

export const U14A_NAMES = [
  "Alfie Ryan", "Cillian Conlan", "Danny Mitchell", "Aaron Cummins", "Matthew Drysdale",
  "Daragh B Kelly", "Darragh C Kelly", "Shane Kinneen", "Mikey Gilligan", "Sean Coughlan",
  "Cathal Cloonan", "Kevin", "Bartoz Walo", "Aaron Burke", "Jack Melia",
];

export const U15B_NAMES = [
  "Alfie Ryan", "Miki", "Niall Colohan", "AJ Kelly", "Colm Rosel", "Cailan", "Oisin Darcy",
];

export const u14a = () => ({
  id: "u14a-boys-2026-27",
  name: "U14A Boys 2026-27",
  players: players(U14A_NAMES),
});

export const u15b = () => ({
  id: "u15b-boys-2026-27",
  name: "U15B Boys 2026-27",
  players: players(U15B_NAMES),
});
