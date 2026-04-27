import type { Document } from "../api/documents.ts";

export function DocumentEditor({ document }: { document: Document }) {
  return (
    <article className="mx-auto max-w-3xl">
      <input
        className="mb-4 w-full border-0 bg-transparent text-3xl font-semibold text-neutral-950 outline-none"
        value={document.title}
        readOnly
        aria-label="Title"
      />
      <textarea
        className="min-h-[60vh] w-full resize-y border-0 bg-transparent text-base leading-7 text-neutral-800 outline-none"
        value={document.content}
        readOnly
        aria-label="Content"
      />
    </article>
  );
}
