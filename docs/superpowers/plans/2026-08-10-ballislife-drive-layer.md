# ballislife Drive Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in to Google as the owner, read and write drill markdown files in a visible `/BallIsLife` Drive folder, and keep a validated `index.json` cache — ending with a page that lists your real drills with their diagrams.

**Architecture:** Client-only, no server. All Drive HTTP logic lives in pure-ish functions taking an access token, unit-tested against a mocked `fetch`. Google Identity Services token juggling is isolated in one thin module ported from the sibling `fancystats` project. The `index.json` cache is disposable and revalidated against Drive on every load.

**Tech Stack:** React 18, Vite 5, Vitest 2 (node environment, no jsdom), js-yaml. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-ballislife-design.md`
**Previous plan:** `docs/superpowers/plans/2026-08-10-ballislife-foundation.md` (complete)

---

## Environment

```bash
node -v   # must be v20; if v14: export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

**`grep` is broken in this sandbox** — it exits 1 with no output even for strings that
are present. Never use it to verify anything. Use the Grep tool or node.

All commands run from `/home/sean/workspace/ballislife`.

---

## What already exists

Plan 1 delivered, all green at 117 tests across 7 files:

| Module | Exports you will use |
| --- | --- |
| `src/lib/frontmatter.js` | `parseDoc(src) -> {meta, body, error, front}`, `serialiseDoc(doc)` |
| `src/lib/markdown.js` | `splitSegments(body) -> [{kind:"prose"\|"pitch", text, line?}]` |
| `src/lib/pitch.js` | `parse(src) -> {scene, errors}` (never throws), `serialise(scene)` |
| `src/lib/pitchSvg.js` | `S`, `PAD`, `viewBox`, `toPx`, `markings`, `MARKER_GAP`, `resolvePoint`, `actionPath` |
| `src/components/PitchDiagram.jsx` | `<PitchDiagram source baseLine />` |
| `src/components/DrillPreview.jsx` | `<DrillPreview source />` |

---

## A decomposition change from the spec

The spec's module map lists one `lib/drive.js`. Implementing it that way would put the
Google Identity Services token dance — which needs `window.google`, popups and timers,
and is close to untestable in Vitest's node environment — in the same file as the Drive
HTTP calls, which are highly testable against a mocked `fetch`. Everything in the file
would then be as untestable as its worst part.

So `drive.js` becomes three modules:

| Module | Job | Testability |
| --- | --- | --- |
| `lib/driveAuth.js` | GIS token lifecycle: request, remember, silent refresh, keep-alive. Ported from fancystats. | Smoke tests only; deliberately thin, holds no domain logic |
| `lib/driveApi.js` | Every Drive HTTP call, each taking an access token. Folder find-or-create, list, read, write, create, rename, trash. | Fully unit-tested against a mocked `fetch` |
| `lib/drive.js` | Thin facade: wires auth to api, retries once on 401, owns the per-file save queue | Unit-tested with `driveApi` mocked |

Same responsibilities as the spec, drawn so the logic that can be tested is.

---

## What I cannot verify, and you must

**I cannot test any of this against real Google Drive.** Authenticating requires your
Google account, and I have neither your credentials nor a browser session. Every test in
this plan runs against a mocked `fetch` or a mocked `driveApi`. That verifies the logic —
request shapes, retry behaviour, the index diff, error handling — but **not** that
Google accepts our requests.

Task 8 therefore ends with a manual checklist for you at a real browser. Until you have
run it, treat "Drive integration works" as unproven no matter how many tests pass. I
will say so rather than implying otherwise.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/owner.js` | SHA-256 of an email; the owner gate decision. No network |
| `src/lib/driveApi.js` | Drive REST calls, each taking a token. No auth, no retry |
| `src/lib/driveAuth.js` | GIS token lifecycle (ported). No Drive knowledge |
| `src/lib/drive.js` | Facade: auth + api, 401 retry, per-file debounced save queue |
| `src/lib/driveIndex.js` | Build, diff and repair the `index.json` cache. Pure |
| `src/lib/drills.js` | Drill model from index entries: slug, filter, search. Pure |
| `src/components/Catalogue.jsx` | Sign-in state, load, and the drill list |
| `src/App.jsx` | Replaces the Plan 1 preview harness with `Catalogue` |

Note the spec calls the index module `lib/index.js`. It is named `driveIndex.js` here:
`index.js` is a magic filename to bundlers and editors (implicit directory imports), and
a module called `index` that is not an entry point invites confusion.

---

## Data shapes

`index.json`, stored in `/BallIsLife`:

```js
{
  version: 1,
  entries: {
    "<driveFileId>": {
      name: "3v2-to-end-line.md",
      modifiedTime: "2026-08-10T12:00:00.000Z", // exactly as Drive returned it
      meta: { title: "3v2 to end line", category: "skill", minutes: 15, ... },
      thumb: "area: 40x25 half\nred: A@10,20\n...",  // first pitch block, or null
      invalid: null,                                  // or a frontmatter error string
    },
  },
}
```

`thumb` holds only the **first** `pitch` block: the grid draws one thumbnail per drill,
and storing every block would bloat a cache that must be downloaded on a phone.

A drill, as `drills.js` presents it to components:

```js
{
  id: "<driveFileId>",
  slug: "3v2-to-end-line",       // filename without .md
  title: "3v2 to end line",      // meta.title, falling back to the slug
  category: "skill",             // or null
  minutes: 15,                   // or null
  players: "8-12",               // or null
  tags: ["transition"],          // always an array
  thumb: "...",                  // or null
  invalid: null,                 // frontmatter error, or null
}
```

---

## Task 1: Hash an email and decide the owner gate

**Files:**
- Create: `src/lib/owner.js`
- Test: `test/owner.test.js`

Sean chose to restrict the deployed app to his own account. This module holds that
decision. It is **not** a security boundary — the repo is public, so anyone can fork it
and delete the check — it stops a stranger who finds the URL from using this deployment.

- [ ] **Step 1: Write the failing tests**

```js
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
```

**Note on the first test's expected value:** compute it rather than trusting me —
`node -e 'console.log(require("crypto").createHash("sha256").update("a@b.com").digest("hex"))'` —
and use what that prints. If it differs from the literal above, the literal is wrong;
fix the test and say so in your report.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/owner.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/owner.js"`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/owner.test.js
```

Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/owner.js test/owner.test.js
git commit -m "feat: gate the app on the owner's hashed google address"
```

---

## Task 2: Drive REST calls

**Files:**
- Create: `src/lib/driveApi.js`
- Test: `test/driveApi.test.js`

Every function takes an access token and returns parsed data, throwing an `Error` with a
numeric `code` on failure. No auth, no retry, no state — that is `drive.js`'s job. This
split is what makes these testable.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  aboutEmail, findFolder, createFolder, listFiles,
  readFile, writeFile, createFile, renameFile, trashFile,
} from "../src/lib/driveApi.js";

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => "" });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
});
afterEach(() => { vi.restoreAllMocks(); });

const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];

describe("aboutEmail", () => {
  it("asks only for the user's email address", async () => {
    fetchMock.mockResolvedValue(ok({ user: { emailAddress: "a@b.com" } }));
    expect(await aboutEmail("tok")).toBe("a@b.com");
    const [url, opts] = lastCall();
    expect(url).toContain("/drive/v3/about");
    expect(url).toContain("fields=user(emailAddress)");
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("returns null when Drive omits the user", async () => {
    fetchMock.mockResolvedValue(ok({}));
    expect(await aboutEmail("tok")).toBe(null);
  });
});

describe("findFolder", () => {
  it("queries by name, folder mime type and not-trashed", async () => {
    fetchMock.mockResolvedValue(ok({ files: [{ id: "F1" }] }));
    expect(await findFolder("tok", "BallIsLife")).toBe("F1");
    const [url] = lastCall();
    expect(decodeURIComponent(url)).toContain("name='BallIsLife'");
    expect(decodeURIComponent(url)).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(decodeURIComponent(url)).toContain("trashed=false");
  });

  it("returns null when the folder does not exist", async () => {
    fetchMock.mockResolvedValue(ok({ files: [] }));
    expect(await findFolder("tok", "BallIsLife")).toBe(null);
  });
});

describe("createFolder", () => {
  it("posts a folder and returns its id", async () => {
    fetchMock.mockResolvedValue(ok({ id: "F2" }));
    expect(await createFolder("tok", "BallIsLife")).toBe("F2");
    const [, opts] = lastCall();
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      name: "BallIsLife",
      mimeType: "application/vnd.google-apps.folder",
    });
  });
});

