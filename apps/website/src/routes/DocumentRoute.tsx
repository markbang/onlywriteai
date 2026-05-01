import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { getDocument } from "../api/documents.ts";
import { DocumentEditor } from "../components/DocumentEditor.tsx";
import { SourcePanel } from "../components/SourcePanel.tsx";

export function DocumentRoute() {
  const documentId = useLocation().pathname.split("/").filter(Boolean).at(1) ?? "";
  const [showSources, setShowSources] = useState(true);
  const document = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId),
  });

  if (document.isLoading) {
    return <p className="text-sm text-muted">Loading document...</p>;
  }

  if (document.isError || !document.data) {
    return <p className="text-sm text-danger">Could not load this document.</p>;
  }

  return (
    <section className="relative h-[calc(100vh-57px)] min-h-[620px]">
      <div className="absolute left-3 top-3 z-20">
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface text-foreground shadow-sm hover:bg-surface-secondary"
          type="button"
          onClick={() => setShowSources((current) => !current)}
          aria-label={showSources ? "Hide sources" : "Show sources"}
          title={showSources ? "Hide sources" : "Show sources"}
        >
          <span
            className={
              showSources ? "i-lucide-panel-left-close h-5 w-5" : "i-lucide-panel-left-open h-5 w-5"
            }
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        className={
          showSources
            ? "grid h-full min-h-0 lg:grid-cols-[320px_minmax(0,1fr)]"
            : "grid h-full min-h-0"
        }
      >
        {showSources ? (
          <div className="min-h-0">
            <SourcePanel documentId={documentId} />
          </div>
        ) : null}
        <div className="min-w-0">
          <DocumentEditor document={document.data} isCentered={false} />
        </div>
      </div>
    </section>
  );
}
