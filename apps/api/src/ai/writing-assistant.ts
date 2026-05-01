import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, stepCountIs, streamText, tool } from "ai";
import type { TextStreamPart, ToolSet } from "ai";
import type { DocumentRecord, DocumentSourceRecord, UserRecord } from "../db/schema.ts";
import type {
  AppSettings,
  DocumentInput,
  DocumentSourceInput,
  DocumentSourceUpdate,
} from "../documents/repository.ts";

export type WritingAssistInput = {
  draftContent?: string;
  draftTitle?: string;
  document?: DocumentRecord;
  currentDocumentId?: string;
  messages?: WritingAssistMessage[];
  model?: string;
  reasoningEffort?: string;
  thinkingEnabled?: boolean;
  toolContext?: WritingAssistToolContext;
  sources: DocumentSourceRecord[];
  instruction: string;
};

export type WritingAssistMessage = {
  role: "assistant" | "user";
  content: string;
};

export type WritingAssistResult = {
  suggestion: string;
  model: string;
  usedSources: number;
};

export type WritingAssistStreamResult = {
  format?: "events" | "text";
  model: string;
  stream: ReadableStream<Uint8Array>;
  usedSources: number;
};

export type WritingAssistToolEvent = {
  input?: unknown;
  inputSummary?: string;
  output?: unknown;
  approvalToken?: string;
  risk?: ToolRisk;
  state: "approval_required" | "approved" | "call" | "denied" | "error" | "result";
  toolCallId: string;
  toolName: string;
};

export type ToolRisk = "low" | "high";

export type ApprovalRequest = {
  input: unknown;
  inputSummary: string;
  output: unknown;
  risk: ToolRisk;
  toolName: string;
};

export type WritingAssistToolContext = {
  createApproval(request: ApprovalRequest): string;
  currentDocumentId?: string;
  createDocument(input: DocumentInput): unknown;
  createSource(input: DocumentSourceInput, linkToDocumentId?: string): unknown;
  deleteDocument(documentId: string): unknown;
  deleteSource(sourceId: string): unknown;
  fetchUrl(url: string): Promise<unknown>;
  getProfile(): UserRecord | null;
  getSettings(): AppSettings;
  importSources(input: { message: string; linkToDocumentId?: string }): Promise<unknown>;
  linkSourceToDocument(documentId: string, sourceId: string): unknown;
  listDocumentSources(documentId?: string): DocumentSourceRecord[];
  listDocuments(): DocumentRecord[];
  listModels(): Promise<string[]>;
  listSources(): DocumentSourceRecord[];
  readDocument(documentId?: string): DocumentRecord | null;
  readSource(sourceId: string): DocumentSourceRecord | null;
  searchWorkspace(query: string, limit?: number): unknown;
  unlinkSourceFromDocument(documentId: string, sourceId: string): unknown;
  updateAppSettings(input: Partial<AppSettings>): unknown;
  updateDocument(documentId: string, input: DocumentInput): DocumentRecord | null;
  updateProfile(input: { name?: string; picture?: string }): Promise<unknown>;
  updateSource(sourceId: string, input: DocumentSourceUpdate): unknown;
};

export type WritingAssistant = {
  generate(input: WritingAssistInput): Promise<WritingAssistResult>;
  models(): Promise<string[]>;
  stream(input: WritingAssistInput): Promise<WritingAssistStreamResult>;
};

export class WritingAssistantConfigurationError extends Error {
  constructor(message = "LLM is not configured") {
    super(message);
    this.name = "WritingAssistantConfigurationError";
  }
}

type ModelsResponse = {
  data?: Array<{
    id?: unknown;
  }>;
};

type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      reasoning_delta?: unknown;
    };
  }>;
  usage?: unknown;
};

type ResponsesStreamEvent = {
  delta?: unknown;
  response?: {
    usage?: unknown;
  };
  type?: unknown;
};

type StreamUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type StreamDelta = {
  reasoning: string;
  text: string;
  usage?: StreamUsage;
};

const defaultTimeoutMs = 120_000;

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, timer };
}

function configuredTimeout(env: NodeJS.ProcessEnv) {
  const value = Number(env.LLM_TIMEOUT_MS ?? env.OPENAI_TIMEOUT_MS ?? defaultTimeoutMs);
  return Number.isFinite(value) && value > 0 ? value : defaultTimeoutMs;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
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

function formatSources(sources: DocumentSourceRecord[]) {
  if (sources.length === 0) {
    return "No sources provided.";
  }

  return sources
    .map((source, index) => {
      const details = [
        `Type: ${source.type}`,
        `Title: ${source.title}`,
        parseTags(source.tags).length > 0 ? `Tags: ${parseTags(source.tags).join(", ")}` : null,
        source.note ? `Note: ${source.note}` : null,
        source.url ? `URL: ${source.url}` : null,
        source.fileName ? `File: ${source.fileName}` : null,
      ].filter(Boolean);

      return `Source ${index + 1}\n${details.join("\n")}`;
    })
    .join("\n\n");
}

function sourceSummary(source: DocumentSourceRecord) {
  return {
    id: source.id,
    fileName: source.fileName,
    note: truncate(source.note, 2_000),
    tags: parseTags(source.tags),
    title: source.title,
    type: source.type,
    updatedAt: source.updatedAt,
    url: source.url,
  };
}

function documentSummary(document: DocumentRecord) {
  return {
    content: document.content,
    id: document.id,
    title: document.title,
    updatedAt: document.updatedAt,
  };
}

function buildUserPrompt(input: WritingAssistInput) {
  const title = input.draftTitle ?? input.document?.title ?? "No document selected";
  const content = input.draftContent ?? input.document?.content ?? "";
  return [
    `Instruction:\n${input.instruction}`,
    input.currentDocumentId ? `Current document id:\n${input.currentDocumentId}` : null,
    `Current draft title:\n${title}`,
    `Current draft body:\n${truncate(content, 8_000)}`,
    `Information sources:\n${formatSources(input.sources)}`,
    input.messages?.length
      ? `Conversation:\n${input.messages
          .map((message) => `${message.role}: ${truncate(message.content, 4_000)}`)
          .join("\n\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

const systemPrompt =
  "You are OnlyWrite's writing assistant. Use the document and information sources as grounded context. Do not invent facts that are not supported by the context. Write in the same language as the user's instruction or document.";

const agentSystemPrompt = `${systemPrompt}

You are also an OnlyWrite workspace agent. You can call tools to inspect and update the user's documents, sources, document-source links, app settings, profile, and available AI models.
- Prefer searchWorkspace, listDocuments, listSources, readDocument, and readSource before guessing.
- Use the current document id when the user says "this document" or "current document".
- Creates, ordinary updates, and source links are allowed when clearly requested.
- Deletes, unlinks, profile changes, and app settings changes require explicit user approval; those tools will return an approval request instead of executing immediately.
- Authentication routes, health, and readiness are unavailable.
After tool calls, briefly explain what changed or what you found.`;

function writeEvent(
  encoder: { encode(value?: string): Uint8Array },
  type: "reasoning" | "text" | "tool" | "usage",
  delta: string | StreamUsage | WritingAssistToolEvent,
) {
  return encoder.encode(JSON.stringify({ type, delta }) + "\n");
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readUsage(value: unknown): StreamUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const usage = {
    inputTokens: readNumber(record.prompt_tokens ?? record.input_tokens),
    outputTokens: readNumber(record.completion_tokens ?? record.output_tokens),
    totalTokens: readNumber(record.total_tokens),
  };

  return Object.values(usage).some((token) => typeof token === "number") ? usage : undefined;
}

function readChatCompletionsDelta(chunk: ChatCompletionStreamChunk): StreamDelta {
  const delta = chunk.choices?.[0]?.delta;
  const usage = readUsage(chunk.usage);
  if (!delta) {
    return { reasoning: "", text: "", usage };
  }

  return {
    reasoning:
      readString(delta.reasoning_content) ||
      readString(delta.reasoning) ||
      readString(delta.reasoning_delta),
    text: readString(delta.content),
    usage,
  };
}

function readResponsesDelta(event: ResponsesStreamEvent): StreamDelta {
  const type = readString(event.type);
  const delta = readString(event.delta);
  const usage = readUsage(event.response?.usage);
  if (!delta) {
    return { reasoning: "", text: "", usage };
  }

  if (type === "response.output_text.delta") {
    return { reasoning: "", text: delta, usage };
  }

  if (
    type === "response.reasoning.delta" ||
    type === "response.reasoning_text.delta" ||
    type === "response.reasoning_summary_text.delta"
  ) {
    return { reasoning: delta, text: "", usage };
  }

  return { reasoning: "", text: "", usage };
}

function chatCompletionsBody(
  input: WritingAssistInput,
  model: string,
  defaultReasoningEffort?: string,
  defaultThinkingEnabled?: boolean,
) {
  const reasoningEffort = input.reasoningEffort || defaultReasoningEffort;
  const thinkingEnabled = input.thinkingEnabled ?? defaultThinkingEnabled;
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserPrompt(input) },
    ],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.4,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(thinkingEnabled
      ? {
          enable_thinking: true,
          thinking: { type: "enabled" },
        }
      : {}),
  };
}

function responsesBody(
  input: WritingAssistInput,
  model: string,
  defaultReasoningEffort?: string,
  defaultThinkingEnabled?: boolean,
) {
  const reasoningEffort = input.reasoningEffort || defaultReasoningEffort;
  const thinkingEnabled = input.thinkingEnabled ?? defaultThinkingEnabled;
  return {
    input: buildUserPrompt(input),
    instructions: systemPrompt,
    model,
    stream: true,
    ...(reasoningEffort || thinkingEnabled
      ? {
          reasoning: {
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
            ...(thinkingEnabled ? { summary: "auto" } : {}),
          },
        }
      : {}),
  };
}

function configuredStreamApi(env: NodeJS.ProcessEnv) {
  const mode = (env.LLM_STREAM_API ?? env.OPENAI_STREAM_API ?? "").trim().toLowerCase();
  if (mode === "responses" || mode === "chat") {
    return mode;
  }

  return "responses";
}

function encodeOpenAICompatibleStream(
  stream: ReadableStream<Uint8Array>,
  readDelta: (data: unknown) => StreamDelta,
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      let buffer = "";

      function handleEvent(rawEvent: string) {
        const dataLines = rawEvent
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) {
          return;
        }

        const data = dataLines.join("\n");
        if (!data || data === "[DONE]") {
          return;
        }

        try {
          const parsed = JSON.parse(data) as unknown;
          const delta = readDelta(parsed);
          if (delta.reasoning) {
            controller.enqueue(writeEvent(encoder, "reasoning", delta.reasoning));
          }
          if (delta.text) {
            controller.enqueue(writeEvent(encoder, "text", delta.text));
          }
          if (delta.usage) {
            controller.enqueue(writeEvent(encoder, "usage", delta.usage));
          }
        } catch {
          // Ignore malformed or provider-specific chunks that do not match our event model.
        }
      }

      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          for (const event of events) {
            handleEvent(event);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          handleEvent(buffer);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function objectInput(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toolInputSummary(input: unknown) {
  const value = JSON.stringify(input);
  return truncate(value === undefined ? "{}" : value, 240);
}

function approvedLater(context: WritingAssistToolContext, toolName: string, input: unknown) {
  const inputSummary = toolInputSummary(input);
  const output = {
    message: "Approval required before this tool can execute.",
    toolName,
  };
  return {
    __onlywriteApprovalRequired: true,
    approvalToken: context.createApproval({
      input,
      inputSummary,
      output,
      risk: "high",
      toolName,
    }),
    inputSummary,
    output,
    risk: "high" satisfies ToolRisk,
  };
}

function toolOutputHasError(output: unknown) {
  return Boolean(
    output &&
    typeof output === "object" &&
    typeof (output as { error?: unknown }).error === "string",
  );
}

const emptyObjectSchema = jsonSchema<Record<string, never>>({
  additionalProperties: false,
  properties: {},
  type: "object",
});

function createAgentTools(context: WritingAssistToolContext) {
  return {
    createDocument: tool({
      description: "Create a new document in the user's workspace.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          title: { type: "string" },
        },
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        const document = context.createDocument({
          content: optionalString(record, "content"),
          title: optionalString(record, "title"),
        });
        return document;
      },
    }),
    createSource: tool({
      description: "Create a reference source for the user. Optionally link it to a document.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          fileName: { type: "string" },
          linkToCurrentDocument: { type: "boolean" },
          linkToDocumentId: { type: "string" },
          note: { type: "string" },
          tags: { items: { type: "string" }, type: "array" },
          title: { type: "string" },
          type: { enum: ["text", "rss", "pdf", "image"], type: "string" },
          url: { type: "string" },
        },
        required: ["type"],
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        const linkToDocumentId =
          optionalString(record, "linkToDocumentId") ??
          (record.linkToCurrentDocument === true ? context.currentDocumentId : undefined);
        const source = context.createSource(
          {
            fileName: optionalString(record, "fileName"),
            note: optionalString(record, "note"),
            tags: optionalStringArray(record, "tags"),
            title: optionalString(record, "title"),
            type:
              record.type === "rss" || record.type === "pdf" || record.type === "image"
                ? record.type
                : "text",
            url: optionalString(record, "url"),
          },
          linkToDocumentId,
        );
        return source;
      },
    }),
    linkSource: tool({
      description: "Link an existing source to the current document.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { sourceId: { type: "string" } },
        required: ["sourceId"],
        type: "object",
      }),
      execute: async (input) => {
        const documentId = context.currentDocumentId;
        if (!documentId) {
          return { error: "No current document selected" };
        }
        return context.linkSourceToDocument(
          documentId,
          optionalString(objectInput(input), "sourceId") ?? "",
        );
      },
    }),
    deleteDocument: tool({
      description: "Delete a document. This is high risk and requires user approval.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
        type: "object",
      }),
      execute: async (input) => approvedLater(context, "deleteDocument", input),
    }),
    deleteSource: tool({
      description: "Delete a source. This is high risk and requires user approval.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { sourceId: { type: "string" } },
        required: ["sourceId"],
        type: "object",
      }),
      execute: async (input) => approvedLater(context, "deleteSource", input),
    }),
    getProfile: tool({
      description: "Read the current user's profile.",
      inputSchema: emptyObjectSchema,
      execute: async () => context.getProfile(),
    }),
    getSettings: tool({
      description: "Read the current user's app settings.",
      inputSchema: emptyObjectSchema,
      execute: async () => context.getSettings(),
    }),
    fetchUrl: tool({
      description:
        "Fetch a public HTTP(S) URL in real time so the agent can inspect page, RSS, or plain text content. Server-side URL safety restrictions apply.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { url: { type: "string" } },
        required: ["url"],
        type: "object",
      }),
      execute: async (input) => {
        const url = optionalString(objectInput(input), "url");
        return url ? context.fetchUrl(url) : { error: "URL is required" };
      },
    }),
    importSources: tool({
      description:
        "Import sources from a user instruction or URL. Server-side URL safety restrictions apply.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          linkToDocumentId: { type: "string" },
          message: { type: "string" },
        },
        required: ["message"],
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        return context.importSources({
          linkToDocumentId: optionalString(record, "linkToDocumentId"),
          message: optionalString(record, "message") ?? "",
        });
      },
    }),
    linkSourceToDocument: tool({
      description: "Link an existing source to a document.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { documentId: { type: "string" }, sourceId: { type: "string" } },
        required: ["documentId", "sourceId"],
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        return context.linkSourceToDocument(
          optionalString(record, "documentId") ?? "",
          optionalString(record, "sourceId") ?? "",
        );
      },
    }),
    listDocumentSources: tool({
      description: "List sources that are linked to a document.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { documentId: { type: "string" } },
        type: "object",
      }),
      execute: async (input) =>
        context
          .listDocumentSources(optionalString(objectInput(input), "documentId"))
          .map(sourceSummary),
    }),
    listDocuments: tool({
      description: "List documents owned by the current user.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { limit: { maximum: 50, minimum: 1, type: "number" } },
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        const limit =
          typeof record.limit === "number" ? Math.min(Math.max(record.limit, 1), 50) : 20;
        return context
          .listDocuments()
          .slice(0, limit)
          .map((document) => ({
            id: document.id,
            title: document.title,
            updatedAt: document.updatedAt,
          }));
      },
    }),
    listSources: tool({
      description: "List all sources owned by the current user.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          limit: { maximum: 50, minimum: 1, type: "number" },
          tag: { type: "string" },
        },
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        const tag = optionalString(record, "tag")?.toLowerCase();
        const limit =
          typeof record.limit === "number" ? Math.min(Math.max(record.limit, 1), 50) : 20;
        return context
          .listSources()
          .filter(
            (source) => !tag || parseTags(source.tags).some((item) => item.toLowerCase() === tag),
          )
          .slice(0, limit)
          .map(sourceSummary);
      },
    }),
    listModels: tool({
      description: "List available AI models.",
      inputSchema: emptyObjectSchema,
      execute: async () => ({ models: await context.listModels() }),
    }),
    readDocument: tool({
      description: "Read a document title and full markdown content.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { documentId: { type: "string" } },
        type: "object",
      }),
      execute: async (input) => {
        const document = context.readDocument(optionalString(objectInput(input), "documentId"));
        return document ? documentSummary(document) : { error: "Document not found" };
      },
    }),
    readSource: tool({
      description: "Read one source by id.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { sourceId: { type: "string" } },
        required: ["sourceId"],
        type: "object",
      }),
      execute: async (input) => {
        const source = context.readSource(optionalString(objectInput(input), "sourceId") ?? "");
        return source ? sourceSummary(source) : { error: "Source not found" };
      },
    }),
    searchWorkspace: tool({
      description: "Search documents and sources by keyword.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          limit: { maximum: 20, minimum: 1, type: "number" },
          query: { type: "string" },
        },
        required: ["query"],
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        const limit =
          typeof record.limit === "number" ? Math.min(Math.max(record.limit, 1), 20) : 10;
        return context.searchWorkspace(optionalString(record, "query") ?? "", limit);
      },
    }),
    unlinkSourceFromDocument: tool({
      description: "Unlink a source from a document. This is high risk and requires user approval.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { documentId: { type: "string" }, sourceId: { type: "string" } },
        required: ["documentId", "sourceId"],
        type: "object",
      }),
      execute: async (input) => approvedLater(context, "unlinkSourceFromDocument", input),
    }),
    updateAppSettings: tool({
      description: "Update app settings. This is high risk and requires user approval.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          defaultDocumentTitle: { type: "string" },
          editorLineHeight: { enum: ["comfortable", "compact", "relaxed"], type: "string" },
          sourcePanelDefaultOpen: { type: "boolean" },
        },
        type: "object",
      }),
      execute: async (input) => approvedLater(context, "updateAppSettings", input),
    }),
    updateDocument: tool({
      description: "Update a document title and/or markdown content.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          documentId: { type: "string" },
          title: { type: "string" },
        },
        required: ["documentId"],
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        const updated = context.updateDocument(optionalString(record, "documentId") ?? "", {
          content: optionalString(record, "content"),
          title: optionalString(record, "title"),
        });
        return updated ? documentSummary(updated) : { error: "Document not found" };
      },
    }),
    updateProfile: tool({
      description:
        "Update the current user's profile. This is high risk and requires user approval.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          picture: { type: "string" },
        },
        type: "object",
      }),
      execute: async (input) => approvedLater(context, "updateProfile", input),
    }),
    updateSource: tool({
      description: "Update an existing source.",
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          fileName: { type: "string" },
          note: { type: "string" },
          sourceId: { type: "string" },
          tags: { items: { type: "string" }, type: "array" },
          title: { type: "string" },
          type: { enum: ["text", "rss", "pdf", "image"], type: "string" },
          url: { type: "string" },
        },
        required: ["sourceId"],
        type: "object",
      }),
      execute: async (input) => {
        const record = objectInput(input);
        return context.updateSource(optionalString(record, "sourceId") ?? "", {
          fileName: optionalString(record, "fileName"),
          note: optionalString(record, "note"),
          tags: optionalStringArray(record, "tags"),
          title: optionalString(record, "title"),
          type:
            record.type === "rss" ||
            record.type === "pdf" ||
            record.type === "image" ||
            record.type === "text"
              ? record.type
              : undefined,
          url: optionalString(record, "url"),
        });
      },
    }),
  };
}

function encodeAgentStream<TOOLS extends ToolSet>(stream: {
  fullStream: AsyncIterable<TextStreamPart<TOOLS>>;
}) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of stream.fullStream) {
          if (part.type === "text-delta") {
            controller.enqueue(writeEvent(encoder, "text", part.text));
          }
          if (part.type === "reasoning-delta") {
            controller.enqueue(writeEvent(encoder, "reasoning", part.text));
          }
          if (part.type === "tool-call") {
            controller.enqueue(
              writeEvent(encoder, "tool", {
                input: part.input,
                inputSummary: toolInputSummary(part.input),
                risk: "low",
                state: "call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              }),
            );
          }
          if (part.type === "tool-result") {
            const approval =
              part.output &&
              typeof part.output === "object" &&
              (part.output as { __onlywriteApprovalRequired?: unknown })
                .__onlywriteApprovalRequired === true
                ? (part.output as {
                    approvalToken?: string;
                    inputSummary?: string;
                    output?: unknown;
                    risk?: ToolRisk;
                  })
                : null;
            controller.enqueue(
              writeEvent(encoder, "tool", {
                ...(approval
                  ? {
                      approvalToken: approval.approvalToken,
                      inputSummary: approval.inputSummary,
                      output: approval.output,
                      risk: approval.risk ?? "high",
                      state: "approval_required" as const,
                    }
                  : {
                      output: part.output,
                      risk: "low" as const,
                      state: toolOutputHasError(part.output)
                        ? ("error" as const)
                        : ("result" as const),
                    }),
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              }),
            );
          }
          if (part.type === "tool-error") {
            controller.enqueue(
              writeEvent(encoder, "tool", {
                output: { error: String(part.error) },
                state: "error",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              }),
            );
          }
          if (part.type === "finish") {
            const usage = {
              inputTokens: part.totalUsage.inputTokens,
              outputTokens: part.totalUsage.outputTokens,
              totalTokens: part.totalUsage.totalTokens,
            };
            if (Object.values(usage).some((token) => typeof token === "number")) {
              controller.enqueue(writeEvent(encoder, "usage", usage));
            }
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export function createOpenAICompatibleWritingAssistant(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): WritingAssistant {
  const apiKey = env.LLM_API_KEY ?? env.OPENAI_API_KEY;
  const baseUrl = (env.LLM_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = env.LLM_MODEL ?? env.OPENAI_MODEL ?? "gpt-4.1-mini";
  let modelsCache: { expiresAt: number; models: string[] } | null = null;
  const provider = createOpenAICompatible({
    apiKey,
    baseURL: baseUrl,
    fetch: fetcher,
    name: "onlywrite",
  });
  const defaultReasoningEffort = env.LLM_REASONING_EFFORT ?? env.OPENAI_REASONING_EFFORT;
  const defaultThinkingEnabled =
    env.LLM_ENABLE_THINKING === "true" || env.OPENAI_ENABLE_THINKING === "true";
  const timeoutMs = configuredTimeout(env);

  function providerOptions(input: WritingAssistInput) {
    const reasoningEffort = input.reasoningEffort || defaultReasoningEffort;
    const thinkingEnabled = input.thinkingEnabled ?? defaultThinkingEnabled;
    return reasoningEffort || thinkingEnabled
      ? {
          onlywrite: {
            ...(thinkingEnabled ? { enable_thinking: true } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        }
      : undefined;
  }

  return {
    async generate(input) {
      if (!apiKey) {
        throw new WritingAssistantConfigurationError();
      }

      const requestModel = input.model || model;
      const result = await generateText({
        model: provider.chatModel(requestModel),
        prompt: buildUserPrompt(input),
        providerOptions: providerOptions(input),
        system: systemPrompt,
        temperature: 0.4,
      });
      if (result.text.trim() === "") {
        throw new Error("LLM response did not include text");
      }

      return {
        suggestion: result.text.trim(),
        model: requestModel,
        usedSources: input.sources.length,
      };
    },

    async models() {
      if (!apiKey) {
        throw new WritingAssistantConfigurationError();
      }
      if (modelsCache && modelsCache.expiresAt > Date.now()) {
        return modelsCache.models;
      }

      const response = await fetcher(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`LLM models request failed with status ${response.status}`);
      }

      const body = (await response.json()) as ModelsResponse;
      const models = (body.data ?? [])
        .map((candidate) => candidate.id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .sort((first, second) => first.localeCompare(second));
      modelsCache = {
        expiresAt: Date.now() + 5 * 60 * 1000,
        models: models.length ? models : [model],
      };
      return modelsCache.models;
    },

    async stream(input) {
      if (!apiKey) {
        throw new WritingAssistantConfigurationError();
      }

      const requestModel = input.model || model;
      if (input.toolContext) {
        const result = streamText({
          model: provider.chatModel(requestModel),
          prompt: buildUserPrompt(input),
          providerOptions: providerOptions(input),
          stopWhen: stepCountIs(6),
          system: agentSystemPrompt,
          temperature: 0.4,
          tools: createAgentTools(input.toolContext),
        });

        return {
          format: "events",
          model: requestModel,
          stream: encodeAgentStream(result),
          usedSources: input.sources.length,
        };
      }

      const streamApi = configuredStreamApi(env);
      const timeout = timeoutSignal(timeoutMs);
      let response: Response;
      try {
        response = await fetcher(
          streamApi === "responses" ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`,
          {
            method: "POST",
            body: JSON.stringify(
              streamApi === "responses"
                ? responsesBody(input, requestModel, defaultReasoningEffort, defaultThinkingEnabled)
                : chatCompletionsBody(
                    input,
                    requestModel,
                    defaultReasoningEffort,
                    defaultThinkingEnabled,
                  ),
            ),
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            signal: timeout.signal,
          },
        );
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          throw new Error("LLM stream request timed out");
        }

        throw error;
      } finally {
        clearTimeout(timeout.timer);
      }
      if (!response.ok) {
        throw new Error(`LLM stream request failed with status ${response.status}`);
      }
      if (!response.body) {
        throw new Error("LLM stream response did not include a body");
      }

      return {
        format: "events",
        model: requestModel,
        stream: encodeOpenAICompatibleStream(response.body, (data) =>
          streamApi === "responses"
            ? readResponsesDelta(data as ResponsesStreamEvent)
            : readChatCompletionsDelta(data as ChatCompletionStreamChunk),
        ),
        usedSources: input.sources.length,
      };
    },
  };
}
