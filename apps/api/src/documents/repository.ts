import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.ts";
import {
  agentConversations,
  documentSourceLinks,
  documents,
  isDocumentSourceType,
  sources,
  userSettings,
  users,
  type AgentConversationRecord,
  type DocumentRecord,
  type DocumentSourceRecord,
  type DocumentSourceType,
  type UserRecord,
} from "../db/schema.ts";

export const localUserId = "local-user";

export type DocumentInput = {
  title?: string;
  content?: string;
};

export type DocumentUpdate = {
  title?: string;
  content?: string;
};

export type DocumentSourceInput = {
  type: string;
  title?: string;
  note?: string;
  url?: string;
  fileName?: string;
  tags?: string[];
};

export type DocumentSourceUpdate = {
  type?: string;
  title?: string;
  note?: string;
  url?: string;
  fileName?: string;
  tags?: string[];
};

export type LinkedDocument = {
  id: string;
  title: string;
};

export type DocumentSourceWithDocuments = DocumentSourceRecord & {
  documents: LinkedDocument[];
};

export type UserInput = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type AppSettings = {
  defaultDocumentTitle: string;
  editorLineHeight: "comfortable" | "compact" | "relaxed";
  sourcePanelDefaultOpen: boolean;
};

export type AgentConversationInput = {
  documentId?: string | null;
  messages?: unknown[];
  title?: string;
};

export type AgentConversationUpdate = {
  messages?: unknown[];
  title?: string;
};

export const defaultAppSettings: AppSettings = {
  defaultDocumentTitle: "Untitled",
  editorLineHeight: "comfortable",
  sourcePanelDefaultOpen: true,
};

function normalizeTitle(title: string | undefined) {
  const trimmed = title?.trim();
  return trimmed ? trimmed : "Untitled";
}

function normalizeSourceTitle(title: string | undefined) {
  const trimmed = title?.trim();
  return trimmed ?? "";
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTags(tags: string[] | undefined) {
  if (!tags) {
    return "[]";
  }

  const seen = new Set<string>();
  const normalized = [];
  for (const tag of tags) {
    const value = tag.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      normalized.push(value);
    }
  }

  return JSON.stringify(normalized);
}

function normalizeConversationTitle(title: string | undefined) {
  const trimmed = title?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 80) : "New chat";
}

function serializeMessages(messages: unknown[] | undefined) {
  return JSON.stringify(Array.isArray(messages) ? messages : []);
}

function hasSourceBody(input: DocumentSourceInput | DocumentSourceUpdate) {
  return Boolean(
    normalizeOptionalText(input.url) ?? normalizeOptionalText(input.fileName) ?? input.note?.trim(),
  );
}

