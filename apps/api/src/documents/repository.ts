import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.ts";
import {
  documentSources,
  documents,
  type DocumentRecord,
  type DocumentSourceRecord,
  type DocumentSourceType,
} from "../db/schema.ts";

export type DocumentInput = {
  title?: string;
  content?: string;
};

export type DocumentUpdate = {
  title?: string;
  content?: string;
};

export type DocumentSourceInput = {
  type: DocumentSourceType;
  title?: string;
  note?: string;
  url?: string;
  fileName?: string;
};

export type DocumentSourceUpdate = {
  type?: DocumentSourceType;
  title?: string;
  note?: string;
  url?: string;
  fileName?: string;
};

function normalizeTitle(title: string | undefined) {
  const trimmed = title?.trim();
  return trimmed ? trimmed : "Untitled";
}

function normalizeSourceTitle(title: string | undefined) {
  const trimmed = title?.trim();
  return trimmed ? trimmed : "Untitled source";
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function createDocumentRepository(db: AppDatabase) {
  return {
    list(): DocumentRecord[] {
      return db
        .select()
        .from(documents)
        .orderBy(desc(documents.updatedAt), sql`rowid desc`)
        .all();
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
      db.delete(documentSources).where(eq(documentSources.documentId, id)).run();
      const result = db.delete(documents).where(eq(documents.id, id)).run();
      return result.changes > 0;
    },

    listSources(documentId: string): DocumentSourceRecord[] {
      return db
        .select()
        .from(documentSources)
        .where(eq(documentSources.documentId, documentId))
        .orderBy(desc(documentSources.updatedAt), sql`rowid desc`)
        .all();
    },

    createSource(documentId: string, input: DocumentSourceInput): DocumentSourceRecord | null {
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
        url: normalizeOptionalText(input.url),
        fileName: normalizeOptionalText(input.fileName),
        createdAt: now,
        updatedAt: now,
      };

      db.insert(documentSources).values(record).run();
      return record;
    },

    updateSource(
      documentId: string,
      sourceId: string,
      input: DocumentSourceUpdate,
    ): DocumentSourceRecord | null {
      const existing =
        db
          .select()
          .from(documentSources)
          .where(and(eq(documentSources.id, sourceId), eq(documentSources.documentId, documentId)))
          .get() ?? null;

      if (!existing) {
        return null;
      }

      const next = {
        type: input.type ?? existing.type,
        title: input.title === undefined ? existing.title : normalizeSourceTitle(input.title),
        note: input.note ?? existing.note,
        url: input.url === undefined ? existing.url : normalizeOptionalText(input.url),
        fileName:
          input.fileName === undefined ? existing.fileName : normalizeOptionalText(input.fileName),
        updatedAt: Date.now(),
      };

      db.update(documentSources)
        .set(next)
        .where(and(eq(documentSources.id, sourceId), eq(documentSources.documentId, documentId)))
        .run();

      return (
        db
          .select()
          .from(documentSources)
          .where(and(eq(documentSources.id, sourceId), eq(documentSources.documentId, documentId)))
          .get() ?? null
      );
    },

    deleteSource(documentId: string, sourceId: string): boolean {
      const result = db
        .delete(documentSources)
        .where(and(eq(documentSources.id, sourceId), eq(documentSources.documentId, documentId)))
        .run();

      return result.changes > 0;
    },
  };
}
