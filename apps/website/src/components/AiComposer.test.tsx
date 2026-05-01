import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import {
  ApiError,
  createAgentConversation,
  generateAgentConversationTitle,
  listDocumentSources,
  listAgentConversations,
  listModels,
  streamWritingAssistance,
  updateAgentConversation,
} from "../api/documents.ts";
import { createQueryClient } from "../query.ts";
import { AiComposer } from "./AiComposer.tsx";

function createStorage() {
  const values = new Map<string, string>();
  return {
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

vi.mock("../api/documents.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/documents.ts")>()),
  listDocumentSources: vi.fn(),
  listAgentConversations: vi.fn(),
  listModels: vi.fn(),
  streamWritingAssistance: vi.fn(),
  createAgentConversation: vi.fn(),
  updateAgentConversation: vi.fn(),
  generateAgentConversationTitle: vi.fn(),
}));

beforeEach(() => {
  const storage = createStorage();
  vi.stubGlobal("localStorage", storage);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn() },
  });
  vi.mocked(listDocumentSources).mockResolvedValue([
    {
      id: "source-1",
      type: "text",
      title: "Research note",
      note: "Source context",
      url: null,
      fileName: null,
      tags: ["research"],
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  vi.mocked(listModels).mockResolvedValue({ models: ["test-model", "other-model"] });
  vi.mocked(listAgentConversations).mockResolvedValue([]);
  vi.mocked(createAgentConversation).mockResolvedValue({
    id: "conversation-1",
    userId: "local-user",
    documentId: "doc-1",
    title: "Improve the intro",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  });
  vi.mocked(updateAgentConversation).mockResolvedValue({
    id: "conversation-1",
    userId: "local-user",
    documentId: "doc-1",
    title: "Improve the intro",
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  });
  vi.mocked(generateAgentConversationTitle).mockResolvedValue({
    model: "test-model",
    title: "Sharper intro",
  });
  vi.mocked(streamWritingAssistance).mockReset();
});

function renderComposer(onInsert = vi.fn(), onReplace = vi.fn(), onDocumentUpdated = vi.fn()) {
  return {
    onDocumentUpdated,
    onInsert,
    onReplace,
    ...render(
      <QueryClientProvider client={createQueryClient()}>
        <AiComposer
          documentId="doc-1"
          draftContent="Draft body"
          draftTitle="Draft"
          initialInstruction="Improve the intro"
          onInsert={onInsert}
          onDocumentUpdated={onDocumentUpdated}
          onReplace={onReplace}
        />
      </QueryClientProvider>,
    ),
  };
}

test("generates markdown writing suggestions with thinking and inserts them", async () => {
  vi.mocked(streamWritingAssistance).mockImplementation(
    async (_documentId, _input, onChunk, _fetcher, _signal, onReasoning, onTool, onUsage) => {
      onReasoning?.("Reading the draft.");
      onTool?.({
        inputSummary: '{"documentId":"doc-1"}',
        state: "call",
        toolCallId: "tool-1",
        toolName: "readDocument",
      });
      onChunk("## Draft\n\n");
      onChunk("- Use the source context.");
      onTool?.({
        output: {
          content: "Draft body",
          id: "doc-1",
          title: "Draft",
          updatedAt: 1,
        },
        state: "result",
        toolCallId: "tool-1",
        toolName: "readDocument",
      });
      onTool?.({
        output: {
          content: "Updated body",
          id: "doc-1",
          title: "Updated draft",
          updatedAt: 2,
        },
        state: "result",
        toolCallId: "tool-2",
        toolName: "updateDocument",
      });
      onUsage?.({ inputTokens: 8, outputTokens: 4, totalTokens: 12 });
      return {
        suggestion: "## Draft\n\n- Use the source context.",
        model: "test-model",
        usedSources: 2,
      };
    },
  );
  const { onDocumentUpdated, onInsert } = renderComposer();

  await waitFor(() =>
    expect(screen.getByLabelText("AI model")).toHaveProperty("value", "test-model"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  expect((await screen.findAllByText("Draft")).length).toBeGreaterThan(0);
  expect(screen.queryByText("Raw stream")).toBeNull();
  expect(await screen.findByText("Reading the draft.")).toBeTruthy();
  expect(await screen.findByText("Read document")).toBeTruthy();
  expect(screen.getAllByText("Read document")).toHaveLength(1);
  expect(screen.queryByText("running")).toBeNull();
  fireEvent.click(screen.getByText("Read document"));
  expect(screen.getAllByText("Command").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Result").length).toBeGreaterThan(0);
  expect(await screen.findByText(/Draft body/)).toBeTruthy();
  expect(await screen.findByText("Update document")).toBeTruthy();
  expect(await screen.findByText("4 output tokens")).toBeTruthy();
  expect(await screen.findByText("Research note")).toBeTruthy();
  expect(screen.getByText("Use the source context.")).toBeTruthy();
  expect(
    Boolean(
      screen
        .getByText("Use the source context.")
        .compareDocumentPosition(screen.getByText("Update document")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Insert latest response" }));

  await waitFor(() => expect(listModels).toHaveBeenCalledOnce());
  expect(streamWritingAssistance).toHaveBeenCalledWith(
    "doc-1",
    {
      draftContent: "Draft body",
      draftTitle: "Draft",
      instruction: "Improve the intro",
      messages: [{ role: "user", content: "Improve the intro" }],
      model: "test-model",
      reasoningEffort: "medium",
      thinkingEnabled: true,
    },
    expect.any(Function),
    undefined,
    expect.any(AbortSignal),
    expect.any(Function),
    expect.any(Function),
    expect.any(Function),
  );
  expect(onInsert).toHaveBeenCalledWith("## Draft\n\n- Use the source context.");
  expect(onDocumentUpdated).toHaveBeenCalledWith({
    content: "Updated body",
    id: "doc-1",
    title: "Updated draft",
    updatedAt: 2,
  });
  await waitFor(() =>
    expect(createAgentConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        title: "Improve the intro",
      }),
    ),
  );
  await waitFor(() =>
    expect(generateAgentConversationTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        model: "test-model",
      }),
    ),
  );
  await waitFor(() =>
    expect(updateAgentConversation).toHaveBeenCalledWith("conversation-1", {
      title: "Sharper intro",
    }),
  );
});

test("defaults to a new conversation and continues a selected saved conversation", async () => {
  vi.mocked(listAgentConversations).mockResolvedValue([
    {
      id: "conversation-1",
      userId: "local-user",
      documentId: "doc-1",
      title: "Saved conversation",
      messages: [
        { id: "message-1", role: "user", content: "Previous question" },
        {
          completedAt: 2,
          content: "Previous answer",
          id: "message-2",
          role: "assistant",
          startedAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    },
  ]);
  vi.mocked(streamWritingAssistance).mockImplementation(async (_documentId, _input, onChunk) => {
    onChunk("Follow-up answer");
    return {
      suggestion: "Follow-up answer",
      model: "test-model",
      usedSources: 1,
    };
  });

  renderComposer();

  await screen.findByRole("option", { name: "Saved conversation" });
  expect(screen.getByLabelText("AI conversation")).toHaveProperty("value", "");
  expect(screen.queryByText("Previous question")).toBeNull();

  fireEvent.change(screen.getByLabelText("AI conversation"), {
    target: { value: "conversation-1" },
  });
  expect(await screen.findByText("Previous question")).toBeTruthy();
  expect(await screen.findByText("Previous answer")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Agent message"), {
    target: { value: "Follow up" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  await waitFor(() =>
    expect(streamWritingAssistance).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        messages: [
          { role: "user", content: "Previous question" },
          { role: "assistant", content: "Previous answer" },
          { role: "user", content: "Follow up" },
        ],
      }),
      expect.any(Function),
      undefined,
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ),
  );
  await waitFor(() =>
    expect(updateAgentConversation).toHaveBeenCalledWith(
      "conversation-1",
      expect.objectContaining({
        title: "Previous question",
      }),
    ),
  );
  await waitFor(() =>
    expect(updateAgentConversation).toHaveBeenCalledWith("conversation-1", {
      title: "Sharper intro",
    }),
  );
});

test("persists selected model and thinking effort locally", async () => {
  localStorage.setItem("onlywrite.ai.model", "other-model");
  localStorage.setItem("onlywrite.ai.thinking", "high");
  renderComposer();

  await waitFor(() =>
    expect(screen.getByLabelText("AI model")).toHaveProperty("value", "other-model"),
  );
  expect(screen.getByLabelText("Thinking effort")).toHaveProperty("value", "high");

  fireEvent.change(screen.getByLabelText("AI model"), { target: { value: "test-model" } });
  fireEvent.change(screen.getByLabelText("Thinking effort"), { target: { value: "off" } });

  expect(localStorage.getItem("onlywrite.ai.model")).toBe("test-model");
  expect(localStorage.getItem("onlywrite.ai.thinking")).toBe("off");
});

test("shows an LLM configuration error", async () => {
  vi.mocked(streamWritingAssistance).mockRejectedValue(new ApiError("LLM is not configured", 503));

  renderComposer();

  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("LLM is not configured."));
});