export function createDocumentRepository(db: AppDatabase) {
  function findById(userId: string, id: string): DocumentRecord | null {
    return (
      db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.userId, userId)))
        .get() ?? null
    );
  }

  function findSourceById(userId: string, id: string): DocumentSourceRecord | null {
    return (
      db
        .select()
        .from(sources)
        .where(and(eq(sources.id, id), eq(sources.userId, userId)))
        .get() ?? null
    );
  }

  function findConversationById(userId: string, id: string): AgentConversationRecord | null {
    return (
      db
        .select()
        .from(agentConversations)
        .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)))
        .get() ?? null
    );
  }

  function normalizeSettings(value: unknown): AppSettings {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const editorLineHeight = record.editorLineHeight;
    return {
      defaultDocumentTitle:
        typeof record.defaultDocumentTitle === "string" && record.defaultDocumentTitle.trim()
          ? record.defaultDocumentTitle.trim()
          : defaultAppSettings.defaultDocumentTitle,
      editorLineHeight:
        editorLineHeight === "compact" || editorLineHeight === "relaxed"
          ? editorLineHeight
          : defaultAppSettings.editorLineHeight,
      sourcePanelDefaultOpen:
        typeof record.sourcePanelDefaultOpen === "boolean"
          ? record.sourcePanelDefaultOpen
          : defaultAppSettings.sourcePanelDefaultOpen,
    };
  }

  function parseSettings(value: string) {
    try {
      return normalizeSettings(JSON.parse(value) as unknown);
    } catch {
      return defaultAppSettings;
    }
  }

  function getSettings(userId: string): AppSettings {
    const record = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();

    return record ? parseSettings(record.settings) : defaultAppSettings;
  }

  function createSourceRecord(
    userId: string,
    input: DocumentSourceInput,
  ): DocumentSourceRecord | null {
    if (!isDocumentSourceType(input.type) || !hasSourceBody(input)) {
      return null;
    }

    const now = Date.now();
    const record = {
      id: crypto.randomUUID(),
      userId,
      type: input.type satisfies DocumentSourceType,
      title: normalizeSourceTitle(input.title),
      note: input.note ?? "",
      url: normalizeOptionalText(input.url),
      fileName: normalizeOptionalText(input.fileName),
      tags: normalizeTags(input.tags),
      createdAt: now,
      updatedAt: now,
    };

    db.insert(sources).values(record).run();
    return record;
  }

  return {
    upsertUser(input: UserInput): UserRecord {
      const now = Date.now();
      const existing = db.select().from(users).where(eq(users.id, input.id)).get() ?? null;
      if (!existing) {
        const record = {
          id: input.id,
          email: input.email ?? null,
          name: input.name ?? null,
          picture: input.picture ?? null,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(users).values(record).run();
        return record;
      }

      const next = {
        email: input.email ?? existing.email,
        name: input.name ?? existing.name,
        picture: input.picture ?? existing.picture,
        updatedAt: now,
      };
      db.update(users).set(next).where(eq(users.id, input.id)).run();
      return db.select().from(users).where(eq(users.id, input.id)).get() ?? existing;
    },

    findUserById(userId: string): UserRecord | null {
      return db.select().from(users).where(eq(users.id, userId)).get() ?? null;
    },

    getSettings(userId = localUserId): AppSettings {
      return getSettings(userId);
    },

    updateSettings(
      userId: string | Partial<AppSettings>,
      input?: Partial<AppSettings>,
    ): AppSettings {
      const ownerId = input === undefined ? localUserId : (userId as string);
      const settingsInput = input ?? (userId as Partial<AppSettings>);
      const settings = normalizeSettings({ ...getSettings(ownerId), ...settingsInput });
      const record = {
        userId: ownerId,
        settings: JSON.stringify(settings),
        updatedAt: Date.now(),
      };

      db.insert(userSettings)
        .values(record)
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { settings: record.settings, updatedAt: record.updatedAt },
        })
        .run();

      return settings;
    },

    list(userId = localUserId): DocumentRecord[] {
      return db
        .select()
        .from(documents)
        .where(eq(documents.userId, userId))
        .orderBy(desc(documents.updatedAt), sql`rowid desc`)
        .all();
    },

    listAgentConversations(
      userId: string | null = null,
      documentId?: string | null,
    ): AgentConversationRecord[] {
      const ownerId = documentId === undefined ? localUserId : (userId ?? localUserId);
      const targetDocumentId = documentId === undefined ? userId : documentId;

      return db
        .select()
        .from(agentConversations)
        .where(
          and(
            eq(agentConversations.userId, ownerId),
            targetDocumentId
              ? eq(agentConversations.documentId, targetDocumentId)
              : isNull(agentConversations.documentId),
          ),
        )
        .orderBy(desc(agentConversations.updatedAt), sql`rowid desc`)
        .all();
    },

    findAgentConversation(userId: string, id?: string): AgentConversationRecord | null {
      return findConversationById(id === undefined ? localUserId : userId, id ?? userId);
    },

    createAgentConversation(
      userId: string | AgentConversationInput,
      input?: AgentConversationInput,
    ): AgentConversationRecord | null {
      const ownerId = typeof userId === "string" ? userId : localUserId;
      const conversationInput = typeof userId === "string" ? (input ?? {}) : userId;
      const documentId = conversationInput.documentId ?? null;
      if (documentId && !findById(ownerId, documentId)) {
        return null;
      }

      const now = Date.now();
      const record = {
        id: crypto.randomUUID(),
        userId: ownerId,
        documentId,
        title: normalizeConversationTitle(conversationInput.title),
        messages: serializeMessages(conversationInput.messages),
        createdAt: now,
        updatedAt: now,
      };

      db.insert(agentConversations).values(record).run();
      return record;
    },

    updateAgentConversation(
      userId: string,
      id: string | AgentConversationUpdate,
      input?: AgentConversationUpdate,
    ): AgentConversationRecord | null {
      const ownerId = input === undefined ? localUserId : userId;
      const conversationId = input === undefined ? userId : (id as string);
      const conversationInput = input ?? (id as AgentConversationUpdate);
      const existing = findConversationById(ownerId, conversationId);
      if (!existing) {
        return null;
      }

      db.update(agentConversations)
        .set({
          messages:
            conversationInput.messages === undefined
              ? existing.messages
              : serializeMessages(conversationInput.messages),
          title:
            conversationInput.title === undefined
              ? existing.title
              : normalizeConversationTitle(conversationInput.title),
          updatedAt: Date.now(),
        })
        .where(
          and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, ownerId)),
        )
        .run();
      return findConversationById(ownerId, conversationId);
    },

    findById(userId: string, id?: string): DocumentRecord | null {
      return findById(id === undefined ? localUserId : userId, id ?? userId);
    },

    create(userId: string | DocumentInput, input?: DocumentInput): DocumentRecord {
      const ownerId = typeof userId === "string" ? userId : localUserId;
      const documentInput = typeof userId === "string" ? (input ?? {}) : userId;
      const now = Date.now();
      const record = {
        id: crypto.randomUUID(),
        userId: ownerId,
        title: normalizeTitle(documentInput.title),
        content: documentInput.content ?? "",
        createdAt: now,
        updatedAt: now,
      };

      db.insert(documents).values(record).run();
      return record;
    },

    update(
      userId: string,
      id: string | DocumentUpdate,
      input?: DocumentUpdate,
    ): DocumentRecord | null {
      const ownerId = input === undefined ? localUserId : userId;
      const documentId = input === undefined ? userId : (id as string);
      const documentInput = input ?? (id as DocumentUpdate);
      const existing = findById(ownerId, documentId);
      if (!existing) {
        return null;
      }

      const next = {
        title:
          documentInput.title === undefined ? existing.title : normalizeTitle(documentInput.title),
        content: documentInput.content ?? existing.content,
        updatedAt: Date.now(),
      };

      db.update(documents)
        .set(next)
        .where(and(eq(documents.id, documentId), eq(documents.userId, ownerId)))
        .run();
      return findById(ownerId, documentId);
    },

    delete(userId: string, id?: string): boolean {
      const ownerId = id === undefined ? localUserId : userId;
      const documentId = id ?? userId;
      const result = db
        .delete(documents)
        .where(and(eq(documents.id, documentId), eq(documents.userId, ownerId)))
        .run();
      return result.changes > 0;
    },

    listSources(userId: string, documentId?: string): DocumentSourceRecord[] {
      const ownerId = documentId === undefined ? localUserId : userId;
      const targetDocumentId = documentId ?? userId;
      return db
        .select({
          id: sources.id,
          userId: sources.userId,
          type: sources.type,
          title: sources.title,
          note: sources.note,
          url: sources.url,
          fileName: sources.fileName,
          tags: sources.tags,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(documentSourceLinks)
        .innerJoin(sources, eq(documentSourceLinks.sourceId, sources.id))
        .where(
          and(eq(documentSourceLinks.documentId, targetDocumentId), eq(sources.userId, ownerId)),
        )
        .orderBy(desc(sources.updatedAt), sql`sources.rowid desc`)
        .all();
    },

    listAllSources(userId = localUserId): DocumentSourceWithDocuments[] {
      const rows = db
        .select()
        .from(sources)
        .where(eq(sources.userId, userId))
        .orderBy(desc(sources.updatedAt), sql`sources.rowid desc`)
        .all();
      const linkedDocuments = db
        .select({
          sourceId: documentSourceLinks.sourceId,
          id: documents.id,
          title: documents.title,
        })
        .from(documentSourceLinks)
        .innerJoin(documents, eq(documentSourceLinks.documentId, documents.id))
        .innerJoin(sources, eq(documentSourceLinks.sourceId, sources.id))
        .where(eq(sources.userId, userId))
        .all();
      const bySourceId = new Map<string, LinkedDocument[]>();
      for (const document of linkedDocuments) {
        bySourceId.set(document.sourceId, [
          ...(bySourceId.get(document.sourceId) ?? []),
          { id: document.id, title: document.title },
        ]);
      }

      return rows.map((source) => ({
        ...source,
        documents: bySourceId.get(source.id) ?? [],
      }));
    },

    createSource(
      userId: string | DocumentSourceInput,
      input?: DocumentSourceInput,
    ): DocumentSourceRecord | null {
      const ownerId = typeof userId === "string" ? userId : localUserId;
      const sourceInput = typeof userId === "string" ? input : userId;
      if (!sourceInput) {
        return null;
      }

      return createSourceRecord(ownerId, sourceInput);
    },

    updateSource(
      userId: string,
      sourceId: string | DocumentSourceUpdate,
      input?: DocumentSourceUpdate,
    ): DocumentSourceRecord | null {
      const ownerId = input === undefined ? localUserId : userId;
      const targetSourceId = input === undefined ? userId : (sourceId as string);
      const sourceInput = input ?? (sourceId as DocumentSourceUpdate);
      const existing = findSourceById(ownerId, targetSourceId);
      if (!existing) {
        return null;
      }
      if (sourceInput.type !== undefined && !isDocumentSourceType(sourceInput.type)) {
        return null;
      }

      const next = {
        type: sourceInput.type ?? existing.type,
        title:
          sourceInput.title === undefined
            ? existing.title
            : normalizeSourceTitle(sourceInput.title),
        note: sourceInput.note ?? existing.note,
        url: sourceInput.url === undefined ? existing.url : normalizeOptionalText(sourceInput.url),
        fileName:
          sourceInput.fileName === undefined
            ? existing.fileName
            : normalizeOptionalText(sourceInput.fileName),
        tags: sourceInput.tags === undefined ? existing.tags : normalizeTags(sourceInput.tags),
        updatedAt: Date.now(),
      };

      db.update(sources)
        .set(next)
        .where(and(eq(sources.id, targetSourceId), eq(sources.userId, ownerId)))
        .run();

      return findSourceById(ownerId, targetSourceId);
    },

    deleteSource(userId: string, sourceId?: string): boolean {
      const ownerId = sourceId === undefined ? localUserId : userId;
      const targetSourceId = sourceId ?? userId;
      const result = db
        .delete(sources)
        .where(and(eq(sources.id, targetSourceId), eq(sources.userId, ownerId)))
        .run();

      return result.changes > 0;
    },

    linkSource(userId: string, documentId: string, sourceId?: string): DocumentSourceRecord | null {
      const ownerId = sourceId === undefined ? localUserId : userId;
      const targetDocumentId = sourceId === undefined ? userId : documentId;
      const targetSourceId = sourceId ?? documentId;
      if (!findById(ownerId, targetDocumentId)) {
        return null;
      }

      const source = findSourceById(ownerId, targetSourceId);
      if (!source) {
        return null;
      }

      db.insert(documentSourceLinks)
        .values({ documentId: targetDocumentId, sourceId: targetSourceId, createdAt: Date.now() })
        .onConflictDoNothing()
        .run();
      return source;
    },

    createAndLinkSource(
      userId: string,
      documentId: string | DocumentSourceInput,
      input?: DocumentSourceInput,
    ): DocumentSourceRecord | null {
      const ownerId = input === undefined ? localUserId : userId;
      const targetDocumentId = input === undefined ? userId : (documentId as string);
      const sourceInput = input ?? (documentId as DocumentSourceInput);
      if (!findById(ownerId, targetDocumentId)) {
        return null;
      }

      const source = createSourceRecord(ownerId, sourceInput);
      if (!source) {
        return null;
      }

      db.insert(documentSourceLinks)
        .values({ documentId: targetDocumentId, sourceId: source.id, createdAt: Date.now() })
        .run();
      return source;
    },

    unlinkSource(userId: string, documentId: string, sourceId?: string): boolean {
      const ownerId = sourceId === undefined ? localUserId : userId;
      const targetDocumentId = sourceId === undefined ? userId : documentId;
      const targetSourceId = sourceId ?? documentId;
      if (!findById(ownerId, targetDocumentId) || !findSourceById(ownerId, targetSourceId)) {
        return false;
      }

      const result = db
        .delete(documentSourceLinks)
        .where(
          and(
            eq(documentSourceLinks.documentId, targetDocumentId),
            eq(documentSourceLinks.sourceId, targetSourceId),
          ),
        )
        .run();

      return result.changes > 0;
    },
  };
}
