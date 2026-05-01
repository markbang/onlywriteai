export type Document = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type DocumentInput = {
  title?: string;
  content?: string;
};

export type DocumentSourceType = "text" | "rss" | "pdf" | "image";

export type DocumentSource = {
  id: string;
  type: DocumentSourceType;
  title: string;
  note: string;
  url: string | null;
  fileName: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type GlobalDocumentSource = DocumentSource & {
  documents: Array<{
    id: string;
    title: string;
  }>;
};

export type DocumentSourceInput = {
  type: DocumentSourceType;
  title?: string;
  note?: string;
  url?: string;
  fileName?: string;
  tags?: string[];
};

export type DocumentSourceUpdate = Partial<DocumentSourceInput>;

export type WritingAssistInput = {
  documentId?: string;
  draftContent?: string;
  draftTitle?: string;
  instruction?: string;
  messages?: WritingAssistMessage[];
  model?: string;
  reasoningEffort?: string;
  thinkingEnabled?: boolean;
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

export type WritingAssistUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type WritingAssistToolEvent = {
  input?: unknown;
  inputSummary?: string;
  output?: unknown;
  approvalToken?: string;
  risk?: "low" | "high";
  state: "approval_required" | "approved" | "call" | "denied" | "error" | "result";
  toolCallId: string;
  toolName: string;
};

export type AgentConversationMessagePart =
  | { content: string; id: string; type: "text" }
  | { id: string; toolCallId: string; type: "tool" };

export type ApprovedToolResult = {
  output: unknown;
  toolCallId: string;
  toolName: string;
};

export type AgentConversationMessage = WritingAssistMessage & {
  completedAt?: number;
  id: string;
  model?: string;
  parts?: AgentConversationMessagePart[];
  reasoning?: string;
  startedAt?: number;
  toolEvents?: WritingAssistToolEvent[];
  usage?: WritingAssistUsage;
};

export type AgentConversation = {
  id: string;
  userId: string;
  documentId: string | null;
  title: string;
  messages: AgentConversationMessage[];
  createdAt: number;
  updatedAt: number;
};

export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type AuthStatus = {
  enabled: boolean;
  user: AuthUser | null;
};

export type AppSettings = {
  defaultDocumentTitle: string;
  editorLineHeight: "comfortable" | "compact" | "relaxed";
  sourcePanelDefaultOpen: boolean;
};

export type Settings = {
  app: AppSettings;
  profile: AuthUser | null;
};

export type ProfileInput = {
  name?: string;
  picture?: string;
};

export type SourceImportInput = {
  message: string;
};

export type SourceImportResult = {
  sources: DocumentSource[];
  model: string;
  fetchedUrls: number;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const defaultFetch: typeof fetch = (...args) => fetch(...args);

async function request<T>(
  path: string,
  init: RequestInit = {},
  fetcher = defaultFetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetcher(`/api${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const body = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      message = (body as { error: { message: string } }).error.message;
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(
      `Expected JSON response but received ${contentType || "unknown"}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export function getHealth(fetcher?: typeof fetch) {
  return request<{ ok: true }>("/health", {}, fetcher);
}

export function getAuthStatus(fetcher?: typeof fetch) {
  return request<AuthStatus>("/auth/me", {}, fetcher);
}

export function logout(fetcher?: typeof fetch) {
  return request<void>("/auth/logout", { method: "POST" }, fetcher);
}

export function getSettings(fetcher?: typeof fetch) {
  return request<Settings>("/settings", {}, fetcher);
}

export function listModels(fetcher?: typeof fetch) {
  return request<{ models: string[] }>("/models", {}, fetcher);
}

export function updateAppSettings(input: Partial<AppSettings>, fetcher?: typeof fetch) {
  return request<AppSettings>(
    "/settings/app",
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function updateProfile(input: ProfileInput, fetcher?: typeof fetch) {
  return request<AuthUser>(
    "/settings/profile",
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function listDocuments(fetcher?: typeof fetch) {
  return request<Document[]>("/documents", {}, fetcher);
}

export function getDocument(id: string, fetcher?: typeof fetch) {
  return request<Document>(`/documents/${id}`, {}, fetcher);
}

export function createDocument(input: DocumentInput, fetcher?: typeof fetch) {
  return request<Document>("/documents", { method: "POST", body: JSON.stringify(input) }, fetcher);
}

export function updateDocument(id: string, input: DocumentInput, fetcher?: typeof fetch) {
  return request<Document>(
    `/documents/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function deleteDocument(id: string, fetcher?: typeof fetch) {
  return request<void>(`/documents/${id}`, { method: "DELETE" }, fetcher);
}

export function listDocumentSources(documentId: string, fetcher?: typeof fetch) {
  return request<DocumentSource[]>(`/documents/${documentId}/sources`, {}, fetcher);
}

export function listSources(fetcher?: typeof fetch) {
  return request<GlobalDocumentSource[]>("/sources", {}, fetcher);
}

export function createSource(input: DocumentSourceInput, fetcher?: typeof fetch) {
  return request<DocumentSource>(
    "/sources",
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

export function updateSource(
  sourceId: string,
  input: DocumentSourceUpdate,
  fetcher?: typeof fetch,
) {
  return request<DocumentSource>(
    `/sources/${sourceId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function deleteSource(sourceId: string, fetcher?: typeof fetch) {
  return request<void>(`/sources/${sourceId}`, { method: "DELETE" }, fetcher);
}

export function importSources(input: SourceImportInput, fetcher?: typeof fetch) {
  return request<SourceImportResult>(
    "/sources/import",
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

export function createDocumentSource(
  documentId: string,
  input: DocumentSourceInput,
  fetcher?: typeof fetch,
) {
  return request<DocumentSource>(
    `/documents/${documentId}/sources`,
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

export function linkDocumentSource(documentId: string, sourceId: string, fetcher?: typeof fetch) {
  return request<DocumentSource>(
    `/documents/${documentId}/sources`,
    { method: "POST", body: JSON.stringify({ sourceId }) },
    fetcher,
  );
}

export function updateDocumentSource(
  documentId: string,
  sourceId: string,
  input: DocumentSourceUpdate,
  fetcher?: typeof fetch,
) {
  return request<DocumentSource>(
    `/documents/${documentId}/sources/${sourceId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function deleteDocumentSource(documentId: string, sourceId: string, fetcher?: typeof fetch) {
  return request<void>(
    `/documents/${documentId}/sources/${sourceId}`,
    { method: "DELETE" },
    fetcher,
  );
}

export function generateWritingAssistance(
  documentId: string,
  input: WritingAssistInput,
  fetcher?: typeof fetch,
) {
  return request<WritingAssistResult>(
    `/documents/${documentId}/assist`,
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

export function executeApprovedTool(approvalToken: string, fetcher?: typeof fetch) {
  return request<ApprovedToolResult>(
    "/agent/tools/execute-approved",
    { method: "POST", body: JSON.stringify({ approvalToken }) },
    fetcher,
  );
}

export function listAgentConversations(documentId?: string, fetcher?: typeof fetch) {
  const query = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
  return request<AgentConversation[]>(`/agent/conversations${query}`, {}, fetcher);
}

export function createAgentConversation(
  input: {
    documentId?: string | null;
    messages?: AgentConversationMessage[];
    title?: string;
  },
  fetcher?: typeof fetch,
) {
  return request<AgentConversation>(
    "/agent/conversations",
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

export function updateAgentConversation(
  id: string,
  input: {
    messages?: AgentConversationMessage[];
    title?: string;
  },
  fetcher?: typeof fetch,
) {
  return request<AgentConversation>(
    `/agent/conversations/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function generateAgentConversationTitle(
  input: {
    documentId?: string | null;
    draftTitle?: string;
    messages: AgentConversationMessage[];
    model?: string;
  },
  fetcher?: typeof fetch,
) {
  return request<{ model: string; title: string }>(
    "/agent/conversations/title",
    { method: "POST", body: JSON.stringify(input) },
    fetcher,
  );
}

async function streamAssistantEndpoint(
  path: string,
  input: WritingAssistInput,
  onChunk: (chunk: string) => void,
  fetcher = defaultFetch,
  signal?: AbortSignal,
  onReasoning?: (chunk: string) => void,
  onTool?: (event: WritingAssistToolEvent) => void,
  onUsage?: (usage: WritingAssistUsage) => void,
) {
  const response = await fetcher(path, {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    signal,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const body = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      message = (body as { error: { message: string } }).error.message;
    }
    throw new ApiError(message, response.status);
  }

  if (!response.body) {
    throw new ApiError("Response did not include a stream", response.status);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let suggestion = "";
  let buffer = "";
  const isEventStream = response.headers.get("x-onlywrite-stream-format") === "events";

  function readEventLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const event = JSON.parse(line) as { delta?: unknown; type?: unknown };
    if (event.type === "usage" && event.delta && typeof event.delta === "object") {
      onUsage?.(event.delta as WritingAssistUsage);
      return;
    }

    if (event.type === "tool" && event.delta && typeof event.delta === "object") {
      onTool?.(event.delta as WritingAssistToolEvent);
      return;
    }

    if (typeof event.delta !== "string") {
      return;
    }

    if (event.type === "reasoning") {
      onReasoning?.(event.delta);
      return;
    }

    if (event.type === "text") {
      suggestion += event.delta;
      onChunk(event.delta);
    }
  }

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    const text = decoder.decode(chunk.value, { stream: true });
    if (isEventStream) {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        readEventLine(line);
      }
      continue;
    }

    suggestion += text;
    onChunk(text);
  }

  const tail = decoder.decode();
  if (isEventStream) {
    buffer += tail;
    if (buffer.trim()) {
      readEventLine(buffer);
    }
  } else if (tail) {
    suggestion += tail;
    onChunk(tail);
  }

  return {
    suggestion,
    model: response.headers.get("x-onlywrite-model") ?? "streaming-model",
    usedSources: Number(response.headers.get("x-onlywrite-used-sources") ?? 0),
  };
}

export async function streamWritingAssistance(
  documentId: string,
  input: WritingAssistInput,
  onChunk: (chunk: string) => void,
  fetcher = defaultFetch,
  signal?: AbortSignal,
  onReasoning?: (chunk: string) => void,
  onTool?: (event: WritingAssistToolEvent) => void,
  onUsage?: (usage: WritingAssistUsage) => void,
) {
  return streamAssistantEndpoint(
    `/api/documents/${documentId}/assist/stream`,
    input,
    onChunk,
    fetcher,
    signal,
    onReasoning,
    onTool,
    onUsage,
  );
}

export async function streamAgentAssistance(
  input: WritingAssistInput,
  onChunk: (chunk: string) => void,
  fetcher = defaultFetch,
  signal?: AbortSignal,
  onReasoning?: (chunk: string) => void,
  onTool?: (event: WritingAssistToolEvent) => void,
  onUsage?: (usage: WritingAssistUsage) => void,
) {
  return streamAssistantEndpoint(
    "/api/agent/assist/stream",
    input,
    onChunk,
    fetcher,
    signal,
    onReasoning,
    onTool,
    onUsage,
  );
}
