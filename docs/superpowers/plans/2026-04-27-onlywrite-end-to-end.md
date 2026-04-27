# OnlyWrite End-to-End Starter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin, working OnlyWrite writing app across `apps/website` and `apps/api`, with React + TanStack Router + TanStack Query + UnoCSS on the frontend and Hono + Drizzle + SQLite on the backend.

**Architecture:** `apps/website` owns the browser UI and talks to `apps/api` over HTTP. `apps/api` owns validation, document persistence, timestamps, and JSON error responses. SQLite is local-only for the first slice.

**Tech Stack:** Vite+, React, TanStack Router, TanStack Query, UnoCSS, Hono, Drizzle ORM, SQLite via `better-sqlite3`, Vitest through `vite-plus/test`.

---

## File Structure

Create or modify these files:

- Modify: `package.json`
  - Make root `dev` run both apps through Vite+ tasks.
  - Keep `ready` as check, tests, and builds.
- Modify: `.gitignore`
  - Ignore `.superpowers/` and `apps/api/data/`.
- Modify: `apps/website/package.json`
  - Add React, TanStack, UnoCSS, and test dependencies.
  - Keep `dev`, `build`, and `preview` scripts.
- Modify: `apps/website/tsconfig.json`
  - Add React JSX support and test types.
- Modify: `apps/website/vite.config.ts`
  - Add React and UnoCSS plugins.
  - Proxy `/api` to local Hono dev server.
- Replace: `apps/website/src/main.ts`
  - Rename to `apps/website/src/main.tsx`.
  - Mount React app.
- Delete: `apps/website/src/counter.ts`
  - Starter-only code.
- Replace: `apps/website/src/style.css`
  - Small global base styles only.
- Create: `apps/website/src/router.tsx`
  - TanStack Router route tree.
- Create: `apps/website/src/query.ts`
  - Query client setup.
- Create: `apps/website/src/api/documents.ts`
  - Website API client and types.
- Create: `apps/website/src/api/documents.test.ts`
  - API client tests with injected `fetch`.
- Create: `apps/website/src/components/AppLayout.tsx`
  - Root app shell and health indicator.
- Create: `apps/website/src/components/DocumentEditor.tsx`
  - Title/body editor with save and delete actions.
- Create: `apps/website/src/components/DocumentEditor.test.tsx`
  - Focused React behavior tests.
- Create: `apps/website/src/routes/HomeRoute.tsx`
  - Focused editor landing and empty state.
- Create: `apps/website/src/routes/DocumentsRoute.tsx`
  - Document library.
- Create: `apps/website/src/routes/DocumentRoute.tsx`
  - Editor for one document.
- Create: `apps/api/package.json`
  - API app metadata, scripts, and dependencies.
- Create: `apps/api/tsconfig.json`
  - Node TypeScript config.
- Create: `apps/api/vite.config.ts`
  - Vite+ test/check config for the API app.
- Create: `apps/api/src/db/schema.ts`
  - Drizzle `documents` table.
- Create: `apps/api/src/db/client.ts`
  - SQLite database factory and schema initialization.
- Create: `apps/api/src/documents/repository.ts`
  - Document CRUD functions.
- Create: `apps/api/src/documents/repository.test.ts`
  - Repository tests against isolated temporary SQLite files.
- Create: `apps/api/src/app.ts`
  - Testable Hono app factory and routes.
- Create: `apps/api/src/app.test.ts`
  - Hono route tests using `app.request()`.
- Create: `apps/api/src/server.ts`
  - Node server entrypoint for local dev.

## Task 1: Workspace Dependencies And Baseline Config

**Files:**

- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `apps/website/package.json`
- Modify: `apps/website/tsconfig.json`
- Create: `apps/website/vite.config.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vite.config.ts`

- [ ] **Step 1: Add the API package manifest**

Create `apps/api/package.json`:

```json
{
  "name": "api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vp exec tsx src/server.ts",
    "build": "tsc --noEmit",
    "test": "vp test",
    "check": "vp check"
  },
  "dependencies": {
    "@hono/node-server": "^1.14.4",
    "better-sqlite3": "^11.10.0",
    "drizzle-orm": "^0.44.2",
    "hono": "^4.8.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "catalog:",
    "tsx": "^4.20.3",
    "typescript": "^6.0.2",
    "vite-plus": "catalog:"
  }
}
```

- [ ] **Step 2: Add dependencies through Vite+**

Run:

```bash
vp install -F website react react-dom @tanstack/react-router @tanstack/react-query @vitejs/plugin-react unocss @unocss/reset
vp install -F website -D @types/react @types/react-dom @testing-library/react jsdom
vp install -F api hono @hono/node-server drizzle-orm better-sqlite3
vp install -F api -D @types/better-sqlite3 tsx
```

Expected:

```text
Done
```

- [ ] **Step 3: Add the API TypeScript config**

Create `apps/api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Add the API Vite+ config**

Create `apps/api/vite.config.ts`:

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
```

- [ ] **Step 5: Convert website package metadata**

Replace `apps/website/package.json` with:

```json
{
  "name": "website",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vp dev",
    "build": "tsc && vp build",
    "preview": "vp preview",
    "test": "vp test",
    "check": "vp check"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.83.0",
    "@tanstack/react-router": "^1.125.0",
    "@unocss/reset": "^66.3.3",
    "@vitejs/plugin-react": "^4.6.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "unocss": "^66.3.3"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "jsdom": "^26.1.0",
    "typescript": "~6.0.2",
    "vite": "catalog:",
    "vite-plus": "catalog:"
  }
}
```

- [ ] **Step 6: Update website TypeScript config**

Replace `apps/website/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Add website Vite config**

Create `apps/website/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react(), UnoCSS()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 8: Update root scripts and ignore rules**

Replace root `package.json` with:

```json
{
  "name": "onlywrite",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "ready": "vp check && vp run -r test && vp run -r build",
    "dev": "vp run -r --parallel dev",
    "prepare": "vp config"
  },
  "devDependencies": {
    "vite-plus": "catalog:"
  },
  "engines": {
    "node": ">=22.12.0"
  },
  "packageManager": "pnpm@10.33.2"
}
```

Append to `.gitignore`:

```gitignore

# Local agent and app state
.superpowers/
apps/api/data/
```

- [ ] **Step 9: Install and check baseline**

Run:

```bash
vp install
vp check
```

Expected:

```text
Done
```

`vp check` may fail because the website has not been converted to React yet. That is acceptable for this task only; record the first TypeScript or lint failure for Task 4.

- [ ] **Step 10: Commit baseline config**

Run:

```bash
git add .gitignore package.json pnpm-lock.yaml apps/website/package.json apps/website/tsconfig.json apps/website/vite.config.ts apps/api/package.json apps/api/tsconfig.json apps/api/vite.config.ts
git commit -m "chore: configure app workspace"
```

## Task 2: API Document Repository

**Files:**

- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/documents/repository.ts`
- Create: `apps/api/src/documents/repository.test.ts`

- [ ] **Step 1: Write the failing repository test**

Create `apps/api/src/documents/repository.test.ts`:

```ts
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createDatabase } from "../db/client.ts";
import { createDocumentRepository } from "./repository.ts";

const tempDirs: string[] = [];

