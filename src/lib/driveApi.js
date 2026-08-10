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
