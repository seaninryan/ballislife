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
    expect(url).toContain("fields=user%28emailAddress%29");
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
