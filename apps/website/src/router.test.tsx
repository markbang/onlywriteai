import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { AuthProvider } from "./auth.tsx";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";
import { ThemeProvider } from "./theme.tsx";

function renderRouter() {
  const router = createAppRouter();
  const queryClient = createQueryClient();

  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function requestBody(init: RequestInit | undefined) {
  return typeof init?.body === "string" ? init.body : "{}";
}

function stubApi(documents: unknown[], options: { slowAgentStream?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/health") {
        return Response.json({ ok: true });
      }

      if (url === "/api/auth/me") {
        return Response.json({ enabled: false, user: null });
      }

      if (url === "/api/documents") {
        return Response.json(documents);
      }

      if (url === "/api/models") {
        return Response.json({ models: ["test-model"] });
      }

      if (url === "/api/settings") {
        return Response.json({
          app: {
            defaultDocumentTitle: "Untitled",
            editorLineHeight: "comfortable",
            sourcePanelDefaultOpen: true,
          },
          profile: {
            sub: "user-1",
            email: "writer@example.com",
            name: "Writer",
            picture: "https://example.com/avatar.png",
          },
        });
      }

      if (url === "/api/settings/app") {
        const body = input instanceof Request ? await input.json() : JSON.parse(requestBody(init));
        return Response.json(body);
      }

      if (url === "/api/settings/profile") {
        const body = input instanceof Request ? await input.json() : JSON.parse(requestBody(init));
        return Response.json({ sub: "user-1", email: "writer@example.com", ...body });
      }

      if (url === "/api/documents/doc-1") {
        return Response.json({
          id: "doc-1",
          title: "Draft",
          content: "Body",
          createdAt: 1,
          updatedAt: 1,
        });
      }

      if (url === "/api/documents/doc-1/sources") {
        return Response.json([]);
      }

      if (url === "/api/sources") {
        return Response.json([
          {
            id: "source-1",
            type: "text",
            title: "Reference note",
            note: "Reusable context",
            url: null,
            fileName: null,
            tags: ["research"],
            documents: [{ id: "doc-1", title: "Draft" }],
            createdAt: 1,
            updatedAt: 1,
          },
        ]);
      }

      if (url === "/api/sources/import") {
        return Response.json({
          sources: [
            {
              id: "source-imported",
              type: "rss",
              title: "Imported RSS",
              note: "Fetched feed",
              url: "https://bangwu.me/rss.xml",
              fileName: null,
              tags: ["rss"],
              createdAt: 2,
              updatedAt: 2,
            },
          ],
          model: "test-model",
          fetchedUrls: 1,
        });
      }

      if (url === "/api/agent/assist/stream") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              if (options.slowAgentStream) {
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ delta: "Live answer", type: "text" })}\n`),
                );
                setTimeout(() => {
                  controller.close();
                }, 1000);
                return;
              }

              for (const event of [
                {
                  delta: {
                    inputSummary: '{"message":"https://bangwu.me/rss.xml"}',
                    state: "call",
                    toolCallId: "tool-import",
                    toolName: "importSources",
                  },
                  type: "tool",
                },
                {
                  delta: {
                    output: {
                      fetchedUrls: 1,
                      sources: [
                        {
                          id: "source-imported",
                          title: "Imported RSS",
                        },
                      ],
                    },
                    state: "result",
                    toolCallId: "tool-import",
                    toolName: "importSources",
                  },
                  type: "tool",
                },
                { delta: "Imported 1 source.", type: "text" },
              ]) {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              }
              controller.close();
            },
          }),
          {
            headers: {
              "x-onlywrite-model": "test-model",
              "x-onlywrite-stream-format": "events",
            },
          },
        );
      }

      return Response.json({ error: { message: "Not found" } }, { status: 404 });
    }),
  );
}

test("renders the OnlyWrite app shell", async () => {
  renderRouter();

  expect(await screen.findByText("OnlyWrite")).toBeTruthy();
});

test("renders a fallback for invalid document timestamps", async () => {
  window.history.pushState({}, "", "/documents");
  stubApi([{ id: "doc-1", title: "Draft", content: "", createdAt: 1, updatedAt: 9e99 }]);

  renderRouter();

  expect(await screen.findByText("Date unavailable")).toBeTruthy();
});

test("wraps long document titles in the document list", async () => {
  const longTitle = "A".repeat(140);
  window.history.pushState({}, "", "/documents");
  stubApi([{ id: "doc-1", title: longTitle, content: "", createdAt: 1, updatedAt: 1 }]);

  renderRouter();

  expect((await screen.findByText(longTitle)).className).toContain("break-words");
});

test("opens global document search", async () => {
  window.history.pushState({}, "", "/");
  stubApi([{ id: "doc-1", title: "Searchable Draft", content: "", createdAt: 1, updatedAt: 1 }]);

  renderRouter();

  fireEvent.click(await screen.findByRole("button", { name: "Search" }));

  expect(await screen.findByLabelText("Search documents")).toBeTruthy();
  expect(await screen.findByText("Searchable Draft")).toBeTruthy();
});

test("switches theme modes", async () => {
  window.history.pushState({}, "", "/");
  stubApi([]);

  renderRouter();

  fireEvent.change(await screen.findByLabelText("Theme"), { target: { value: "dark" } });

  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem("onlywrite.theme.mode")).toBe("dark");
});

test("renders document workspace with sources and editor", async () => {
  window.history.pushState({}, "", "/documents/doc-1");
  stubApi([]);

  renderRouter();

  expect(await screen.findByText("Sources")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Open AI agent" })).toBeTruthy();
  expect(await screen.findByDisplayValue("Draft")).toBeTruthy();
});

test("renders the global source manager", async () => {
  window.history.pushState({}, "", "/sources");
  stubApi([{ id: "doc-1", title: "Draft", content: "", createdAt: 1, updatedAt: 1 }]);

  renderRouter();

  expect(await screen.findByText("Reference note")).toBeTruthy();
  expect((await screen.findAllByText("research")).length).toBeGreaterThan(0);
  expect(await screen.findByRole("button", { name: "Add source" })).toBeTruthy();
});

test("imports sources with AI from the global source manager", async () => {
  window.history.pushState({}, "", "/sources");
  stubApi([{ id: "doc-1", title: "Draft", content: "", createdAt: 1, updatedAt: 1 }]);

  renderRouter();

  const importInput = await screen.findByLabelText("AI source import message");
  fireEvent.change(importInput, {
    target: { value: "https://bangwu.me/rss.xml\nfhafjak" },
  });
  const importButton = await screen.findByRole("button", { name: "Import sources with AI" });
  await waitFor(() => expect((importButton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(importButton);

  expect(await screen.findByText("Agent import started.")).toBeTruthy();
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/assist/stream",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("fetchUrl"),
      }),
    ),
  );
  expect(screen.getAllByText("AI agent").length).toBeGreaterThan(0);
});

test("keeps a streaming chat card after the chat is closed", async () => {
  window.history.pushState({}, "", "/");
  stubApi([], { slowAgentStream: true });

  renderRouter();

  fireEvent.click(await screen.findByRole("button", { name: "Open AI agent" }));
  fireEvent.change(await screen.findByLabelText("Agent message"), {
    target: { value: "Write a live answer" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Send message" }));

  expect(await screen.findByText("Live answer")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close AI agent" }));

  expect(await screen.findByText("Streaming")).toBeTruthy();
  expect(screen.getByText("Live answer")).toBeTruthy();
});

test("renders and saves settings", async () => {
  window.history.pushState({}, "", "/settings");
  stubApi([]);

  renderRouter();

  expect(await screen.findByText("OnlyWrite")).toBeTruthy();
  expect(await screen.findByDisplayValue("Writer")).toBeTruthy();
  fireEvent.change(await screen.findByDisplayValue("Untitled"), {
    target: { value: "New draft" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Save settings" }));

  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings/app",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          defaultDocumentTitle: "New draft",
          editorLineHeight: "comfortable",
          sourcePanelDefaultOpen: true,
        }),
      }),
    ),
  );
});
