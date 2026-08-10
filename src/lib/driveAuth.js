// src/lib/driveAuth.js
// Google Drive auth token lifecycle. Ported from fancystats (src/lib/drive.js) —
// token lifecycle, silent reauth, pending-request de-duplication and keep-alive are
// hard-won against real Google behaviour and are ported as-is.
//
// No Drive knowledge lives here: this module only ever produces a token. driveApi.js
// and drive.js do the rest.

export const CLIENT_ID = "1082152886862-ls2qdqu246emgs93q6hvrcqq4ipi1iur.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive";
const TOK_KEY = "ballislife_tok";

let tokenClient = null;
let accessToken = null;
let tokenExp = 0;
let onAuthExpired = null;
let keepAliveStarted = false;
let pendingTokenRequest = null;

function rememberToken(resp) {
  accessToken = resp.access_token;
  const ttl = Number(resp.expires_in) || 3600;
  tokenExp = Date.now() + (ttl - 60) * 1000; // 60s safety margin, so a token never expires mid-request.
  sessionStorage.setItem(TOK_KEY, JSON.stringify({ t: accessToken, exp: tokenExp }));
}

function recallToken() {
  try {
    const j = JSON.parse(sessionStorage.getItem(TOK_KEY));
    if (j?.t && j.exp > Date.now()) { tokenExp = j.exp; return j.t; }
  } catch { /* corrupt/absent */ }
  return null;
}

function forgetToken() {
  accessToken = null;
  tokenExp = 0;
  sessionStorage.removeItem(TOK_KEY);
}

// Resolves true when GIS is ready. Call once at app start.
export function initAuth(handlers = {}) {
  onAuthExpired = handlers.onAuthExpired || null;
  accessToken = recallToken();
  if (tokenClient) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(poll);
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: () => {},
        });
        resolve(true);
      } else if (Date.now() - started > 10000) {
        clearInterval(poll);
        resolve(false);
      }
    }, 100);
  });
}

export function isSignedIn() {
  return !!accessToken && tokenExp > Date.now();
}

export const getAccessToken = () => (isSignedIn() ? accessToken : null);

function requestToken(opts = {}) {
  if (!tokenClient) return Promise.resolve(false);
  if (pendingTokenRequest) return pendingTokenRequest; // a keep-alive tick must not clobber an in-flight interactive request.
  pendingTokenRequest = new Promise((resolve) => {
    tokenClient.callback = (resp) => {
      if (resp.access_token) { rememberToken(resp); resolve(true); } else resolve(false);
    };
    tokenClient.error_callback = () => resolve(false);
    tokenClient.requestAccessToken(opts);
  }).finally(() => { pendingTokenRequest = null; });
  return pendingTokenRequest;
}

export const signIn = () => requestToken(); // user gesture -> consent popup allowed
async function reauth() {
  const ok = await requestToken({ prompt: "" }); // silent
  if (!ok) forgetToken(); // Keep isSignedIn() honest after a rejected silent refresh.
  return ok;
}

// Roll the token if it expires soon. Call before save bursts.
export async function ensureFreshToken() {
  if (tokenExp - Date.now() < 10 * 60 * 1000) await reauth();
}

// Background keep-alive: silent reauth when <12 min left. Call once after sign-in.
export function startTokenKeepAlive() {
  if (keepAliveStarted) return; // StrictMode and remounts must not stack intervals.
  keepAliveStarted = true;
  const tick = () => {
    if (accessToken && tokenExp - Date.now() < 12 * 60 * 1000) reauth();
  };
  setInterval(tick, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}

export function signOut() {
  forgetToken();
}

// Test seam. Exported rather than reaching into module state from the test, so the
// production path has no test-only branch in it.
export function __setTokenForTests(token, exp) {
  accessToken = token;
  tokenExp = exp;
}
