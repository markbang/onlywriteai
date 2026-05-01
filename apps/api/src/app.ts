import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import {
  createOpenAICompatibleSourceImportAssistant,
  fetchPublicUrl,
  type SourceImportAssistant,
} from "./ai/source-import-assistant.ts";
import {
  createOpenAICompatibleWritingAssistant,
  WritingAssistantConfigurationError,
  type WritingAssistant,
  type WritingAssistToolContext,
} from "./ai/writing-assistant.ts";
import { createAuthConfig, createAuthRuntime, type AuthConfig } from "./auth.ts";
import type { AppDatabase } from "./db/client.ts";
import {
  isDocumentSourceType,
  type AgentConversationRecord,
  type DocumentSourceRecord,
} from "./db/schema.ts";
import {
  createDocumentRepository,
  localUserId,
  type AppSettings,
  type DocumentSourceWithDocuments,
  type DocumentSourceInput,
  type DocumentSourceUpdate,
} from "./documents/repository.ts";

const notFoundError = { error: { message: "Document not found" } };
const sourceNotFoundError = { error: { message: "Source not found" } };
const invalidJsonError = { error: { message: "Invalid JSON body" } };
const invalidSourceTypeError = { error: { message: "Invalid source type" } };
const invalidSourceInputError = { error: { message: "Source requires a file, URL, or note" } };
const llmNotConfiguredError = { error: { message: "LLM is not configured" } };
const llmRequestError = { error: { message: "Could not generate writing assistance" } };
const sourceImportError = { error: { message: "Could not import sources" } };
const profileUpdateNotConfiguredError = {
  error: { message: "Logto Management API is not configured" },
};
const profileUpdateError = { error: { message: "Could not update Logto profile" } };

type AppOptions = {
  authConfig?: AuthConfig;
  databasePath?: string;
  sourceImportAssistant?: SourceImportAssistant;
  writingAssistant?: WritingAssistant;
};

const defaultBodyLimit = 1_000_000;
const aiBodyLimit = 2_000_000;

function requestId() {
  return crypto.randomUUID();
}

function requiredProductionEnv() {
  return [
    "APP_BASE_URL",
    "AUTH_SESSION_SECRET",
    "DATABASE_URL",
    "LOGTO_APP_ID",
    "LOGTO_APP_SECRET",
    "LOGTO_ISSUER",
    "LOGTO_JWKS_URI",
    "LLM_API_KEY",
    "LLM_MODEL",
  ];
}

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") {
    return [];
  }

  return requiredProductionEnv().filter((key) => !env[key]?.trim());
}

function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  };
}

function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      await next();
      return;
    }

    const id = c.req.header("x-request-id") || requestId();
    const startedAt = Date.now();
    c.header("X-Request-Id", id);

    try {
      await next();
    } finally {
      const elapsed = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          elapsedMs: elapsed,
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          requestId: id,
          status: c.res.status,
        }),
      );
    }
  };
}

function limitBody(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    if (!["POST", "PUT", "PATCH"].includes(c.req.method)) {
      await next();
      return;
    }

    const contentLength = c.req.header("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      return c.json({ error: { message: "Request body is too large" } }, 413);
    }

    await next();
  };
}

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

function readAssistInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return { instruction: "Suggest the next revision using the document context.", messages: [] };
  }

  const record = value as Record<string, unknown>;
  const instruction = typeof record.instruction === "string" ? record.instruction.trim() : "";
  const draftContent = typeof record.draftContent === "string" ? record.draftContent : undefined;
  const draftTitle = typeof record.draftTitle === "string" ? record.draftTitle : undefined;
  const documentId =
    typeof record.documentId === "string" && record.documentId.trim()
      ? record.documentId.trim()
      : undefined;
  const model =
    typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined;
  const reasoningEffort =
    typeof record.reasoningEffort === "string" && record.reasoningEffort.trim()
      ? record.reasoningEffort.trim()
      : undefined;
  const thinkingEnabled =
    typeof record.thinkingEnabled === "boolean" ? record.thinkingEnabled : undefined;
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map((message) => {
          if (!message || typeof message !== "object") {
            return null;
          }

          const candidate = message as Record<string, unknown>;
          const role = candidate.role;
          const content = candidate.content;
          return (role === "assistant" || role === "user") && typeof content === "string"
            ? { role, content }
            : null;
        })
        .filter((message): message is { role: "assistant" | "user"; content: string } =>
          Boolean(message?.content.trim()),
        )
    : [];
  return {
    draftContent,
    draftTitle,
    documentId,
    instruction: instruction || "Suggest the next revision using the document context.",
    messages,
    model,
    reasoningEffort,
    thinkingEnabled,
  };
}