describe("listFiles", () => {
  it("asks for id, name and modifiedTime of the folder's children", async () => {
    fetchMock.mockResolvedValue(ok({ files: [{ id: "1", name: "a.md", modifiedTime: "T" }] }));
    expect(await listFiles("tok", "F1")).toEqual([{ id: "1", name: "a.md", modifiedTime: "T" }]);
    const [url] = lastCall();
    expect(decodeURIComponent(url)).toContain("'F1' in parents");
    expect(decodeURIComponent(url)).toContain("trashed=false");
    expect(decodeURIComponent(url)).toContain("id,name,modifiedTime");
  });

  it("follows pagination until there is no next page", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ files: [{ id: "1" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(ok({ files: [{ id: "2" }] }));
    expect(await listFiles("tok", "F1")).toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(lastCall()[0])).toContain("pageToken=p2");
  });

  it("returns an empty array when the folder is empty", async () => {
    fetchMock.mockResolvedValue(ok({}));
    expect(await listFiles("tok", "F1")).toEqual([]);
  });
});

describe("readFile", () => {
  it("fetches the media and returns text", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "hello" });
    expect(await readFile("tok", "ID")).toBe("hello");
    expect(lastCall()[0]).toContain("alt=media");
  });
});

describe("writeFile", () => {
  it("PATCHes media and returns the new modifiedTime", async () => {
    fetchMock.mockResolvedValue(ok({ modifiedTime: "T2" }));
    expect(await writeFile("tok", "ID", "body")).toBe("T2");
    const [url, opts] = lastCall();
    expect(url).toContain("/upload/drive/v3/files/ID");
    expect(url).toContain("uploadType=media");
    expect(opts.method).toBe("PATCH");
    expect(opts.body).toBe("body");
  });
});

describe("createFile", () => {
  it("creates the metadata then uploads the content", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: "NEW" }))
      .mockResolvedValueOnce(ok({ modifiedTime: "T1" }));
    expect(await createFile("tok", "F1", "new.md", "text")).toEqual({ id: "NEW", modifiedTime: "T1" });
    const [firstUrl, firstOpts] = fetchMock.mock.calls[0];
    expect(firstUrl).toContain("/drive/v3/files");
    expect(JSON.parse(firstOpts.body)).toEqual({ name: "new.md", parents: ["F1"] });
  });
});

describe("renameFile", () => {
  it("PATCHes the name only", async () => {
    fetchMock.mockResolvedValue(ok({ modifiedTime: "T3" }));
    expect(await renameFile("tok", "ID", "other.md")).toBe("T3");
    const [url, opts] = lastCall();
    expect(url).not.toContain("upload");
    expect(JSON.parse(opts.body)).toEqual({ name: "other.md" });
  });
});

describe("trashFile", () => {
  it("trashes rather than deleting, so a mistake is recoverable", async () => {
    fetchMock.mockResolvedValue(ok({}));
    await trashFile("tok", "ID");
    const [url, opts] = lastCall();
    expect(opts.method).toBe("PATCH");
    expect(url).not.toContain("upload");
    expect(JSON.parse(opts.body)).toEqual({ trashed: true });
  });
});

