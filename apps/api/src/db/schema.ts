import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const documentSourceTypes = ["text", "rss", "pdf", "image"] as const;
export type DocumentSourceType = (typeof documentSourceTypes)[number];

export function isDocumentSourceType(value: unknown): value is DocumentSourceType {
  return typeof value === "string" && documentSourceTypes.includes(value as DocumentSourceType);
}

export const documentSources = sqliteTable(
  "document_sources",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    type: text("type").$type<DocumentSourceType>().notNull(),
    title: text("title").notNull(),
    note: text("note").notNull(),
    url: text("url"),
    fileName: text("file_name"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("document_sources_type_check", sql`${table.type} in ('text', 'rss', 'pdf', 'image')`),
  ],
);

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
export type DocumentSourceRecord = typeof documentSources.$inferSelect;
export type NewDocumentSourceRecord = typeof documentSources.$inferInsert;
