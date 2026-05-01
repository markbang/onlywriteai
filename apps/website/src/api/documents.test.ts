// @vitest-environment node

import { expect, test } from "vite-plus/test";
import {
  ApiError,
  createAgentConversation,
  createDocument,
  createDocumentSource,
  deleteDocument,
  deleteDocumentSource,
  generateAgentConversationTitle,
  getDocument,
  getAuthStatus,
  getHealth,
  getSettings,
  generateWritingAssistance,
  importSources,
  listModels,
  listAgentConversations,
  listDocumentSources,
  listDocuments,
  listSources,
  logout,
  streamWritingAssistance,
  updateAgentConversation,
  updateAppSettings,
  updateDocument,
  updateDocumentSource,
  updateProfile,
} from "./documents.ts";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

test("calls health endpoint with the /api base path", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${requestUrl(input)}`);
    return jsonResponse({ ok: true });
  };

  const health = await getHealth(fetcher);

  expect(health).toEqual({ ok: true });
  expect(calls).toEqual(["GET /api/health"]);
});

test("reports non-JSON API responses clearly", async () => {
  const fetcher: typeof fetch = async () =>
    new Response("<!doctype html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  await expect(getHealth(fetcher)).rejects.toMatchObject({
    message: "Expected JSON response but received text/html; charset=utf-8",
    status: 200,
  });
});

test("calls auth endpoints with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    if (init?.method === "POST") {
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ enabled: true, user: { sub: "user-1" } });
  };

  const status = await getAuthStatus(fetcher);
  await logout(fetcher);

  expect(status).toEqual({ enabled: true, user: { sub: "user-1" } });
  expect(calls).toEqual([
    { url: "/api/auth/me", method: "GET", body: undefined },
    { url: "/api/auth/logout", method: "POST", body: undefined },
  ]);
});

test("calls document endpoints with the /api base path", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${requestUrl(input)}`);
    return jsonResponse([{ id: "1", title: "Draft", content: "", createdAt: 1, updatedAt: 1 }]);
  };

  const documents = await listDocuments(fetcher);

  expect(documents).toHaveLength(1);
  expect(calls).toEqual(["GET /api/documents"]);
});

test("sends create, update, read, and delete requests", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ id: "1", title: "Draft", content: "Body", createdAt: 1, updatedAt: 1 });
  };

  await createDocument({ title: "Draft" }, fetcher);
  await getDocument("1", fetcher);
  await updateDocument("1", { content: "Body" }, fetcher);
  await deleteDocument("1", fetcher);

  expect(calls).toEqual([
    { url: "/api/documents", method: "POST", body: JSON.stringify({ title: "Draft" }) },
    { url: "/api/documents/1", method: "GET", body: undefined },
    { url: "/api/documents/1", method: "PATCH", body: JSON.stringify({ content: "Body" }) },
    { url: "/api/documents/1", method: "DELETE", body: undefined },
  ]);
});

test("throws ApiError for JSON error responses", async () => {
  const fetcher: typeof fetch = async () =>
    jsonResponse({ error: { message: "Document not found" } }, { status: 404 });

  await expect(getDocument("missing", fetcher)).rejects.toMatchObject(
    new ApiError("Document not found", 404),
  );
});

