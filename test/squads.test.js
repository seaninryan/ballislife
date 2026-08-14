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
