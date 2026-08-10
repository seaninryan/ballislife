import { describe, it, expect } from "vitest";
import { parse } from "../src/lib/pitch.js";

describe("parse: area", () => {
  it("reads dimensions and a markings preset", () => {
    const { scene, errors } = parse("area: 40x25 half\n");
    expect(scene.area).toEqual({ w: 40, h: 25, markings: "half" });
    expect(errors).toEqual([]);
  });

  it("defaults markings to plain", () => {
    expect(parse("area: 30x20\n").scene.area).toEqual({ w: 30, h: 20, markings: "plain" });
  });

  it("defaults the whole area when the line is absent", () => {
    expect(parse("cone: 1,1\n").scene.area).toEqual({ w: 40, h: 25, markings: "plain" });
  });

  it("accepts decimal dimensions", () => {
    expect(parse("area: 37.5x22.5 full\n").scene.area).toEqual({ w: 37.5, h: 22.5, markings: "full" });
  });

  it("ignores blank lines and comments", () => {
    const { scene, errors } = parse("\n# a comment\narea: 40x25 box\n\n");
    expect(scene.area.markings).toBe("box");
    expect(errors).toEqual([]);
  });
});
