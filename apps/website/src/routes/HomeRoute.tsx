import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createDocument, listDocuments } from "../api/documents.ts";

export function HomeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
  });
  const createMutation = useMutation({
    mutationFn: () => createDocument({}),
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await navigate({ to: "/documents/$documentId", params: { documentId: document.id } });
    },
  });

  const latest = documents.data?.[0];

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center">
      <p className="mb-3 text-sm text-muted">Focused local writing</p>
      <h1 className="mb-4 text-4xl font-semibold leading-tight text-foreground">
        Write without setup.
      </h1>
      <p className="mb-8 max-w-2xl text-base leading-7 text-muted">
        OnlyWrite keeps the first slice intentionally small: local drafts, a quiet editor, and fast
        saves through your local API.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded bg-accent text-accent-foreground disabled:opacity-60"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
          aria-label="New document"
          title="New document"
        >
          <span
            className={
              createMutation.isPending
                ? "i-lucide-loader-circle h-5 w-5 animate-spin"
                : "i-lucide-file-plus h-5 w-5"
            }
            aria-hidden="true"
          />
        </button>
        {latest ? (
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded border border-border text-foreground hover:bg-surface-secondary"
            onClick={() =>
              navigate({ to: "/documents/$documentId", params: { documentId: latest.id } })
            }
            aria-label="Continue latest"
            title="Continue latest"
          >
            <span className="i-lucide-arrow-right h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {createMutation.isError ? (
        <p className="mt-4 text-sm text-danger">Could not create a document.</p>
      ) : null}
    </section>
  );
}
