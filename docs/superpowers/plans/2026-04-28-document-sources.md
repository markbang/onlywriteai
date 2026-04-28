# Document Sources Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add document-level read-only information sources beside the OnlyWrite editor, plus clean up the noisy development workflow.

**Architecture:** Sources belong to a single document and are stored in SQLite through the API. The website accesses sources through TanStack Query and renders a persistent source panel next to the document editor. The feature stores metadata and user notes only; it does not fetch RSS, upload files, parse PDFs, run OCR, insert text into the editor, or build AI context.

**Tech Stack:** Vite+, Hono, Drizzle ORM, SQLite, React, TanStack Query, TanStack Router, UnoCSS, Vitest through `vite-plus/test`.

---

## File Structure

Create or modify these files:

- Modify: `apps/api/src/db/schema.ts`
  - Add `documentSources` table.
- Modify: `apps/api/src/db/client.ts`
  - Create the `document_sources` table at startup.
- Modify: `apps/api/src/documents/repository.ts`
  - Add source CRUD functions.
  - Delete sources when deleting a document.
- Modify: `apps/api/src/documents/repository.test.ts`
  - Add source repository tests.
- Modify: `apps/api/src/app.ts`
  - Add nested source routes under documents.
  - Add source input validation.
- Modify: `apps/api/src/app.test.ts`
  - Add source route tests.
- Modify: `apps/website/src/api/documents.ts`
  - Add source client types and functions.
- Modify: `apps/website/src/api/documents.test.ts`
  - Add source client tests.
- Create: `apps/website/src/components/SourcePanel.tsx`
  - Source list, form, create/update/delete UI.
- Create: `apps/website/src/components/SourcePanel.test.tsx`
  - Component tests for source panel behavior.
- Modify: `apps/website/src/routes/DocumentRoute.tsx`
  - Render source panel beside editor.
- Modify: `apps/website/src/router.test.tsx`
  - Assert the document workspace contains editor and source panel.
- Create: `apps/website/uno.config.ts`
  - Explicit UnoCSS config to remove missing-config warning.
- Modify: `package.json`
  - Change root `dev` to start only website and API.
- Modify: `README.md`
  - Clarify dev command starts website and API.

## Task 1: Source Persistence

**Files:**

- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/client.ts`
- Modify: `apps/api/src/documents/repository.ts`
- Modify: `apps/api/src/documents/repository.test.ts`

- [ ] **Step 1: Write failing source repository tests**

Append these tests to `apps/api/src/documents/repository.test.ts`:

```ts
test("creates, lists, updates, and deletes document sources", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft", content: "Body" });

  const created = repository.createSource(document.id, {
    type: "rss",
    title: "Feed",
    note: "Useful context",
    url: "https://example.com/feed.xml",
  });
  expect(created).not.toBeNull();
  if (!created) {
    throw new Error("Expected source to be created");
  }

  const listed = repository.listSources(document.id);
  const updated = repository.updateSource(document.id, created.id, {
    title: "Updated feed",
    note: "Updated context",
    fileName: "ignored.pdf",
  });
  expect(updated).not.toBeNull();
  if (!updated) {
    throw new Error("Expected source to be updated");
  }

  const deleted = repository.deleteSource(document.id, created.id);
  const listedAfterDelete = repository.listSources(document.id);

  expect(created).toMatchObject({
    documentId: document.id,
    type: "rss",
    title: "Feed",
    note: "Useful context",
    url: "https://example.com/feed.xml",
    fileName: null,
  });
  expect(listed).toHaveLength(1);
  expect(updated).toMatchObject({
    id: created.id,
    title: "Updated feed",
    note: "Updated context",
    url: "https://example.com/feed.xml",
    fileName: "ignored.pdf",
  });
  expect(deleted).toBe(true);
  expect(listedAfterDelete).toEqual([]);
});

test("normalizes source defaults and nullable fields", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({});

  const source = repository.createSource(document.id, {
    type: "pdf",
    title: "   ",
    url: "   ",
    fileName: " notes.pdf ",
  });
  expect(source).not.toBeNull();
  if (!source) {
    throw new Error("Expected source to be created");
  }

  expect(source.title).toBe("Untitled source");
  expect(source.note).toBe("");
  expect(source.url).toBeNull();
  expect(source.fileName).toBe("notes.pdf");
});