function createTempDatabase() {
  const dir = join(tmpdir(), `onlywrite-api-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const database = createDatabase(join(dir, "test.sqlite"));
  return {
    database,
    repository: createDocumentRepository(database.db),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("creates, lists, reads, updates, and deletes documents", () => {
  const { database, repository } = createTempDatabase();

  const created = repository.create({ title: "Draft", content: "First body" });
  const listed = repository.list();
  const updated = repository.update(created.id, { title: "Updated", content: "Second body" });
  const foundAfterUpdate = repository.findById(created.id);
  const deleted = repository.delete(created.id);
  const foundAfterDelete = repository.findById(created.id);

  database.close();

  expect(created.title).toBe("Draft");
  expect(created.content).toBe("First body");
  expect(created.createdAt).toEqual(expect.any(Number));
  expect(created.updatedAt).toEqual(expect.any(Number));
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: created.id, title: "Draft" });
  expect(updated).toMatchObject({ id: created.id, title: "Updated", content: "Second body" });
  expect(foundAfterUpdate).toMatchObject({ id: created.id, title: "Updated" });
  expect(deleted).toBe(true);
  expect(foundAfterDelete).toBeNull();
});

test("defaults empty documents to an untitled blank draft", () => {
  const { database, repository } = createTempDatabase();

  const created = repository.create({});

  database.close();

  expect(created.title).toBe("Untitled");
  expect(created.content).toBe("");
});

test("returns null or false for missing documents", () => {
  const { database, repository } = createTempDatabase();

  const updated = repository.update("missing", { title: "Nope" });
  const deleted = repository.delete("missing");

  database.close();

  expect(repository.findById("missing")).toBeNull();
  expect(updated).toBeNull();
  expect(deleted).toBe(false);
});
```

- [ ] **Step 2: Run repository test to verify it fails**

Run:

```bash
vp run api#test -- src/documents/repository.test.ts
```

Expected: FAIL because `../db/client.ts` and `./repository.ts` do not exist.

- [ ] **Step 3: Implement Drizzle schema**

Create `apps/api/src/db/schema.ts`:

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
```

- [ ] **Step 4: Implement database factory**

Create `apps/api/src/db/client.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    create table if not exists documents (
      id text primary key,
      title text not null,
      content text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `);

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
```

- [ ] **Step 5: Implement repository**

Create `apps/api/src/documents/repository.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.ts";
import { documents, type DocumentRecord } from "../db/schema.ts";

export type DocumentInput = {
  title?: string;
  content?: string;
};

export type DocumentUpdate = {
  title?: string;
  content?: string;
};

function normalizeTitle(title: string | undefined) {
  const trimmed = title?.trim();
  return trimmed ? trimmed : "Untitled";
}

export function createDocumentRepository(db: AppDatabase) {
  return {
    list(): DocumentRecord[] {
      return db.select().from(documents).orderBy(desc(documents.updatedAt));
    },

    findById(id: string): DocumentRecord | null {
      return db.select().from(documents).where(eq(documents.id, id)).get() ?? null;
    },

    create(input: DocumentInput): DocumentRecord {
      const now = Date.now();
      const record = {
        id: crypto.randomUUID(),
        title: normalizeTitle(input.title),
        content: input.content ?? "",
        createdAt: now,
        updatedAt: now,
      };

      db.insert(documents).values(record).run();
      return record;
    },

    update(id: string, input: DocumentUpdate): DocumentRecord | null {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const next = {
        title: input.title === undefined ? existing.title : normalizeTitle(input.title),
        content: input.content ?? existing.content,
        updatedAt: Date.now(),
      };

      db.update(documents).set(next).where(eq(documents.id, id)).run();
      return this.findById(id);
    },

    delete(id: string): boolean {
      const result = db.delete(documents).where(eq(documents.id, id)).run();
      return result.changes > 0;
    },
  };
}
```

- [ ] **Step 6: Run repository test to verify it passes**

Run:

```bash
vp run api#test -- src/documents/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit repository**

Run:

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/client.ts apps/api/src/documents/repository.ts apps/api/src/documents/repository.test.ts
git commit -m "feat(api): add document repository"
```

## Task 3: API Hono Routes And Server

**Files:**

- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/app.test.ts`
- Create: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing Hono route tests**

Create `apps/api/src/app.test.ts`:

```ts
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createApp } from "./app.ts";
import { createDatabase } from "./db/client.ts";

const tempDirs: string[] = [];

function createTestApp() {
  const dir = join(tmpdir(), `onlywrite-routes-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const database = createDatabase(join(dir, "test.sqlite"));
  return {
    app: createApp(database.db),
    close: database.close,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("returns health status", async () => {
  const { app, close } = createTestApp();

  const response = await app.request("/health");

  close();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
});

test("creates, lists, updates, and deletes a document", async () => {
  const { app, close } = createTestApp();

  const createdResponse = await app.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Draft", content: "Body" }),
  });
  const created = await createdResponse.json();

  const listResponse = await app.request("/documents");
  const list = await listResponse.json();

  const updateResponse = await app.request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Updated" }),
  });
  const updated = await updateResponse.json();

  const detailResponse = await app.request(`/documents/${created.id}`);
  const detail = await detailResponse.json();

  const deleteResponse = await app.request(`/documents/${created.id}`, {
    method: "DELETE",
  });
  const missingResponse = await app.request(`/documents/${created.id}`);

  close();

  expect(createdResponse.status).toBe(201);
  expect(created).toMatchObject({ title: "Draft", content: "Body" });
  expect(list).toHaveLength(1);
  expect(updated).toMatchObject({ id: created.id, title: "Updated", content: "Body" });
  expect(detail).toMatchObject({ id: created.id, title: "Updated" });
  expect(deleteResponse.status).toBe(204);
  expect(missingResponse.status).toBe(404);
});

test("returns a consistent JSON error for missing documents", async () => {
  const { app, close } = createTestApp();

  const response = await app.request("/documents/missing");

  close();

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    error: { message: "Document not found" },
  });
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
vp run api#test -- src/app.test.ts
```

Expected: FAIL because `src/app.ts` does not exist.

- [ ] **Step 3: Implement the Hono app**

Create `apps/api/src/app.ts`:

```ts
import { Hono, type Context } from "hono";
import type { AppDatabase } from "./db/client.ts";
import { createDocumentRepository } from "./documents/repository.ts";

type ErrorStatus = 400 | 404 | 500;

function errorResponse(message: string, status: ErrorStatus) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson(c: Context) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function readDocumentInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    content: typeof record.content === "string" ? record.content : undefined,
  };
}

export function createApp(db: AppDatabase) {
  const app = new Hono();
  const repository = createDocumentRepository(db);

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/documents", (c) => c.json(repository.list()));

  app.post("/documents", async (c) => {
    const input = readDocumentInput(await readJson(c));
    return c.json(repository.create(input), 201);
  });

  app.get("/documents/:id", (c) => {
    const document = repository.findById(c.req.param("id"));
    if (!document) {
      return errorResponse("Document not found", 404);
    }
    return c.json(document);
  });

  app.patch("/documents/:id", async (c) => {
    const input = readDocumentInput(await readJson(c));
    const document = repository.update(c.req.param("id"), input);
    if (!document) {
      return errorResponse("Document not found", 404);
    }
    return c.json(document);
  });

  app.delete("/documents/:id", (c) => {
    const deleted = repository.delete(c.req.param("id"));
    if (!deleted) {
      return errorResponse("Document not found", 404);
    }
    return c.body(null, 204);
  });

  return app;
}
```

- [ ] **Step 4: Implement the server entrypoint**

Create `apps/api/src/server.ts`:

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createDatabase } from "./db/client.ts";

const port = Number(process.env.PORT ?? 8787);
const databasePath = process.env.DATABASE_URL ?? "data/onlywrite.sqlite";
const database = createDatabase(databasePath);
const app = createApp(database.db);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`OnlyWrite API listening on http://localhost:${info.port}`);
});

