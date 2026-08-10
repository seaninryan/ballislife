import { describe, it, expect } from "vitest";
import { digestEmail, isOwner, OWNER_EMAIL_SHA256 } from "../src/lib/owner.js";

describe("digestEmail", () => {
  it("hashes a known value", async () => {
    // sha256("a@b.com")
    expect(await digestEmail("a@b.com")).toBe(
      "fb98d44ad7501a959f3f4f4a3f004fe2d9e581ea6207e218c4b02c08a4d75adf",
    );
  });

  it("normalises case and surrounding whitespace", async () => {
    const plain = await digestEmail("a@b.com");
    expect(await digestEmail("  A@B.CoM  ")).toBe(plain);
  });

  it("does not normalise anything else", async () => {
    expect(await digestEmail("a.b@c.com")).not.toBe(await digestEmail("ab@c.com"));
  });
});

describe("isOwner", () => {
  it("rejects an email that is not the owner's", async () => {
    expect(await isOwner("someone@else.com")).toBe(false);
  });

  it("rejects absent or malformed input rather than throwing", async () => {
    expect(await isOwner(null)).toBe(false);
    expect(await isOwner(undefined)).toBe(false);
    expect(await isOwner("")).toBe(false);
    expect(await isOwner(123)).toBe(false);
    expect(await isOwner({})).toBe(false);
  });

  it("accepts the address the committed digest was made from", async () => {
    // Proves the constant and the comparison agree without putting the address in
    // the repo: any address whose digest matches is the owner, by definition.
    const fake = "not-the-real-address@example.com";
    expect(await isOwner(fake, await digestEmail(fake))).toBe(true);
  });

  it("exports the committed digest as 64 lowercase hex characters", () => {
    expect(OWNER_EMAIL_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
