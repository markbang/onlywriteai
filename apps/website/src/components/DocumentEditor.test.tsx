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

test("deletes the document and notifies parent", async () => {
  deleteDocument.mockResolvedValueOnce(undefined);
  const { onDeleted } = renderEditor();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith(document.id));
  expect(onDeleted).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith({ to: "/documents" });
});

test("shows save and delete errors", async () => {
  updateDocument.mockRejectedValueOnce(new Error("save failed"));
  deleteDocument.mockRejectedValueOnce(new Error("delete failed"));
  renderEditor();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Could not save changes.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("Could not delete document.")).toBeTruthy();
});