process.on("SIGINT", () => {
  database.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  database.close();
  process.exit(0);
});
```

- [ ] **Step 5: Run API tests**

Run:

```bash
vp run api#test
```

Expected: PASS for repository and route tests.

- [ ] **Step 6: Commit API routes**

Run:

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/server.ts
git commit -m "feat(api): add document routes"
```

## Task 4: Website API Client

**Files:**

- Create: `apps/website/src/api/documents.ts`
- Create: `apps/website/src/api/documents.test.ts`

- [ ] **Step 1: Write failing API client tests**

Create `apps/website/src/api/documents.test.ts`:

```ts
import { expect, test } from "vite-plus/test";
import {
  ApiError,
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "./documents.ts";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

test("calls document endpoints with the /api base path", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return jsonResponse([{ id: "1", title: "Draft", content: "", createdAt: 1, updatedAt: 1 }]);
  };

  const documents = await listDocuments(fetcher);

  expect(documents).toHaveLength(1);
  expect(calls).toEqual(["GET /api/documents"]);
});

test("sends create, update, read, and delete requests", async () => {
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
    return jsonResponse({ id: "1", title: "Draft", content: "Body", createdAt: 1, updatedAt: 1 });
  };

  await createDocument({ title: "Draft" }, fetcher);
  await getDocument("1", fetcher);
  await updateDocument("1", { content: "Body" }, fetcher);
  await deleteDocument("1", fetcher);

  expect(calls).toEqual([
    { url: "/api/documents", method: "POST", body: JSON.stringify({ title: "Draft" }) },
    { url: "/api/documents/1", method: "GET", body: undefined },
    { url: "/api/documents/1", method: "PATCH", body: JSON.stringify({ content: "Body" }) },
    { url: "/api/documents/1", method: "DELETE", body: undefined },
  ]);
});

test("throws ApiError for JSON error responses", async () => {
  const fetcher: typeof fetch = async () =>
    jsonResponse({ error: { message: "Document not found" } }, { status: 404 });

  await expect(getDocument("missing", fetcher)).rejects.toMatchObject(
    new ApiError("Document not found", 404),
  );
});
```