test("calls source endpoints with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    if (init?.method === "GET") {
      return jsonResponse([
        {
          id: "source-1",
          documentId: "doc-1",
          type: "text",
          title: "Source",
          note: "Note",
          url: null,
          fileName: null,
          tags: ["research"],
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
    }
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({
      id: "source-1",
      documentId: "doc-1",
      type: "text",
      title: "Source",
      note: "Note",
      url: null,
      fileName: null,
      tags: ["research"],
      createdAt: 1,
      updatedAt: 1,
    });
  };

  await listDocumentSources("doc-1", fetcher);
  await createDocumentSource(
    "doc-1",
    { type: "rss", title: "Feed", url: "https://example.com/rss" },
    fetcher,
  );
  await updateDocumentSource("doc-1", "source-1", { note: "Updated" }, fetcher);
  await deleteDocumentSource("doc-1", "source-1", fetcher);
  await listSources(fetcher);

  expect(calls).toEqual([
    { url: "/api/documents/doc-1/sources", method: "GET", body: undefined },
    {
      url: "/api/documents/doc-1/sources",
      method: "POST",
      body: JSON.stringify({ type: "rss", title: "Feed", url: "https://example.com/rss" }),
    },
    {
      url: "/api/documents/doc-1/sources/source-1",
      method: "PATCH",
      body: JSON.stringify({ note: "Updated" }),
    },
    { url: "/api/documents/doc-1/sources/source-1", method: "DELETE", body: undefined },
    { url: "/api/sources", method: "GET", body: undefined },
  ]);
});

test("calls writing assistance endpoint with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return jsonResponse({ suggestion: "Draft suggestion", model: "test-model", usedSources: 2 });
  };

  const result = await generateWritingAssistance(
    "doc-1",
    { instruction: "Improve the draft" },
    fetcher,
  );

  expect(result).toEqual({ suggestion: "Draft suggestion", model: "test-model", usedSources: 2 });
  expect(calls).toEqual([
    {
      url: "/api/documents/doc-1/assist",
      method: "POST",
      body: JSON.stringify({ instruction: "Improve the draft" }),
    },
  ]);
});

