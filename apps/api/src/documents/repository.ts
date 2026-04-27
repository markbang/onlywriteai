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
      return db.select().from(documents).orderBy(desc(documents.updatedAt)).all();
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
