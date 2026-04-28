import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

function renderRouter() {
  const router = createAppRouter();
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function stubApi(documents: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/health") {
        return Response.json({ ok: true });
      }

      if (url === "/api/documents") {
        return Response.json(documents);
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
