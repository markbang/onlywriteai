import { Hono, type Context } from "hono";
import type { AppDatabase } from "./db/client.ts";
import { isDocumentSourceType } from "./db/schema.ts";
import {
  createDocumentRepository,
  type DocumentSourceInput,
  type DocumentSourceUpdate,
} from "./documents/repository.ts";

const notFoundError = { error: { message: "Document not found" } };
const sourceNotFoundError = { error: { message: "Source not found" } };
const invalidJsonError = { error: { message: "Invalid JSON body" } };
const invalidSourceTypeError = { error: { message: "Invalid source type" } };

async function readJson(c: Context): Promise<
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
    }
> {
  const body = await c.req.text();
  if (body === "") {
    return { ok: true, value: {} };
  }

  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
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

function readSourceInput(value: unknown):
  | {
      ok: true;
      value: DocumentSourceInput;
    }
  | {
      ok: false;
    } {
  if (!value || typeof value !== "object") {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  if (!isDocumentSourceType(record.type)) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      type: record.type,
      title: typeof record.title === "string" ? record.title : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    },
  };
}

function readSourcePatch(value: unknown):
  | {
      ok: true;
      value: DocumentSourceUpdate;
    }
  | {
      ok: false;
    } {
  if (!value || typeof value !== "object") {
    return { ok: true, value: {} };
  }

  const record = value as Record<string, unknown>;
  if (record.type !== undefined && !isDocumentSourceType(record.type)) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      type: isDocumentSourceType(record.type) ? record.type : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    },
  };
}

export function createApp(db: AppDatabase) {
  const app = new Hono();
  const repository = createDocumentRepository(db);

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/documents", (c) => c.json(repository.list()));

  app.post("/documents", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const input = readDocumentInput(body.value);
    return c.json(repository.create(input), 201);
  });

  app.get("/documents/:id", (c) => {
    const document = repository.findById(c.req.param("id"));
    if (!document) {
      return c.json(notFoundError, 404);
    }

    return c.json(document);
  });

  app.patch("/documents/:id", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const input = readDocumentInput(body.value);
    const document = repository.update(c.req.param("id"), input);
    if (!document) {
      return c.json(notFoundError, 404);
    }

    return c.json(document);
  });

  app.delete("/documents/:id", (c) => {
    const deleted = repository.delete(c.req.param("id"));
    if (!deleted) {
      return c.json(notFoundError, 404);
    }

    return c.body(null, 204);
  });

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

  return app;
}
