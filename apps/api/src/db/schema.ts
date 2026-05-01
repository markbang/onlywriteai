import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  picture: text("picture"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  settings: text("settings").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<DocumentSourceType>().notNull(),
    title: text("title").notNull(),
    note: text("note").notNull(),
    url: text("url"),
    fileName: text("file_name"),
    tags: text("tags").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [check("sources_type_check", sql`${table.type} in ('text', 'rss', 'pdf', 'image')`)],
);

export const documentSourceLinks = sqliteTable(
  "document_source_links",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.sourceId] })],
);

export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  messages: text("messages").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
export type DocumentSourceRecord = typeof sources.$inferSelect;
export type NewDocumentSourceRecord = typeof sources.$inferInsert;
export type DocumentSourceLinkRecord = typeof documentSourceLinks.$inferSelect;
export type AgentConversationRecord = typeof agentConversations.$inferSelect;
export type UserRecord = typeof users.$inferSelect;
export type UserSettingsRecord = typeof userSettings.$inferSelect;