function readSettingsInput(value: unknown): Partial<AppSettings> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    defaultDocumentTitle:
      typeof record.defaultDocumentTitle === "string" ? record.defaultDocumentTitle : undefined,
    editorLineHeight:
      record.editorLineHeight === "compact" ||
      record.editorLineHeight === "comfortable" ||
      record.editorLineHeight === "relaxed"
        ? record.editorLineHeight
        : undefined,
    sourcePanelDefaultOpen:
      typeof record.sourcePanelDefaultOpen === "boolean"
        ? record.sourcePanelDefaultOpen
        : undefined,
  };
}

function readProfileInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name.trim() : undefined,
    picture: typeof record.picture === "string" ? record.picture.trim() : undefined,
  };
}

function readSourceImportInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return { message: "" };
  }

  const record = value as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  return { message };
}

function readAgentConversationMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }

      const record = message as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      if ((role !== "assistant" && role !== "user") || typeof content !== "string") {
        return null;
      }

      return {
        content,
        role,
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        ...(typeof record.startedAt === "number" ? { startedAt: record.startedAt } : {}),
        ...(typeof record.completedAt === "number" ? { completedAt: record.completedAt } : {}),
        ...(typeof record.model === "string" ? { model: record.model } : {}),
        ...(Array.isArray(record.parts) ? { parts: record.parts } : {}),
        ...(typeof record.reasoning === "string" ? { reasoning: record.reasoning } : {}),
        ...(Array.isArray(record.toolEvents) ? { toolEvents: record.toolEvents } : {}),
        ...(record.usage && typeof record.usage === "object" ? { usage: record.usage } : {}),
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
}

function readAgentConversationInput(value: unknown) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    documentId:
      typeof record.documentId === "string" && record.documentId.trim()
        ? record.documentId.trim()
        : null,
    messages: readAgentConversationMessages(record.messages),
    title: typeof record.title === "string" ? record.title : undefined,
  };
}

function readAgentConversationPatch(value: unknown) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...(Array.isArray(record.messages)
      ? { messages: readAgentConversationMessages(record.messages) }
      : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
  };
}

function readAgentConversationTitleInput(value: unknown) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    documentId:
      typeof record.documentId === "string" && record.documentId.trim()
        ? record.documentId.trim()
        : undefined,
    draftTitle: typeof record.draftTitle === "string" ? record.draftTitle : undefined,
    messages: readAgentConversationMessages(record.messages),
    model:
      typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined,
  };
}

function normalizeGeneratedConversationTitle(value: string) {
  const title = value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ");
  return (title || "New chat").slice(0, 80);
}

function buildConversationTitleInstruction(
  messages: ReturnType<typeof readAgentConversationMessages>,
) {
  const transcript = messages
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

  return [
    "Generate a concise title for this AI chat session.",
    "Return only the title, without quotes, punctuation wrappers, labels, or explanation.",
    "Use the same language as the user's main message.",
    "Keep it under 8 words or 24 Chinese characters.",
    "",
    transcript,
  ].join("\n");
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
      tags: Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === "string")
        : undefined,
    },
  };
}

function readSourceLinkInput(value: unknown):
  | {
      ok: true;
      sourceId: string;
    }
  | {
      ok: false;
    } {
  if (!value || typeof value !== "object") {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  return typeof record.sourceId === "string" && record.sourceId.trim()
    ? { ok: true, sourceId: record.sourceId.trim() }
    : { ok: false };
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
      tags: Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === "string")
        : undefined,
    },
  };
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === "string");
    }
  } catch {
    return [];
  }

  return [];
}

function sourceResponse(source: DocumentSourceRecord) {
  return {
    ...source,
    tags: parseTags(source.tags),
  };
}

function sourceSummaryForApi(source: DocumentSourceRecord) {
  return {
    id: source.id,
    fileName: source.fileName,
    note: source.note.slice(0, 500),
    tags: parseTags(source.tags),
    title: source.title,
    type: source.type,
    updatedAt: source.updatedAt,
    url: source.url,
  };
}

