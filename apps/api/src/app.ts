import { Hono, type Context } from "hono";
import type { AppDatabase } from "./db/client.ts";
import { createDocumentRepository } from "./documents/repository.ts";

const notFoundError = { error: { message: "Document not found" } };
const invalidJsonError = { error: { message: "Invalid JSON body" } };

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

  return app;
}
