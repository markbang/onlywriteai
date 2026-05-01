import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import {
  ApiError,
  createAgentConversation,
  executeApprovedTool,
  generateAgentConversationTitle,
  listAgentConversations,
  listDocumentSources,
  listModels,
  streamAgentAssistance,
  streamWritingAssistance,
  updateAgentConversation,
  type AgentConversation,
  type AgentConversationMessagePart,
  type AgentConversationMessage,
  type Document,
  type WritingAssistToolEvent,
} from "../api/documents.ts";

type AiComposerProps = {
  documentId?: string;
  draftContent?: string;
  draftTitle?: string;
  initialInstruction: string;
  launchRequest?: {
    autoSend?: boolean;
    id: number;
    instruction: string;
  } | null;
  onActivityChange?: (activity: AiComposerActivity) => void;
  onClose?: () => void;
  onExpand?: () => void;
  onInsert?: (suggestion: string) => void;
  onDocumentUpdated?: (document: Document) => void;
  onReplace?: (suggestion: string) => void;
  onToggleExpanded?: () => void;
  variant?: "mini" | "panel";
  isExpanded?: boolean;
};

type AgentMessage = AgentConversationMessage;

export type AiComposerActivity = {
  isStreaming: boolean;
  model: string;
  preview: string;
  title: string;
};

const modelStorageKey = "onlywrite.ai.model";
const thinkingStorageKey = "onlywrite.ai.thinking";
const handledLaunchRequestIds = new Set<number>();

type MarkdownCodeProps = ComponentProps<"code"> & {
  "data-block"?: boolean | string;
};

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map((child) => textFromChildren(child)).join("");
  }

  return "";
}

function languageFromClassName(className?: string) {
  return className?.match(/language-([^\s]+)/)?.[1] ?? "text";
}

function trimCodeBlock(value: string) {
  return value.replace(/\n$/, "");
}

function AiCodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;

    void import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(code || " ", {
          lang: language || "text",
          theme: "github-dark",
        }),
      )
      .then((value) => {
        if (!cancelled) {
          setHtml(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div className="ai-code-block" data-language={language}>
      <div className="ai-code-block-header">
        <span>{language}</span>
        <button
          className="ai-code-copy"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(code)}
          aria-label="Copy code"
          title="Copy code"
        >
          <span className="i-lucide-copy h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {html ? (
        <div
          className="ai-code-block-body"
          // Shiki returns escaped highlighted HTML for code input.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="ai-code-block-fallback">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function AiMarkdownCode({ children, className, ...props }: MarkdownCodeProps) {
  const code = textFromChildren(children);
  const isBlock = Boolean(props["data-block"]) || code.includes("\n");

  if (isBlock) {
    return <AiCodeBlock code={trimCodeBlock(code)} language={languageFromClassName(className)} />;
  }

  return <code className={className}>{children}</code>;
}

const markdownComponents = {
  code: AiMarkdownCode,
};

function AiMarkdown({ children }: { children: string }) {
  return (
    <Streamdown components={markdownComponents} controls={{ code: false }}>
      {children}
    </Streamdown>
  );
}

function assistantErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 503) {
    return "LLM is not configured.";
  }

  return error instanceof Error ? error.message : "Could not generate writing assistance.";
}

function id() {
  return crypto.randomUUID();
}

function estimateTokens(value: string) {
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const other = value.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.8 + other / 4));
}

function formatElapsed(startedAt?: number, completedAt?: number, now = Date.now()) {
  if (!startedAt) {
    return "";
  }

  return `${Math.max(0.1, ((completedAt ?? now) - startedAt) / 1000).toFixed(1)}s`;
}

function outputTokenLabel(message: AgentMessage) {
  const outputTokens = message.usage?.outputTokens;
  if (typeof outputTokens === "number") {
    return `${outputTokens} output tokens`;
  }

  return message.content ? `≈${estimateTokens(message.content)} tokens` : "";
}

