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
      <p className="mb-3 text-sm text-neutral-500">Focused local writing</p>
      <h1 className="mb-4 text-4xl font-semibold leading-tight text-neutral-950">
        Write without setup.
      </h1>
      <p className="mb-8 max-w-2xl text-base leading-7 text-neutral-600">
        OnlyWrite keeps the first slice intentionally small: local drafts, a quiet editor, and fast
        saves through your local API.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? "Creating..." : "New document"}
        </button>
        {latest ? (
          <button
            type="button"
            className="rounded border border-stone-300 px-4 py-2 text-sm font-medium text-neutral-800"
            onClick={() =>
              navigate({ to: "/documents/$documentId", params: { documentId: latest.id } })
            }
          >
            Continue latest
          </button>
        ) : null}
      </div>
      {createMutation.isError ? (
        <p className="mt-4 text-sm text-red-700">Could not create a document.</p>
      ) : null}
    </section>
  );
}