test("returns empty source list for missing documents and null or false for missing sources", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({});

  expect(repository.listSources("missing")).toEqual([]);
  expect(repository.createSource("missing", { type: "text", title: "Nope" })).toBeNull();
  expect(repository.updateSource(document.id, "missing", { title: "Nope" })).toBeNull();
  expect(repository.deleteSource(document.id, "missing")).toBe(false);
});

test("deleting a document deletes its sources", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({});
  const source = repository.createSource(document.id, { type: "image", fileName: "photo.png" });

  expect(source).not.toBeNull();
  expect(repository.delete(document.id)).toBe(true);
  expect(repository.listSources(document.id)).toEqual([]);
});

test("lists sources by newest update with a deterministic tie breaker", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({});
  const originalDateNow = Date.now;
  Date.now = () => 123_456;

  try {
    const first = repository.createSource(document.id, { type: "text", title: "First" });
    const second = repository.createSource(document.id, { type: "text", title: "Second" });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      throw new Error("Expected sources to be created");
    }

    expect(repository.listSources(document.id).map((source) => source.id)).toEqual([
      second.id,
      first.id,
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});
```

- [ ] **Step 2: Run repository tests to verify RED**

Run:

```bash
vp run api#test -- src/documents/repository.test.ts
```

Expected: FAIL because `createSource`, `listSources`, `updateSource`, and `deleteSource` are not defined.

- [ ] **Step 3: Add source schema**

Update `apps/api/src/db/schema.ts`:

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const documentSources = sqliteTable("document_sources", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  note: text("note").notNull(),
  url: text("url"),
  fileName: text("file_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
export type DocumentSourceRecord = typeof documentSources.$inferSelect;
export type NewDocumentSourceRecord = typeof documentSources.$inferInsert;
```

- [ ] **Step 4: Create source table at startup**

Update `apps/api/src/db/client.ts` so `sqlite.exec()` creates both tables:

```ts
sqlite.exec(`
  create table if not exists documents (
    id text primary key,
    title text not null,
    content text not null,
    created_at integer not null,
    updated_at integer not null
  );

  create table if not exists document_sources (
    id text primary key,
    document_id text not null,
    type text not null,
    title text not null,
    note text not null,
    url text,
    file_name text,
    created_at integer not null,
    updated_at integer not null
  );
`);
```

- [ ] **Step 5: Implement source repository functions**

Update imports in `apps/api/src/documents/repository.ts`:

```ts
import { desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.ts";
import {
  documentSources,
  documents,
  type DocumentRecord,
  type DocumentSourceRecord,
} from "../db/schema.ts";
```

Add types and helpers:

```ts
export type SourceType = "text" | "rss" | "pdf" | "image";

export type SourceInput = {
  type: SourceType;
  title?: string | null;
  note?: string | null;
  url?: string | null;
  fileName?: string | null;
};

export type SourceUpdate = Partial<SourceInput>;

function normalizeSourceTitle(title: string | null | undefined) {
  const trimmed = title?.trim();
  return trimmed ? trimmed : "Untitled source";
}

function normalizeOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
```

Add these methods inside the returned repository object:

```ts
listSources(documentId: string): DocumentSourceRecord[] {
  if (!this.findById(documentId)) {
    return [];
  }

  return db
    .select()
    .from(documentSources)
    .where(eq(documentSources.documentId, documentId))
    .orderBy(desc(documentSources.updatedAt), sql`rowid desc`);
},

createSource(documentId: string, input: SourceInput): DocumentSourceRecord | null {
  if (!this.findById(documentId)) {
    return null;
  }

  const now = Date.now();
  const record = {
    id: crypto.randomUUID(),
    documentId,
    type: input.type,
    title: normalizeSourceTitle(input.title),
    note: input.note ?? "",
    url: normalizeOptional(input.url),
    fileName: normalizeOptional(input.fileName),
    createdAt: now,
    updatedAt: now,
  };

  db.insert(documentSources).values(record).run();
  return record;
},

updateSource(
  documentId: string,
  sourceId: string,
  input: SourceUpdate,
): DocumentSourceRecord | null {
  const existing =
    db
      .select()
      .from(documentSources)
      .where(eq(documentSources.id, sourceId))
      .get() ?? null;

  if (!existing || existing.documentId !== documentId || !this.findById(documentId)) {
    return null;
  }

  const next = {
    type: input.type ?? existing.type,
    title: input.title === undefined ? existing.title : normalizeSourceTitle(input.title),
    note: input.note ?? existing.note,
    url: input.url === undefined ? existing.url : normalizeOptional(input.url),
    fileName:
      input.fileName === undefined ? existing.fileName : normalizeOptional(input.fileName),
    updatedAt: Date.now(),
  };

  db.update(documentSources).set(next).where(eq(documentSources.id, sourceId)).run();
  return db.select().from(documentSources).where(eq(documentSources.id, sourceId)).get() ?? null;
},

deleteSource(documentId: string, sourceId: string): boolean {
  const existing =
    db
      .select()
      .from(documentSources)
      .where(eq(documentSources.id, sourceId))
      .get() ?? null;

  if (!existing || existing.documentId !== documentId || !this.findById(documentId)) {
    return false;
  }

  const result = db.delete(documentSources).where(eq(documentSources.id, sourceId)).run();
  return result.changes > 0;
},
```

Update existing `delete(id)` so it removes source rows before deleting the document:

```ts
delete(id: string): boolean {
  db.delete(documentSources).where(eq(documentSources.documentId, id)).run();
  const result = db.delete(documents).where(eq(documents.id, id)).run();
  return result.changes > 0;
},
```

- [ ] **Step 6: Run repository tests to verify GREEN**

Run:

```bash
vp run api#test -- src/documents/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run API checks**

Run:

```bash
vp run api#test
vp check
```

Expected: PASS.

- [ ] **Step 8: Commit source persistence**

Run:

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/client.ts apps/api/src/documents/repository.ts apps/api/src/documents/repository.test.ts
git commit -m "feat(api): add document source persistence"
```

## Task 2: Source API Routes

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write failing source route tests**

Append these tests to `apps/api/src/app.test.ts`:

```ts
test("creates, lists, updates, and deletes document sources through the API", async () => {
  const { app, close } = createTestApp();
  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = (await documentResponse.json()) as { id: string };

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
  const created = (await createResponse.json()) as { id: string; title: string; url: string };

  const listResponse = await app.request(`/documents/${document.id}/sources`);
  const list = (await listResponse.json()) as Array<{ id: string; title: string }>;

  const updateResponse = await app.request(`/documents/${document.id}/sources/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Updated feed", fileName: "feed.pdf" }),
  });
  const updated = (await updateResponse.json()) as { title: string; fileName: string };

  const deleteResponse = await app.request(`/documents/${document.id}/sources/${created.id}`, {
    method: "DELETE",
  });
  const listAfterDeleteResponse = await app.request(`/documents/${document.id}/sources`);
  const listAfterDelete = await listAfterDeleteResponse.json();

  close();

  expect(createResponse.status).toBe(201);
  expect(created).toMatchObject({ title: "Feed", url: "https://example.com/feed.xml" });
  expect(list).toHaveLength(1);
  expect(updated).toMatchObject({ title: "Updated feed", fileName: "feed.pdf" });
  expect(deleteResponse.status).toBe(204);
  expect(listAfterDelete).toEqual([]);
});

