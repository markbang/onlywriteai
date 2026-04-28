import "../test/setup.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
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

test("renders editable document fields and action buttons", () => {
  renderEditor();

  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Draft title");
  expect(screen.getByLabelText("Content")).toHaveProperty("value", "Draft body");
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
});

test("saves edited title and content", async () => {
  const updatedDocument = { ...document, title: "Updated title", content: "Updated body" };
  updateDocument.mockResolvedValueOnce(updatedDocument);
  const { queryClient } = renderEditor();
  queryClient.setQueryData(["document", document.id], document);

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated title" } });
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Updated body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Submitted body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Newer title" } });
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Newer body" } });

  save.resolve({ ...document, title: "Submitted title", content: "Submitted body" });

  await waitFor(() => expect(updateDocument).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
  expect(screen.queryByText("Saved")).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Newer title");
  expect(screen.getByLabelText("Content")).toHaveProperty("value", "Newer body");
  expect(queryClient.getQueryData(["document", document.id])).toEqual(document);
});

test("deletes the document and notifies parent", async () => {
  deleteDocument.mockResolvedValueOnce(undefined);
  const { onDeleted, queryClient } = renderEditor();
  queryClient.setQueryData(["document", document.id], document);

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith(document.id));
  expect(queryClient.getQueryData(["document", document.id])).toBeUndefined();
  expect(onDeleted).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith({ to: "/documents" });
});

test("shows save and delete errors", async () => {
  updateDocument.mockRejectedValueOnce(new Error("save failed"));
  deleteDocument.mockRejectedValueOnce(new Error("delete failed"));
  renderEditor();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not save changes.");

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not delete document.");
});

test("announces pending and saved states", async () => {
  const save = deferred<Document>();
  updateDocument.mockReturnValueOnce(save.promise);
  renderEditor();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect((await screen.findByRole("status")).textContent).toBe("Saving...");

  save.resolve(document);

  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
});
