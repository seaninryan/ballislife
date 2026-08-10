import { describe, it, expect, beforeEach, vi } from "vitest";
import { isSignedIn, getAccessToken, signOut, __setTokenForTests } from "../src/lib/driveAuth.js";

beforeEach(() => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  signOut();
});

describe("token state", () => {
  it("reports signed out with no token", () => {
    expect(isSignedIn()).toBe(false);
    expect(getAccessToken()).toBe(null);
  });

  it("reports signed in with an unexpired token", () => {
    __setTokenForTests("tok", Date.now() + 60_000);
    expect(isSignedIn()).toBe(true);
    expect(getAccessToken()).toBe("tok");
  });

  it("reports signed out once the token has expired", () => {
    __setTokenForTests("tok", Date.now() - 1);
    expect(isSignedIn()).toBe(false);
  });

  it("forgets the token on sign-out, including from sessionStorage", () => {
    __setTokenForTests("tok", Date.now() + 60_000);
    signOut();
    expect(isSignedIn()).toBe(false);
    expect(globalThis.sessionStorage.getItem("ballislife_tok")).toBe(null);
  });

  it("survives a corrupt sessionStorage entry", () => {
    globalThis.sessionStorage.setItem("ballislife_tok", "{{{not json");
    expect(() => isSignedIn()).not.toThrow();
    expect(isSignedIn()).toBe(false);
  });
});