function sourceWithDocumentsResponse(source: DocumentSourceWithDocuments) {
  return {
    ...source,
    tags: parseTags(source.tags),
  };
}

function parseAgentMessages(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readAgentConversationMessages(parsed);
  } catch {
    return [];
  }
}

function agentConversationResponse(conversation: AgentConversationRecord) {
  return {
    ...conversation,
    messages: parseAgentMessages(conversation.messages),
  };
}

async function currentUser(
  c: Context,
  auth: ReturnType<typeof createAuthRuntime>,
  repository: ReturnType<typeof createDocumentRepository>,
) {
  const user = await auth.readUser(c);
  if (!user) {
    const storedUser = repository.upsertUser({ id: localUserId, name: "Local user" });
    return {
      id: localUserId,
      user: {
        sub: localUserId,
        email: storedUser.email ?? undefined,
        name: storedUser.name ?? undefined,
        picture: storedUser.picture ?? undefined,
      },
    };
  }

  const storedUser = repository.upsertUser({
    id: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
  });
  return {
    id: user.sub,
    user: {
      sub: user.sub,
      email: storedUser.email ?? user.email,
      name: storedUser.name ?? user.name,
      picture: storedUser.picture ?? user.picture,
    },
  };
}

async function currentUserId(
  c: Context,
  auth: ReturnType<typeof createAuthRuntime>,
  repository: ReturnType<typeof createDocumentRepository>,
) {
  return (await currentUser(c, auth, repository)).id;
}

function managementApiConfig(authConfig: AuthConfig) {
  const appId = process.env.LOGTO_MANAGEMENT_APP_ID ?? "";
  const appSecret = process.env.LOGTO_MANAGEMENT_APP_SECRET ?? "";
  const apiUrl =
    process.env.LOGTO_MANAGEMENT_API_URL ?? authConfig.issuer.replace(/\/oidc$/, "/api");
  const resource = process.env.LOGTO_MANAGEMENT_RESOURCE ?? "https://default.logto.app/api";
  return { apiUrl: apiUrl.replace(/\/$/, ""), appId, appSecret, resource };
}

async function updateLogtoProfile(
  authConfig: AuthConfig,
  userId: string,
  profile: { name?: string; picture?: string },
) {
  const management = managementApiConfig(authConfig);
  if (!management.appId || !management.appSecret) {
    return { ok: false as const, reason: "not_configured" as const };
  }

  const tokenResponse = await fetch(authConfig.issuer + "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: management.appId,
      client_secret: management.appSecret,
      grant_type: "client_credentials",
      resource: management.resource,
      scope: "all",
    }),
  });
  if (!tokenResponse.ok) {
    const message = await tokenResponse.text().catch(() => "");
    throw new Error(
      "Could not get Logto Management API token: " + tokenResponse.status + " " + message,
    );
  }

  const tokenBody = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof tokenBody.access_token !== "string") {
    throw new Error("Logto Management API token response did not include an access token");
  }

  const response = await fetch(management.apiUrl + "/users/" + encodeURIComponent(userId), {
    method: "PATCH",
    headers: {
      authorization: "Bearer " + tokenBody.access_token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(profile.name === undefined ? {} : { name: profile.name }),
      ...(profile.picture === undefined ? {} : { avatar: profile.picture }),
    }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error("Could not update Logto profile: " + response.status + " " + message);
  }

  return { ok: true as const };
}

type ApprovalPayload = {
  expiresAt: number;
  toolCallId: string;
  input: unknown;
  toolName: string;
  userId: string;
};

