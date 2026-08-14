// src/lib/browser.js
// The two things this app asks the browser for directly, in one place because three
// callers wanted them and each had grown its own copy. Both are guarded for the node
// environment the component tests render in: a header that reads progress must render
// under renderToStaticMarkup as well as in a tab.

// null rather than a throw where there is no window: losing a mark is acceptable, a
// blank screen is not — every reader in lib/progress.js already treats null as "empty".
export const localStore = () => (typeof window !== "undefined" ? window.localStorage : null);

// Today as a day key (YYYY-MM-DD), the key both progress stores are keyed by.
export const todayIso = () => new Date().toISOString().slice(0, 10);
