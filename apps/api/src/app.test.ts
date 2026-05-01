import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import {
  type SourceImportAssistant,
  type SourceImportInput,
} from "./ai/source-import-assistant.ts";
import {
  WritingAssistantConfigurationError,
  type WritingAssistant,
} from "./ai/writing-assistant.ts";
import { createApp } from "./app.ts";
import { createAuthConfig, type AuthConfig } from "./auth.ts";
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
  type: string;
  title: string;
  note: string;
  url: string | null;
  fileName: string | null;
  tags: string[];
  documents?: Array<{ id: string; title: string }>;
  createdAt: number;
  updatedAt: number;
};

const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

function createTestApp(
  options: {
    authConfig?: AuthConfig;
    sourceImportAssistant?: SourceImportAssistant;
    writingAssistant?: WritingAssistant;
  } = {},
) {
  const dir = join(tmpdir(), `onlywrite-routes-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const database = createDatabase(join(dir, "test.sqlite"));
  databases.push(database);
  return {
    app: createApp(database.db, options),
    close: database.close,
  };
}

async function readDocument(response: Response): Promise<DocumentResponse> {
  return (await response.json()) as DocumentResponse;
}

async function readSource(response: Response): Promise<DocumentSourceResponse> {
  return (await response.json()) as DocumentSourceResponse;
}

function textStream(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("returns health and readiness status", async () => {
  const { app } = createTestApp();

  const healthResponse = await app.request("/health");
  const readyResponse = await app.request("/ready");

  expect(healthResponse.status).toBe(200);
  expect(healthResponse.headers.get("x-content-type-options")).toBe("nosniff");
  await expect(healthResponse.json()).resolves.toEqual({ ok: true });
  expect(readyResponse.status).toBe(200);
  await expect(readyResponse.json()).resolves.toMatchObject({
    checks: { database: true },
    ok: true,
  });
});

test("lists available writing models", async () => {
  const { app } = createTestApp({
    writingAssistant: {
      async generate() {
        return { suggestion: "Noop", model: "test-model", usedSources: 0 };
      },
      async models() {
        return ["test-model", "other-model"];
      },
      async stream() {
        return { model: "test-model", stream: textStream("Noop"), usedSources: 0 };
      },
    },
  });

  const response = await app.request("/models");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ models: ["test-model", "other-model"] });
});

test("reports auth status when auth is disabled", async () => {
  const { app } = createTestApp();

  const response = await app.request("/auth/me");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ enabled: false, user: null });
});

test("requires authentication when Logto is configured", async () => {
  const { app } = createTestApp({
    authConfig: createAuthConfig({
      APP_BASE_URL: "http://localhost:5173",
      AUTH_SESSION_SECRET: "test-session-secret",
      LOGTO_APP_ID: "app-id",
      LOGTO_APP_SECRET: "app-secret",
      LOGTO_ISSUER: "https://auth.example.test/oidc",
      LOGTO_JWKS_URI: "https://auth.example.test/oidc/jwks",
    }),
  });

  const meResponse = await app.request("/auth/me");
  const documentsResponse = await app.request("/documents");

  expect(meResponse.status).toBe(200);
  await expect(meResponse.json()).resolves.toEqual({ enabled: true, user: null });
  expect(documentsResponse.status).toBe(401);
  await expect(documentsResponse.json()).resolves.toEqual({
    error: { message: "Unauthorized" },
  });
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

test("creates, lists, reads, and updates agent conversations", async () => {
  const { app } = createTestApp();
  const documentResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "Body" }),
  });
  const document = await readDocument(documentResponse);

  const createResponse = await app.request("/agent/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      messages: [{ id: "message-1", role: "user", content: "Continue this" }],
      title: "Continue this",
    }),
  });
  const created = await createResponse.json();
  const listResponse = await app.request(`/agent/conversations?documentId=${document.id}`);
  const updateResponse = await app.request(
    `/agent/conversations/${(created as { id: string }).id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { id: "message-1", role: "user", content: "Continue this" },
          { id: "message-2", role: "assistant", content: "Next paragraph." },
        ],
        title: "Continue this updated",
      }),
    },
  );
  const detailResponse = await app.request(
    `/agent/conversations/${(created as { id: string }).id}`,
  );

  expect(createResponse.status).toBe(201);
  expect(created).toMatchObject({
    documentId: document.id,
    title: "Continue this",
    messages: [{ id: "message-1", role: "user", content: "Continue this" }],
  });
  await expect(listResponse.json()).resolves.toMatchObject([
    { id: (created as { id: string }).id, documentId: document.id },
  ]);
  await expect(updateResponse.json()).resolves.toMatchObject({
    id: (created as { id: string }).id,
    title: "Continue this updated",
    messages: [
      { id: "message-1", role: "user", content: "Continue this" },
      { id: "message-2", role: "assistant", content: "Next paragraph." },
    ],
  });
  await expect(detailResponse.json()).resolves.toMatchObject({
    id: (created as { id: string }).id,
    title: "Continue this updated",
  });
});

