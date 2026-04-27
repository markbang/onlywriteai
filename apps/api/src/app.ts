import { Hono, type Context } from "hono";
import type { AppDatabase } from "./db/client.ts";
import { createDocumentRepository } from "./documents/repository.ts";

const notFoundError = { error: { message: "Document not found" } };

async function readJson(c: Context): Promise<unknown> {
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
      return c.json(notFoundError, 404);
    }

    return c.json(document);
  });

  app.patch("/documents/:id", async (c) => {
    const input = readDocumentInput(await readJson(c));
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
