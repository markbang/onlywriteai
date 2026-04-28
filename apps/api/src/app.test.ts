import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createApp } from "./app.ts";
import { createDatabase } from "./db/client.ts";

type DocumentResponse = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

type DocumentSourceResponse = {
  id: string;
  documentId: string;
  type: string;
  title: string;
  note: string;
  url: string | null;
  fileName: string | null;
  createdAt: number;
  updatedAt: number;
};

const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

function createTestApp() {
  const dir = join(tmpdir(), `onlywrite-routes-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const database = createDatabase(join(dir, "test.sqlite"));
  databases.push(database);
  return {
    app: createApp(database.db),
    close: database.close,
  };
}

async function readDocument(response: Response): Promise<DocumentResponse> {
  return (await response.json()) as DocumentResponse;
}

async function readSource(response: Response): Promise<DocumentSourceResponse> {
  return (await response.json()) as DocumentSourceResponse;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("returns health status", async () => {
  const { app } = createTestApp();

  const response = await app.request("/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
});

test("creates, lists, updates, and deletes a document", async () => {
  const { app } = createTestApp();

  const createdResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "Body" }),
  });
  const created = await readDocument(createdResponse);

  const listResponse = await app.request("/documents");
  const list = await listResponse.json();

  const updateResponse = await app.request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Updated" }),
  });
  const updated = await readDocument(updateResponse);

  const detailResponse = await app.request(`/documents/${created.id}`);
  const detail = await readDocument(detailResponse);

  const deleteResponse = await app.request(`/documents/${created.id}`, {
    method: "DELETE",
  });
  const missingResponse = await app.request(`/documents/${created.id}`);

  expect(createdResponse.status).toBe(201);
  expect(created).toMatchObject({ title: "Draft", content: "Body" });
  expect(list).toHaveLength(1);
  expect(updated).toMatchObject({
    id: created.id,
    title: "Updated",
    content: "Body",
  });
  expect(detail).toMatchObject({ id: created.id, title: "Updated" });
  expect(deleteResponse.status).toBe(204);
  expect(missingResponse.status).toBe(404);
});

test("returns a consistent JSON error for missing documents", async () => {
  const { app } = createTestApp();

  const responses = await Promise.all([
    app.request("/documents/missing"),
    app.request("/documents/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" }),
    }),
    app.request("/documents/missing", { method: "DELETE" }),
  ]);

  for (const response of responses) {
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Document not found" },
    });
  }
});

test("treats missing JSON bodies as empty objects", async () => {
  const { app } = createTestApp();

  const missingBodyResponse = await app.request("/documents", {
    method: "POST",
  });
  const missingBody = await readDocument(missingBodyResponse);

  const emptyPatchResponse = await app.request(`/documents/${missingBody.id}`, {
    method: "PATCH",
  });
  const emptyPatch = await readDocument(emptyPatchResponse);

  expect(missingBodyResponse.status).toBe(201);
  expect(missingBody).toMatchObject({ title: "Untitled", content: "" });
  expect(emptyPatchResponse.status).toBe(200);
  expect(emptyPatch).toMatchObject({
    id: missingBody.id,
    title: "Untitled",
    content: "",
  });
});

test("returns a JSON error for malformed create bodies", async () => {
  const { app } = createTestApp();

  const response = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: { message: "Invalid JSON body" },
  });
});

test("returns a JSON error for whitespace-only create bodies", async () => {
  const { app } = createTestApp();

  const response = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "   ",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: { message: "Invalid JSON body" },
  });
});

test("returns a JSON error for malformed update bodies", async () => {
  const { app } = createTestApp();
  const createdResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "Body" }),
  });
  const created = await readDocument(createdResponse);

  const response = await app.request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: { message: "Invalid JSON body" },
  });
});

test("returns a JSON error for whitespace-only update bodies", async () => {
  const { app } = createTestApp();
  const createdResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "Body" }),
  });
  const created = await readDocument(createdResponse);

  const response = await app.request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "   ",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: { message: "Invalid JSON body" },
  });
});

test("creates, lists, updates, and deletes document sources", async () => {
  const { app } = createTestApp();
  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = await readDocument(documentResponse);

  const createResponse = await app.request(`/documents/${document.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "rss",
      title: "Feed",
      note: "Context note",
      url: "https://example.com/feed.xml",
    }),
  });
  const created = await readSource(createResponse);

  const listResponse = await app.request(`/documents/${document.id}/sources`);
  const list = (await listResponse.json()) as DocumentSourceResponse[];

  const updateResponse = await app.request(`/documents/${document.id}/sources/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Updated feed",
      fileName: "feed.pdf",
    }),
  });
  const updated = await readSource(updateResponse);

  const deleteResponse = await app.request(`/documents/${document.id}/sources/${created.id}`, {
    method: "DELETE",
  });
  const listAfterDeleteResponse = await app.request(`/documents/${document.id}/sources`);
  const listAfterDelete = await listAfterDeleteResponse.json();

  expect(createResponse.status).toBe(201);
  expect(created).toMatchObject({
    documentId: document.id,
    type: "rss",
    title: "Feed",
    note: "Context note",
    url: "https://example.com/feed.xml",
    fileName: null,
  });
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: created.id, title: "Feed" });
  expect(updateResponse.status).toBe(200);
  expect(updated).toMatchObject({
    id: created.id,
    title: "Updated feed",
    fileName: "feed.pdf",
  });
  expect(deleteResponse.status).toBe(204);
  expect(listAfterDelete).toEqual([]);
});

test("returns document not found for source routes with missing parent documents", async () => {
  const { app } = createTestApp();

  const responses = await Promise.all([
    app.request("/documents/missing/sources"),
    app.request("/documents/missing/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "text", title: "Nope" }),
    }),
    app.request("/documents/missing/sources/source-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" }),
    }),
    app.request("/documents/missing/sources/source-1", { method: "DELETE" }),
  ]);

  for (const response of responses) {
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Document not found" },
    });
  }
});

test("returns source not found for missing or incorrectly scoped source routes", async () => {
  const { app } = createTestApp();
  const ownerResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Owner" }),
  });
  const otherResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Other" }),
  });
  const owner = await readDocument(ownerResponse);
  const other = await readDocument(otherResponse);
  const sourceResponse = await app.request(`/documents/${owner.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", title: "Scoped" }),
  });
  const source = await readSource(sourceResponse);

  const responses = await Promise.all([
    app.request(`/documents/${owner.id}/sources/missing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" }),
    }),
    app.request(`/documents/${owner.id}/sources/missing`, { method: "DELETE" }),
    app.request(`/documents/${other.id}/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" }),
    }),
    app.request(`/documents/${other.id}/sources/${source.id}`, { method: "DELETE" }),
  ]);

  for (const response of responses) {
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Source not found" },
    });
  }
});

test("returns a JSON error for malformed source bodies", async () => {
  const { app } = createTestApp();
  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = await readDocument(documentResponse);
  const sourceResponse = await app.request(`/documents/${document.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", title: "Source" }),
  });
  const source = await readSource(sourceResponse);

  const responses = await Promise.all([
    app.request(`/documents/${document.id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    app.request(`/documents/${document.id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "   ",
    }),
    app.request(`/documents/${document.id}/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    app.request(`/documents/${document.id}/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "   ",
    }),
  ]);

  for (const response of responses) {
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Invalid JSON body" },
    });
  }
});

test("returns a JSON error for invalid source types", async () => {
  const { app } = createTestApp();
  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = await readDocument(documentResponse);
  const sourceResponse = await app.request(`/documents/${document.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "image", title: "Photo" }),
  });
  const source = await readSource(sourceResponse);

  const responses = await Promise.all([
    app.request(`/documents/${document.id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Missing type" }),
    }),
    app.request(`/documents/${document.id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "video" }),
    }),
    app.request(`/documents/${document.id}/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "video" }),
    }),
  ]);

  for (const response of responses) {
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Invalid source type" },
    });
  }
});
