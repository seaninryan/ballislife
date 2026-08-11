// src/lib/errors.js
// Turns a raw Drive exception into something a coach can act on. Lives on its own
// (rather than inside Catalogue.jsx, where it started) because both Catalogue and
// Editor need it, and Catalogue also renders Editor — importing it back out of
// Catalogue would be a circular import.
//
// Classify on the numeric code driveApi already attaches; only sniff the text for the
// network case, which has no code. Regexing the message for digits would misread a
// drill named "500 Cones" as a server error.
export function friendlyError(error) {
  if (!error) return "";
  const code = typeof error === "object" ? error.code : undefined;
  const text = String((typeof error === "object" ? error.message : error) ?? "");
  if (code === 401) return "Your Google sign-in expired. Reload to sign in again.";
  if (code === 403) return "Google is rate-limiting requests. Try again in a minute.";
  if (code === 404) return "That drill is no longer in your Drive folder.";
  if (code >= 500 && code < 600) return "Google Drive is having trouble. Try again shortly.";
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return "No connection to Google Drive. Check your signal and try again.";
  }
  return text || "Something went wrong.";
}
