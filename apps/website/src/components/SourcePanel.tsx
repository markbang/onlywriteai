import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createDocumentSource,
  deleteDocumentSource,
  linkDocumentSource,
  listDocumentSources,
  listSources,
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
  tags: string;
};

const emptyForm: SourceFormState = {
  type: "text",
  title: "",
  note: "",
  url: "",
  fileName: "",
  tags: "",
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
    tags: source.tags.join(", "),
  };
}

function parseTags(value: string) {
  return Array.from(
    new Map(
      value
        .split(",")
        .map((tag) => tag.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .map((tag) => [tag.toLowerCase(), tag]),
    ).values(),
  );
}

function toInput(form: SourceFormState) {
  return {
    type: form.type,
    title: form.title,
    note: form.note,
    url: form.url || undefined,
    fileName: form.fileName || undefined,
    tags: parseTags(form.tags),
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
  const [sourceToLink, setSourceToLink] = useState("");
  const sourcesQueryKey = ["documentSources", documentId];
  const sources = useQuery({
    queryKey: sourcesQueryKey,
    queryFn: () => listDocumentSources(documentId),
  });
  const allSources = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
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

  const linkSource = useMutation({
    mutationFn: (sourceId: string) => linkDocumentSource(documentId, sourceId),
    onSuccess: async () => {
      setSourceToLink("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sourcesQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
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
  const actionError =
    createSource.isError || updateSource.isError || deleteSource.isError || linkSource.isError;
  const linkedSourceIds = new Set(sources.data?.map((source) => source.id) ?? []);
  const linkableSources = (allSources.data ?? []).filter(
    (source) => !linkedSourceIds.has(source.id),
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sources</h2>
            <p className="mt-1 text-xs text-muted">{sources.data?.length ?? 0} linked</p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded bg-surface-tertiary text-muted">
            <span className="i-lucide-library h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <form
          className="mb-4 flex gap-2 border-b border-border pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (sourceToLink) {
              linkSource.mutate(sourceToLink);
            }
          }}
        >
          <select
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-2 text-sm text-foreground"
            value={sourceToLink}
            onChange={(event) => setSourceToLink(event.currentTarget.value)}
            aria-label="Existing source"
          >
            <option value="">Attach source</option>
            {linkableSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title || source.url || source.fileName || "Untitled source"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!sourceToLink || linkSource.isPending}
            aria-label="Attach source"
            title="Attach source"
          >
            <span
              className={
                linkSource.isPending ? "i-lucide-loader-circle h-5 w-5" : "i-lucide-link h-5 w-5"
              }
              aria-hidden="true"
            />
          </button>
        </form>

        <form
          className="mb-5 flex flex-col gap-3 border-b border-border pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (editingSource) {
              updateSource.mutate();
            } else {
              createSource.mutate();
            }
          }}
        >
          <label className="text-sm font-medium text-foreground">
            Source type
            <select
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm text-foreground"
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
          <label className="text-sm font-medium text-foreground">
            Source title
            <input
              className="mt-1 w-full rounded border border-border px-2 py-2 text-sm text-foreground"
              value={form.title}
              onChange={(event) => {
                const title = event.currentTarget.value;
                setForm((current) => ({ ...current, title }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Source note
            <textarea
              className="mt-1 min-h-24 w-full resize-y rounded border border-border px-2 py-2 text-sm leading-6 text-foreground"
              value={form.note}
              onChange={(event) => {
                const note = event.currentTarget.value;
                setForm((current) => ({ ...current, note }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Tags
            <input
              className="mt-1 w-full rounded border border-border px-2 py-2 text-sm text-foreground"
              placeholder="research, product, quotes"
              value={form.tags}
              onChange={(event) => {
                const tags = event.currentTarget.value;
                setForm((current) => ({ ...current, tags }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Source URL
            <input
              className="mt-1 w-full rounded border border-border px-2 py-2 text-sm text-foreground"
              value={form.url}
              onChange={(event) => {
                const url = event.currentTarget.value;
                setForm((current) => ({ ...current, url }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            File name
            <input
              className="mt-1 w-full rounded border border-border px-2 py-2 text-sm text-foreground"
              value={form.fileName}
              onChange={(event) => {
                const fileName = event.currentTarget.value;
                setForm((current) => ({ ...current, fileName }));
              }}
            />
          </label>
          {actionError ? (
            <p className="text-sm text-danger" role="alert">
              Could not update sources.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="inline-flex h-10 w-10 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              aria-label={editingSource ? "Save source" : "Add source"}
              title={editingSource ? "Save source" : "Add source"}
            >
              <span
                className={
                  isSubmitting
                    ? "i-lucide-loader-circle h-5 w-5 animate-spin"
                    : editingSource
                      ? "i-lucide-save h-5 w-5"
                      : "i-lucide-plus h-5 w-5"
                }
                aria-hidden="true"
              />
            </button>
            {editingSource ? (
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-secondary"
                onClick={cancelEditing}
                aria-label="Cancel source editing"
                title="Cancel source editing"
              >
                <span className="i-lucide-x h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </form>

        {sources.isLoading ? <p className="text-sm text-muted">Loading sources...</p> : null}
        {sources.isError ? (
          <p className="text-sm text-danger" role="alert">
            Could not load sources.
          </p>
        ) : null}
        {sources.data?.length === 0 ? <p className="text-sm text-muted">No sources yet.</p> : null}
        <div className="flex flex-col gap-3">
          {sources.data?.map((source) => {
            const sourceLabel = source.title || source.url || source.fileName || "Untitled source";

            return (
              <article key={source.id} className="rounded border border-border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold uppercase text-muted">
                      {typeLabels[source.type]}
                    </span>
                    <h3 className="break-words text-sm font-semibold text-foreground">
                      {sourceLabel}
                    </h3>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-muted hover:bg-surface-secondary"
                      onClick={() => startEditing(source)}
                      aria-label={`Edit ${sourceLabel}`}
                      title={`Edit ${sourceLabel}`}
                    >
                      <span className="i-lucide-pencil h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-danger bg-surface text-danger hover:bg-danger-soft"
                      onClick={() => deleteSource.mutate(source.id)}
                      aria-label={`Detach ${sourceLabel}`}
                      title={`Detach ${sourceLabel}`}
                    >
                      <span className="i-lucide-unlink h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {source.note ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {source.note}
                  </p>
                ) : null}
                {source.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {source.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-border px-2 py-0.5 text-xs text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {source.url ? (
                  <p className="mt-2 break-words text-xs text-muted">{source.url}</p>
                ) : null}
                {source.fileName ? (
                  <p className="mt-2 break-words text-xs text-muted">{source.fileName}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted">{formatDate(source.updatedAt)}</p>
              </article>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
