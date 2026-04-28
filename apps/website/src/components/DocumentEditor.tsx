import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { deleteDocument, updateDocument } from "../api/documents.ts";
import type { Document } from "../api/documents.ts";

type DocumentDraft = {
  title: string;
  content: string;
};

type DocumentEditorProps = {
  document: Document;
  onDeleted?: () => void;
};

export function DocumentEditor({ document, onDeleted }: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [isSaved, setIsSaved] = useState(false);
  const currentDraft = useRef<DocumentDraft>({ title: document.title, content: document.content });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    setTitle(document.title);
    setContent(document.content);
    setIsSaved(false);
    currentDraft.current = { title: document.title, content: document.content };
  }, [document]);

  const saveDocument = useMutation({
    mutationFn: (draft: DocumentDraft) => updateDocument(document.id, draft),
    onSuccess: (updatedDocument, submittedDraft) => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });

      if (
        currentDraft.current.title === submittedDraft.title &&
        currentDraft.current.content === submittedDraft.content
      ) {
        queryClient.setQueryData(["document", document.id], updatedDocument);
        setIsSaved(true);
      }
    },
  });

  const removeDocument = useMutation({
    mutationFn: () => deleteDocument(document.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["document", document.id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDeleted?.();
      void navigate({ to: "/documents" });
    },
  });

  function handleTitleChange(value: string) {
    setTitle(value);
    currentDraft.current = { title: value, content };
    setIsSaved(false);
  }

  function handleContentChange(value: string) {
    setContent(value);
    currentDraft.current = { title, content: value };
    setIsSaved(false);
  }

  const statusMessage = saveDocument.isPending
    ? "Saving..."
    : removeDocument.isPending
      ? "Deleting..."
      : isSaved
        ? "Saved"
        : "";
  const errorMessage = removeDocument.isError
    ? "Could not delete document."
    : saveDocument.isError
      ? "Could not save changes."
      : "";

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5">
      <input
        className="w-full border-0 bg-transparent text-3xl font-semibold text-neutral-950 outline-none focus:ring-0"
        value={title}
        onChange={(event) => handleTitleChange(event.currentTarget.value)}
        aria-label="Title"
      />
      <textarea
        className="min-h-[60vh] w-full resize-y border-0 bg-transparent text-base leading-7 text-neutral-800 outline-none focus:ring-0"
        value={content}
        onChange={(event) => handleContentChange(event.currentTarget.value)}
        aria-label="Content"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
        <div className="min-h-5 text-sm">
          {errorMessage ? (
            <span className="text-red-700" role="alert">
              {errorMessage}
            </span>
          ) : null}
          {statusMessage && !errorMessage ? (
            <span
              className={isSaved ? "text-green-700" : "text-neutral-500"}
              role="status"
              aria-live="polite"
            >
              {statusMessage}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={removeDocument.isPending || saveDocument.isPending}
            onClick={() => removeDocument.mutate()}
          >
            {removeDocument.isPending ? "Deleting..." : "Delete"}
          </button>
          <button
            className="rounded bg-neutral-950 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={saveDocument.isPending || removeDocument.isPending}
            onClick={() => saveDocument.mutate({ title, content })}
          >
            {saveDocument.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </article>
  );
}