- [ ] **Step 2: Run API client tests to verify they fail**

Run:

```bash
vp run website#test -- src/api/documents.test.ts
```

Expected: FAIL because `src/api/documents.ts` does not exist.

- [ ] **Step 3: Implement the API client**

Create `apps/website/src/api/documents.ts`:

```ts
export type Document = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type DocumentInput = {
  title?: string;
  content?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const defaultFetch: typeof fetch = (...args) => fetch(...args);

async function request<T>(
  path: string,
  init: RequestInit = {},
  fetcher = defaultFetch,
): Promise<T> {
  const response = await fetcher(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const body = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      message = (body as { error: { message: string } }).error.message;
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getHealth(fetcher?: typeof fetch) {
  return request<{ ok: true }>("/health", {}, fetcher);
}

export function listDocuments(fetcher?: typeof fetch) {
  return request<Document[]>("/documents", {}, fetcher);
}

export function getDocument(id: string, fetcher?: typeof fetch) {
  return request<Document>(`/documents/${id}`, {}, fetcher);
}

export function createDocument(input: DocumentInput, fetcher?: typeof fetch) {
  return request<Document>("/documents", { method: "POST", body: JSON.stringify(input) }, fetcher);
}

export function updateDocument(id: string, input: DocumentInput, fetcher?: typeof fetch) {
  return request<Document>(
    `/documents/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function deleteDocument(id: string, fetcher?: typeof fetch) {
  return request<void>(`/documents/${id}`, { method: "DELETE" }, fetcher);
}
```

- [ ] **Step 4: Run API client tests**

Run:

```bash
vp run website#test -- src/api/documents.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit website API client**

Run:

```bash
git add apps/website/src/api/documents.ts apps/website/src/api/documents.test.ts
git commit -m "feat(website): add document api client"
```

## Task 5: Website React App, Router, And Query Wiring

**Files:**

- Create: `apps/website/src/query.ts`
- Create: `apps/website/src/router.tsx`
- Create: `apps/website/src/components/AppLayout.tsx`
- Create: `apps/website/src/routes/HomeRoute.tsx`
- Create: `apps/website/src/routes/DocumentsRoute.tsx`
- Create: `apps/website/src/routes/DocumentRoute.tsx`
- Replace: `apps/website/src/main.ts` with `apps/website/src/main.tsx`
- Replace: `apps/website/src/style.css`
- Delete: `apps/website/src/counter.ts`

- [ ] **Step 1: Write a failing route smoke test**

Create `apps/website/src/router.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";

test("renders the OnlyWrite app shell", async () => {
  const router = createAppRouter();
  const queryClient = createQueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("OnlyWrite")).toBeTruthy();
});
```

