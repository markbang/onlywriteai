import { useQuery } from "@tanstack/react-query";
import { listDocuments } from "../api/documents.ts";

function formatDate(value: number) {
  const date = new Date(value);

  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export function DocumentsRoute() {
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
  });

  if (documents.isLoading) {
    return <p className="text-sm text-muted">Loading documents...</p>;
  }

  if (documents.isError) {
    return <p className="text-sm text-danger">Could not load documents.</p>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Documents</h1>
        <p className="mt-1 text-sm text-muted">Your local drafts, sorted by most recent changes.</p>
      </div>
      <div className="divide-y divide-border rounded border border-border bg-surface">
        {documents.data?.length ? (
          documents.data.map((document) => (
            <a
              key={document.id}
              href={`/documents/${document.id}`}
              className="block px-4 py-3 hover:bg-surface-secondary"
            >
              <div className="break-words font-medium text-foreground">{document.title}</div>
              <div className="mt-1 text-xs text-muted">{formatDate(document.updatedAt)}</div>
            </a>
          ))
        ) : (
          <p className="px-4 py-8 text-sm text-muted">No documents yet.</p>
        )}
      </div>
    </section>
  );
}