test("returns source route errors for invalid input and missing records", async () => {
  const { app, close } = createTestApp();
  const documentResponse = await app.request("/documents", { method: "POST" });
  const document = (await documentResponse.json()) as { id: string };

  const invalidTypeResponse = await app.request(`/documents/${document.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "video" }),
  });
  const invalidJsonResponse = await app.request(`/documents/${document.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const missingDocumentResponse = await app.request("/documents/missing/sources");
  const missingSourceResponse = await app.request(`/documents/${document.id}/sources/missing`);

  close();

  expect(invalidTypeResponse.status).toBe(400);
  await expect(invalidTypeResponse.json()).resolves.toEqual({
    error: { message: "Invalid source type" },
  });
  expect(invalidJsonResponse.status).toBe(400);
  expect(missingDocumentResponse.status).toBe(404);
  expect(missingSourceResponse.status).toBe(404);
});
```

- [ ] **Step 2: Run route tests to verify RED**

Run:

```bash
vp run api#test -- src/app.test.ts
```

Expected: FAIL because source routes do not exist.

- [ ] **Step 3: Add source validation helpers**

Add to `apps/api/src/app.ts`:

```ts
const sourceNotFoundError = { error: { message: "Source not found" } };
const invalidSourceTypeError = { error: { message: "Invalid source type" } };
const sourceTypes = new Set(["text", "rss", "pdf", "image"]);

function readSourceInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return { ok: false as const };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || !sourceTypes.has(record.type)) {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    value: {
      type: record.type as "text" | "rss" | "pdf" | "image",
      title: typeof record.title === "string" ? record.title : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    },
  };
}