- [ ] **Step 2: Run route smoke test to verify it fails**

Run:

```bash
vp run website#test -- src/router.test.tsx
```

Expected: FAIL because `src/query.ts` and `src/router.tsx` do not exist.

- [ ] **Step 3: Implement Query client**

Create `apps/website/src/query.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
      },
    },
  });
}
```

- [ ] **Step 4: Implement root app layout**

Create `apps/website/src/components/AppLayout.tsx`:

```tsx
import { Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/documents.ts";

export function AppLayout() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => getHealth(),
  });

  const healthText = health.isSuccess
    ? "API online"
    : health.isError
      ? "API offline"
      : "Checking API";

  return (
    <div className="min-h-screen bg-stone-50 text-neutral-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-base font-semibold text-neutral-950">
            OnlyWrite
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/documents" className="text-neutral-600 hover:text-neutral-950">
              Documents
            </Link>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs text-neutral-600">
              {healthText}
            </span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Implement route pages**

Create `apps/website/src/routes/HomeRoute.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createDocument, listDocuments } from "../api/documents.ts";

export function HomeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
  });
  const createMutation = useMutation({
    mutationFn: () => createDocument({}),
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await navigate({ to: "/documents/$documentId", params: { documentId: document.id } });
    },
  });

  const latest = documents.data?.[0];

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center">
      <p className="mb-3 text-sm text-neutral-500">Focused local writing</p>
      <h1 className="mb-4 text-4xl font-semibold leading-tight text-neutral-950">
        Write without setup.
      </h1>
      <p className="mb-8 max-w-2xl text-base leading-7 text-neutral-600">
        OnlyWrite keeps the first slice intentionally small: local drafts, a quiet editor, and fast
        saves through your local API.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? "Creating..." : "New document"}
        </button>
        {latest ? (
          <button
            type="button"
            className="rounded border border-stone-300 px-4 py-2 text-sm font-medium text-neutral-800"
            onClick={() =>
              navigate({ to: "/documents/$documentId", params: { documentId: latest.id } })
            }
          >
            Continue latest
          </button>
        ) : null}
      </div>
      {createMutation.isError ? (
        <p className="mt-4 text-sm text-red-700">Could not create a document.</p>
      ) : null}
    </section>
  );
}
```

Create `apps/website/src/routes/DocumentsRoute.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listDocuments } from "../api/documents.ts";

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    value,
  );
}

export function DocumentsRoute() {
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
  });

  if (documents.isLoading) {
    return <p className="text-sm text-neutral-500">Loading documents...</p>;
  }

  if (documents.isError) {
    return <p className="text-sm text-red-700">Could not load documents.</p>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-950">Documents</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Your local drafts, sorted by most recent changes.
        </p>
      </div>
      <div className="divide-y divide-stone-200 rounded border border-stone-200 bg-white">
        {documents.data?.length ? (
          documents.data.map((document) => (
            <Link
              key={document.id}
              to="/documents/$documentId"
              params={{ documentId: document.id }}
              className="block px-4 py-3 hover:bg-stone-50"
            >
              <div className="font-medium text-neutral-950">{document.title}</div>
              <div className="mt-1 text-xs text-neutral-500">{formatDate(document.updatedAt)}</div>
            </Link>
          ))
        ) : (
          <p className="px-4 py-8 text-sm text-neutral-500">No documents yet.</p>
        )}
      </div>
    </section>
  );
}
```

Create `apps/website/src/routes/DocumentRoute.tsx` after Task 6 creates `DocumentEditor.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
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

  return <DocumentEditor document={document.data} />;
}
```

- [ ] **Step 6: Implement router**

Create `apps/website/src/router.tsx`:

```tsx
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "./components/AppLayout.tsx";
import { HomeRoute } from "./routes/HomeRoute.tsx";
import { DocumentsRoute } from "./routes/DocumentsRoute.tsx";
import { DocumentRoute } from "./routes/DocumentRoute.tsx";

const rootRoute = createRootRoute({
  component: AppLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: DocumentsRoute,
});

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  component: DocumentRoute,
});