function sourceLabel(source: { fileName: string | null; title: string; url: string | null }) {
  return source.title || source.url || source.fileName || "Untitled source";
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    createSource: "Create source",
    linkSource: "Link source",
    linkSourceToDocument: "Link source",
    deleteDocument: "Delete document",
    deleteSource: "Delete source",
    getProfile: "Read profile",
    getSettings: "Read settings",
    fetchUrl: "Fetch URL",
    importSources: "Import sources",
    listDocumentSources: "List document sources",
    listDocuments: "List documents",
    listModels: "List models",
    listSources: "List sources",
    readDocument: "Read document",
    readSource: "Read source",
    searchWorkspace: "Search workspace",
    unlinkSourceFromDocument: "Unlink source",
    updateAppSettings: "Update settings",
    updateDocument: "Update document",
    updateProfile: "Update profile",
    updateSource: "Update source",
  };
  return labels[name] ?? name;
}

function toolStateLabel(state: WritingAssistToolEvent["state"]) {
  const labels: Record<WritingAssistToolEvent["state"], string> = {
    approval_required: "approval required",
    approved: "approved",
    call: "running",
    denied: "denied",
    error: "failed",
    result: "done",
  };
  return labels[state];
}

function toolIconClass(state: WritingAssistToolEvent["state"]) {
  if (state === "call") {
    return "ai-tool-icon i-lucide-wrench h-3.5 w-3.5 text-muted";
  }

  if (state === "approval_required") {
    return "ai-tool-icon i-lucide-shield-alert h-3.5 w-3.5 text-warning";
  }

  if (state === "denied") {
    return "ai-tool-icon i-lucide-ban h-3.5 w-3.5 text-muted";
  }

  if (state === "approved") {
    return "ai-tool-icon i-lucide-shield-check h-3.5 w-3.5 text-success";
  }

  if (state === "error") {
    return "ai-tool-icon i-lucide-circle-alert h-3.5 w-3.5 text-danger";
  }

  return "ai-tool-icon i-lucide-check h-3.5 w-3.5 text-success";
}

function prettyToolValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

function mergeToolEvent(
  previous: WritingAssistToolEvent | undefined,
  event: WritingAssistToolEvent,
) {
  if (!previous) {
    return event;
  }

  return {
    ...previous,
    ...event,
    approvalToken: event.approvalToken ?? previous.approvalToken,
    input: event.input ?? previous.input,
    inputSummary: event.inputSummary ?? previous.inputSummary,
    output: event.output ?? previous.output,
    risk: event.risk ?? previous.risk,
  };
}

function visibleToolEvents(events: WritingAssistToolEvent[]) {
  const order: string[] = [];
  const latest = new Map<string, WritingAssistToolEvent>();

  for (const event of events) {
    if (!latest.has(event.toolCallId)) {
      order.push(event.toolCallId);
    }

    latest.set(event.toolCallId, mergeToolEvent(latest.get(event.toolCallId), event));
  }

  return order.flatMap((toolCallId) => {
    const event = latest.get(toolCallId);
    return event ? [event] : [];
  });
}

function fallbackMessageParts(message: AgentMessage): AgentConversationMessagePart[] {
  if (message.parts?.length) {
    return message.parts;
  }

  const parts: AgentConversationMessagePart[] = [];
  if (message.content) {
    parts.push({ content: message.content, id: `${message.id}-content`, type: "text" });
  }

  for (const event of visibleToolEvents(message.toolEvents ?? [])) {
    parts.push({ id: event.toolCallId, toolCallId: event.toolCallId, type: "tool" });
  }

  return parts;
}

function isDocument(value: unknown): value is Document {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { title?: unknown }).title === "string" &&
    typeof (value as { content?: unknown }).content === "string"
  );
}

function hasToolError(output: unknown) {
  return Boolean(
    output &&
    typeof output === "object" &&
    typeof (output as { error?: unknown }).error === "string",
  );
}

function readStoredValue(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) || fallback;
}

function conversationTitle(messages: AgentMessage[], fallback: string) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  return (firstUserMessage || fallback || "New chat").replace(/\s+/g, " ").slice(0, 80);
}