test("calls model listing endpoint with the /api base path", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${requestUrl(input)}`);
    return jsonResponse({ models: ["test-model"] });
  };

  const result = await listModels(fetcher);

  expect(result).toEqual({ models: ["test-model"] });
  expect(calls).toEqual(["GET /api/models"]);
});

test("calls agent conversation endpoints with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const conversation = {
    id: "conversation-1",
    userId: "local-user",
    documentId: "doc-1",
    title: "Continue this",
    messages: [{ id: "message-1", role: "user", content: "Continue this" }],
    createdAt: 1,
    updatedAt: 2,
  };
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return jsonResponse(init?.method === "GET" ? [conversation] : conversation);
  };

  await listAgentConversations("doc-1", fetcher);
  await createAgentConversation(
    {
      documentId: "doc-1",
      messages: [{ id: "message-1", role: "user", content: "Continue this" }],
      title: "Continue this",
    },
    fetcher,
  );
  await updateAgentConversation(
    "conversation-1",
    {
      messages: [{ id: "message-2", role: "assistant", content: "Done" }],
      title: "Done",
    },
    fetcher,
  );
  await generateAgentConversationTitle(
    {
      documentId: "doc-1",
      draftTitle: "Draft",
      messages: [
        { id: "message-1", role: "user", content: "Continue this" },
        { id: "message-2", role: "assistant", content: "Done" },
      ],
      model: "test-model",
    },
    fetcher,
  );

  expect(calls).toEqual([
    { url: "/api/agent/conversations?documentId=doc-1", method: "GET", body: undefined },
    {
      url: "/api/agent/conversations",
      method: "POST",
      body: JSON.stringify({
        documentId: "doc-1",
        messages: [{ id: "message-1", role: "user", content: "Continue this" }],
        title: "Continue this",
      }),
    },
    {
      url: "/api/agent/conversations/conversation-1",
      method: "PATCH",
      body: JSON.stringify({
        messages: [{ id: "message-2", role: "assistant", content: "Done" }],
        title: "Done",
      }),
    },
    {
      url: "/api/agent/conversations/title",
      method: "POST",
      body: JSON.stringify({
        documentId: "doc-1",
        draftTitle: "Draft",
        messages: [
          { id: "message-1", role: "user", content: "Continue this" },
          { id: "message-2", role: "assistant", content: "Done" },
        ],
        model: "test-model",
      }),
    },
  ]);
});

test("streams writing assistance from the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const chunks: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("Hello "));
          controller.enqueue(encoder.encode("stream"));
          controller.close();
        },
      }),
      {
        headers: {
          "x-onlywrite-model": "test-model",
          "x-onlywrite-used-sources": "2",
        },
      },
    );
  };

  const result = await streamWritingAssistance(
    "doc-1",
    { instruction: "Improve the draft" },
    (chunk) => chunks.push(chunk),
    fetcher,
  );

  expect(result).toEqual({ suggestion: "Hello stream", model: "test-model", usedSources: 2 });
  expect(chunks).toEqual(["Hello ", "stream"]);
  expect(calls).toEqual([
    {
      url: "/api/documents/doc-1/assist/stream",
      method: "POST",
      body: JSON.stringify({ instruction: "Improve the draft" }),
    },
  ]);
});

test("streams writing assistance events with reasoning and tool chunks", async () => {
  const chunks: string[] = [];
  const tools: unknown[] = [];
  const reasoning: string[] = [];
  const usage: unknown[] = [];
  const fetcher: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(JSON.stringify({ type: "reasoning", delta: "Read." })));
          controller.enqueue(encoder.encode("\n"));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "tool",
                delta: {
                  state: "result",
                  toolCallId: "tool-1",
                  toolName: "readDocument",
                },
              }),
            ),
          );
          controller.enqueue(encoder.encode("\n"));
          controller.enqueue(encoder.encode(JSON.stringify({ type: "text", delta: "Answer." })));
          controller.enqueue(encoder.encode("\n"));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "usage",
                delta: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
              }),
            ),
          );
          controller.enqueue(encoder.encode("\n"));
          controller.close();
        },
      }),
      {
        headers: {
          "x-onlywrite-model": "test-model",
          "x-onlywrite-stream-format": "events",
          "x-onlywrite-used-sources": "2",
        },
      },
    );

  const result = await streamWritingAssistance(
    "doc-1",
    { instruction: "Improve the draft", reasoningEffort: "medium" },
    (chunk) => chunks.push(chunk),
    fetcher,
    undefined,
    (chunk) => reasoning.push(chunk),
    (value) => tools.push(value),
    (value) => usage.push(value),
  );

  expect(result).toEqual({ suggestion: "Answer.", model: "test-model", usedSources: 2 });
  expect(chunks).toEqual(["Answer."]);
  expect(reasoning).toEqual(["Read."]);
  expect(tools).toEqual([{ state: "result", toolCallId: "tool-1", toolName: "readDocument" }]);
  expect(usage).toEqual([{ inputTokens: 8, outputTokens: 4, totalTokens: 12 }]);
});

test("calls source import endpoint with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return jsonResponse({
      sources: [],
      model: "test-model",
      fetchedUrls: 1,
    });
  };

  const result = await importSources({ message: "https://example.com/rss.xml\nA note" }, fetcher);

  expect(result).toEqual({ sources: [], model: "test-model", fetchedUrls: 1 });
  expect(calls).toEqual([
    {
      url: "/api/sources/import",
      method: "POST",
      body: JSON.stringify({ message: "https://example.com/rss.xml\nA note" }),
    },
  ]);
});

test("calls settings endpoints with the /api base path", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return jsonResponse({
      app: {
        defaultDocumentTitle: "Untitled",
        editorLineHeight: "comfortable",
        sourcePanelDefaultOpen: true,
      },
      profile: { sub: "user-1", name: "Writer" },
    });
  };

  await getSettings(fetcher);
  await updateAppSettings({ editorLineHeight: "compact" }, fetcher);
  await updateProfile({ name: "Updated", picture: "https://example.com/avatar.png" }, fetcher);

  expect(calls).toEqual([
    { url: "/api/settings", method: "GET", body: undefined },
    {
      url: "/api/settings/app",
      method: "PATCH",
      body: JSON.stringify({ editorLineHeight: "compact" }),
    },
    {
      url: "/api/settings/profile",
      method: "PATCH",
      body: JSON.stringify({ name: "Updated", picture: "https://example.com/avatar.png" }),
    },
  ]);
});