function readSourcePatch(value: unknown) {
  if (!value || typeof value !== "object") {
    return { ok: true as const, value: {} };
  }

  const record = value as Record<string, unknown>;
  if (
    record.type !== undefined &&
    (typeof record.type !== "string" || !sourceTypes.has(record.type))
  ) {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    value: {
      type: record.type as "text" | "rss" | "pdf" | "image" | undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    },
  };
}
```

- [ ] **Step 4: Add source routes**

Add these routes inside `createApp()` before `return app`:

```ts
app.get("/documents/:documentId/sources", (c) => {
  const documentId = c.req.param("documentId");
  if (!repository.findById(documentId)) {
    return c.json(notFoundError, 404);
  }

  return c.json(repository.listSources(documentId));
});

app.post("/documents/:documentId/sources", async (c) => {
  const documentId = c.req.param("documentId");
  if (!repository.findById(documentId)) {
    return c.json(notFoundError, 404);
  }

  const body = await readJson(c);
  if (!body.ok) {
    return c.json(invalidJsonError, 400);
  }

  const input = readSourceInput(body.value);
  if (!input.ok) {
    return c.json(invalidSourceTypeError, 400);
  }

  const source = repository.createSource(documentId, input.value);
  if (!source) {
    return c.json(notFoundError, 404);
  }

  return c.json(source, 201);
});

app.patch("/documents/:documentId/sources/:sourceId", async (c) => {
  const documentId = c.req.param("documentId");
  if (!repository.findById(documentId)) {
    return c.json(notFoundError, 404);
  }

  const body = await readJson(c);
  if (!body.ok) {
    return c.json(invalidJsonError, 400);
  }

  const input = readSourcePatch(body.value);
  if (!input.ok) {
    return c.json(invalidSourceTypeError, 400);
  }

  const source = repository.updateSource(documentId, c.req.param("sourceId"), input.value);
  if (!source) {
    return c.json(sourceNotFoundError, 404);
  }

  return c.json(source);
});

app.delete("/documents/:documentId/sources/:sourceId", (c) => {
  const documentId = c.req.param("documentId");
  if (!repository.findById(documentId)) {
    return c.json(notFoundError, 404);
  }

  const deleted = repository.deleteSource(documentId, c.req.param("sourceId"));
  if (!deleted) {
    return c.json(sourceNotFoundError, 404);
  }

  return c.body(null, 204);
});
```

- [ ] **Step 5: Run API tests**

Run:

```bash
vp run api#test -- src/app.test.ts
vp run api#test
vp check
```

Expected: PASS.

- [ ] **Step 6: Commit source routes**

Run:

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat(api): add document source routes"
```

## Task 3: Website Source API Client

**Files:**

- Modify: `apps/website/src/api/documents.ts`
- Modify: `apps/website/src/api/documents.test.ts`

- [ ] **Step 1: Write failing source client tests**

Append to `apps/website/src/api/documents.test.ts`:

```ts
test("calls source endpoints with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({
      id: "source-1",
      documentId: "doc-1",
      type: "text",
      title: "Source",
      note: "Note",
      url: null,
      fileName: null,
      createdAt: 1,
      updatedAt: 1,
    });
  };

  await listDocumentSources("doc-1", fetcher);
  await createDocumentSource(
    "doc-1",
    { type: "rss", title: "Feed", url: "https://example.com/rss" },
    fetcher,
  );
  await updateDocumentSource("doc-1", "source-1", { note: "Updated" }, fetcher);
  await deleteDocumentSource("doc-1", "source-1", fetcher);

  expect(calls).toEqual([
    { url: "/api/documents/doc-1/sources", method: "GET", body: undefined },
    {
      url: "/api/documents/doc-1/sources",
      method: "POST",
      body: JSON.stringify({ type: "rss", title: "Feed", url: "https://example.com/rss" }),
    },
    {
      url: "/api/documents/doc-1/sources/source-1",
      method: "PATCH",
      body: JSON.stringify({ note: "Updated" }),
    },
    { url: "/api/documents/doc-1/sources/source-1", method: "DELETE", body: undefined },
  ]);
});
```

Update the import in the test to include:

```ts
createDocumentSource,
deleteDocumentSource,
listDocumentSources,
updateDocumentSource,
```

- [ ] **Step 2: Run client tests to verify RED**

Run:

```bash
vp run website#test -- src/api/documents.test.ts
```

Expected: FAIL because source client functions do not exist.

- [ ] **Step 3: Add source client types and functions**

Append to `apps/website/src/api/documents.ts`:

```ts
export type DocumentSourceType = "text" | "rss" | "pdf" | "image";

export type DocumentSource = {
  id: string;
  documentId: string;
  type: DocumentSourceType;
  title: string;
  note: string;
  url: string | null;
  fileName: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DocumentSourceInput = {
  type: DocumentSourceType;
  title?: string;
  note?: string;
  url?: string;
  fileName?: string;
};

export type DocumentSourceUpdate = Partial<DocumentSourceInput>;

export function listDocumentSources(documentId: string, fetcher?: typeof fetch) {
  return request<DocumentSource[]>(`/documents/${documentId}/sources`, {}, fetcher);
}

export function createDocumentSource(
  documentId: string,
  input: DocumentSourceInput,
  fetcher?: typeof fetch,
) {
  return request<DocumentSource>(
    `/documents/${documentId}/sources`,
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

export function updateDocumentSource(
  documentId: string,
  sourceId: string,
  input: DocumentSourceUpdate,
  fetcher?: typeof fetch,
) {
  return request<DocumentSource>(
    `/documents/${documentId}/sources/${sourceId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function deleteDocumentSource(documentId: string, sourceId: string, fetcher?: typeof fetch) {
  return request<void>(
    `/documents/${documentId}/sources/${sourceId}`,
    { method: "DELETE" },
    fetcher,
  );
}
```

- [ ] **Step 4: Run website API tests**

Run:

```bash
vp run website#test -- src/api/documents.test.ts
vp check
```

Expected: PASS.

- [ ] **Step 5: Commit source client**

Run:

```bash
git add apps/website/src/api/documents.ts apps/website/src/api/documents.test.ts
git commit -m "feat(website): add source api client"
```

## Task 4: Source Panel And Document Workspace

**Files:**

- Create: `apps/website/src/components/SourcePanel.tsx`
- Create: `apps/website/src/components/SourcePanel.test.tsx`
- Modify: `apps/website/src/routes/DocumentRoute.tsx`
- Modify: `apps/website/src/router.test.tsx`

- [ ] **Step 1: Write failing SourcePanel tests**

Create `apps/website/src/components/SourcePanel.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { createQueryClient } from "../query.ts";
import { SourcePanel } from "./SourcePanel.tsx";
import {
  createDocumentSource,
  deleteDocumentSource,
  listDocumentSources,
  updateDocumentSource,
} from "../api/documents.ts";

vi.mock("../api/documents.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/documents.ts")>()),
  listDocumentSources: vi.fn(),
  createDocumentSource: vi.fn(),
  updateDocumentSource: vi.fn(),
  deleteDocumentSource: vi.fn(),
}));

function renderPanel() {
  const queryClient = createQueryClient();
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <SourcePanel documentId="doc-1" />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

test("renders an empty source state", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([]);

  renderPanel();

  expect(await screen.findByText("No sources yet.")).toBeTruthy();
});

test("renders source list items", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([
    {
      id: "source-1",
      documentId: "doc-1",
      type: "rss",
      title: "Research feed",
      note: "Track this feed.",
      url: "https://example.com/rss",
      fileName: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);

  renderPanel();

  expect(await screen.findByText("Research feed")).toBeTruthy();
  expect(screen.getByText("RSS")).toBeTruthy();
  expect(screen.getByText("Track this feed.")).toBeTruthy();
});

test("creates a source", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([]);
  vi.mocked(createDocumentSource).mockResolvedValue({
    id: "source-1",
    documentId: "doc-1",
    type: "text",
    title: "Quote",
    note: "Useful quote",
    url: null,
    fileName: null,
    createdAt: 1,
    updatedAt: 1,
  });

  renderPanel();

  fireEvent.change(await screen.findByLabelText("Source title"), {
    target: { value: "Quote" },
  });
  fireEvent.change(screen.getByLabelText("Source note"), {
    target: { value: "Useful quote" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add source" }));

  await waitFor(() =>
    expect(createDocumentSource).toHaveBeenCalledWith("doc-1", {
      type: "text",
      title: "Quote",
      note: "Useful quote",
      url: undefined,
      fileName: undefined,
    }),
  );
});

test("shows type-specific URL and file name fields", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([]);

  renderPanel();

  fireEvent.change(await screen.findByLabelText("Source type"), { target: { value: "rss" } });
  expect(screen.getByLabelText("Source URL")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "pdf" } });
  expect(screen.getByLabelText("File name")).toBeTruthy();
});

