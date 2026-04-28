import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
    return <p className="text-sm text-neutral-500">Loading documents...</p>;
  }

  if (documents.isError) {
    return <p className="text-sm text-red-700">Could not load documents.</p>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-950">Documents</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Your local drafts, sorted by most recent changes.
        </p>
      </div>
      <div className="divide-y divide-stone-200 rounded border border-stone-200 bg-white">
        {documents.data?.length ? (
          documents.data.map((document) => (
            <Link
              key={document.id}
              to="/documents/$documentId"
              params={{ documentId: document.id }}
              className="block px-4 py-3 hover:bg-stone-50"
            >
              <div className="break-words font-medium text-neutral-950">{document.title}</div>
              <div className="mt-1 text-xs text-neutral-500">{formatDate(document.updatedAt)}</div>
            </Link>
          ))
        ) : (
          <p className="px-4 py-8 text-sm text-neutral-500">No documents yet.</p>
        )}
      </div>
    </section>
  );
}
