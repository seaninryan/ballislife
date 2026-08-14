// The squad model: who is in a squad, and which squad a session is for. Pure — no Drive,
// no React.
import { describe, it, expect } from "vitest";
import {
  EMPTY_SQUADS, parseSquads, playerId, emptySquad, addPlayer, renamePlayer,
  removePlayer, restorePlayer, currentPlayers, playerName, linkSquadId,
} from "../src/lib/squads.js";

describe("parseSquads", () => {
  it("reads a well-formed file", () => {
    expect(parseSquads('{"version":1,"squads":{}}')).toEqual({ ok: true, squads: {} });
  });

  it("says WHY it could not be read, rather than answering 'empty'", () => {
    // Mistaking unreadable for empty is how a corrupt sessions.json nearly lost every
    // plan: the migration saw nothing to move and renamed the file away.
    for (const bad of [null, "", "{", "[]", '{"version":9,"squads":{}}', '{"version":1}', '{"version":1,"squads":[]}']) {
      expect(parseSquads(bad).ok).toBe(false);
    }
    expect(parseSquads("{").reason).toBe("parse");
    expect(parseSquads('{"version":9,"squads":{}}').reason).toBe("version");
  });

  // These files are read and edited by hand, so a player written the obvious way — as a
  // bare name — is a plausible thing to find. Left alone, `p.id === undefined` matched
  // `undefined === undefined` in every mutator and the string was spread into an object:
  // typing one character saved {"0":"S","1":"e",…}. Repair what can be repaired on the way
  // in, so nothing downstream ever meets a player that is not {id, name}.
  describe("repairing a hand-edited file", () => {
    const read = (squads) => parseSquads(JSON.stringify({ version: 1, squads }));

    it("gives a bare-string player a proper id and name", () => {
      const r = read({ u14a: { id: "u14a", name: "U14A", players: ["Sean Ryan", "  Ali Khan  "] } });
      expect(r.ok).toBe(true);
      expect(r.squads.u14a.players).toEqual([
        { id: "sean-ryan", name: "Sean Ryan" },
        { id: "ali-khan", name: "Ali Khan" },
      ]);
    });

    it("keeps two people with the same id apart, so renaming one cannot rename both", () => {
      const r = read({
        u14a: { id: "u14a", name: "U14A", players: [{ id: "x", name: "A" }, { id: "x", name: "B" }] },
      });
      expect(r.squads.u14a.players.map((p) => p.id)).toEqual(["x", "b"]);
    });

    it("keeps the fields it does not own, like who has left", () => {
      const r = read({
        u14a: { id: "u14a", name: "U14A", players: [{ id: "x", name: "A", left: true }] },
      });
      expect(r.squads.u14a.players[0]).toEqual({ id: "x", name: "A", left: true });
    });

    it("gives a player with a broken id one made from their name", () => {
      const r = read({ u14a: { id: "u14a", name: "U14A", players: [{ id: "", name: "Ali Khan" }] } });
      expect(r.squads.u14a.players).toEqual([{ id: "ali-khan", name: "Ali Khan" }]);
    });

    it("drops what cannot be repaired rather than carrying a nameless player", () => {
      const r = read({
        u14a: { id: "u14a", name: "U14A", players: [null, 7, { id: "x" }, { name: "  " }, "Ali"] },
      });
      expect(r.squads.u14a.players).toEqual([{ id: "ali", name: "Ali" }]);
    });

    it("answers a players field that is not a list with no players", () => {
      expect(read({ u14a: { id: "u14a", name: "U14A", players: "Sean" } }).squads.u14a.players)
        .toEqual([]);
      expect(read({ u14a: { id: "u14a", name: "U14A" } }).squads.u14a.players).toEqual([]);
    });
  });
});

describe("playerId", () => {
  it("is a slug of the name, made unique within the squad", () => {
    expect(playerId("Sean Ryan")).toBe("sean-ryan");
    expect(playerId("Sean Ryan", ["sean-ryan"])).toBe("sean-ryan-2");
    expect(playerId("Sean Ryan", ["sean-ryan", "sean-ryan-2"])).toBe("sean-ryan-3");
  });

  it("always produces something, even from nothing", () => {
    expect(playerId("")).toBe("untitled");
  });
});