test("updates and deletes a source", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([
    {
      id: "source-1",
      documentId: "doc-1",
      type: "text",
      title: "Old title",
      note: "Old note",
      url: null,
      fileName: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  vi.mocked(updateDocumentSource).mockResolvedValue({
    id: "source-1",
    documentId: "doc-1",
    type: "text",
    title: "New title",
    note: "Old note",
    url: null,
    fileName: null,
    createdAt: 1,
    updatedAt: 2,
  });
  vi.mocked(deleteDocumentSource).mockResolvedValue(undefined);

  renderPanel();

  fireEvent.click(await screen.findByRole("button", { name: "Edit Old title" }));
  fireEvent.change(screen.getByLabelText("Source title"), { target: { value: "New title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save source" }));
  await waitFor(() =>
    expect(updateDocumentSource).toHaveBeenCalledWith("doc-1", "source-1", {
      type: "text",
      title: "New title",
      note: "Old note",
      url: undefined,
      fileName: undefined,
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Delete Old title" }));
  await waitFor(() => expect(deleteDocumentSource).toHaveBeenCalledWith("doc-1", "source-1"));
});
```

- [ ] **Step 2: Run SourcePanel tests to verify RED**

Run:

```bash
vp run website#test -- src/components/SourcePanel.test.tsx
```

Expected: FAIL because `SourcePanel.tsx` does not exist.

- [ ] **Step 3: Implement SourcePanel**

Create `apps/website/src/components/SourcePanel.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createDocumentSource,
  deleteDocumentSource,
  listDocumentSources,
  updateDocumentSource,
  type DocumentSource,
  type DocumentSourceType,
} from "../api/documents.ts";

type SourcePanelProps = {
  documentId: string;
};

type SourceFormState = {
  type: DocumentSourceType;
  title: string;
  note: string;
  url: string;
  fileName: string;
};

const emptyForm: SourceFormState = {
  type: "text",
  title: "",
  note: "",
  url: "",
  fileName: "",
};

const typeLabels: Record<DocumentSourceType, string> = {
  text: "Text",
  rss: "RSS",
  pdf: "PDF",
  image: "Image",
};

function toForm(source: DocumentSource): SourceFormState {
  return {
    type: source.type,
    title: source.title,
    note: source.note,
    url: source.url ?? "",
    fileName: source.fileName ?? "",
  };
}

function formatDate(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export function SourcePanel({ documentId }: SourcePanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SourceFormState>(emptyForm);
  const [editingSource, setEditingSource] = useState<DocumentSource | null>(null);
  const sources = useQuery({
    queryKey: ["documentSources", documentId],
    queryFn: () => listDocumentSources(documentId),
  });

  const createSource = useMutation({
    mutationFn: () =>
      createDocumentSource(documentId, {
        type: form.type,
        title: form.title,
        note: form.note,
        url: form.url || undefined,
        fileName: form.fileName || undefined,
      }),
    onSuccess: async () => {
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ["documentSources", documentId] });
    },
  });

  const updateSource = useMutation({
    mutationFn: () => {
      if (!editingSource) {
        throw new Error("No source selected");
      }
      return updateDocumentSource(documentId, editingSource.id, {
        type: form.type,
        title: form.title,
        note: form.note,
        url: form.url || undefined,
        fileName: form.fileName || undefined,
      });
    },
    onSuccess: async () => {
      setEditingSource(null);
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ["documentSources", documentId] });
    },
  });

  const deleteSource = useMutation({
    mutationFn: (sourceId: string) => deleteDocumentSource(documentId, sourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documentSources", documentId] });
    },
  });

  function startEditing(source: DocumentSource) {
    setEditingSource(source);
    setForm(toForm(source));
  }

  function cancelEditing() {
    setEditingSource(null);
    setForm(emptyForm);
  }

  const submitLabel = editingSource ? "Save source" : "Add source";
  const isSubmitting = createSource.isPending || updateSource.isPending;
  const showUrl = form.type === "rss";
  const showFileName = form.type === "pdf" || form.type === "image";

  return (
    <aside className="rounded border border-stone-200 bg-white p-4">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-neutral-950">Sources</h2>
        <p className="mt-1 text-sm text-neutral-500">Read-only context for this document.</p>
      </div>

      <form
        className="mb-5 flex flex-col gap-3 border-b border-stone-200 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (editingSource) {
            updateSource.mutate();
          } else {
            createSource.mutate();
          }
        }}
      >
        <label className="text-sm font-medium text-neutral-700">
          Source type
          <select
            className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-2"
            value={form.type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type: event.currentTarget.value as DocumentSourceType,
              }))
            }
          >
            <option value="text">Text</option>
            <option value="rss">RSS</option>
            <option value="pdf">PDF</option>
            <option value="image">Image</option>
          </select>
        </label>
        <label className="text-sm font-medium text-neutral-700">
          Source title
          <input
            className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.currentTarget.value }))
            }
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          Source note
          <textarea
            className="mt-1 min-h-24 w-full resize-y rounded border border-stone-300 px-2 py-2"
            value={form.note}
            onChange={(event) =>
              setForm((current) => ({ ...current, note: event.currentTarget.value }))
            }
          />
        </label>
        {showUrl ? (
          <label className="text-sm font-medium text-neutral-700">
            Source URL
            <input
              className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
              value={form.url}
              onChange={(event) =>
                setForm((current) => ({ ...current, url: event.currentTarget.value }))
              }
            />
          </label>
        ) : null}
        {showFileName ? (
          <label className="text-sm font-medium text-neutral-700">
            File name
            <input
              className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
              value={form.fileName}
              onChange={(event) =>
                setForm((current) => ({ ...current, fileName: event.currentTarget.value }))
              }
            />
          </label>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-neutral-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
          >
            {submitLabel}
          </button>
          {editingSource ? (
            <button
              type="button"
              className="rounded border border-stone-300 px-3 py-2 text-sm text-neutral-700"
              onClick={cancelEditing}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {sources.isLoading ? <p className="text-sm text-neutral-500">Loading sources...</p> : null}
      {sources.isError ? <p className="text-sm text-red-700">Could not load sources.</p> : null}
      {sources.data?.length === 0 ? (
        <p className="text-sm text-neutral-500">No sources yet.</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {sources.data?.map((source) => (
          <article key={source.id} className="rounded border border-stone-200 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <span className="text-xs font-semibold uppercase text-neutral-500">
                  {typeLabels[source.type]}
                </span>
                <h3 className="break-words text-sm font-semibold text-neutral-950">
                  {source.title}
                </h3>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="text-xs text-neutral-600 underline"
                  onClick={() => startEditing(source)}
                  aria-label={`Edit ${source.title}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs text-red-700 underline"
                  onClick={() => deleteSource.mutate(source.id)}
                  aria-label={`Delete ${source.title}`}
                >
                  Delete
                </button>
              </div>
            </div>
            {source.note ? (
              <p className="whitespace-pre-wrap break-words text-sm text-neutral-700">
                {source.note}
              </p>
            ) : null}
            {source.url ? (
              <p className="mt-2 break-words text-xs text-neutral-500">{source.url}</p>
            ) : null}
            {source.fileName ? (
              <p className="mt-2 break-words text-xs text-neutral-500">{source.fileName}</p>
            ) : null}
            <p className="mt-2 text-xs text-neutral-400">{formatDate(source.updatedAt)}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Update document route workspace**

Update `apps/website/src/routes/DocumentRoute.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { SourcePanel } from "../components/SourcePanel.tsx";
import { getDocument } from "../api/documents.ts";
import { DocumentEditor } from "../components/DocumentEditor.tsx";

export function DocumentRoute() {
  const { documentId } = useParams({ from: "/documents/$documentId" });
  const document = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId),
  });

  if (document.isLoading) {
    return <p className="text-sm text-neutral-500">Loading document...</p>;
  }

  if (document.isError || !document.data) {
    return <p className="text-sm text-red-700">Could not load this document.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <SourcePanel documentId={documentId} />
      <DocumentEditor document={document.data} />
    </div>
  );
}
```

- [ ] **Step 5: Update route smoke test**

In `apps/website/src/router.test.tsx`, add a test that renders a document route with mocked document and sources:

```tsx
test("renders document workspace with sources and editor", async () => {
  vi.mocked(getDocument).mockResolvedValue({
    id: "doc-1",
    title: "Draft",
    content: "Body",
    createdAt: 1,
    updatedAt: 1,
  });
  vi.mocked(listDocumentSources).mockResolvedValue([]);

  renderRoute("/documents/doc-1");

  expect(await screen.findByText("Sources")).toBeTruthy();
  expect(await screen.findByDisplayValue("Draft")).toBeTruthy();
});
```

If `router.test.tsx` does not already mock `getDocument`, update its API mock to include `listDocumentSources` and `getDocument`.

- [ ] **Step 6: Run website tests**

Run:

```bash
vp run website#test -- src/components/SourcePanel.test.tsx src/router.test.tsx
vp run website#test
vp check
```

Expected: PASS.

- [ ] **Step 7: Commit source panel**

Run:

```bash
git add apps/website/src/components/SourcePanel.tsx apps/website/src/components/SourcePanel.test.tsx apps/website/src/routes/DocumentRoute.tsx apps/website/src/router.test.tsx
git commit -m "feat(website): add document source panel"
```

## Task 5: Dev Workflow And Final Verification

**Files:**

- Modify: `package.json`
- Create: `apps/website/uno.config.ts`
- Modify: `README.md`

- [ ] **Step 1: Update root dev script**

Change root `package.json`:

```json
"dev": "vp run --parallel -F website -F api dev"
```

Do not use recursive `-r` for dev because it starts `packages/utils#dev`.

- [ ] **Step 2: Add explicit UnoCSS config**

Create `apps/website/uno.config.ts`:

```ts
import { defineConfig } from "unocss";

export default defineConfig({});
```

- [ ] **Step 3: Update README**

Update the development section in `README.md` so it includes this text:

```md
Run website and API with `vp run dev`.

This starts `apps/website` and `apps/api`. The utility package is not watched during app development.
```

Keep the existing verification commands:

```bash
vp check
vp run -r test
vp run -r build
```

- [ ] **Step 4: Run full verification**

Run:

```bash
vp check
vp run -r test
vp run -r build
```

Expected: PASS.

- [ ] **Step 5: Verify dev server output**

Run:

```bash
vp run dev
```

Expected:

```text
~/apps/api$ vp exec tsx src/server.ts
~/apps/website$ vp dev
OnlyWrite API listening on http://localhost:8787
Local: http://localhost:5173/
```

Expected not to appear:

```text
~/packages/utils$ vp pack --watch
[@unocss/config] Config file not found
```

Stop the dev server before continuing.

- [ ] **Step 6: Manual product verification**

In the browser:

1. Open `http://localhost:5173/`.
2. Create a document.
3. Open the document editor.
4. Confirm the source panel is visible next to the editor on desktop.
5. Add a text source with title and note.
6. Add an RSS source with URL and note.
7. Add a PDF source with file name and note.
8. Add an image source with file name and note.
9. Edit one source.
10. Delete one source.
11. Save the document body independently.
12. Delete the document.
13. Confirm returning to the documents list and no source errors occur.

- [ ] **Step 7: Final verification**

Run:

```bash
vp check
vp run -r test
vp run -r build
```

Expected: PASS.

- [ ] **Step 8: Commit workflow changes**

Run:

```bash
git add package.json apps/website/uno.config.ts README.md
git commit -m "chore: streamline app development workflow"
```

If source implementation changes are still uncommitted because a prior task batched them, include only files that belong to this task in this commit.

## Self-Review

Spec coverage:

- Document-level source persistence is covered by Task 1.
- Source API routes and errors are covered by Task 2.
- Website source API client is covered by Task 3.
- Persistent split-pane source panel is covered by Task 4.
- Read-only source behavior is maintained because SourcePanel never calls document update APIs.
- Source cleanup on document delete is covered by Task 1.
- Root dev script and UnoCSS config warning cleanup are covered by Task 5.
- Final verification and manual flow are covered by Task 5.

Placeholder scan:

- No TBD, TODO, or unspecified implementation steps remain.

Type consistency:

- Source type names are consistently `text`, `rss`, `pdf`, and `image`.
- Source fields are consistently `id`, `documentId`, `type`, `title`, `note`, `url`, `fileName`, `createdAt`, and `updatedAt`.
- Query key is consistently `["documentSources", documentId]`.
- API paths consistently use `/documents/:documentId/sources` and `/documents/:documentId/sources/:sourceId`.
