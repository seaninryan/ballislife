// src/lib/owner.js
// Restricts the deployed app to its owner's Google account.
//
// This is NOT a security boundary. The repo is public, so anyone can fork it, delete
// this check and run their own copy — and nothing is lost if they do, because the
// drills live in the owner's Drive behind Google's authentication. What this stops is
// a stranger who finds the deployed URL using *this* deployment against their Drive.
//
// The address is stored hashed rather than in the clear because the repo is public and
// scrapers harvest plaintext addresses. Hashing adds no security; it removes that one
// concrete nuisance.
export const OWNER_EMAIL_SHA256 =
  "9620eb10792df98e40aa9814000f894744e9add26225d3aa834e707c6a6c3596";

// Lower-cased and trimmed before hashing: Google may return a differently-cased
// address than the one the digest was made from.
export async function digestEmail(email) {
  const bytes = new TextEncoder().encode(String(email).trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// -> boolean. Never throws: a malformed argument is simply "not the owner", because
// the failure mode of throwing here is a blank page on sign-in.
export async function isOwner(email, expected = OWNER_EMAIL_SHA256) {
  if (typeof email !== "string" || email.trim() === "") return false;
  try {
    return (await digestEmail(email)) === expected;
  } catch {
    return false;
  }
}
