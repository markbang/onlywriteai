import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getDocument } from "../api/documents.ts";
import { DocumentEditor } from "../components/DocumentEditor.tsx";
import { SourcePanel } from "../components/SourcePanel.tsx";

export function DocumentRoute() {
  const { documentId } = useParams({ from: "/documents/$documentId" });
  const document = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId),
  });

  if (document.isLoading) {
    return <p className="text-sm text-neutral-500">Loading document...</p>;
  }

  if (document.isError || !document.data) {
    return <p className="text-sm text-red-700">Could not load this document.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <SourcePanel documentId={documentId} />
      <DocumentEditor document={document.data} />
    </div>
  );
}
