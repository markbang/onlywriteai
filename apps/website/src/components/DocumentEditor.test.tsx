import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Document } from "../api/documents.ts";
import { createQueryClient } from "../query.ts";
import { DocumentEditor } from "./DocumentEditor.tsx";

const navigate = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("../api/documents.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/documents.ts")>();

  return {
    ...actual,
    updateDocument: (...args: unknown[]) => updateDocument(...args),
    deleteDocument: (...args: unknown[]) => deleteDocument(...args),
  };
});

const document: Document = {
  id: "doc-1",
  title: "Draft title",
  content: "Draft body",
  createdAt: 1,
  updatedAt: 2,
};

function renderEditor(onDeleted = vi.fn()) {
  const queryClient = createQueryClient();

  return {
    onDeleted,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <DocumentEditor document={document} onDeleted={onDeleted} />
      </QueryClientProvider>,
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

beforeEach(() => {
  updateDocument.mockReset();
  deleteDocument.mockReset();
  navigate.mockReset();
});

function editRenderedText(currentText: string, nextText: string) {
  const field = screen.getByTestId("document-markdown-editor");
  expect(field.textContent).toContain(currentText);
  field.textContent = nextText;
  fireEvent.input(field);
}

test("renders editable document fields and hides document action buttons", () => {
  renderEditor();

  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Draft title");
  expect(screen.getByTestId("document-markdown-editor").textContent).toBe("Draft body");
  expect(screen.queryByRole("button", { name: "Save document" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete document" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "AI agent" })).toBeNull();
});

test("saves edited title and content with the keyboard shortcut", async () => {
  const updatedDocument = { ...document, title: "Updated title", content: "Updated body" };
  updateDocument.mockResolvedValueOnce(updatedDocument);
  const { queryClient } = renderEditor();
  queryClient.setQueryData(["document", document.id], document);

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated title" } });
  editRenderedText("Draft body", "Updated body");
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });

  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(updateDocument).toHaveBeenCalledWith(document.id, {
    title: "Updated title",
    content: "Updated body",
  });
  expect(queryClient.getQueryData(["document", document.id])).toEqual(updatedDocument);
});

test("does not mark a stale save response as saved or cache stale fields", async () => {
  const save = deferred<Document>();
  updateDocument.mockReturnValueOnce(save.promise);
  const { queryClient } = renderEditor();
  queryClient.setQueryData(["document", document.id], document);

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Submitted title" } });
  editRenderedText("Draft body", "Submitted body");
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Newer title" } });
  editRenderedText("Submitted body", "Newer body");

  save.resolve({ ...document, title: "Submitted title", content: "Submitted body" });

  await waitFor(() => expect(updateDocument).toHaveBeenCalledOnce());
  expect(screen.queryByText("Saved")).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Newer title");
  expect(screen.getByTestId("document-markdown-editor").textContent).toBe("Newer body");
  expect(queryClient.getQueryData(["document", document.id])).toEqual(document);
});

test("shows save errors", async () => {
  updateDocument.mockRejectedValueOnce(new Error("save failed"));
  renderEditor();

  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect((await screen.findByRole("alert")).textContent).toBe("Could not save changes.");
  expect(deleteDocument).not.toHaveBeenCalled();
});

test("announces pending and saved states", async () => {
  const save = deferred<Document>();
  updateDocument.mockReturnValueOnce(save.promise);
  renderEditor();

  fireEvent.keyDown(window, { key: "s", ctrlKey: true });

  expect((await screen.findByRole("status")).textContent).toBe("Saving...");

  save.resolve(document);

  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
});

test("saves with the keyboard shortcut", async () => {
  updateDocument.mockResolvedValueOnce(document);
  renderEditor();

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Shortcut title" } });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });

  await waitFor(() =>
    expect(updateDocument).toHaveBeenCalledWith(document.id, {
      title: "Shortcut title",
      content: "Draft body",
    }),
  );
});

test("keeps slash input inside the Milkdown editor", async () => {
  renderEditor();

  editRenderedText("Draft body", "/");

  expect(screen.getByTestId("document-markdown-editor").textContent).toBe("/");
});

test("saves code block markdown from the Milkdown editor", async () => {
  updateDocument.mockResolvedValueOnce({
    ...document,
    content: "```ts\nconsole.log('OnlyWrite')\n```",
  });
  renderEditor();

  editRenderedText("Draft body", "```ts\nconsole.log('OnlyWrite')\n```");
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });

  await waitFor(() =>
    expect(updateDocument).toHaveBeenCalledWith(document.id, {
      title: "Draft title",
      content: "```ts\nconsole.log('OnlyWrite')\n```",
    }),
  );
});

test("syncs external document content updates into the Milkdown editor", async () => {
  const { rerender, queryClient } = renderEditor();
  const updatedDocument = { ...document, content: "Updated by agent" };
  updateDocument.mockResolvedValueOnce(updatedDocument);
  queryClient.setQueryData(["document", document.id], updatedDocument);

  rerender(
    <QueryClientProvider client={queryClient}>
      <DocumentEditor document={updatedDocument} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Updated by agent")).toBeTruthy();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });

  await waitFor(() =>
    expect(updateDocument).toHaveBeenCalledWith(document.id, {
      title: "Draft title",
      content: "Updated by agent",
    }),
  );
});
