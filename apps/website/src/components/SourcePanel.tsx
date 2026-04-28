import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createDocumentSource,
  deleteDocumentSource,
  listDocumentSources,
  updateDocumentSource,
  type DocumentSource,
  type DocumentSourceType,
} from "../api/documents.ts";

type SourcePanelProps = {
  documentId: string;
};

type SourceFormState = {
  type: DocumentSourceType;
  title: string;
  note: string;
  url: string;
  fileName: string;
};

const emptyForm: SourceFormState = {
  type: "text",
  title: "",
  note: "",
  url: "",
  fileName: "",
};

const typeLabels: Record<DocumentSourceType, string> = {
  image: "Image",
  pdf: "PDF",
  rss: "RSS",
  text: "Text",
};

function toForm(source: DocumentSource): SourceFormState {
  return {
    type: source.type,
    title: source.title,
    note: source.note,
    url: source.url ?? "",
    fileName: source.fileName ?? "",
  };
}

function toInput(form: SourceFormState) {
  return {
    type: form.type,
    title: form.title,
    note: form.note,
    url: form.url || undefined,
    fileName: form.fileName || undefined,
  };
}

function formatDate(value: number) {
  const date = new Date(value);

  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export function SourcePanel({ documentId }: SourcePanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SourceFormState>(emptyForm);
  const [editingSource, setEditingSource] = useState<DocumentSource | null>(null);
  const sourcesQueryKey = ["documentSources", documentId];
  const sources = useQuery({
    queryKey: sourcesQueryKey,
    queryFn: () => listDocumentSources(documentId),
  });

  const createSource = useMutation({
    mutationFn: () => createDocumentSource(documentId, toInput(form)),
    onSuccess: async () => {
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: sourcesQueryKey });
    },
  });

  const updateSource = useMutation({
    mutationFn: () => {
      if (!editingSource) {
        throw new Error("No source selected");
      }

      return updateDocumentSource(documentId, editingSource.id, toInput(form));
    },
    onSuccess: async () => {
      setEditingSource(null);
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: sourcesQueryKey });
    },
  });

  const deleteSource = useMutation({
    mutationFn: (sourceId: string) => deleteDocumentSource(documentId, sourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sourcesQueryKey });
    },
  });

  function startEditing(source: DocumentSource) {
    setEditingSource(source);
    setForm(toForm(source));
  }

  function cancelEditing() {
    setEditingSource(null);
    setForm(emptyForm);
  }

  const isSubmitting = createSource.isPending || updateSource.isPending;
  const actionError = createSource.isError || updateSource.isError || deleteSource.isError;
  const showUrl = form.type === "rss";
  const showFileName = form.type === "pdf" || form.type === "image";

  return (
    <aside className="rounded border border-stone-200 bg-white p-4">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-neutral-950">Sources</h2>
        <p className="mt-1 text-sm text-neutral-500">Read-only context for this document.</p>
      </div>

      <form
        className="mb-5 flex flex-col gap-3 border-b border-stone-200 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (editingSource) {
            updateSource.mutate();
          } else {
            createSource.mutate();
          }
        }}
      >
        <label className="text-sm font-medium text-neutral-700">
          Source type
          <select
            className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-2 text-sm text-neutral-950"
            value={form.type}
            onChange={(event) => {
              const type = event.currentTarget.value as DocumentSourceType;
              setForm((current) => ({ ...current, type }));
            }}
          >
            <option value="text">Text</option>
            <option value="rss">RSS</option>
            <option value="pdf">PDF</option>
            <option value="image">Image</option>
          </select>
        </label>
        <label className="text-sm font-medium text-neutral-700">
          Source title
          <input
            className="mt-1 w-full rounded border border-stone-300 px-2 py-2 text-sm text-neutral-950"
            value={form.title}
            onChange={(event) => {
              const title = event.currentTarget.value;
              setForm((current) => ({ ...current, title }));
            }}
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          Source note
          <textarea
            className="mt-1 min-h-24 w-full resize-y rounded border border-stone-300 px-2 py-2 text-sm leading-6 text-neutral-950"
            value={form.note}
            onChange={(event) => {
              const note = event.currentTarget.value;
              setForm((current) => ({ ...current, note }));
            }}
          />
        </label>
        {showUrl ? (
          <label className="text-sm font-medium text-neutral-700">
            Source URL
            <input
              className="mt-1 w-full rounded border border-stone-300 px-2 py-2 text-sm text-neutral-950"
              value={form.url}
              onChange={(event) => {
                const url = event.currentTarget.value;
                setForm((current) => ({ ...current, url }));
              }}
            />
          </label>
        ) : null}
        {showFileName ? (
          <label className="text-sm font-medium text-neutral-700">
            File name
            <input
              className="mt-1 w-full rounded border border-stone-300 px-2 py-2 text-sm text-neutral-950"
              value={form.fileName}
              onChange={(event) => {
                const fileName = event.currentTarget.value;
                setForm((current) => ({ ...current, fileName }));
              }}
            />
          </label>
        ) : null}
        {actionError ? (
          <p className="text-sm text-red-700" role="alert">
            Could not update sources.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded bg-neutral-950 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {editingSource ? "Save source" : "Add source"}
          </button>
          {editingSource ? (
            <button
              type="button"
              className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-stone-50"
              onClick={cancelEditing}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {sources.isLoading ? <p className="text-sm text-neutral-500">Loading sources...</p> : null}
      {sources.isError ? (
        <p className="text-sm text-red-700" role="alert">
          Could not load sources.
        </p>
      ) : null}
      {sources.data?.length === 0 ? (
        <p className="text-sm text-neutral-500">No sources yet.</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {sources.data?.map((source) => (
          <article key={source.id} className="rounded border border-stone-200 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase text-neutral-500">
                  {typeLabels[source.type]}
                </span>
                <h3 className="break-words text-sm font-semibold text-neutral-950">
                  {source.title}
                </h3>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-neutral-600 underline"
                  onClick={() => startEditing(source)}
                  aria-label={`Edit ${source.title}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-red-700 underline"
                  onClick={() => deleteSource.mutate(source.id)}
                  aria-label={`Delete ${source.title}`}
                >
                  Delete
                </button>
              </div>
            </div>
            {source.note ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-neutral-700">
                {source.note}
              </p>
            ) : null}
            {source.url ? (
              <p className="mt-2 break-words text-xs text-neutral-500">{source.url}</p>
            ) : null}
            {source.fileName ? (
              <p className="mt-2 break-words text-xs text-neutral-500">{source.fileName}</p>
            ) : null}
            <p className="mt-2 text-xs text-neutral-400">{formatDate(source.updatedAt)}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