function canGenerateConversationTitle(messages: AgentMessage[]) {
  return (
    messages.some((message) => message.role === "user" && message.content.trim()) &&
    messages.some((message) => message.role === "assistant" && message.content.trim())
  );
}

export function AiComposer({
  documentId,
  draftContent = "",
  draftTitle = "Workspace",
  initialInstruction,
  isExpanded = false,
  launchRequest,
  onActivityChange,
  onClose,
  onExpand,
  onInsert,
  onDocumentUpdated,
  onReplace,
  onToggleExpanded,
  variant = "panel",
}: AiComposerProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => listModels(),
    staleTime: 5 * 60 * 1000,
  });
  const sources = useQuery({
    queryKey: ["documentSources", documentId],
    queryFn: () => listDocumentSources(documentId ?? ""),
    enabled: Boolean(documentId),
  });
  const conversations = useQuery({
    queryKey: ["agentConversations", documentId ?? null],
    queryFn: () => listAgentConversations(documentId),
  });
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState(initialInstruction);
  const [error, setError] = useState<unknown>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [model, setModel] = useState(() => readStoredValue(modelStorageKey, ""));
  const [now, setNow] = useState(Date.now());
  const [reasoningEffort, setReasoningEffort] = useState(() =>
    readStoredValue(thinkingStorageKey, "medium"),
  );
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const createConversationRef = useRef<Promise<AgentConversation> | null>(null);
  const lastSavedSignatureRef = useRef("");
  const messagesRef = useRef<AgentMessage[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const titledConversationIdsRef = useRef(new Set<string>());
  const scopeKey = documentId ?? "workspace";
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content);
  const liveAssistantMessage =
    messages.find((message) => message.role === "assistant" && !message.completedAt) ?? null;
  const latestLiveToolEvent = liveAssistantMessage?.toolEvents?.length
    ? liveAssistantMessage.toolEvents[liveAssistantMessage.toolEvents.length - 1]
    : null;
  const livePreview =
    liveAssistantMessage?.content ||
    liveAssistantMessage?.reasoning ||
    (latestLiveToolEvent
      ? `${toolLabel(latestLiveToolEvent.toolName)} ${
          latestLiveToolEvent.state === "call"
            ? "running"
            : latestLiveToolEvent.state === "approval_required"
              ? "needs approval"
              : latestLiveToolEvent.state
        }`
      : "Thinking...");
  const sourceChips = useMemo(() => (sources.data ?? []).slice(0, 4), [sources.data]);

  useEffect(() => {
    setDraft(initialInstruction);
  }, [initialInstruction]);

  useEffect(() => {
    if (!launchRequest || handledLaunchRequestIds.has(launchRequest.id)) {
      return;
    }

    handledLaunchRequestIds.add(launchRequest.id);
    setDraft(launchRequest.instruction);
    inputRef.current?.focus();
    if (launchRequest.autoSend) {
      void sendMessage(launchRequest.instruction);
    }
  }, [launchRequest]);

  useEffect(() => {
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setMessages([]);
    messagesRef.current = [];
    lastSavedSignatureRef.current = "";
    createConversationRef.current = null;
    titledConversationIdsRef.current = new Set();
  }, [scopeKey]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const firstModel = models.data?.models[0];
    if (!model && firstModel) {
      setModel(firstModel);
    }
  }, [model, models.data]);

  useEffect(() => {
    if (model) {
      window.localStorage.setItem(modelStorageKey, model);
    }
  }, [model]);

  useEffect(() => {
    window.localStorage.setItem(thinkingStorageKey, reasoningEffort);
  }, [reasoningEffort]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const signature = JSON.stringify(messages);
    if (signature === lastSavedSignatureRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveConversation(messages, signature);
    }, 350);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [messages, documentId]);

  useEffect(() => {
    if (!isStreaming) {
      return undefined;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  useEffect(() => {
    onActivityChange?.({
      isStreaming,
      model: liveAssistantMessage?.model || model || "AI",
      preview: livePreview,
      title: draftTitle,
    });
  }, [draftTitle, isStreaming, liveAssistantMessage?.model, livePreview, model, onActivityChange]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape" && abortRef.current) {
        abortRef.current.abort();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  async function copyMessage(content: string) {
    await navigator.clipboard?.writeText(content);
  }

  function setConversationCache(conversation: AgentConversation) {
    queryClient.setQueryData<AgentConversation[]>(
      ["agentConversations", documentId ?? null],
      (current = []) =>
        [conversation, ...current.filter((item) => item.id !== conversation.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
    );
  }

  async function saveConversation(snapshot: AgentMessage[], signature: string) {
    if (snapshot.length === 0) {
      return;
    }

    const fallbackTitle = conversationTitle(snapshot, draftTitle);
    let conversationId = activeConversationIdRef.current;

    try {
      if (!conversationId) {
        createConversationRef.current ??= createAgentConversation({
          documentId: documentId ?? null,
          messages: snapshot,
          title: fallbackTitle,
        });
        const created = await createConversationRef.current;
        createConversationRef.current = null;
        conversationId = created.id;
        activeConversationIdRef.current = created.id;
        setActiveConversationId(created.id);
        setConversationCache(created);
        const latestSignature = JSON.stringify(messagesRef.current);
        if (latestSignature !== signature && messagesRef.current.length > 0) {
          const latestMessages = messagesRef.current;
          const updated = await updateAgentConversation(created.id, {
            messages: latestMessages,
            title: conversationTitle(latestMessages, draftTitle),
          });
          setConversationCache(updated);
          lastSavedSignatureRef.current = latestSignature;
          void generateAndSaveConversationTitle(created.id, latestMessages);
          return;
        }
      } else {
        const updated = await updateAgentConversation(conversationId, {
          messages: snapshot,
          title: fallbackTitle,
        });
        setConversationCache(updated);
      }

      if (JSON.stringify(messagesRef.current) === signature) {
        lastSavedSignatureRef.current = signature;
      }
      if (conversationId) {
        void generateAndSaveConversationTitle(conversationId, snapshot);
      }
    } catch (caught) {
      createConversationRef.current = null;
      setError(caught);
    }
  }

  async function generateAndSaveConversationTitle(
    conversationId: string,
    snapshot: AgentMessage[],
  ) {
    if (
      titledConversationIdsRef.current.has(conversationId) ||
      !canGenerateConversationTitle(snapshot)
    ) {
      return;
    }

    titledConversationIdsRef.current.add(conversationId);
    try {
      const result = await generateAgentConversationTitle({
        documentId: documentId ?? null,
        draftTitle,
        messages: snapshot,
        model: model || undefined,
      });
      const title = result.title.trim();
      if (!title) {
        return;
      }

      const updated = await updateAgentConversation(conversationId, { title });
      setConversationCache(updated);
    } catch {
      titledConversationIdsRef.current.delete(conversationId);
    }
  }

  function selectConversation(conversationId: string) {
    if (!conversationId) {
      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      setMessages([]);
      messagesRef.current = [];
      setError(null);
      lastSavedSignatureRef.current = "";
      setDraft(initialInstruction);
      return;
    }

    const conversation = conversations.data?.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    setActiveConversationId(conversation.id);
    activeConversationIdRef.current = conversation.id;
    setMessages(conversation.messages);
    messagesRef.current = conversation.messages;
    setError(null);
    lastSavedSignatureRef.current = JSON.stringify(conversation.messages);
  }

  function handleToolEvent(assistantId: string, event: WritingAssistToolEvent) {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              parts: (message.parts ?? []).some(
                (part) => part.type === "tool" && part.toolCallId === event.toolCallId,
              )
                ? message.parts
                : [
                    ...(message.parts ?? []),
                    { id: event.toolCallId, toolCallId: event.toolCallId, type: "tool" },
                  ],
              toolEvents: [...(message.toolEvents ?? []), event],
            }
          : message,
      ),
    );

    if (
      event.state === "result" &&
      event.toolName === "updateDocument" &&
      isDocument(event.output)
    ) {
      queryClient.setQueryData(["document", event.output.id], event.output);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDocumentUpdated?.(event.output);
    }

    if (
      event.state === "result" &&
      (event.toolName === "createSource" ||
        event.toolName === "importSources" ||
        event.toolName === "linkSource" ||
        event.toolName === "linkSourceToDocument" ||
        event.toolName === "updateSource" ||
        event.toolName === "deleteSource" ||
        event.toolName === "unlinkSourceFromDocument")
    ) {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      if (documentId) {
        void queryClient.invalidateQueries({ queryKey: ["documentSources", documentId] });
      }
    }

    if (event.state === "result" && event.toolName === "createDocument") {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    }

    if (event.state === "result" && event.toolName === "deleteDocument") {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (
        documentId &&
        event.output &&
        typeof event.output === "object" &&
        (event.output as { documentId?: unknown }).documentId === documentId
      ) {
        queryClient.removeQueries({ queryKey: ["document", documentId], exact: true });
        void navigate({ to: "/documents" });
      }
    }

    if (
      event.state === "result" &&
      (event.toolName === "updateAppSettings" || event.toolName === "updateProfile")
    ) {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  }

  async function resolveApproval(
    assistantId: string,
    event: WritingAssistToolEvent,
    approved: boolean,
  ) {
    if (!approved || !event.approvalToken) {
      handleToolEvent(assistantId, { ...event, state: "denied" });
      return;
    }

    handleToolEvent(assistantId, { ...event, state: "approved" });
    try {
      const result = await executeApprovedTool(event.approvalToken);
      handleToolEvent(assistantId, {
        output: result.output,
        risk: "high",
        state: hasToolError(result.output) ? "error" : "result",
        toolCallId: result.toolCallId,
        toolName: result.toolName,
      });
    } catch (caught) {
      handleToolEvent(assistantId, {
        output: { error: assistantErrorMessage(caught) },
        risk: "high",
        state: "error",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
    }
  }

  async function sendMessage(nextInstruction = draft.trim()) {
    const instruction = nextInstruction.trim();
    if (!instruction || isStreaming) {
      return;
    }

    const userMessage: AgentMessage = { id: id(), role: "user", content: instruction };
    const assistantId = id();
    const startedAt = Date.now();
    const nextMessages: AgentMessage[] = [
      ...messages,
      userMessage,
      { id: assistantId, role: "assistant", content: "", model: model || undefined, startedAt },
    ];
    const controller = new AbortController();
    abortRef.current = controller;
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setIsStreaming(true);

    function appendTextChunk(chunk: string) {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== assistantId) {
            return message;
          }

          const parts = [...(message.parts ?? [])];
          const lastPart = parts[parts.length - 1];
          if (lastPart?.type === "text") {
            parts[parts.length - 1] = {
              ...lastPart,
              content: `${lastPart.content}${chunk}`,
            };
          } else {
            parts.push({ content: chunk, id: id(), type: "text" });
          }

          return { ...message, content: `${message.content}${chunk}`, parts };
        }),
      );
    }

    try {
      const activeDocumentId = documentId;
      const streamPromise = activeDocumentId
        ? streamWritingAssistance(
            activeDocumentId,
            {
              draftContent,
              draftTitle,
              instruction,
              messages: nextMessages
                .filter((message) => message.id !== assistantId)
                .map(({ role, content }) => ({ role, content })),
              model: model || undefined,
              reasoningEffort: reasoningEffort === "off" ? undefined : reasoningEffort,
              thinkingEnabled: reasoningEffort !== "off",
            },
            (chunk) => {
              appendTextChunk(chunk);
            },
            undefined,
            controller.signal,
            (chunk) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, reasoning: `${message.reasoning ?? ""}${chunk}` }
                    : message,
                ),
              );
            },
            (toolEvent) => handleToolEvent(assistantId, toolEvent),
            (usage) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, usage } : message,
                ),
              );
            },
          )
        : streamAgentAssistance(
            {
              draftContent,
              draftTitle,
              instruction,
              messages: nextMessages
                .filter((message) => message.id !== assistantId)
                .map(({ role, content }) => ({ role, content })),
              model: model || undefined,
              reasoningEffort: reasoningEffort === "off" ? undefined : reasoningEffort,
              thinkingEnabled: reasoningEffort !== "off",
            },
            (chunk) => {
              appendTextChunk(chunk);
            },
            undefined,
            controller.signal,
            (chunk) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, reasoning: `${message.reasoning ?? ""}${chunk}` }
                    : message,
                ),
              );
            },
            (toolEvent) => handleToolEvent(assistantId, toolEvent),
            (usage) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, usage } : message,
                ),
              );
            },
          );
      await streamPromise;
    } catch (caught) {
      if ((caught as { name?: string }).name !== "AbortError") {
        setError(caught);
        setMessages((current) => current.filter((message) => message.id !== assistantId));
      }
    } finally {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, completedAt: Date.now() } : message,
        ),
      );
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  if (variant === "mini") {
    if (!isStreaming) {
      return null;
    }

    return (
      <section className="ai-mini-chat rounded border border-border bg-overlay shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            type="button"
            onClick={onExpand}
            aria-label="Open AI agent"
            title="Open AI agent"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
              <span className="i-lucide-bot h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-foreground">
                {liveAssistantMessage?.model || model || "AI"}
              </span>
              <span className="block truncate text-[11px] text-muted">{draftTitle}</span>
            </span>
          </button>
          <button
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              abortRef.current?.abort();
            }}
            aria-label="Stop generation"
            title="Stop generation"
          >
            <span className="i-lucide-square h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <button
          className="block w-full px-3 py-2 text-left"
          type="button"
          onClick={onExpand}
          aria-label="Open AI agent"
        >
          <span className="mb-2 flex items-center gap-2 text-[11px] text-muted">
            <span className="i-lucide-loader-circle h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Streaming
          </span>
          <span className="ai-mini-preview block text-sm leading-6 text-foreground">
            {livePreview}
          </span>
        </button>
      </section>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
              <span className="i-lucide-bot h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">AI agent</h2>
              <p className="truncate text-xs text-muted">{draftTitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <select
              className="max-w-36 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
              value={model}
              onChange={(event) => setModel(event.currentTarget.value)}
              aria-label="AI model"
            >
              {(models.data?.models ?? (model ? [model] : [])).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {onToggleExpanded ? (
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-muted hover:bg-surface-secondary"
                type="button"
                onClick={onToggleExpanded}
                aria-label={isExpanded ? "Shrink AI agent" : "Expand AI agent"}
                title={isExpanded ? "Shrink" : "Expand"}
              >
                <span
                  className={
                    isExpanded ? "i-lucide-minimize-2 h-4 w-4" : "i-lucide-maximize-2 h-4 w-4"
                  }
                  aria-hidden="true"
                />
              </button>
            ) : null}
            {onClose ? (
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-muted hover:bg-surface-secondary"
                type="button"
                onClick={onClose}
                aria-label="Close AI agent"
                title="Close"
              >
                <span className="i-lucide-x h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <select
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
            value={reasoningEffort}
            onChange={(event) => setReasoningEffort(event.currentTarget.value)}
            aria-label="Thinking effort"
          >
            <option value="off">Thinking off</option>
            <option value="low">Low thinking</option>
            <option value="medium">Medium thinking</option>
            <option value="high">High thinking</option>
          </select>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <select
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
            value={activeConversationId ?? ""}
            onChange={(event) => selectConversation(event.currentTarget.value)}
            aria-label="AI conversation"
          >
            <option value="">New chat</option>
            {(conversations.data ?? []).map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
          <button
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-surface text-muted hover:bg-surface-secondary disabled:opacity-50"
            type="button"
            disabled={isStreaming}
            onClick={() => selectConversation("")}
            aria-label="New AI conversation"
            title="New chat"
          >
            <span className="i-lucide-plus h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {sourceChips.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sourceChips.map((source) => (
              <span
                key={source.id}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface-secondary px-2 py-1 text-xs text-muted"
                title={sourceLabel(source)}
              >
                <span className="i-lucide-paperclip h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{sourceLabel(source)}</span>
              </span>
            ))}
            {(sources.data?.length ?? 0) > sourceChips.length ? (
              <span className="rounded border border-border px-2 py-1 text-xs text-muted">
                +{(sources.data?.length ?? 0) - sourceChips.length}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-gutter:stable]">
        {messages.length === 0 ? (
          <div className="mx-auto mt-20 max-w-64 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded border border-border bg-surface text-muted">
              <span className="i-lucide-message-circle h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm text-muted">Start a writing session.</p>
          </div>
        ) : null}

        <div className="space-y-5">
          {messages.map((message) => {
            const isAssistant = message.role === "assistant";
            const elapsed = formatElapsed(message.startedAt, message.completedAt, now);
            const tokens = isAssistant ? outputTokenLabel(message) : "";
            const isActive = isStreaming && isAssistant && !message.completedAt;
            const toolEventsById = new Map(
              visibleToolEvents(message.toolEvents ?? []).map((event) => [event.toolCallId, event]),
            );
            const parts = fallbackMessageParts(message);

            return (
              <article
                key={message.id}
                className={isAssistant ? "group" : "group flex justify-end"}
              >
                {isAssistant ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-muted">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
                          <span className="i-lucide-bot h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate">{message.model || model || "AI"}</span>
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 text-muted">
                            <span
                              className="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                            Thinking
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {tokens ? <span>{tokens}</span> : null}
                        {elapsed ? <span>{elapsed}</span> : null}
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-muted opacity-100 hover:bg-surface-secondary lg:opacity-0 lg:group-hover:opacity-100"
                          type="button"
                          disabled={!message.content}
                          onClick={() => void copyMessage(message.content)}
                          aria-label="Copy response"
                          title="Copy response"
                        >
                          <span className="i-lucide-copy h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {message.reasoning || isActive ? (
                      <details
                        className="ai-thinking rounded border border-border bg-surface-secondary p-2"
                        open
                      >
                        <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
                          <span
                            className={
                              isActive
                                ? "ai-thinking-icon-open i-lucide-brain-cog h-3.5 w-3.5 animate-pulse"
                                : "ai-thinking-icon-open i-lucide-brain-cog h-3.5 w-3.5"
                            }
                            aria-hidden="true"
                          />
                          <span
                            className="ai-thinking-icon-closed i-lucide-brain h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Thinking
                        </summary>
                        <div className="streamdown ai-streamdown ai-thinking-stream mt-2 text-xs leading-5 text-muted">
                          <AiMarkdown>
                            {message.reasoning || "Reading context and drafting..."}
                          </AiMarkdown>
                        </div>
                      </details>
                    ) : null}

                    <div className="space-y-2">
                      {parts.length ? (
                        parts.map((part) => {
                          if (part.type === "text") {
                            return (
                              <div
                                key={part.id}
                                className="streamdown ai-streamdown prose prose-neutral max-w-none rounded border border-border bg-surface px-3 py-2 text-sm leading-6 text-foreground"
                              >
                                <AiMarkdown>{part.content}</AiMarkdown>
                              </div>
                            );
                          }

                          const event = toolEventsById.get(part.toolCallId);
                          if (!event) {
                            return null;
                          }

                          const inputText =
                            prettyToolValue(event.input) || event.inputSummary || "";
                          const outputText = prettyToolValue(event.output);

                          return (
                            <details
                              key={event.toolCallId}
                              className={`ai-tool-card ai-tool-card--${event.state} rounded border border-border bg-surface-secondary text-xs text-muted`}
                            >
                              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-2 py-1.5">
                                <span className={toolIconClass(event.state)} aria-hidden="true" />
                                <span className="font-medium">{toolLabel(event.toolName)}</span>
                                <span className="text-muted">{toolStateLabel(event.state)}</span>
                                {event.inputSummary ? (
                                  <span className="min-w-0 flex-1 truncate text-muted">
                                    {event.inputSummary}
                                  </span>
                                ) : (
                                  <span className="min-w-0 flex-1" />
                                )}
                                <span
                                  className="i-lucide-chevron-down ai-tool-chevron h-3.5 w-3.5 text-muted"
                                  aria-hidden="true"
                                />
                                {event.state === "approval_required" ? (
                                  <span className="flex gap-1">
                                    <button
                                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary"
                                      type="button"
                                      onClick={(clickEvent) => {
                                        clickEvent.preventDefault();
                                        void resolveApproval(message.id, event, false);
                                      }}
                                      aria-label="Deny tool call"
                                      title="Deny"
                                    >
                                      <span className="i-lucide-x h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      className="inline-flex h-7 w-7 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent"
                                      type="button"
                                      onClick={(clickEvent) => {
                                        clickEvent.preventDefault();
                                        void resolveApproval(message.id, event, true);
                                      }}
                                      aria-label="Approve tool call"
                                      title="Approve"
                                    >
                                      <span
                                        className="i-lucide-check h-3.5 w-3.5"
                                        aria-hidden="true"
                                      />
                                    </button>
                                  </span>
                                ) : null}
                              </summary>
                              <div className="space-y-2 border-t border-border px-2 py-2">
                                <div>
                                  <div className="mb-1 text-[11px] font-medium uppercase text-muted">
                                    Command
                                  </div>
                                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface px-2 py-1.5 text-[11px] leading-5 text-foreground">
                                    {inputText ? `${event.toolName} ${inputText}` : event.toolName}
                                  </pre>
                                </div>
                                {outputText ? (
                                  <div>
                                    <div className="mb-1 text-[11px] font-medium uppercase text-muted">
                                      Result
                                    </div>
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface px-2 py-1.5 text-[11px] leading-5 text-foreground">
                                      {outputText}
                                    </pre>
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          );
                        })
                      ) : (
                        <div className="rounded border border-border bg-surface px-3 py-2 text-sm leading-6 text-muted">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="i-lucide-loader-circle h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                            Thinking...
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary disabled:opacity-50"
                        type="button"
                        disabled={!message.content || isStreaming || !onInsert}
                        onClick={() => onInsert?.(message.content)}
                        aria-label="Insert latest response"
                        title="Insert latest response"
                      >
                        <span className="i-lucide-corner-down-left h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary disabled:opacity-50"
                        type="button"
                        disabled={!message.content || isStreaming || !onReplace}
                        onClick={() => onReplace?.(message.content)}
                        aria-label="Replace document with latest response"
                        title="Replace document"
                      >
                        <span className="i-lucide-file-output h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[86%] rounded bg-accent px-3 py-2 text-sm leading-6 text-accent-foreground">
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                )}
              </article>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>

      {error ? (
        <p className="border-t border-border px-4 py-2 text-sm text-danger" role="alert">
          {assistantErrorMessage(error)}
        </p>
      ) : null}

      <form
        className="shrink-0 border-t border-border bg-surface px-3 pb-4 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <div className="rounded border border-border bg-surface p-2 focus-within:border-focus">
          <textarea
            ref={inputRef}
            className="max-h-40 min-h-20 w-full resize-none border-0 px-1 py-1 text-sm leading-6 text-foreground outline-none"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void sendMessage();
              }
              if (event.key === "Escape" && abortRef.current) {
                abortRef.current.abort();
              }
            }}
            aria-label="Agent message"
            placeholder="Ask the agent to write, edit, or use sources..."
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="i-lucide-paperclip h-4 w-4" aria-hidden="true" />
              <span>{sources.data?.length ?? 0} sources</span>
              {lastAssistantMessage?.usage?.totalTokens ? (
                <span>{lastAssistantMessage.usage.totalTokens} tokens</span>
              ) : null}
            </div>
            {isStreaming ? (
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary"
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generation"
                title="Stop generation"
              >
                <span className="i-lucide-square h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent disabled:opacity-50"
                type="submit"
                disabled={!draft.trim()}
                aria-label="Send message"
                title="Send message"
              >
                <span className="i-lucide-send h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