test("generates an agent conversation title with the selected model", async () => {
  const calls: Array<{ instruction: string; model?: string }> = [];
  const { app } = createTestApp({
    writingAssistant: {
      async generate(input) {
        calls.push({ instruction: input.instruction, model: input.model });
        return {
          model: input.model ?? "test-model",
          suggestion: '  "Focused rewrite"  ',
          usedSources: 0,
        };
      },
      async models() {
        return ["test-model"];
      },
      async stream() {
        return { model: "test-model", stream: textStream("Noop"), usedSources: 0 };
      },
    },
  });

  const response = await app.request("/agent/conversations/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftTitle: "Draft",
      messages: [
        { id: "message-1", role: "user", content: "Improve the intro" },
        { id: "message-2", role: "assistant", content: "Use a clearer hook." },
      ],
      model: "test-model",
    }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    model: "test-model",
    title: "Focused rewrite",
  });
  expect(calls).toEqual([
    {
      instruction: expect.stringContaining("Improve the intro"),
      model: "test-model",
    },
  ]);
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
      tags: ["rss", "research", "rss"],
    }),
  });
  const created = await readSource(createResponse);

  const listResponse = await app.request(`/documents/${document.id}/sources`);
  const list = (await listResponse.json()) as DocumentSourceResponse[];
  const allSourcesResponse = await app.request("/sources");
  const allSources = (await allSourcesResponse.json()) as DocumentSourceResponse[];

  const updateResponse = await app.request(`/documents/${document.id}/sources/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Updated feed",
      fileName: "feed.pdf",
      tags: ["edited"],
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
    type: "rss",
    title: "Feed",
    note: "Context note",
    url: "https://example.com/feed.xml",
    fileName: null,
    tags: ["rss", "research"],
  });
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: created.id, title: "Feed" });
  expect(allSources).toHaveLength(1);
  expect(allSources[0]).toMatchObject({
    id: created.id,
    documents: [{ id: document.id, title: "Untitled" }],
    tags: ["rss", "research"],
  });
  expect(updateResponse.status).toBe(200);
  expect(updated).toMatchObject({
    id: created.id,
    title: "Updated feed",
    fileName: "feed.pdf",
    tags: ["edited"],
  });
  expect(deleteResponse.status).toBe(204);
  expect(listAfterDelete).toEqual([]);
  expect((await (await app.request("/sources")).json()) as DocumentSourceResponse[]).toHaveLength(
    1,
  );
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
    body: JSON.stringify({ type: "text", title: "Scoped", note: "Body" }),
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
    body: JSON.stringify({ type: "text", title: "Source", note: "Body" }),
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
    body: JSON.stringify({ type: "image", title: "Photo", fileName: "photo.png" }),
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

test("imports sources through the source import assistant", async () => {
  const calls: SourceImportInput[] = [];
  const sourceImportAssistant: SourceImportAssistant = {
    async importSources(input) {
      calls.push(input);
      const rss = input.createSource({
        type: "rss",
        title: "Bangwu RSS",
        note: "Personal writing feed.",
        url: "https://bangwu.me/rss.xml",
        tags: ["blog", "rss"],
      });
      const text = input.createSource({
        type: "text",
        note: "fhafjak",
        tags: ["note"],
      });

      return {
        sources: [rss, text].filter((source): source is NonNullable<typeof source> => !!source),
        model: "test-model",
        fetchedUrls: 1,
      };
    },
  };
  const { app } = createTestApp({ sourceImportAssistant });

  const response = await app.request("/sources/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "https://bangwu.me/rss.xml\nfhafjak" }),
  });
  const result = (await response.json()) as {
    fetchedUrls: number;
    model: string;
    sources: DocumentSourceResponse[];
  };
  const listResponse = await app.request("/sources");
  const list = (await listResponse.json()) as DocumentSourceResponse[];

  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.message).toBe("https://bangwu.me/rss.xml\nfhafjak");
  expect(result.model).toBe("test-model");
  expect(result.fetchedUrls).toBe(1);
  expect(result.sources).toHaveLength(2);
  expect(result.sources[0]).toMatchObject({
    type: "rss",
    title: "Bangwu RSS",
    url: "https://bangwu.me/rss.xml",
    tags: ["blog", "rss"],
  });
  expect(result.sources[1]).toMatchObject({ type: "text", note: "fhafjak", tags: ["note"] });
  expect(list).toHaveLength(2);
});

test("returns source import route errors", async () => {
  const { app } = createTestApp({
    sourceImportAssistant: {
      async importSources() {
        throw new WritingAssistantConfigurationError();
      },
    },
  });

  const emptyResponse = await app.request("/sources/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  const malformedResponse = await app.request("/sources/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const unconfiguredResponse = await app.request("/sources/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "https://example.com" }),
  });

  expect(emptyResponse.status).toBe(400);
  await expect(emptyResponse.json()).resolves.toEqual({
    error: { message: "Source requires a file, URL, or note" },
  });
  expect(malformedResponse.status).toBe(400);
  await expect(malformedResponse.json()).resolves.toEqual({
    error: { message: "Invalid JSON body" },
  });
  expect(unconfiguredResponse.status).toBe(503);
  await expect(unconfiguredResponse.json()).resolves.toEqual({
    error: { message: "LLM is not configured" },
  });
});

test("generates writing assistance using document sources", async () => {
  const calls: Parameters<WritingAssistant["generate"]>[0][] = [];
  const writingAssistant: WritingAssistant = {
    async generate(input) {
      calls.push(input);
      return {
        suggestion: "Use the feed and note to expand the intro.",
        model: "test-model",
        usedSources: input.sources.length,
      };
    },
    async models() {
      return ["test-model"];
    },
    async stream(input) {
      calls.push(input);
      return {
        model: "test-model",
        stream: textStream("Use the feed and note to expand the intro."),
        usedSources: input.sources.length,
      };
    },
  };
  const { app } = createTestApp({ writingAssistant });
  const documentResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "Body" }),
  });
  const document = await readDocument(documentResponse);
  await app.request(`/documents/${document.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", title: "Research", note: "Use this context." }),
  });

  const response = await app.request(`/documents/${document.id}/assist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "Improve the opening" }),
  });
  const result = await response.json();
  const streamResponse = await app.request(`/documents/${document.id}/assist/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instruction: "Continue the opening",
      messages: [{ role: "user", content: "Make it sharper." }],
    }),
  });

  expect(response.status).toBe(200);
  expect(result).toEqual({
    suggestion: "Use the feed and note to expand the intro.",
    model: "test-model",
    usedSources: 1,
  });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.document).toMatchObject({ id: document.id, title: "Draft", content: "Body" });
  expect(calls[0]?.sources).toHaveLength(1);
  expect(calls[0]?.instruction).toBe("Improve the opening");
  expect(streamResponse.status).toBe(200);
  expect(streamResponse.headers.get("x-onlywrite-model")).toBe("test-model");
  expect(await streamResponse.text()).toBe("Use the feed and note to expand the intro.");
  expect(calls[1]?.instruction).toBe("Continue the opening");
  expect(calls[1]?.messages).toEqual([{ role: "user", content: "Make it sharper." }]);
});

