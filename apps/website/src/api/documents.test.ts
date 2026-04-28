// @vitest-environment node

import { expect, test } from "vite-plus/test";
import {
  ApiError,
  createDocument,
  createDocumentSource,
  deleteDocument,
  deleteDocumentSource,
  getDocument,
  getHealth,
  listDocumentSources,
  listDocuments,
  updateDocument,
  updateDocumentSource,
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
  ]);
});
