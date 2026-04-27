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

test("treats missing or invalid JSON bodies as empty objects", async () => {
  const { app } = createTestApp();

  const missingBodyResponse = await app.request("/documents", {
    method: "POST",
  });
  const missingBody = await readDocument(missingBodyResponse);

  const invalidBodyResponse = await app.request(`/documents/${missingBody.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const invalidBody = await readDocument(invalidBodyResponse);

  expect(missingBodyResponse.status).toBe(201);
  expect(missingBody).toMatchObject({ title: "Untitled", content: "" });
  expect(invalidBodyResponse.status).toBe(200);
  expect(invalidBody).toMatchObject({
    id: missingBody.id,
    title: "Untitled",
    content: "",
  });
});