test("requires signed approval before executing high risk agent tools", async () => {
  const writingAssistant: WritingAssistant = {
    async generate() {
      return { suggestion: "Noop", model: "test-model", usedSources: 0 };
    },
    async models() {
      return ["test-model"];
    },
    async stream(input) {
      const token = input.toolContext?.createApproval({
        input: { documentId: input.currentDocumentId },
        inputSummary: "delete current document",
        output: { message: "Approval required before this tool can execute." },
        risk: "high",
        toolName: "deleteDocument",
      });
      return {
        format: "events",
        model: "test-model",
        stream: textStream(
          JSON.stringify({
            type: "tool",
            delta: {
              approvalToken: token,
              inputSummary: "delete current document",
              risk: "high",
              state: "approval_required",
              toolCallId: "tool-1",
              toolName: "deleteDocument",
            },
          }) + "\n",
        ),
        usedSources: 0,
      };
    },
  };
  const { app } = createTestApp({ writingAssistant });
  const documentResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft" }),
  });
  const document = await readDocument(documentResponse);

  const streamResponse = await app.request("/agent/assist/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId: document.id, instruction: "Delete this document" }),
  });
  const events = streamResponse.text().then((body) =>
    body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { delta: { approvalToken: string } }),
  );
  const token = (await events)[0]?.delta.approvalToken ?? "";
  const tamperedResponse = await app.request("/agent/tools/execute-approved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalToken: token.slice(0, -1) + "x" }),
  });
  const approvedResponse = await app.request("/agent/tools/execute-approved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalToken: token }),
  });
  const missingResponse = await app.request(`/documents/${document.id}`);

  expect(streamResponse.status).toBe(200);
  expect(tamperedResponse.status).toBe(403);
  expect(approvedResponse.status).toBe(200);
  await expect(approvedResponse.json()).resolves.toMatchObject({
    output: { deleted: true, documentId: document.id },
    toolName: "deleteDocument",
  });
  expect(missingResponse.status).toBe(404);
});