describe("a squad's players", () => {
  const squad = () => {
    let s = emptySquad("u14a", "U14A Boys");
    s = addPlayer(s, "Sean Ryan");
    s = addPlayer(s, "  Ali Khan  ");
    s = addPlayer(s, "Sean Ryan"); // two players really can share a name
    return s;
  };

  it("adds players in order, trimming the name and keeping ids unique", () => {
    const s = squad();
    expect(s.players.map((p) => p.id)).toEqual(["sean-ryan", "ali-khan", "sean-ryan-2"]);
    expect(s.players.map((p) => p.name)).toEqual(["Sean Ryan", "Ali Khan", "Sean Ryan"]);
  });

  it("adds nobody for a blank name", () => {
    expect(addPlayer(squad(), "   ").players).toHaveLength(3);
  });

  it("renames a player WITHOUT changing their id", () => {
    // The id is what attendance points at. If it followed the name, fixing a spelling
    // would orphan every record of that player ever turning up.
    const renamed = renamePlayer(squad(), "sean-ryan", "Seán Ryan");
    expect(renamed.players[0]).toEqual({ id: "sean-ryan", name: "Seán Ryan" });
  });

  it("ignores a blank rename", () => {
    expect(renamePlayer(squad(), "sean-ryan", "  ").players[0].name).toBe("Sean Ryan");
  });

  it("removing a player keeps the record, so past sessions still name them", () => {
    const gone = removePlayer(squad(), "ali-khan");
    expect(gone.players).toHaveLength(3);
    expect(currentPlayers(gone).map((p) => p.id)).toEqual(["sean-ryan", "sean-ryan-2"]);
    expect(playerName(gone, "ali-khan")).toBe("Ali Khan");
  });

  it("restores a player to their original place in the list", () => {
    const back = restorePlayer(removePlayer(squad(), "ali-khan"), "ali-khan");
    expect(currentPlayers(back).map((p) => p.id)).toEqual(["sean-ryan", "ali-khan", "sean-ryan-2"]);
  });

  // Belt and braces behind parseSquads: an id that is not a real id must never match a
  // player, because `undefined === undefined` matching every malformed row is what spread a
  // bare string into an object and wrote it to Drive.
  it("refuses an id that is not a real id, rather than matching anything", () => {
    const s = squad();
    for (const bad of [undefined, null, "", 7, {}]) {
      expect(renamePlayer(s, bad, "Whoever")).toBe(s);
      expect(removePlayer(s, bad)).toBe(s);
      expect(restorePlayer(s, bad)).toBe(s);
    }
  });

  it("changes ONE player when two somehow share an id", () => {
    const s = { id: "u14a", name: "U14A", players: [{ id: "x", name: "A" }, { id: "x", name: "B" }] };
    expect(renamePlayer(s, "x", "C").players.map((p) => p.name)).toEqual(["C", "B"]);
    expect(removePlayer(s, "x").players.map((p) => p.left)).toEqual([true, undefined]);
  });

  it("survives being asked about nobody, or about no squad at all", () => {
    expect(playerName(squad(), "nobody")).toBe(null);
    expect(currentPlayers(undefined)).toEqual([]);
    expect(playerName(undefined, "x")).toBe(null);
  });
});

describe("linkSquadId", () => {
  const squads = { u14a: { id: "u14a", name: "U14A Boys" }, u12: { id: "u12", name: "U12s" } };

  it("links a session's free-text squad name to the squad of that name", () => {
    expect(linkSquadId({ squad: "U14A Boys" }, squads).squadId).toBe("u14a");
    expect(linkSquadId({ squad: "  u14a boys  " }, squads).squadId).toBe("u14a");
  });

  it("leaves an unmatched name alone rather than guessing", () => {
    expect(linkSquadId({ squad: "Nobody" }, squads).squadId).toBeUndefined();
    expect(linkSquadId({ squad: "" }, squads).squadId).toBeUndefined();
  });

  it("never second-guesses a link that already exists", () => {
    const already = { squad: "U12s", squadId: "u14a" };
    expect(linkSquadId(already, squads)).toBe(already);
  });
});
