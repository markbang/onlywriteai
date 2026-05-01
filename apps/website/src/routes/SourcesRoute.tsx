import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  createSource as createGlobalSource,
  deleteSource as deleteGlobalSource,
  listSources,
  updateSource as updateGlobalSource,
  type DocumentSourceType,
  type GlobalDocumentSource,
} from "../api/documents.ts";

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

function formatDate(value: number) {
  const date = new Date(value);

  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
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

function toForm(source: GlobalDocumentSource): SourceFormState {
  return {
    type: source.type,
    title: source.title,
    note: source.note,
    url: source.url ?? "",
    fileName: source.fileName ?? "",
    tags: source.tags.join(", "),
  };
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

export function SourcesRoute() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SourceFormState>(emptyForm);
  const [importMessage, setImportMessage] = useState("");
  const [agentImportStatus, setAgentImportStatus] = useState("");
  const [editingSource, setEditingSource] = useState<GlobalDocumentSource | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
  });

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sources.data ?? []) {
      for (const tag of source.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()].sort((first, second) => first[0].localeCompare(second[0]));
  }, [sources.data]);

  const filteredSources = useMemo(() => {
    if (!activeTag) {
      return sources.data ?? [];
    }

    return (sources.data ?? []).filter((source) => source.tags.includes(activeTag));
  }, [activeTag, sources.data]);

  const createSource = useMutation({
    mutationFn: () => createGlobalSource(toInput(form)),
    onSuccess: async () => {
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  const updateSource = useMutation({
    mutationFn: () => {
      if (!editingSource) {
        throw new Error("No source selected");
      }

      return updateGlobalSource(editingSource.id, toInput(form));
    },
    onSuccess: async (_source, _input, _context) => {
      const documentIds = editingSource?.documents?.map((document) => document.id) ?? [];
      setEditingSource(null);
      setForm(emptyForm);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
        ...documentIds.map((documentId) =>
          queryClient.invalidateQueries({ queryKey: ["documentSources", documentId] }),
        ),
      ]);
    },
  });

  const deleteSource = useMutation({
    mutationFn: (source: GlobalDocumentSource) => deleteGlobalSource(source.id),
    onSuccess: async (_source, deletedSource) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
        ...(deletedSource.documents ?? []).map((document) =>
          queryClient.invalidateQueries({ queryKey: ["documentSources", document.id] }),
        ),
      ]);
    },
  });

  function startEditing(source: GlobalDocumentSource) {
    setEditingSource(source);
    setForm(toForm(source));
  }

  function cancelEditing() {
    setEditingSource(null);
    setForm(emptyForm);
  }

  const isSubmitting = createSource.isPending || updateSource.isPending;
  const actionError = createSource.isError || updateSource.isError || deleteSource.isError;
  const canSubmit = Boolean(form.url.trim() || form.fileName.trim() || form.note.trim());

  function requestAgentImport() {
    const message = importMessage.trim();
    if (!message) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("onlywrite:open-agent", {
        detail: {
          autoSend: true,
          instruction: [
            "For every URL below, call fetchUrl first, then createSource with a concise title, useful note, URL, and tags.",
            "For pasted standalone text, call createSource directly. Keep every step visible as tool calls.",
            "",
            message,
          ].join("\n"),
        },
      }),
    );
    setImportMessage("");
    setAgentImportStatus("Agent import started.");
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Sources</h1>
        <p className="mt-1 text-sm text-muted">Manage reference context across every document.</p>
      </div>

      <form
        className="border border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          requestAgentImport();
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">AI import</h2>
            <p className="mt-1 text-sm text-muted">
              Paste URLs or notes; OnlyWrite will fetch links and create sources.
            </p>
          </div>
          <button
            type="submit"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!importMessage.trim()}
            aria-label="Import sources with AI"
            title="Import sources with AI"
          >
            <span className="i-lucide-wand-sparkles h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <textarea
          className="min-h-28 w-full resize-y rounded border border-border px-3 py-2 text-sm leading-6 text-foreground"
          placeholder="https://bangwu.me/rss.xml\nA pasted paragraph or reference note..."
          value={importMessage}
          onChange={(event) => setImportMessage(event.currentTarget.value)}
          aria-label="AI source import message"
        />
        {agentImportStatus ? (
          <p className="mt-2 text-sm text-muted" role="status">
            {agentImportStatus}
          </p>
        ) : null}
      </form>

      <form
        className="grid gap-4 border border-border bg-surface p-4 lg:grid-cols-[180px_minmax(0,1fr)_120px]"
        onSubmit={(event) => {
          event.preventDefault();

          if (editingSource) {
            updateSource.mutate();
          } else {
            createSource.mutate();
          }
        }}
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-foreground">
            Type
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
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Title
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
            Tags
            <input
              className="mt-1 w-full rounded border border-border px-2 py-2 text-sm text-foreground"
              placeholder="research, market, quote"
              value={form.tags}
              onChange={(event) => {
                const tagsValue = event.currentTarget.value;
                setForm((current) => ({ ...current, tags: tagsValue }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            URL
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
            File
            <input
              className="mt-1 w-full rounded border border-border px-2 py-2 text-sm text-foreground"
              value={form.fileName}
              onChange={(event) => {
                const fileName = event.currentTarget.value;
                setForm((current) => ({ ...current, fileName }));
              }}
            />
          </label>
          <label className="text-sm font-medium text-foreground md:col-span-2">
            Note
            <textarea
              className="mt-1 min-h-24 w-full resize-y rounded border border-border px-2 py-2 text-sm leading-6 text-foreground"
              value={form.note}
              onChange={(event) => {
                const note = event.currentTarget.value;
                setForm((current) => ({ ...current, note }));
              }}
            />
          </label>
        </div>

        <div className="flex items-start justify-end gap-2">
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
          <button
            type="submit"
            className="inline-flex h-10 w-10 items-center justify-center rounded bg-accent text-accent-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSubmit || isSubmitting}
            aria-label={editingSource ? "Save source" : "Add source"}
            title={editingSource ? "Save source" : "Add source"}
          >
            <span
              className={
                isSubmitting
                  ? "i-lucide-loader-circle h-5 w-5"
                  : editingSource
                    ? "i-lucide-save h-5 w-5"
                    : "i-lucide-plus h-5 w-5"
              }
              aria-hidden="true"
            />
          </button>
        </div>
        {actionError ? (
          <p className="text-sm text-danger lg:col-span-3" role="alert">
            Could not update sources.
          </p>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded border px-3 py-1.5 text-sm ${
            activeTag === null
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border bg-surface text-foreground hover:bg-surface-secondary"
          }`}
          onClick={() => setActiveTag(null)}
        >
          All
        </button>
        {tags.map(([tag, count]) => (
          <button
            key={tag}
            type="button"
            className={`rounded border px-3 py-1.5 text-sm ${
              activeTag === tag
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface text-foreground hover:bg-surface-secondary"
            }`}
            onClick={() => setActiveTag(tag)}
          >
            {tag} <span className="text-xs opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {sources.isLoading ? <p className="text-sm text-muted">Loading sources...</p> : null}
      {sources.isError ? (
        <p className="text-sm text-danger" role="alert">
          Could not load sources.
        </p>
      ) : null}
      {!sources.isLoading && filteredSources.length === 0 ? (
        <p className="border border-border bg-surface px-4 py-8 text-sm text-muted">
          No sources found.
        </p>
      ) : null}
      <div className="grid gap-3">
        {filteredSources.map((source) => {
          const sourceLabel = source.title || source.url || source.fileName || "Untitled source";

          return (
            <article key={source.id} className="border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-muted">
                      {typeLabels[source.type]}
                    </span>
                    {(source.documents ?? []).map((document) => (
                      <Link
                        key={document.id}
                        to="/documents/$documentId"
                        params={{ documentId: document.id }}
                        className="text-xs text-muted hover:text-foreground"
                      >
                        {document.title}
                      </Link>
                    ))}
                  </div>
                  <h2 className="mt-1 break-words text-base font-semibold text-foreground">
                    {sourceLabel}
                  </h2>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface text-muted hover:bg-surface-secondary"
                    onClick={() => startEditing(source)}
                    aria-label={`Edit ${sourceLabel}`}
                    title={`Edit ${sourceLabel}`}
                  >
                    <span className="i-lucide-pencil h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded border border-danger bg-surface text-danger hover:bg-danger-soft"
                    onClick={() => deleteSource.mutate(source)}
                    aria-label={`Delete ${sourceLabel}`}
                    title={`Delete ${sourceLabel}`}
                  >
                    <span className="i-lucide-trash h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {source.note ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                  {source.note}
                </p>
              ) : null}
              {source.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {source.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-secondary"
                      onClick={() => setActiveTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {source.url ? <span className="break-all">{source.url}</span> : null}
                {source.fileName ? <span className="break-all">{source.fileName}</span> : null}
                <span>{formatDate(source.updatedAt)}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