test("agent tools resolve current document aliases", async () => {
  const writingAssistant: WritingAssistant = {
    async generate() {
      return { suggestion: "Noop", model: "test-model", usedSources: 0 };
    },
    async models() {
      return ["test-model"];
    },
    async stream(input) {
      const output = input.toolContext?.updateDocument("current", {
        content: "Updated through current alias",
        title: "Updated title",
      });
      return {
        format: "events",
        model: "test-model",
        stream: textStream(
          JSON.stringify({
            type: "tool",
            delta: {
              output,
              state: "result",
              toolCallId: "tool-1",
              toolName: "updateDocument",
            },
          }) + "\n",
        ),
        usedSources: 0,
      };
    },
  };
  const { app } = createTestApp({ writingAssistant });
  const documentResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "" }),
  });
  const document = await readDocument(documentResponse);

  const streamResponse = await app.request("/agent/assist/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId: document.id, instruction: "Update this document" }),
  });
  const updatedResponse = await app.request(`/documents/${document.id}`);
  const updated = await readDocument(updatedResponse);

  expect(streamResponse.status).toBe(200);
  expect(await streamResponse.text()).toContain("Updated through current alias");
  expect(updated).toMatchObject({
    content: "Updated through current alias",
    title: "Updated title",
  });
});

test("returns assistant route errors for missing documents and malformed JSON", async () => {
  const { app } = createTestApp({
    writingAssistant: {
      async generate() {
        return { suggestion: "Noop", model: "test-model", usedSources: 0 };
      },
      async models() {
        return ["test-model"];
      },
      async stream() {
        return { model: "test-model", stream: textStream("Noop"), usedSources: 0 };
      },
    },
  });

  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = await readDocument(documentResponse);
  const missingResponse = await app.request("/documents/missing/assist", { method: "POST" });
  const malformedResponse = await app.request(`/documents/${document.id}/assist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  expect(missingResponse.status).toBe(404);
  await expect(missingResponse.json()).resolves.toEqual({
    error: { message: "Document not found" },
  });
  expect(malformedResponse.status).toBe(400);
  await expect(malformedResponse.json()).resolves.toEqual({
    error: { message: "Invalid JSON body" },
  });
});

test("returns a JSON error when LLM is not configured", async () => {
  const { app } = createTestApp({
    writingAssistant: {
      async generate() {
        throw new WritingAssistantConfigurationError();
      },
      async models() {
        throw new WritingAssistantConfigurationError();
      },
      async stream() {
        throw new WritingAssistantConfigurationError();
      },
    },
  });
  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = await readDocument(documentResponse);

  const response = await app.request(`/documents/${document.id}/assist`, { method: "POST" });

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: { message: "LLM is not configured" },
  });
});

test("reads and updates application settings", async () => {
  const { app } = createTestApp();

  const initialResponse = await app.request("/settings");
  const updateResponse = await app.request("/settings/app", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      defaultDocumentTitle: "Research note",
      editorLineHeight: "compact",
      sourcePanelDefaultOpen: false,
    }),
  });
  const updatedResponse = await app.request("/settings");

  expect(initialResponse.status).toBe(200);
  await expect(initialResponse.json()).resolves.toMatchObject({
    app: {
      defaultDocumentTitle: "Untitled",
      editorLineHeight: "comfortable",
      sourcePanelDefaultOpen: true,
    },
  });
  expect(updateResponse.status).toBe(200);
  await expect(updateResponse.json()).resolves.toEqual({
    defaultDocumentTitle: "Research note",
    editorLineHeight: "compact",
    sourcePanelDefaultOpen: false,
  });
  await expect(updatedResponse.json()).resolves.toMatchObject({
    app: {
      defaultDocumentTitle: "Research note",
      editorLineHeight: "compact",
      sourcePanelDefaultOpen: false,
    },
  });
});

test("requires Logto management configuration before updating authenticated profiles", async () => {
  const { app } = createTestApp({
    authConfig: createAuthConfig({
      APP_BASE_URL: "http://localhost:5173",
      AUTH_SESSION_SECRET: "test-session-secret",
      LOGTO_APP_ID: "app-id",
      LOGTO_APP_SECRET: "app-secret",
      LOGTO_ISSUER: "https://auth.example.test/oidc",
      LOGTO_JWKS_URI: "https://auth.example.test/oidc/jwks",
    }),
  });

  const response = await app.request("/settings/profile", {
    method: "PATCH",
    headers: {
      authorization: "Bearer invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Updated" }),
  });

  expect(response.status).toBe(401);
});
