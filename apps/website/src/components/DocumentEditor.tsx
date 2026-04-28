import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { deleteDocument, updateDocument } from "../api/documents.ts";
import type { Document } from "../api/documents.ts";

type DocumentEditorProps = {
  document: Document;
  onDeleted?: () => void;
};

export function DocumentEditor({ document, onDeleted }: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [isSaved, setIsSaved] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    setTitle(document.title);
    setContent(document.content);
    setIsSaved(false);
  }, [document]);

  const saveDocument = useMutation({
    mutationFn: () => updateDocument(document.id, { title, content }),
    onSuccess: (updatedDocument) => {
      queryClient.setQueryData(["document", document.id], updatedDocument);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      setIsSaved(true);
    },
  });

  const removeDocument = useMutation({
    mutationFn: () => deleteDocument(document.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDeleted?.();
      void navigate({ to: "/documents" });
    },
  });

  function handleTitleChange(value: string) {
    setTitle(value);
    setIsSaved(false);
  }

  function handleContentChange(value: string) {
    setContent(value);
    setIsSaved(false);
  }

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
          {saveDocument.isPending ? <span className="text-neutral-500">Saving...</span> : null}
          {isSaved && !saveDocument.isPending ? (
            <span className="text-green-700">Saved</span>
          ) : null}
          {saveDocument.isError ? (
            <span className="text-red-700">Could not save changes.</span>
          ) : null}
          {removeDocument.isPending ? <span className="text-neutral-500">Deleting...</span> : null}
          {removeDocument.isError ? (
            <span className="text-red-700">Could not delete document.</span>
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
            onClick={() => saveDocument.mutate()}
          >
            {saveDocument.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </article>
  );
}
