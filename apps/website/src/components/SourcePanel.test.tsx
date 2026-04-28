import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import {
  createDocumentSource,
  deleteDocumentSource,
  listDocumentSources,
  updateDocumentSource,
} from "../api/documents.ts";
import { createQueryClient } from "../query.ts";
import { SourcePanel } from "./SourcePanel.tsx";

vi.mock("../api/documents.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/documents.ts")>()),
  createDocumentSource: vi.fn(),
  deleteDocumentSource: vi.fn(),
  listDocumentSources: vi.fn(),
  updateDocumentSource: vi.fn(),
}));

function renderPanel() {
  const queryClient = createQueryClient();

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SourcePanel documentId="doc-1" />
      </QueryClientProvider>,
    ),
  };
}

test("renders an empty source state", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([]);

  renderPanel();

  expect(await screen.findByText("No sources yet.")).toBeTruthy();
});

test("renders source list items", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([
    {
      id: "source-1",
      documentId: "doc-1",
      type: "rss",
      title: "Research feed",
      note: "Track this feed.",
      url: "https://example.com/rss",
      fileName: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);

  renderPanel();

  expect(await screen.findByText("Research feed")).toBeTruthy();
  expect(screen.getAllByText("RSS").length).toBeGreaterThan(0);
  expect(screen.getByText("Track this feed.")).toBeTruthy();
  expect(screen.getByText("https://example.com/rss")).toBeTruthy();
});

test("creates a source", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([]);
  vi.mocked(createDocumentSource).mockResolvedValue({
    id: "source-1",
    documentId: "doc-1",
    type: "text",
    title: "Quote",
    note: "Useful quote",
    url: null,
    fileName: null,
    createdAt: 1,
    updatedAt: 1,
  });

  renderPanel();

  fireEvent.change(await screen.findByLabelText("Source title"), {
    target: { value: "Quote" },
  });
  fireEvent.change(screen.getByLabelText("Source note"), {
    target: { value: "Useful quote" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add source" }));

  await waitFor(() =>
    expect(createDocumentSource).toHaveBeenCalledWith("doc-1", {
      type: "text",
      title: "Quote",
      note: "Useful quote",
      url: undefined,
      fileName: undefined,
    }),
  );
});

test("shows type-specific URL and file name fields", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([]);

  renderPanel();

  fireEvent.change(await screen.findByLabelText("Source type"), { target: { value: "rss" } });
  expect(screen.getByLabelText("Source URL")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "pdf" } });
  expect(screen.getByLabelText("File name")).toBeTruthy();
});

test("updates and deletes a source", async () => {
  vi.mocked(listDocumentSources).mockResolvedValue([
    {
      id: "source-1",
      documentId: "doc-1",
      type: "text",
      title: "Old title",
      note: "Old note",
      url: null,
      fileName: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  vi.mocked(updateDocumentSource).mockResolvedValue({
    id: "source-1",
    documentId: "doc-1",
    type: "text",
    title: "New title",
    note: "Old note",
    url: null,
    fileName: null,
    createdAt: 1,
    updatedAt: 2,
  });
  vi.mocked(deleteDocumentSource).mockResolvedValue(undefined);

  renderPanel();

  fireEvent.click(await screen.findByRole("button", { name: "Edit Old title" }));
  fireEvent.change(screen.getByLabelText("Source title"), { target: { value: "New title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save source" }));
  await waitFor(() =>
    expect(updateDocumentSource).toHaveBeenCalledWith("doc-1", "source-1", {
      type: "text",
      title: "New title",
      note: "Old note",
      url: undefined,
      fileName: undefined,
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Delete Old title" }));
  await waitFor(() => expect(deleteDocumentSource).toHaveBeenCalledWith("doc-1", "source-1"));
});