function approvalSecret() {
  return (
    process.env.AGENT_APPROVAL_SECRET ??
    process.env.AUTH_SESSION_SECRET ??
    "onlywrite-local-agent-approval-secret"
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signApprovalPayload(payload: ApprovalPayload) {
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", approvalSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyApprovalToken(token: string, userId: string): ApprovalPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = createHmac("sha256", approvalSecret()).update(body).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(body)) as ApprovalPayload;
    if (payload.userId !== userId || payload.expiresAt < Date.now()) {
      return null;
    }
    if (
      payload.toolName !== "deleteDocument" &&
      payload.toolName !== "deleteSource" &&
      payload.toolName !== "unlinkSourceFromDocument" &&
      payload.toolName !== "updateAppSettings" &&
      payload.toolName !== "updateProfile"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createApp(db: AppDatabase, options: AppOptions = {}) {
  const app = new Hono();
  const repository = createDocumentRepository(db);
  const auth = createAuthRuntime(options.authConfig ?? createAuthConfig());
  const writingAssistant = options.writingAssistant ?? createOpenAICompatibleWritingAssistant();
  const sourceImportAssistant =
    options.sourceImportAssistant ?? createOpenAICompatibleSourceImportAssistant();

  function createAgentToolContext(
    c: Context,
    userId: string,
    currentDocumentId?: string,
  ): WritingAssistToolContext {
    const currentDocument = currentDocumentId
      ? repository.findById(userId, currentDocumentId)
      : null;

    function isCurrentDocumentReference(value: string) {
      return ["current", "currentdocument", "current_document", "selected", "this"].includes(
        value.trim().toLowerCase(),
      );
    }

    function resolveDocumentId(documentId?: string) {
      if (!documentId) {
        return currentDocument?.id ?? "";
      }

      return isCurrentDocumentReference(documentId)
        ? (currentDocument?.id ?? documentId)
        : documentId;
    }

    function resolveDocumentAliases(input: unknown) {
      if (!input || typeof input !== "object") {
        return input;
      }

      const record = input as Record<string, unknown>;
      return {
        ...record,
        ...(typeof record.documentId === "string"
          ? { documentId: resolveDocumentId(record.documentId) }
          : {}),
        ...(typeof record.linkToDocumentId === "string"
          ? { linkToDocumentId: resolveDocumentId(record.linkToDocumentId) }
          : {}),
      };
    }

    async function updateProfileFromTool(input: { name?: string; picture?: string }) {
      const { user } = await currentUser(c, auth, repository);
      if (auth.config.enabled) {
        const result = await updateLogtoProfile(auth.config, userId, input);
        if (!result.ok) {
          return { error: profileUpdateNotConfiguredError.error.message };
        }
      }

      const updated = repository.upsertUser({ id: userId, ...input });
      const profile = {
        sub: userId,
        email: updated.email ?? user?.email,
        name: updated.name ?? user?.name,
        picture: updated.picture ?? user?.picture,
      };
      if (auth.config.enabled) {
        await auth.updateSessionUser(c, profile);
      }
      return profile;
    }

    return {
      currentDocumentId,
      createApproval(request) {
        return signApprovalPayload({
          expiresAt: Date.now() + 10 * 60 * 1000,
          input: resolveDocumentAliases(request.input),
          toolCallId: crypto.randomUUID(),
          toolName: request.toolName,
          userId,
        });
      },
      createDocument: (input) => repository.create(userId, input),
      createSource: (input, linkToDocumentId) => {
        const source = repository.createSource(userId, input);
        if (!source) {
          return { error: invalidSourceInputError.error.message };
        }
        if (linkToDocumentId) {
          repository.linkSource(userId, resolveDocumentId(linkToDocumentId), source.id);
        }
        return sourceResponse(source);
      },
      deleteDocument: (documentId) => {
        const targetDocumentId = resolveDocumentId(documentId);
        const deleted = repository.delete(userId, targetDocumentId);
        return deleted
          ? { deleted: true, documentId: targetDocumentId }
          : { error: notFoundError.error.message };
      },
      deleteSource: (sourceId) => {
        const deleted = repository.deleteSource(userId, sourceId);
        return deleted ? { deleted: true, sourceId } : { error: sourceNotFoundError.error.message };
      },
      getProfile: () => repository.findUserById(userId),
      getSettings: () => repository.getSettings(userId),
      fetchUrl: (url) => fetchPublicUrl({ url }),
      importSources: async (input) => {
        const result = await sourceImportAssistant.importSources({
          message: input.message,
          createSource: (sourceInput) => repository.createSource(userId, sourceInput),
        });
        if (input.linkToDocumentId) {
          const targetDocumentId = resolveDocumentId(input.linkToDocumentId);
          for (const source of result.sources) {
            repository.linkSource(userId, targetDocumentId, source.id);
          }
        }
        return {
          ...result,
          sources: result.sources.map(sourceResponse),
        };
      },
      linkSourceToDocument: (documentId, sourceId) => {
        const source = repository.linkSource(userId, resolveDocumentId(documentId), sourceId);
        return source ? sourceResponse(source) : { error: sourceNotFoundError.error.message };
      },
      listDocumentSources: (documentId) => {
        const targetDocumentId = resolveDocumentId(documentId);
        return targetDocumentId ? repository.listSources(userId, targetDocumentId) : [];
      },
      listDocuments: () => repository.list(userId),
      listModels: () => writingAssistant.models(),
      listSources: () => repository.listAllSources(userId),
      readDocument: (documentId) => repository.findById(userId, resolveDocumentId(documentId)),
      readSource: (sourceId) =>
        repository.listAllSources(userId).find((source) => source.id === sourceId) ?? null,
      searchWorkspace: (query, limit = 10) => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) {
          return { documents: [], sources: [] };
        }

        const documents = repository
          .list(userId)
          .filter(
            (document) =>
              document.title.toLowerCase().includes(normalized) ||
              document.content.toLowerCase().includes(normalized),
          )
          .slice(0, limit)
          .map((document) => ({
            id: document.id,
            title: document.title,
            updatedAt: document.updatedAt,
          }));
        const sources = repository
          .listAllSources(userId)
          .filter((source) =>
            [source.title, source.note, source.url ?? "", source.fileName ?? "", source.tags]
              .join(" ")
              .toLowerCase()
              .includes(normalized),
          )
          .slice(0, limit)
          .map(sourceSummaryForApi);
        return { documents, sources };
      },
      unlinkSourceFromDocument: (documentId, sourceId) => {
        const targetDocumentId = resolveDocumentId(documentId);
        const unlinked = repository.unlinkSource(userId, targetDocumentId, sourceId);
        return unlinked
          ? { documentId: targetDocumentId, sourceId, unlinked: true }
          : { error: sourceNotFoundError.error.message };
      },
      updateAppSettings: (input) => repository.updateSettings(userId, input),
      updateDocument: (documentId, input) =>
        repository.update(userId, resolveDocumentId(documentId), input),
      updateProfile: updateProfileFromTool,
      updateSource: (sourceId, input) => {
        const source = repository.updateSource(userId, sourceId, input);
        return source ? sourceResponse(source) : { error: sourceNotFoundError.error.message };
      },
    };
  }

  async function executeApprovedTool(c: Context, payload: ApprovalPayload) {
    const context = createAgentToolContext(c, payload.userId);
    const input = payload.input && typeof payload.input === "object" ? payload.input : {};
    const record = input as Record<string, unknown>;
    const documentId = typeof record.documentId === "string" ? record.documentId : "";
    const sourceId = typeof record.sourceId === "string" ? record.sourceId : "";
    let output: unknown;

    if (payload.toolName === "deleteDocument") {
      output = context.deleteDocument(documentId);
    } else if (payload.toolName === "deleteSource") {
      output = context.deleteSource(sourceId);
    } else if (payload.toolName === "unlinkSourceFromDocument") {
      output = context.unlinkSourceFromDocument(documentId, sourceId);
    } else if (payload.toolName === "updateAppSettings") {
      output = context.updateAppSettings(readSettingsInput(input));
    } else {
      output = await context.updateProfile(readProfileInput(input));
    }

    return { output, toolCallId: payload.toolCallId, toolName: payload.toolName };
  }

  app.use("*", securityHeaders());
  app.use("*", requestLogger());
  app.use("*", limitBody(defaultBodyLimit));
  app.use("/sources/import", limitBody(aiBodyLimit));
  app.use("/agent/assist/stream", limitBody(aiBodyLimit));
  app.use("/agent/tools/execute-approved", limitBody(aiBodyLimit));
  app.use("/documents/:id/assist", limitBody(aiBodyLimit));
  app.use("/documents/:id/assist/stream", limitBody(aiBodyLimit));

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/ready", (c) => {
    const missingConfig = validateProductionConfig();
    let database = false;

    try {
      db.run(sql`select 1`);
      database = true;
    } catch {
      database = false;
    }

    const ready = database && missingConfig.length === 0;
    return c.json(
      {
        ok: ready,
        checks: {
          authConfigured: auth.config.enabled,
          database,
          databasePath: options.databasePath,
          llmConfigured: Boolean(process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY),
          missingConfig,
        },
      },
      ready ? 200 : 503,
    );
  });

  app.get("/auth/login", (c) => auth.createLoginResponse(c));

  app.get("/auth/callback", (c) => auth.handleCallback(c));

  app.get("/auth/me", async (c) => {
    const user = await auth.readUser(c);
    if (!user) {
      return c.json({ enabled: auth.config.enabled, user: null });
    }

    const storedUser = repository.findUserById(user.sub);
    return c.json({
      enabled: auth.config.enabled,
      user: {
        ...user,
        email: storedUser?.email ?? user.email,
        name: storedUser?.name ?? user.name,
        picture: storedUser?.picture ?? user.picture,
      },
    });
  });

  app.post("/auth/logout", (c) => auth.handleLogout(c));

  app.use("*", auth.requireAuth);

  app.get("/settings", async (c) => {
    const { id, user } = await currentUser(c, auth, repository);
    return c.json({
      app: repository.getSettings(id),
      profile: user,
    });
  });

  app.patch("/settings/app", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const userId = await currentUserId(c, auth, repository);
    return c.json(repository.updateSettings(userId, readSettingsInput(body.value)));
  });

  app.patch("/settings/profile", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const { id, user } = await currentUser(c, auth, repository);
    const input = readProfileInput(body.value);
    if (auth.config.enabled) {
      try {
        const result = await updateLogtoProfile(auth.config, id, input);
        if (!result.ok) {
          return c.json(profileUpdateNotConfiguredError, 503);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : profileUpdateError.error.message;
        return c.json({ error: { message } }, 502);
      }
    }

    const updated = repository.upsertUser({ id, ...input });
    const profile = {
      sub: id,
      email: updated.email ?? user?.email,
      name: updated.name ?? user?.name,
      picture: updated.picture ?? user?.picture,
    };
    if (auth.config.enabled) {
      await auth.updateSessionUser(c, profile);
    }

    return c.json(profile);
  });

  app.get("/models", async (c) => {
    try {
      return c.json({ models: await writingAssistant.models() });
    } catch (error) {
      if (error instanceof WritingAssistantConfigurationError) {
        return c.json(llmNotConfiguredError, 503);
      }

      return c.json({ models: [] });
    }
  });

  app.get("/agent/conversations", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const documentId = c.req.query("documentId")?.trim() || null;
    if (documentId && !repository.findById(userId, documentId)) {
      return c.json(notFoundError, 404);
    }

    return c.json(
      repository.listAgentConversations(userId, documentId).map(agentConversationResponse),
    );
  });

  app.post("/agent/conversations", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const userId = await currentUserId(c, auth, repository);
    const conversation = repository.createAgentConversation(
      userId,
      readAgentConversationInput(body.value),
    );
    if (!conversation) {
      return c.json(notFoundError, 404);
    }

    return c.json(agentConversationResponse(conversation), 201);
  });

  app.get("/agent/conversations/:conversationId", async (c) => {
    const conversation = repository.findAgentConversation(
      await currentUserId(c, auth, repository),
      c.req.param("conversationId"),
    );
    if (!conversation) {
      return c.json({ error: { message: "Conversation not found" } }, 404);
    }

    return c.json(agentConversationResponse(conversation));
  });

  app.patch("/agent/conversations/:conversationId", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const conversation = repository.updateAgentConversation(
      await currentUserId(c, auth, repository),
      c.req.param("conversationId"),
      readAgentConversationPatch(body.value),
    );
    if (!conversation) {
      return c.json({ error: { message: "Conversation not found" } }, 404);
    }

    return c.json(agentConversationResponse(conversation));
  });

  app.post("/agent/conversations/title", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const userId = await currentUserId(c, auth, repository);
    const input = readAgentConversationTitleInput(body.value);
    const document = input.documentId ? repository.findById(userId, input.documentId) : null;

    try {
      const result = await writingAssistant.generate({
        document: document ?? undefined,
        draftTitle: input.draftTitle ?? document?.title,
        instruction: buildConversationTitleInstruction(input.messages),
        messages: input.messages.map(({ content, role }) => ({
          content,
          role: role === "assistant" ? "assistant" : "user",
        })),
        model: input.model,
        sources: input.documentId ? repository.listSources(userId, input.documentId) : [],
        thinkingEnabled: false,
      });

      return c.json({
        model: result.model,
        title: normalizeGeneratedConversationTitle(result.suggestion),
      });
    } catch (error) {
      if (error instanceof WritingAssistantConfigurationError) {
        return c.json(llmNotConfiguredError, 503);
      }
      return c.json(llmRequestError, 502);
    }
  });

  app.post("/agent/assist/stream", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    try {
      const input = readAssistInput(body.value);
      const document = input.documentId ? repository.findById(userId, input.documentId) : null;
      if (input.documentId && !document) {
        return c.json(notFoundError, 404);
      }

      const result = await writingAssistant.stream({
        currentDocumentId: document?.id,
        draftContent: input.draftContent,
        draftTitle: input.draftTitle,
        document: document ?? undefined,
        messages: input.messages,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        thinkingEnabled: input.thinkingEnabled,
        toolContext: createAgentToolContext(c, userId, document?.id),
        sources: document ? repository.listSources(userId, document.id) : [],
        instruction: input.instruction,
      });

      return new Response(result.stream, {
        headers: {
          "content-type":
            result.format === "events" ? "application/x-ndjson" : "text/plain; charset=utf-8",
          "x-onlywrite-model": result.model,
          "x-onlywrite-stream-format": result.format ?? "text",
          "x-onlywrite-used-sources": String(result.usedSources),
        },
      });
    } catch (error) {
      if (error instanceof WritingAssistantConfigurationError) {
        return c.json(llmNotConfiguredError, 503);
      }

      return c.json(llmRequestError, 502);
    }
  });

  app.post("/agent/tools/execute-approved", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const token =
      body.value && typeof body.value === "object"
        ? (body.value as { approvalToken?: unknown }).approvalToken
        : undefined;
    if (typeof token !== "string") {
      return c.json({ error: { message: "Approval token is required" } }, 400);
    }

    const userId = await currentUserId(c, auth, repository);
    const payload = verifyApprovalToken(token, userId);
    if (!payload) {
      return c.json({ error: { message: "Approval token is invalid or expired" } }, 403);
    }

    try {
      return c.json(await executeApprovedTool(c, payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not execute approved tool";
      return c.json({ error: { message } }, 502);
    }
  });

  app.get("/documents", async (c) =>
    c.json(repository.list(await currentUserId(c, auth, repository))),
  );

  app.get("/sources", async (c) =>
    c.json(
      repository
        .listAllSources(await currentUserId(c, auth, repository))
        .map(sourceWithDocumentsResponse),
    ),
  );

  app.post("/sources", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const input = readSourceInput(body.value);
    if (!input.ok) {
      return c.json(invalidSourceTypeError, 400);
    }

    const userId = await currentUserId(c, auth, repository);
    const source = repository.createSource(userId, input.value);
    if (!source) {
      return c.json(invalidSourceInputError, 400);
    }

    return c.json(sourceResponse(source), 201);
  });

  app.post("/sources/import", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const input = readSourceImportInput(body.value);
    if (!input.message) {
      return c.json(invalidSourceInputError, 400);
    }

    const userId = await currentUserId(c, auth, repository);

    try {
      const result = await sourceImportAssistant.importSources({
        message: input.message,
        createSource: (sourceInput) => repository.createSource(userId, sourceInput),
      });

      return c.json({
        ...result,
        sources: result.sources.map(sourceResponse),
      });
    } catch (error) {
      if (error instanceof WritingAssistantConfigurationError) {
        return c.json(llmNotConfiguredError, 503);
      }

      return c.json(sourceImportError, 502);
    }
  });

  app.patch("/sources/:sourceId", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const input = readSourcePatch(body.value);
    if (!input.ok) {
      return c.json(invalidSourceTypeError, 400);
    }

    const userId = await currentUserId(c, auth, repository);
    const source = repository.updateSource(userId, c.req.param("sourceId"), input.value);
    if (!source) {
      return c.json(sourceNotFoundError, 404);
    }

    return c.json(sourceResponse(source));
  });

  app.delete("/sources/:sourceId", async (c) => {
    const deleted = repository.deleteSource(
      await currentUserId(c, auth, repository),
      c.req.param("sourceId"),
    );
    if (!deleted) {
      return c.json(sourceNotFoundError, 404);
    }

    return c.body(null, 204);
  });

  app.post("/documents", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const input = readDocumentInput(body.value);
    return c.json(repository.create(await currentUserId(c, auth, repository), input), 201);
  });

  app.get("/documents/:id", async (c) => {
    const document = repository.findById(
      await currentUserId(c, auth, repository),
      c.req.param("id"),
    );
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
    const document = repository.update(
      await currentUserId(c, auth, repository),
      c.req.param("id"),
      input,
    );
    if (!document) {
      return c.json(notFoundError, 404);
    }

    return c.json(document);
  });

  app.delete("/documents/:id", async (c) => {
    const deleted = repository.delete(await currentUserId(c, auth, repository), c.req.param("id"));
    if (!deleted) {
      return c.json(notFoundError, 404);
    }

    return c.body(null, 204);
  });

  app.post("/documents/:id/assist", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const document = repository.findById(userId, c.req.param("id"));
    if (!document) {
      return c.json(notFoundError, 404);
    }

    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    try {
      const input = readAssistInput(body.value);
      const result = await writingAssistant.generate({
        draftContent: input.draftContent,
        draftTitle: input.draftTitle,
        document,
        messages: input.messages,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        thinkingEnabled: input.thinkingEnabled,
        sources: repository.listSources(userId, document.id),
        instruction: input.instruction,
      });

      return c.json(result);
    } catch (error) {
      if (error instanceof WritingAssistantConfigurationError) {
        return c.json(llmNotConfiguredError, 503);
      }

      return c.json(llmRequestError, 502);
    }
  });

  app.post("/documents/:id/assist/stream", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const document = repository.findById(userId, c.req.param("id"));
    if (!document) {
      return c.json(notFoundError, 404);
    }

    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    try {
      const input = readAssistInput(body.value);
      const result = await writingAssistant.stream({
        draftContent: input.draftContent,
        draftTitle: input.draftTitle,
        document,
        messages: input.messages,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        thinkingEnabled: input.thinkingEnabled,
        toolContext: createAgentToolContext(c, userId, document.id),
        sources: repository.listSources(userId, document.id),
        instruction: input.instruction,
      });

      return new Response(result.stream, {
        headers: {
          "content-type":
            result.format === "events" ? "application/x-ndjson" : "text/plain; charset=utf-8",
          "x-onlywrite-model": result.model,
          "x-onlywrite-stream-format": result.format ?? "text",
          "x-onlywrite-used-sources": String(result.usedSources),
        },
      });
    } catch (error) {
      if (error instanceof WritingAssistantConfigurationError) {
        return c.json(llmNotConfiguredError, 503);
      }

      return c.json(llmRequestError, 502);
    }
  });

  app.get("/documents/:documentId/sources", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const documentId = c.req.param("documentId");
    if (!repository.findById(userId, documentId)) {
      return c.json(notFoundError, 404);
    }

    return c.json(repository.listSources(userId, documentId).map(sourceResponse));
  });

  app.post("/documents/:documentId/sources", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const documentId = c.req.param("documentId");
    if (!repository.findById(userId, documentId)) {
      return c.json(notFoundError, 404);
    }

    const body = await readJson(c);
    if (!body.ok) {
      return c.json(invalidJsonError, 400);
    }

    const linkInput = readSourceLinkInput(body.value);
    if (linkInput.ok) {
      const source = repository.linkSource(userId, documentId, linkInput.sourceId);
      if (!source) {
        return c.json(sourceNotFoundError, 404);
      }

      return c.json(sourceResponse(source), 201);
    }

    const input = readSourceInput(body.value);
    if (!input.ok) {
      return c.json(invalidSourceTypeError, 400);
    }

    const source = repository.createAndLinkSource(userId, documentId, input.value);
    if (!source) {
      return c.json(invalidSourceInputError, 400);
    }

    return c.json(sourceResponse(source), 201);
  });

  app.patch("/documents/:documentId/sources/:sourceId", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const documentId = c.req.param("documentId");
    if (!repository.findById(userId, documentId)) {
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

    const sourceId = c.req.param("sourceId");
    if (!repository.listSources(userId, documentId).some((source) => source.id === sourceId)) {
      return c.json(sourceNotFoundError, 404);
    }

    const source = repository.updateSource(userId, sourceId, input.value);
    if (!source) {
      return c.json(sourceNotFoundError, 404);
    }

    return c.json(sourceResponse(source));
  });

  app.delete("/documents/:documentId/sources/:sourceId", async (c) => {
    const userId = await currentUserId(c, auth, repository);
    const documentId = c.req.param("documentId");
    if (!repository.findById(userId, documentId)) {
      return c.json(notFoundError, 404);
    }

    const unlinked = repository.unlinkSource(userId, documentId, c.req.param("sourceId"));
    if (!unlinked) {
      return c.json(sourceNotFoundError, 404);
    }

    return c.body(null, 204);
  });

  return app;
}