const routeTree = rootRoute.addChildren([homeRoute, documentsRoute, documentRoute]);

export function createAppRouter() {
  return createRouter({ routeTree });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
```

- [ ] **Step 7: Implement React entrypoint and styles**

Delete `apps/website/src/main.ts` and create `apps/website/src/main.tsx`:

```tsx
import "@unocss/reset/tailwind.css";
import "virtual:uno.css";
import "./style.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.querySelector<HTMLDivElement>("#app")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

Update `apps/website/index.html` script:

```html
<script type="module" src="/src/main.tsx"></script>
```

Replace `apps/website/src/style.css` with:

```css
:root {
  color-scheme: light;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  background: #fafaf9;
  color: #0a0a0a;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
}

button,
input,
textarea {
  font: inherit;
}
```

Delete `apps/website/src/counter.ts`.

- [ ] **Step 8: Run route smoke test**

Run:

```bash
vp run website#test -- src/router.test.tsx
```

Expected: PASS after Task 6 has created `DocumentEditor.tsx`; before that it may fail on the missing editor component.

- [ ] **Step 9: Commit routing shell**

Run:

```bash
git add apps/website/index.html apps/website/src/main.tsx apps/website/src/router.tsx apps/website/src/router.test.tsx apps/website/src/query.ts apps/website/src/style.css apps/website/src/components/AppLayout.tsx apps/website/src/routes/HomeRoute.tsx apps/website/src/routes/DocumentsRoute.tsx apps/website/src/routes/DocumentRoute.tsx
git rm apps/website/src/main.ts apps/website/src/counter.ts
git commit -m "feat(website): add react router shell"
```

## Task 6: Website Document Editor

**Files:**

- Create: `apps/website/src/components/DocumentEditor.tsx`
- Create: `apps/website/src/components/DocumentEditor.test.tsx`

- [ ] **Step 1: Write failing editor tests**

Create `apps/website/src/components/DocumentEditor.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import type { Document } from "../api/documents.ts";
import { createQueryClient } from "../query.ts";
import { DocumentEditor } from "./DocumentEditor.tsx";

const document: Document = {
  id: "doc-1",
  title: "Draft",
  content: "Body",
  createdAt: 1,
  updatedAt: 1,
};

test("renders document title and content fields", () => {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DocumentEditor document={document} />
    </QueryClientProvider>,
  );

  expect(screen.getByDisplayValue("Draft")).toBeTruthy();
  expect(screen.getByDisplayValue("Body")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
});

test("shows delete action", () => {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DocumentEditor document={document} onDeleted={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
});
```

- [ ] **Step 2: Run editor tests to verify they fail**

Run:

```bash
vp run website#test -- src/components/DocumentEditor.test.tsx
```

Expected: FAIL because `DocumentEditor.tsx` does not exist.

- [ ] **Step 3: Implement the editor**

Create `apps/website/src/components/DocumentEditor.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { deleteDocument, type Document, updateDocument } from "../api/documents.ts";

type DocumentEditorProps = {
  document: Document;
  onDeleted?: () => void;
};

export function DocumentEditor({ document, onDeleted }: DocumentEditorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);

  const updateMutation = useMutation({
    mutationFn: () => updateDocument(document.id, { title, content }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["document", document.id], updated);
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(document.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDeleted?.();
      await navigate({ to: "/documents" });
    },
  });

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">Local draft</p>
          <p className="mt-1 text-xs text-neutral-400">
            Last saved {new Date(document.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-stone-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-60"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            Delete
          </button>
          <button
            type="button"
            className="rounded bg-neutral-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <label className="mb-2 block text-sm font-medium text-neutral-600" htmlFor="document-title">
        Title
      </label>
      <input
        id="document-title"
        className="mb-5 w-full border-0 border-b border-stone-300 bg-transparent px-0 py-3 text-3xl font-semibold outline-none focus:border-neutral-950"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <label className="mb-2 block text-sm font-medium text-neutral-600" htmlFor="document-content">
        Body
      </label>
      <textarea
        id="document-content"
        className="min-h-[52vh] w-full resize-y rounded border border-stone-300 bg-white p-4 leading-7 outline-none focus:border-neutral-950"
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      {updateMutation.isSuccess ? <p className="mt-3 text-sm text-green-700">Saved.</p> : null}
      {updateMutation.isError ? (
        <p className="mt-3 text-sm text-red-700">Could not save this document.</p>
      ) : null}
      {deleteMutation.isError ? (
        <p className="mt-3 text-sm text-red-700">Could not delete this document.</p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run editor and router tests**

Run:

```bash
vp run website#test -- src/components/DocumentEditor.test.tsx src/router.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit editor**

Run:

```bash
git add apps/website/src/components/DocumentEditor.tsx apps/website/src/components/DocumentEditor.test.tsx
git commit -m "feat(website): add document editor"
```

## Task 7: Full Verification And Dev Workflow

**Files:**

- Modify if needed: `package.json`
- Modify if needed: `apps/api/package.json`
- Modify if needed: `apps/website/package.json`
- Modify if needed: `README.md`

- [ ] **Step 1: Run full checks**

Run:

```bash
vp check
vp test
vp run -r build
```

Expected: all commands PASS.

- [ ] **Step 2: Start the dev servers**

Run:

```bash
vp run dev
```

Expected:

```text
OnlyWrite API listening on http://localhost:8787
Local: http://localhost:5173/
```

If the Vite website chooses a different port, use the printed URL.

- [ ] **Step 3: Manually verify the product flow**

In the browser:

1. Open the website URL printed by Vite.
2. Confirm the header shows `OnlyWrite`.
3. Confirm the health pill changes to `API online`.
4. Click `New document`.
5. Confirm navigation to `/documents/<id>`.
6. Change title and body.
7. Click `Save`.
8. Refresh the browser.
9. Confirm the saved title and body reload from SQLite.
10. Open `/documents`.
11. Confirm the saved document appears in the list.
12. Open it and click `Delete`.
13. Confirm navigation back to `/documents` and the document is gone.

- [ ] **Step 4: Update README development notes**

Replace `README.md` with:

````md
# OnlyWrite

OnlyWrite is a local-first writing app starter built with Vite+.

## Apps

- `apps/website`: React, TanStack Router, TanStack Query, UnoCSS.
- `apps/api`: Hono, Drizzle, SQLite.

## Development

Install dependencies:

```bash
vp install
```
````

Run website and API:

```bash
vp run dev
```

Run checks:

```bash
vp check
vp test
vp run -r build
```

The API stores local development data in `apps/api/data/onlywrite.sqlite`.

````

- [ ] **Step 5: Final verification**

Run:

```bash
vp check
vp test
vp run -r build
````

Expected: all commands PASS.

- [ ] **Step 6: Commit final docs and workflow fixes**

Run:

```bash
git add README.md package.json apps/api/package.json apps/website/package.json pnpm-lock.yaml
git commit -m "docs: update development workflow"
```

If no package or README changes remain, skip the commit.

## Self-Review

Spec coverage:

- Website conversion to React, TanStack Router, TanStack Query, and UnoCSS is covered in Tasks 1, 4, 5, and 6.
- API creation with Hono is covered in Tasks 1 and 3.
- Drizzle + SQLite document persistence is covered in Task 2.
- Document CRUD API and JSON errors are covered in Task 3.
- Focused editor UX with title and textarea is covered in Tasks 5 and 6.
- No auth/user scope is preserved; no user model is introduced.
- Vite+ wrappers are used for installs, checks, tests, builds, and dev commands.
- Acceptance checks and manual flow are covered in Task 7.

Placeholder scan:

- No TBD, TODO, or unspecified implementation steps remain.

Type consistency:

- API document fields are consistently `id`, `title`, `content`, `createdAt`, and `updatedAt`.
- Website query keys are consistently `["health"]`, `["documents"]`, and `["document", id]`.
- API client and API routes use the same `/documents` and `/health` paths, with the website adding `/api` through the dev proxy.