describe("errors", () => {
  it("throws with a numeric code the caller can branch on", async () => {
    fetchMock.mockResolvedValue(fail(401));
    await expect(listFiles("tok", "F1")).rejects.toMatchObject({ code: 401 });
    fetchMock.mockResolvedValue(fail(500));
    await expect(readFile("tok", "ID")).rejects.toMatchObject({ code: 500 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/driveApi.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/driveApi.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/driveApi.js
// Every Drive REST call, each taking an access token. No auth, no retry, no state —
// that is drive.js's job. Keeping this layer free of GIS globals is what makes it
// testable against a mocked fetch.
const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function call(token, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) throw Object.assign(new Error(`drive ${res.status}`), { code: res.status });
  return res;
}

const json = async (token, url, opts) => (await call(token, url, opts)).json();

// -> the signed-in account's email, or null if Drive did not report one.
export async function aboutEmail(token) {
  // Parentheses are legal unencoded in a query value, and encodeURIComponent leaves
  // them alone anyway, so spell the fixed value out rather than pretending to encode it.
  const url = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";
  const body = await json(token, url);
  return body?.user?.emailAddress ?? null;
}

// -> folder id, or null when it does not exist.
export async function findFolder(token, name) {
  const q = encodeURIComponent(`name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const body = await json(token, `${FILES}?q=${q}&fields=files(id)`);
  return body.files?.[0]?.id ?? null;
}

export async function createFolder(token, name) {
  const body = await json(token, FILES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  return body.id;
}

// -> [{id, name, modifiedTime}] for every non-trashed child, following pagination.
// A folder with more than one page of drills is unlikely, but a silently truncated
// listing would make the index drop real drills, which is worse than one extra call.
export async function listFiles(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("nextPageToken,files(id,name,modifiedTime)");
  const out = [];
  let pageToken = null;
  do {
    const url = `${FILES}?q=${q}&fields=${fields}&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const body = await json(token, url);
    out.push(...(body.files ?? []));
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);
  return out;
}

export async function readFile(token, fileId) {
  const res = await call(token, `${FILES}/${fileId}?alt=media`);
  return res.text();
}

// -> the new modifiedTime, so the caller can update its conflict baseline.
export async function writeFile(token, fileId, text) {
  const body = await json(token, `${UPLOAD}/${fileId}?uploadType=media&fields=modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": "text/markdown" },
    body: text,
  });
  return body.modifiedTime;
}

// Two calls: metadata (to get an id and set the parent) then content.
export async function createFile(token, folderId, name, text) {
  const meta = await json(token, `${FILES}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const modifiedTime = await writeFile(token, meta.id, text);
  return { id: meta.id, modifiedTime };
}

export async function renameFile(token, fileId, name) {
  const body = await json(token, `${FILES}/${fileId}?fields=modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return body.modifiedTime;
}

// Trash rather than delete: a mis-click should be recoverable from Drive's bin.
export async function trashFile(token, fileId) {
  await json(token, `${FILES}/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/driveApi.test.js
```

Expected: `Tests  14 passed (14)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/driveApi.js test/driveApi.test.js
git commit -m "feat: drive rest calls, testable against a mocked fetch"
```

---

## Task 3: Build, diff and repair the index cache

**Files:**
- Create: `src/lib/driveIndex.js`
- Test: `test/driveIndex.test.js`

Pure functions, no network. The spec's load-bearing invariant: **`index.json` is
disposable and never authoritative.** Every load revalidates it against a `files.list`,
so it cannot serve stale data after a drill is edited directly in Drive.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { EMPTY_INDEX, readIndex, entryFor, diffIndex, applyDiff } from "../src/lib/driveIndex.js";

const DRILL = `---
title: 3v2 to end line
category: skill
minutes: 15
tags: [transition]
---

Reds attack.

\`\`\`pitch
area: 40x25 half
red: A@10,20
\`\`\`

More prose.

\`\`\`pitch
area: 10x10
\`\`\`
`;

describe("readIndex", () => {
  it("parses a well-formed index", () => {
    const idx = { version: 1, entries: { a: { name: "a.md", modifiedTime: "T" } } };
    expect(readIndex(JSON.stringify(idx))).toEqual(idx);
  });

  it("falls back to empty for anything unusable, rather than throwing", () => {
    for (const bad of ["", "not json", "null", "[]", '{"version":99}', undefined, null, "{}"]) {
      expect(readIndex(bad)).toEqual(EMPTY_INDEX);
    }
  });

  it("returns a fresh object each time, never the shared EMPTY_INDEX", () => {
    const a = readIndex("nope");
    a.entries.x = 1;
    expect(readIndex("nope").entries).toEqual({});
  });
});

describe("entryFor", () => {
  it("captures name, modifiedTime, metadata and the first pitch block", () => {
    const e = entryFor("3v2.md", "T1", DRILL);
    expect(e.name).toBe("3v2.md");
    expect(e.modifiedTime).toBe("T1");
    expect(e.meta.title).toBe("3v2 to end line");
    expect(e.meta.tags).toEqual(["transition"]);
    expect(e.thumb).toBe("area: 40x25 half\nred: A@10,20\n");
    expect(e.invalid).toBe(null);
  });

  it("records a null thumb when the drill has no diagram", () => {
    expect(entryFor("x.md", "T", "---\ntitle: T\n---\n\njust prose\n").thumb).toBe(null);
  });

  it("flags broken frontmatter but still builds an entry", () => {
    const e = entryFor("x.md", "T", "---\ntitle: [oops\n---\n\nbody\n");
    expect(e.invalid).toMatch(/yaml/i);
    expect(e.meta).toEqual({});
  });
});

describe("diffIndex", () => {
  const index = {
    version: 1,
    entries: {
      keep: { name: "keep.md", modifiedTime: "T1", meta: {}, thumb: null, invalid: null },
      stale: { name: "stale.md", modifiedTime: "T1", meta: {}, thumb: null, invalid: null },
      gone: { name: "gone.md", modifiedTime: "T1", meta: {}, thumb: null, invalid: null },
    },
  };
  const files = [
    { id: "keep", name: "keep.md", modifiedTime: "T1" },
    { id: "stale", name: "stale.md", modifiedTime: "T2" },
    { id: "new", name: "new.md", modifiedTime: "T1" },
  ];

  it("keeps entries whose modifiedTime still matches", () => {
    expect(Object.keys(diffIndex(index, files).keep)).toEqual(["keep"]);
  });

  it("refetches changed and unknown files", () => {
    expect(diffIndex(index, files).refetch.map((f) => f.id).sort()).toEqual(["new", "stale"]);
  });

  it("drops entries for files no longer in Drive", () => {
    expect(diffIndex(index, files).dropped).toEqual(["gone"]);
  });

  it("refetches an entry whose name changed even if modifiedTime did not", () => {
    const renamed = [{ id: "keep", name: "renamed.md", modifiedTime: "T1" }];
    expect(diffIndex(index, renamed).refetch.map((f) => f.id)).toEqual(["keep"]);
  });

  it("ignores index.json itself and anything that is not markdown", () => {
    const noise = [
      { id: "idx", name: "index.json", modifiedTime: "T" },
      { id: "img", name: "photo.png", modifiedTime: "T" },
      { id: "keep", name: "keep.md", modifiedTime: "T1" },
    ];
    const d = diffIndex(index, noise);
    expect(d.refetch).toEqual([]);
    expect(Object.keys(d.keep)).toEqual(["keep"]);
  });

  it("skips a null file rather than throwing", () => {
    const files = [null, { id: "a", name: "a.md", modifiedTime: "T" }];
    expect(() => diffIndex(EMPTY_INDEX, files)).not.toThrow();
    expect(diffIndex(EMPTY_INDEX, files).refetch.map((f) => f.id)).toEqual(["a"]);
  });

  it("treats an empty index as everything needing a fetch", () => {
    const d = diffIndex(EMPTY_INDEX, files);
    expect(d.refetch.map((f) => f.id).sort()).toEqual(["keep", "new", "stale"]);
    expect(d.keep).toEqual({});
    expect(d.dropped).toEqual([]);
  });
});

describe("applyDiff", () => {
  it("merges kept entries with freshly built ones", () => {
    const keep = { k: { name: "k.md", modifiedTime: "T", meta: {}, thumb: null, invalid: null } };
    const fetched = { n: entryFor("n.md", "T", "---\ntitle: N\n---\n") };
    const next = applyDiff(keep, fetched);
    expect(Object.keys(next.entries).sort()).toEqual(["k", "n"]);
    expect(next.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/driveIndex.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/driveIndex.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/driveIndex.js
// The index.json cache: build, diff and repair. Pure — no network, no Drive knowledge
// beyond the {id, name, modifiedTime} shape a listing returns.
//
// INVARIANT: the index is disposable and never authoritative. Every load diffs it
// against a real listing, so it cannot serve stale data after a drill is edited
// directly in the Drive web UI. Anything unparseable rebuilds from scratch.
import { parseDoc } from "./frontmatter.js";
import { splitSegments } from "./markdown.js";

const VERSION = 1;
export const EMPTY_INDEX = Object.freeze({ version: VERSION, entries: {} });

const isDrill = (name) => typeof name === "string" && name.toLowerCase().endsWith(".md");

// -> a usable index, always. A cache that cannot be read is simply rebuilt.
export function readIndex(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    if (parsed.version !== VERSION) throw new Error("version");
    if (!parsed.entries || typeof parsed.entries !== "object") throw new Error("entries");
    return parsed;
  } catch {
    return { version: VERSION, entries: {} };
  }
}

// One drill file -> one cache entry. `thumb` is the FIRST pitch block only: the grid
// draws one thumbnail per drill, and caching every block would bloat a file a phone
// has to download.
export function entryFor(name, modifiedTime, text) {
  const doc = parseDoc(text);
  const firstPitch = splitSegments(doc.body).find((s) => s.kind === "pitch");
  return {
    name,
    modifiedTime,
    meta: doc.meta ?? {},
    thumb: firstPitch ? firstPitch.text : null,
    invalid: doc.error,
  };
}

// index + live listing -> what to keep, what to refetch, what to drop.
// A changed NAME forces a refetch as well as a changed modifiedTime: Drive does not
// always bump modifiedTime on a rename, and the entry caches the name.
export function diffIndex(index, files) {
  const entries = index?.entries ?? {};
  const drills = (files ?? []).filter((f) => f && isDrill(f.name));
  const keep = {};
  const refetch = [];

  for (const file of drills) {
    const cached = entries[file.id];
    if (cached && cached.modifiedTime === file.modifiedTime && cached.name === file.name) {
      keep[file.id] = cached;
    } else {
      refetch.push(file);
    }
  }

  const live = new Set(drills.map((f) => f.id));
  const dropped = Object.keys(entries).filter((id) => !live.has(id));
  return { keep, refetch, dropped };
}

// kept entries + newly built entries -> the index to write back.
export function applyDiff(keep, fetched) {
  return { version: VERSION, entries: { ...keep, ...fetched } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/driveIndex.test.js
```

Expected: `Tests  14 passed (14)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/driveIndex.js test/driveIndex.test.js
git commit -m "feat: build, diff and repair the drive index cache"
```

---

## Task 4: The drill model

**Files:**
- Create: `src/lib/drills.js`
- Test: `test/drills.test.js`

Pure. Turns index entries into the shape components render, and owns slug rules,
filtering and search.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { drillsFromIndex, slugify, fileNameFor, filterDrills } from "../src/lib/drills.js";

const index = {
  version: 1,
  entries: {
    a: { name: "rondo-4v2.md", modifiedTime: "T", thumb: "area: 20x20", invalid: null,
         meta: { title: "Rondo 4v2", category: "warmup", minutes: 10, players: "6-8", tags: ["possession"] } },
    b: { name: "3v2-to-end-line.md", modifiedTime: "T", thumb: null, invalid: null,
         meta: { title: "3v2 to end line", category: "skill", minutes: 15, tags: ["transition", "finishing"] } },
    c: { name: "broken.md", modifiedTime: "T", thumb: null, invalid: "yaml: bad", meta: {} },
  },
};

describe("drillsFromIndex", () => {
  it("maps entries to drills sorted by title, case-insensitively", () => {
    // localeCompare, so "broken" sorts before "Rondo 4v2" — which is what someone
    // reading an alphabetical list expects, rather than ASCII order putting all the
    // capitals first.
    expect(drillsFromIndex(index).map((d) => d.title)).toEqual([
      "3v2 to end line",
      "broken",
      "Rondo 4v2",
    ]);
  });

  it("falls back to the slug when there is no title", () => {
    const d = drillsFromIndex(index).find((x) => x.id === "c");
    expect(d.title).toBe("broken");
    expect(d.slug).toBe("broken");
  });

  it("always gives tags as an array", () => {
    const d = drillsFromIndex(index).find((x) => x.id === "c");
    expect(d.tags).toEqual([]);
  });

  it("keeps an invalid drill in the list, flagged", () => {
    // The spec is explicit: an invalid drill must appear and be openable, never hidden.
    const d = drillsFromIndex(index).find((x) => x.id === "c");
    expect(d.invalid).toBe("yaml: bad");
  });

  it("carries null rather than undefined for absent fields", () => {
    const d = drillsFromIndex(index).find((x) => x.id === "b");
    expect(d.players).toBe(null);
    expect(d.thumb).toBe(null);
  });

  it("returns an empty array for an empty index", () => {
    expect(drillsFromIndex({ version: 1, entries: {} })).toEqual([]);
    expect(drillsFromIndex(null)).toEqual([]);
  });

  it("coerces a non-string title instead of crashing the catalogue", () => {
    // A drill titled 2024 is legitimate YAML, not a broken file, but a number reaching
    // localeCompare threw and took down the whole list — and toLowerCase did the same
    // to search. Both must survive it.
    const idx = { version: 1, entries: {
      a: { name: "a.md", meta: { title: "Alpha" }, thumb: null, invalid: null },
      b: { name: "b.md", meta: { title: 2024 }, thumb: null, invalid: null },
      c: { name: "c.md", meta: { title: true }, thumb: null, invalid: null },
      d: { name: "d.md", meta: { title: "Delta" }, thumb: null, invalid: null },
    } };
    const drills = drillsFromIndex(idx);
    expect(drills.map((d) => d.title)).toEqual(["2024", "Alpha", "Delta", "true"]);
    expect(filterDrills(drills, { query: "20" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("still falls back to the slug for a falsy title", () => {
    const entry = (id, title) => [id, { name: `${id}.md`, meta: { title }, thumb: null, invalid: null }];
    const idx = { version: 1, entries: Object.fromEntries([entry("x", ""), entry("y", false), entry("z", 0)]) };
    expect(drillsFromIndex(idx).map((d) => d.title)).toEqual(["x", "y", "z"]);
  });

  it("skips a null entry rather than throwing", () => {
    expect(drillsFromIndex({ version: 1, entries: { a: null } })).toEqual([]);
  });
});

describe("slugify", () => {
  it("lower-cases and hyphenates", () => {
    expect(slugify("3v2 To End Line")).toBe("3v2-to-end-line");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Rondo: 4v2 (two touch)!")).toBe("rondo-4v2-two-touch");
    expect(slugify("  spaced   out  ")).toBe("spaced-out");
  });

  it("never returns an empty slug", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify(null)).toBe("untitled");
  });

  it("is idempotent", () => {
    expect(slugify(slugify("Rondo: 4v2"))).toBe(slugify("Rondo: 4v2"));
  });
});

describe("fileNameFor", () => {
  it("appends .md to the slug", () => {
    expect(fileNameFor("Rondo 4v2")).toBe("rondo-4v2.md");
  });

  it("avoids colliding with an existing name", () => {
    expect(fileNameFor("Rondo 4v2", ["rondo-4v2.md"])).toBe("rondo-4v2-2.md");
    expect(fileNameFor("Rondo 4v2", ["rondo-4v2.md", "rondo-4v2-2.md"])).toBe("rondo-4v2-3.md");
  });
});

describe("filterDrills", () => {
  const drills = drillsFromIndex(index);

  it("returns everything with no filter", () => {
    expect(filterDrills(drills, {})).toHaveLength(3);
  });

  it("filters by category", () => {
    expect(filterDrills(drills, { category: "skill" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("filters by tag", () => {
    expect(filterDrills(drills, { tag: "possession" }).map((d) => d.id)).toEqual(["a"]);
  });

  it("searches title and tags, case-insensitively", () => {
    expect(filterDrills(drills, { query: "RONDO" }).map((d) => d.id)).toEqual(["a"]);
    expect(filterDrills(drills, { query: "finishing" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("combines filters", () => {
    expect(filterDrills(drills, { category: "warmup", query: "rondo" })).toHaveLength(1);
    expect(filterDrills(drills, { category: "skill", query: "rondo" })).toHaveLength(0);
  });

  it("ignores an empty or whitespace query", () => {
    expect(filterDrills(drills, { query: "   " })).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/drills.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/drills.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/drills.js
// The drill model components render: index entries in, display-ready drills out.
// Owns slug rules, filtering and search. Pure — no Drive, no React.

const stripExt = (name) => String(name ?? "").replace(/\.md$/i, "");

// A title -> a filename-safe slug. Never empty, and idempotent so re-slugging a slug
// is a no-op.
export function slugify(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

// A title -> a filename that does not collide with `taken`.
export function fileNameFor(title, taken = []) {
  const base = slugify(title);
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  if (!used.has(`${base}.md`)) return `${base}.md`;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}.md`;
    if (!used.has(candidate)) return candidate;
  }
}

// Index -> drills, sorted by title. An invalid drill is included and flagged, never
// hidden: the spec requires it to be visible and openable so it can be repaired.
export function drillsFromIndex(index) {
  const entries = index?.entries ?? {};
  return Object.entries(entries)
    .filter(([, e]) => e && typeof e === "object")
    .map(([id, e]) => {
      const slug = stripExt(e.name);
      const meta = e.meta ?? {};
      // YAML types `title: 2024` as a number and `title: true` as a boolean, so coerce
      // before the value reaches localeCompare or toLowerCase. Without this a single
      // numerically-titled drill threw and took the whole catalogue AND its search down
      // with it — and a numeric title is not even invalid, just a season or a year.
      return {
        id,
        slug,
        title: meta.title ? String(meta.title) : slug,
        category: meta.category ?? null,
        minutes: meta.minutes ?? null,
        players: meta.players ?? null,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        thumb: e.thumb ?? null,
        invalid: e.invalid ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Search covers title and tags — the two things a coach recalls a drill by. Body text
// is deliberately not searched here: it is not in the index, and fetching every drill
// to search it would defeat the cache.
export function filterDrills(drills, { category, tag, query } = {}) {
  const q = String(query ?? "").trim().toLowerCase();
  return (drills ?? []).filter((d) => {
    if (category && d.category !== category) return false;
    if (tag && !d.tags.includes(tag)) return false;
    if (!q) return true;
    return (
      d.title.toLowerCase().includes(q) ||
      d.tags.some((t) => String(t).toLowerCase().includes(q))
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/drills.test.js
```

Expected: `Tests  21 passed (21)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/drills.js test/drills.test.js
git commit -m "feat: drill model with slug rules, filtering and search"
```

---

## Task 5: Port the Google auth token lifecycle

**Files:**
- Create: `src/lib/driveAuth.js`
- Test: `test/driveAuth.test.js`

**Port `~/workspace/fancystats/src/lib/drive.js`'s auth half as-is.** Its token
lifecycle, silent reauth, pending-request de-duplication and keep-alive are hard-won
against real Google behaviour and must not be redesigned. Read that file first.

Changes from the original, and only these:
- `SCOPES` becomes `https://www.googleapis.com/auth/drive` (fancystats uses `drive.appdata`)
- `TOK_KEY` becomes `ballislife_tok`, so the two apps do not fight over `sessionStorage`
- The file-management half (`ensureFile`, `driveLoad`, `driveSave`, `saveLatest`) is **not**
  ported — that is `driveApi.js` and `drive.js` here
- `getAccessToken()` and `signOut()` are added, which fancystats did not need

- [ ] **Step 1: Read the source**

```bash
sed -n '1,120p' ~/workspace/fancystats/src/lib/drive.js
```

- [ ] **Step 2: Write the failing tests**

This module is deliberately thin and mostly talks to `window.google`, so the tests are
smoke tests over the parts that hold logic — token recall, expiry, and sign-out.

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run test/driveAuth.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/driveAuth.js"`.

- [ ] **Step 4: Write the implementation**

Port the auth half of fancystats' `drive.js`, applying the four changes listed above.
The result should export: `initAuth(handlers)`, `isSignedIn()`, `signIn()`,
`getAccessToken()`, `ensureFreshToken()`, `startTokenKeepAlive()`, `signOut()`, and a
test-only `__setTokenForTests(token, exp)`.

Key points to preserve verbatim from the original, each of which exists for a reason:

```js
// A 60s safety margin, so a token never expires mid-request.
tokenExp = Date.now() + (ttl - 60) * 1000;

// A keep-alive tick must not clobber an in-flight interactive request.
if (pendingTokenRequest) return pendingTokenRequest;

// StrictMode and remounts must not stack intervals.
if (keepAliveStarted) return;

// Keep isSignedIn() honest after a rejected silent refresh.
if (!ok) forgetToken();
```

Add, which fancystats did not have:

```js
export const getAccessToken = () => (isSignedIn() ? accessToken : null);

export function signOut() {
  forgetToken();
}

// Test seam. Exported rather than reaching into module state from the test, so the
// production path has no test-only branch in it.
export function __setTokenForTests(token, exp) {
  accessToken = token;
  tokenExp = exp;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run test/driveAuth.test.js
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/driveAuth.js test/driveAuth.test.js
git commit -m "feat: port the google auth token lifecycle from fancystats"
```

---

## Task 6: The Drive facade — retry, load and save

**Files:**
- Create: `src/lib/drive.js`
- Test: `test/drive.test.js`

Wires auth to the API. Owns three things: one silent-reauth retry on 401, the whole
catalogue load, and the per-file debounced save queue with conflict detection.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "../src/lib/driveApi.js";
import * as auth from "../src/lib/driveAuth.js";
import {
  loadCatalogue, saveDrill, noteModifiedTime, knownModifiedTime, FOLDER_NAME, INDEX_NAME,
} from "../src/lib/drive.js";

vi.mock("../src/lib/driveApi.js");
vi.mock("../src/lib/driveAuth.js");

const DRILL = "---\ntitle: A\n---\n\nbody\n";

beforeEach(() => {
  vi.resetAllMocks();
  auth.getAccessToken.mockReturnValue("tok");
  auth.ensureFreshToken.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("loadCatalogue", () => {
  it("creates the folder when it does not exist", async () => {
    api.findFolder.mockResolvedValue(null);
    api.createFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.writeFile.mockResolvedValue("T");
    await loadCatalogue();
    expect(api.createFolder).toHaveBeenCalledWith("tok", FOLDER_NAME);
  });

  it("reads only the files whose modifiedTime moved", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T1" },
      { id: "b", name: "b.md", modifiedTime: "T2" },
    ]);
    const cached = {
      version: 1,
      entries: { a: { name: "a.md", modifiedTime: "T1", meta: { title: "A" }, thumb: null, invalid: null } },
    };
    api.readFile.mockImplementation(async (_t, id) => (id === "idx" ? JSON.stringify(cached) : DRILL));
    api.writeFile.mockResolvedValue("T");

    const { drills } = await loadCatalogue();
    const read = api.readFile.mock.calls.map((c) => c[1]);
    expect(read).toContain("b");
    expect(read).not.toContain("a");
    expect(drills.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("rebuilds from scratch when the index is unreadable", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T1" },
    ]);
    api.readFile.mockImplementation(async (_t, id) => (id === "idx" ? "{{{" : DRILL));
    api.writeFile.mockResolvedValue("T");
    const { drills } = await loadCatalogue();
    expect(drills.map((d) => d.id)).toEqual(["a"]);
  });

  it("tolerates a missing index file", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    api.readFile.mockResolvedValue(DRILL);
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    const { drills } = await loadCatalogue();
    expect(drills).toHaveLength(1);
  });

  it("keeps the rest of the catalogue when one drill fails to download", async () => {
    // One flaky read on a phone must not cost every drill.
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([
      { id: "good1", name: "good1.md", modifiedTime: "T1" },
      { id: "bad", name: "bad.md", modifiedTime: "T1" },
      { id: "good2", name: "good2.md", modifiedTime: "T1" },
    ]);
    api.readFile.mockImplementation(async (_t, id) => {
      if (id === "bad") throw Object.assign(new Error("flaky"), { code: 500 });
      return DRILL;
    });
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });

    const { drills, failed } = await loadCatalogue();
    expect(drills.map((d) => d.id).sort()).toEqual(["good1", "good2"]);
    expect(failed.map((f) => f.id)).toEqual(["bad"]);
  });

  it("keeps a stale cached entry when its refetch fails, and retries next load", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([
      { id: "idx", name: INDEX_NAME, modifiedTime: "T" },
      { id: "a", name: "a.md", modifiedTime: "T2" },
    ]);
    const cached = {
      version: 1,
      entries: { a: { name: "a.md", modifiedTime: "T1", meta: { title: "Old" }, thumb: null, invalid: null } },
    };
    api.readFile.mockImplementation(async (_t, id) => {
      if (id === "idx") return JSON.stringify(cached);
      throw Object.assign(new Error("flaky"), { code: 500 });
    });
    api.writeFile.mockResolvedValue("T");

    const { drills, index } = await loadCatalogue();
    expect(drills.map((d) => d.title)).toEqual(["Old"]);
    // The OLD modifiedTime is kept, so the next load notices the mismatch and retries.
    expect(index.entries.a.modifiedTime).toBe("T1");
  });

  it("lets a 401 during a drill read reach the retry rather than failing that drill", async () => {
    api.findFolder.mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([{ id: "a", name: "a.md", modifiedTime: "T1" }]);
    let reads = 0;
    api.readFile.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) throw Object.assign(new Error("auth"), { code: 401 });
      return DRILL;
    });
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });

    const { drills, failed } = await loadCatalogue();
    expect(drills).toHaveLength(1);
    expect(failed).toEqual([]);
  });

  it("retries once after a 401, then succeeds", async () => {
    api.findFolder
      .mockRejectedValueOnce(Object.assign(new Error("auth"), { code: 401 }))
      .mockResolvedValue("F1");
    api.listFiles.mockResolvedValue([]);
    api.readFile.mockResolvedValue("");
    api.writeFile.mockResolvedValue("T");
    api.createFile.mockResolvedValue({ id: "idx", modifiedTime: "T" });
    await expect(loadCatalogue()).resolves.toBeTruthy();
    expect(api.findFolder).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-auth failure", async () => {
    api.findFolder.mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    await expect(loadCatalogue()).rejects.toMatchObject({ code: 500 });
    expect(api.findFolder).toHaveBeenCalledTimes(1);
  });
});

describe("saveDrill", () => {
  it("writes the file and returns the new modifiedTime", async () => {
    noteModifiedTime("a", "T1");
    api.writeFile.mockResolvedValue("T9");
    const r = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T1" });
    expect(r).toEqual({ ok: true, modifiedTime: "T9" });
    expect(api.writeFile).toHaveBeenCalledWith("tok", "a", "x");
    // drive.js now knows the new value, so the next save can use it as its baseline.
    expect(knownModifiedTime("a")).toBe("T9");
  });

  it("refuses to overwrite when the file moved underneath it", async () => {
    noteModifiedTime("a", "T2");
    const r = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T1" });
    expect(r).toMatchObject({ ok: false, conflict: true, modifiedTime: "T2" });
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("saves a file it has never seen, having no baseline to contradict", async () => {
    api.writeFile.mockResolvedValue("T1");
    const r = await saveDrill({ id: "brand-new", text: "x", baseModifiedTime: undefined });
    expect(r).toMatchObject({ ok: true, modifiedTime: "T1" });
  });

  it("collapses rapid saves of one file, writing the newest text last", async () => {
    noteModifiedTime("a", "T1");
    api.writeFile.mockResolvedValue("T2");
    const results = await Promise.all([
      saveDrill({ id: "a", text: "one", baseModifiedTime: "T1" }),
      saveDrill({ id: "a", text: "two", baseModifiedTime: "T1" }),
      saveDrill({ id: "a", text: "three", baseModifiedTime: "T1" }),
    ]);
    const written = api.writeFile.mock.calls.map((c) => c[2]);
    expect(written.length).toBeLessThan(3);
    expect(written[written.length - 1]).toBe("three");
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("tells every caller in a burst which modifiedTime actually landed", async () => {
    // The caller whose text won the burst previously got no modifiedTime at all, so it
    // could not refresh its baseline and its next save conflicted against itself.
    noteModifiedTime("a", "T0");
    let release;
    let n = 0;
    api.writeFile.mockImplementation(async (_t, _id, text) => {
      n += 1;
      if (n === 1) { await new Promise((r) => { release = r; }); return "T-first"; }
      return `T-${text}`;
    });
    const first = saveDrill({ id: "a", text: "first", baseModifiedTime: "T0" });
    await new Promise((r) => setTimeout(r, 0));
    const second = saveDrill({ id: "a", text: "second", baseModifiedTime: "T0" });
    const third = saveDrill({ id: "a", text: "third", baseModifiedTime: "T0" });
    release();
    const results = await Promise.all([first, second, third]);
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(typeof r.modifiedTime).toBe("string");
    }
    expect(knownModifiedTime("a")).toBe("T-third");
  });

  it("recovers after a failed write instead of wedging the queue", async () => {
    noteModifiedTime("a", "T");
    api.writeFile
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 500 }))
      .mockResolvedValue("T5");
    const first = await saveDrill({ id: "a", text: "x", baseModifiedTime: "T" });
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe(500);
    const second = await saveDrill({ id: "a", text: "y", baseModifiedTime: "T" });
    expect(second).toMatchObject({ ok: true, modifiedTime: "T5" });
  });

  it("queues per file, so two files do not block each other", async () => {
    noteModifiedTime("a", "T");
    noteModifiedTime("b", "T");
    api.writeFile.mockResolvedValue("T2");
    await Promise.all([
      saveDrill({ id: "a", text: "x", baseModifiedTime: "T" }),
      saveDrill({ id: "b", text: "y", baseModifiedTime: "T" }),
    ]);
    expect(api.writeFile.mock.calls.map((c) => c[1]).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/drive.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/drive.js"`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/drive.js
// Facade over driveAuth + driveApi. Owns exactly three things: one silent-reauth retry
// on 401, the catalogue load, and the per-file save queue.
import * as api from "./driveApi.js";
import { getAccessToken, ensureFreshToken } from "./driveAuth.js";
import { readIndex, entryFor, diffIndex, applyDiff } from "./driveIndex.js";
import { drillsFromIndex } from "./drills.js";

export const FOLDER_NAME = "BallIsLife";
export const INDEX_NAME = "index.json";

// One silent-reauth retry, then give up. Ported from fancystats' saveWithRetry: an
// expired token is the common failure and is invisible to the user when it works.
async function withRetry(run) {
  try {
    return await run();
  } catch (e) {
    if (e?.code !== 401) throw e;
    await ensureFreshToken();
    return run();
  }
}

async function folderId(token) {
  return (await api.findFolder(token, FOLDER_NAME)) ?? api.createFolder(token, FOLDER_NAME);
}

// Loads the whole catalogue, revalidating the cache against Drive.
// -> { folderId, indexFileId, index, drills, fetched, failed }
export async function loadCatalogue() {
  return withRetry(async () => {
    const token = getAccessToken();
    const folder = await folderId(token);
    const files = await api.listFiles(token, folder);

    const indexFile = files.find((f) => f.name === INDEX_NAME) ?? null;
    const cached = indexFile ? readIndex(await api.readFile(token, indexFile.id)) : readIndex(null);

    const { keep, refetch, dropped } = diffIndex(cached, files);

    const built = {};
    const failed = [];
    for (const file of refetch) {
      try {
        const text = await api.readFile(token, file.id);
        built[file.id] = entryFor(file.name, file.modifiedTime, text);
      } catch (error) {
        // A 401 must still bubble to withRetry, which reauths and retries the whole
        // load — swallowing it here would turn an expired token into "every drill
        // failed".
        if (error?.code === 401) throw error;
        // Any other failure costs one drill, not the catalogue. This app is used on a
        // phone at the side of a pitch, where one flaky read is ordinary. Keep the
        // previous cached entry if there is one, so the drill still shows: its OLD
        // modifiedTime stays in the index, so the next load sees the mismatch and
        // retries by itself.
        failed.push({ id: file.id, name: file.name, error });
        const previous = cached.entries[file.id];
        if (previous) built[file.id] = previous;
      }
    }

    const index = applyDiff(keep, built);

    // Only rewrite the cache when it actually changed — a phone reload should not
    // cost a write.
    if (refetch.length || dropped.length || !indexFile) {
      const body = JSON.stringify(index);
      if (indexFile) await api.writeFile(token, indexFile.id, body);
      else await api.createFile(token, folder, INDEX_NAME, body);
    }

    // Seed the conflict baseline from what Drive just reported, so saveDrill can be
    // the authority on it rather than trusting the caller.
    for (const [id, entry] of Object.entries(index.entries)) known.set(id, entry.modifiedTime);

    return {
      folderId: folder,
      indexFileId: indexFile?.id ?? null,
      index,
      drills: drillsFromIndex(index),
      fetched: refetch.length,
      failed,
    };
  });
}

// -- per-file save queue -----------------------------------------------------
// One chain per fileId, latest-wins. Rapid keystrokes collapse to the newest text, and
// two different drills never block each other. Ported in shape from fancystats'
// saveLatest, but keyed by file rather than global.
const queues = new Map();

function enqueue(id, run) {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(run, run).finally(() => {
    if (queues.get(id) === next) queues.delete(id);
  });
  queues.set(id, next);
  return next;
}

const pending = new Map();

// What Drive last reported for each file. drive.js is the authority on this rather than
// the caller: an earlier design took BOTH the loaded and the current modifiedTime as
// arguments, which meant `saveDrill({ base: x, current: x })` — passing one variable
// twice, the easiest possible mistake — silently disabled the conflict guard entirely.
const known = new Map();

export function noteModifiedTime(id, modifiedTime) { known.set(id, modifiedTime); }
export function knownModifiedTime(id) { return known.get(id) ?? null; }

// -> { ok: true, modifiedTime } | { ok: false, conflict: true, modifiedTime }
//    | { ok: false, error }
//
// `baseModifiedTime` is what the caller loaded. If Drive has since reported something
// different — an edit from the Drive web UI, or another device — we refuse rather than
// clobber, and hand back the current value so the caller can offer to reload.
export async function saveDrill({ id, text, baseModifiedTime }) {
  const current = known.get(id);
  if (current !== undefined && baseModifiedTime !== current) {
    return { ok: false, conflict: true, modifiedTime: current };
  }
  pending.set(id, text);
  return enqueue(id, async () => {
    const latest = pending.get(id);
    if (latest === undefined) {
      // A later save in this burst already wrote the newest text. Report the
      // modifiedTime that actually landed: returning nothing here left the newest edit
      // unable to refresh its own baseline, so its next save spuriously conflicted
      // against the user's own previous keystroke.
      return { ok: true, coalesced: true, modifiedTime: known.get(id) ?? null };
    }
    pending.delete(id);
    try {
      await ensureFreshToken();
      const modifiedTime = await withRetry(() => api.writeFile(getAccessToken(), id, latest));
      known.set(id, modifiedTime);
      return { ok: true, modifiedTime };
    } catch (error) {
      return { ok: false, error };
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/drive.test.js
```

Expected: `Tests  16 passed (16)`.

If the collapsing test fails, the queue's latest-wins logic is wrong — fix `drive.js`,
not the test. That behaviour is what stops a burst of keystrokes issuing a write per
character.

- [ ] **Step 5: Commit**

```bash
git add src/lib/drive.js test/drive.test.js
git commit -m "feat: drive facade with 401 retry, catalogue load and per-file save queue"
```

---

## Task 7: Move mark geometry into the geometry module

**Files:**
- Modify: `src/lib/pitchSvg.js`, `test/pitchSvg.test.js`
- Modify: `src/components/PitchDiagram.jsx`

Debt recorded by the Plan 1 review and deliberately deferred. The cone, ball and flag
path strings and the goal half-height map (`full: 3.66, small: 2, mini: 1.2` — real
metres) are domain geometry living in a component with no test coverage. Clear it before
Plan 3 adds more mark kinds.

- [ ] **Step 1: Write the failing tests**

Append to `test/pitchSvg.test.js`, extending the import to include `markShape`:

```js
describe("markShape", () => {
  it("places a cone triangle at its point", () => {
    const s = markShape({ kind: "cone", x: 5, y: 5 });
    expect(s.type).toBe("path");
    expect(s.d).toContain(`M ${toPx(5, 5).x}`);
  });

  it("sizes a goal by its real half-height in metres", () => {
    const full = markShape({ kind: "goal", x: 0, y: 12, size: "full" });
    const mini = markShape({ kind: "goal", x: 0, y: 12, size: "mini" });
    expect(full.h).toBeCloseTo(3.66 * 2 * S);
    expect(mini.h).toBeCloseTo(1.2 * 2 * S);
    expect(full.y).toBeCloseTo(toPx(0, 12).y - 3.66 * S);
  });

  it("defaults an unknown goal size to full rather than producing NaN", () => {
    expect(markShape({ kind: "goal", x: 0, y: 12, size: "enormous" }).h).toBeCloseTo(3.66 * 2 * S);
    expect(markShape({ kind: "goal", x: 0, y: 12 }).h).toBeCloseTo(3.66 * 2 * S);
  });

  it("gives a ball a circle and a flag a pole", () => {
    expect(markShape({ kind: "ball", x: 1, y: 1 }).type).toBe("circle");
    expect(markShape({ kind: "flag", x: 1, y: 1 }).type).toBe("flag");
  });

  it("returns a zone rect in pixels", () => {
    const z = markShape({ kind: "zone", x: 2, y: 3, w: 4, h: 5, label: "z" });
    expect(z).toMatchObject({ type: "zone", x: toPx(2, 3).x, y: toPx(2, 3).y, w: 4 * S, h: 5 * S, label: "z" });
  });

  it("returns null for an unknown kind rather than throwing", () => {
    expect(markShape({ kind: "spaceship", x: 1, y: 1 })).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/pitchSvg.test.js -t markShape
```

Expected: FAIL — `markShape is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/pitchSvg.js`:

```js
// Real-world half-heights in metres. Domain geometry, so it belongs here beside the
// pitch-marking dimensions rather than in a component.
const GOAL_HALF_HEIGHT = { full: 3.66, small: 2, mini: 1.2 };
const GOAL_DEPTH = 7; // px; a goal is drawn as a thin box on the line

// A scene mark -> a shape descriptor in pixels, or null for an unknown kind.
// The component chooses colours and draws; every number comes from here.
export function markShape(mark) {
  const p = toPx(mark.x, mark.y);
  switch (mark.kind) {
    case "cone":
      return { type: "path", d: `M ${p.x} ${p.y - 5} l 5 10 h -10 z` };
    case "ball":
      return { type: "circle", cx: p.x, cy: p.y, r: 5 };
    case "flag":
      return { type: "flag", x: p.x, y: p.y, top: p.y - 22, d: `M ${p.x} ${p.y - 22} l 12 4 l -12 4 z` };
    case "goal": {
      const half = (GOAL_HALF_HEIGHT[mark.size] ?? GOAL_HALF_HEIGHT.full) * S;
      return { type: "rect", x: p.x - GOAL_DEPTH / 2, y: p.y - half, w: GOAL_DEPTH, h: half * 2 };
    }
    case "zone":
      return { type: "zone", x: p.x, y: p.y, w: mark.w * S, h: mark.h * S,
               label: mark.label ?? null, labelX: toPx(mark.x + mark.w / 2, mark.y).x, labelY: p.y + 13 };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Rewrite `Mark` in `src/components/PitchDiagram.jsx` to consume it**

Replace the whole `Mark` function with:

```jsx
function Mark({ mark }) {
  const s = markShape(mark);
  if (!s) return null;
  if (s.type === "zone") {
    return (
      <g>
        <rect
          x={s.x} y={s.y} width={s.w} height={s.h}
          fill="var(--yellow)" fillOpacity="0.16"
          stroke="var(--yellow)" strokeOpacity="0.7" strokeWidth="1.3" strokeDasharray="5 3"
        />
        {s.label ? (
          <text
            x={s.labelX} y={s.labelY} fontSize="9" fill="#fff"
            stroke="#1d4d31" strokeWidth="2.5" paintOrder="stroke" textAnchor="middle"
          >
            {s.label}
          </text>
        ) : null}
      </g>
    );
  }
  if (s.type === "path") return <path d={s.d} fill="var(--cone)" />;
  if (s.type === "circle") return <circle cx={s.cx} cy={s.cy} r={s.r} fill="#fff" stroke="#222" strokeWidth="1" />;
  if (s.type === "flag") {
    return (
      <g>
        <line x1={s.x} y1={s.y} x2={s.x} y2={s.top} stroke="#fff" strokeWidth="1.6" />
        <path d={s.d} fill="var(--shot-line)" />
      </g>
    );
  }
  return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke="#fff" strokeWidth="2" />;
}
```

Add `markShape` to the `pitchSvg.js` import at the top of the file, and delete the now
unused `S` import if nothing else in the component uses it.

- [ ] **Step 5: Run the whole suite and the build**

```bash
npm test && npm run build
```

Expected: every suite passes. The existing `PitchDiagram` tests must still pass
unchanged — this is a refactor, and if a rendering test fails, the refactor changed
behaviour it should not have.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move mark geometry from the component into pitchSvg"
```

---

## Task 8: Sign in and list your real drills

**Files:**
- Create: `src/components/Catalogue.jsx`
- Test: `test/catalogue.test.jsx`
- Modify: `src/App.jsx`, `index.html`

This replaces the Plan 1 preview harness. It is deliberately a plain list, not the card
grid — the grid and the editor are Plan 3. What it proves is that auth, the folder, the
index and the model work against real Drive.

- [ ] **Step 1: Write the failing tests**

SSR smoke tests only — no jsdom, so no clicking. They check what each state renders.

```jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Catalogue from "../src/components/Catalogue.jsx";

const render = (props) => renderToStaticMarkup(<Catalogue {...props} />);

describe("Catalogue", () => {
  it("offers sign-in when signed out", () => {
    const html = render({ status: "signed-out" });
    expect(html).toContain("Sign in");
  });

  it("says so while loading", () => {
    expect(render({ status: "loading" })).toMatch(/loading/i);
  });

  it("refuses a non-owner without leaking whose app it is", () => {
    const html = render({ status: "not-owner" });
    expect(html).toMatch(/owner/i);
    expect(html).not.toContain("@");
  });

  it("lists drills with their metadata", () => {
    const drills = [
      { id: "a", slug: "rondo-4v2", title: "Rondo 4v2", category: "warmup", minutes: 10,
        players: "6-8", tags: ["possession"], thumb: "area: 20x20 plain\nred: A@5,5\n", invalid: null },
    ];
    const html = render({ status: "ready", drills });
    expect(html).toContain("Rondo 4v2");
    expect(html).toContain("warmup");
    expect(html).toContain("possession");
    expect(html).toContain("<svg");
  });

  it("flags an invalid drill instead of hiding it", () => {
    const drills = [{ id: "c", slug: "broken", title: "broken", category: null, minutes: null,
                      players: null, tags: [], thumb: null, invalid: "yaml: bad" }];
    const html = render({ status: "ready", drills });
    expect(html).toContain("broken");
    expect(html).toMatch(/yaml: bad/);
  });

  it("renders a drill with no diagram without an svg", () => {
    const drills = [{ id: "d", slug: "notes", title: "Notes", category: null, minutes: null,
                      players: null, tags: [], thumb: null, invalid: null }];
    const html = render({ status: "ready", drills });
    expect(html).toContain("Notes");
    expect(html).not.toContain("<svg");
  });

  it("explains an empty folder rather than showing nothing", () => {
    const html = render({ status: "ready", drills: [] });
    expect(html).toMatch(/no drills/i);
    expect(html).toContain("BallIsLife");
  });

  it("shows an error state", () => {
    expect(render({ status: "error", message: "drive 500" })).toContain("drive 500");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/catalogue.test.jsx
```

Expected: FAIL — `Failed to resolve import "../src/components/Catalogue.jsx"`.

- [ ] **Step 3: Write `src/components/Catalogue.jsx`**

Presentational only — it takes `status` and `drills` as props and renders. All the
async wiring lives in `App.jsx`, which keeps this testable without mocking Drive.

```jsx
// src/components/Catalogue.jsx
// Presentational: given a status and a list of drills, render them. No Drive calls —
// App owns the async wiring, which is what lets this be tested without mocks.
import React from "react";
import PitchDiagram from "./PitchDiagram.jsx";

function DrillRow({ drill }) {
  const chips = [drill.category, drill.minutes ? `${drill.minutes}′` : null, drill.players]
    .filter(Boolean)
    .concat(drill.tags);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{drill.title}</strong>
        <span className="dim mono">{drill.slug}.md</span>
      </div>
      <div className="row" style={{ margin: "6px 0" }}>
        {chips.map((c, i) => <span className="chip" key={i}>{c}</span>)}
      </div>
      {drill.invalid ? <div className="banner warn mono">{drill.invalid}</div> : null}
      {drill.thumb ? <PitchDiagram source={drill.thumb} /> : null}
    </div>
  );
}

export default function Catalogue({ status, drills = [], message, onSignIn }) {
  if (status === "signed-out") {
    return (
      <div className="card">
        <p>Your drills live in your own Google Drive. Nothing is stored on this site.</p>
        <button className="primary" onClick={onSignIn}>Sign in with Google</button>
      </div>
    );
  }
  if (status === "loading") return <div className="card">Loading your drills…</div>;
  if (status === "not-owner") {
    return <div className="card banner err">This app is for its owner only. You have been signed out.</div>;
  }
  if (status === "error") return <div className="card banner err mono">{message}</div>;
  if (!drills.length) {
    return (
      <div className="card">
        <p>No drills yet.</p>
        <p className="dim">
          Add markdown files to the <strong>BallIsLife</strong> folder in your Google Drive
          and reload.
        </p>
      </div>
    );
  }
  return <div>{drills.map((d) => <DrillRow key={d.id} drill={d} />)}</div>;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/catalogue.test.jsx
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Wire it up in `src/App.jsx`**

```jsx
import React, { useCallback, useEffect, useState } from "react";
import Catalogue from "./components/Catalogue.jsx";
import { initAuth, isSignedIn, signIn, signOut, startTokenKeepAlive, getAccessToken } from "./lib/driveAuth.js";
import { aboutEmail } from "./lib/driveApi.js";
import { isOwner } from "./lib/owner.js";
import { loadCatalogue } from "./lib/drive.js";

export default function App() {
  const [status, setStatus] = useState("starting");
  const [drills, setDrills] = useState([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      // The owner gate. Not a security boundary — see src/lib/owner.js — it stops a
      // stranger who finds this URL using this deployment against their own Drive.
      const email = await aboutEmail(getAccessToken());
      if (!(await isOwner(email))) {
        signOut();
        setStatus("not-owner");
        return;
      }
      startTokenKeepAlive();
      const { drills: loaded } = await loadCatalogue();
      setDrills(loaded);
      setStatus("ready");
    } catch (e) {
      setMessage(String(e?.message ?? e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    initAuth().then((ready) => {
      if (cancelled) return;
      if (!ready) { setMessage("Google sign-in failed to load"); setStatus("error"); return; }
      if (isSignedIn()) load();
      else setStatus("signed-out");
    });
    return () => { cancelled = true; };
  }, [load]);

  const onSignIn = useCallback(async () => {
    if (await signIn()) load();
  }, [load]);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: "10px 0" }}>ballislife</h1>
        <span className="dim">v{__APP_VERSION__}</span>
      </div>
      <Catalogue
        status={status === "starting" ? "loading" : status}
        drills={drills}
        message={message}
        onSignIn={onSignIn}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run the whole suite and the build**

```bash
npm test && npm run build
```

Expected: all suites pass; build clean.

- [ ] **Step 7: Bump the version and deploy**

```bash
npm version patch --no-git-tag-version
npm install --package-lock-only
git add -A
git commit -m "feat: sign in and list drills from the BallIsLife drive folder"
git push origin main
```

Watch the deploy:

```bash
gh run watch
```

- [ ] **Step 8: MANUAL VERIFICATION — this is Sean's, and nothing above proves it**

Every test in this plan runs against mocked network calls. They prove the logic, not
that Google accepts our requests. **Until these steps pass, Drive integration is
unproven.**

At <https://seaninryan.github.io/ballislife/>:

1. The page offers "Sign in with Google". Click it.
2. Consent screen appears. **It will say "fancystats"** — that is the reused OAuth
   client, as recorded in the spec. It asks for Drive access. Accept.
3. You land on either "No drills yet" or a list. Either is success.
4. Open Google Drive in another tab. A **BallIsLife** folder exists, containing
   `index.json`.
5. Create a file in that folder — `test-drill.md` — with this content:

   ````markdown
   ---
   title: Test drill
   category: warmup
   minutes: 10
   tags: [test]
   ---

   Does this appear?

   ```pitch
   area: 20x20 plain
   red: A@5,5 B@15,15
   pass: A->B
   ```
   ````

6. Reload ballislife. "Test drill" appears, with its diagram, chips and tags.
7. Edit the file in Drive — change `minutes` to 20. Reload. It shows 20′. **This is the
   important one**: it proves the index revalidates rather than serving a stale cache.
8. Sign in with a *different* Google account. You should get "This app is for its owner
   only".

If step 8 locks *you* out, the committed `OWNER_EMAIL_SHA256` does not match the
account you signed in with. Regenerate it:

```bash
node -e 'console.log(require("crypto").createHash("sha256").update("YOUR@ADDRESS".trim().toLowerCase()).digest("hex"))'
```

and replace the constant in `src/lib/owner.js`.

Report which steps passed. Any failure here is a real defect regardless of the test
suite being green.

---

## Done when

- `npm test` passes every suite and `npm run build` is clean
- The deployed site signs in, gates non-owners, and lists real drills from Drive
- Editing a drill in the Drive web UI and reloading shows the change (the index
  revalidates)
- Sean has run the Task 8 manual checklist and reported the result

## What Plan 3 covers

- The card grid browse view, with category chips, tag filter and search wired to
  `filterDrills`
- The three-pane editor: drill list, markdown source, live preview, with the mobile
  collapse to list → read-only preview
- Create, rename and delete drills (`fileNameFor` and `trashFile` already exist)
- Debounced saving wired to `saveDrill`, with the conflict warning surfaced in the UI.
  Note the contract: the caller passes only `baseModifiedTime` (what it loaded) and must
  adopt the `modifiedTime` from every successful result, including a `coalesced` one
- Friendlier error text. `App.jsx` currently surfaces raw exceptions like `drive 403`,
  which tells a coach nothing about what to do next
- A guard against duplicate `BallIsLife` folders. `findFolder` takes the first match with
  no ordering guarantee, so two near-simultaneous first-runs on different devices could
  create two folders and split drills silently. Invisible to any mock
- `marked` + `DOMPurify` for prose, replacing the line-breaks-only rendering
