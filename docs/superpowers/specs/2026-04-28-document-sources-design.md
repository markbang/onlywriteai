# Document Sources Context Design

Date: 2026-04-28

## Summary

OnlyWrite will add document-level information sources as read-only writing context. Each document can have its own source list shown beside the editor. Sources help the writer keep reference material visible without changing the document body automatically.

The first version is intentionally metadata-first:

- Text sources store a title and note.
- RSS sources store a URL, title, and note, but do not fetch feed entries.
- PDF and image sources store a file name, title, and note, but do not upload files, parse text, or run OCR.

This keeps the feature useful while avoiding file storage, parser dependencies, and background ingestion flows.

## Current Context

The repository currently has:

- `apps/website`: React, TanStack Router, TanStack Query, UnoCSS, focused document editor.
- `apps/api`: Hono routes with Drizzle + SQLite document persistence.
- `documents` table and document CRUD API.
- Root `vp run dev` currently starts all workspace dev tasks, including `packages/utils` watch output.
- `apps/website` currently relies on UnoCSS default config, which prints a non-fatal missing config warning.

## Product Scope

Sources are scoped to a single document. There is no global source library in this slice.

In scope:

- Add, edit, list, and delete sources for the active document.
- Show sources in a persistent split pane on desktop.
- Show sources above the editor on mobile.
- Store source metadata and user-written notes in SQLite.
- Keep sources read-only relative to the document body.
- Clean up source rows when their parent document is deleted.
- Reduce dev noise by limiting root `dev` to website + API and adding a minimal UnoCSS config.

Out of scope:

- Global source library.
- Reusing a source across multiple documents.
- RSS fetching or feed parsing.
- PDF text extraction.
- Image OCR.
- File upload or binary file storage.
- Inserting source text into the editor.
- AI prompt/context generation.

## Data Design

Add a `document_sources` table.

Fields:

- `id`: text primary key, generated with `crypto.randomUUID()`.
- `documentId`: text, parent document id.
- `type`: text enum value: `text`, `rss`, `pdf`, or `image`.
- `title`: text, required after application normalization.
- `note`: text, user-written source context.
- `url`: nullable text, used by RSS or web-like sources.
- `fileName`: nullable text, used by PDF/image metadata.
- `createdAt`: integer epoch milliseconds.
- `updatedAt`: integer epoch milliseconds.

Application defaults:

- Missing or blank `title` becomes `"Untitled source"`.
- Missing `note` becomes `""`.
- `url` and `fileName` are stored as `null` when absent or blank.

Deletion:

- Deleting a document must delete its source rows in the same repository operation.
- Deleting an individual source only affects that source.

Ordering:

- Source lists sort by `updatedAt desc`, with a deterministic tie-breaker for same-millisecond updates.

## API Design

Add source routes under documents:

- `GET /documents/:documentId/sources`
  - Returns sources for the document.
  - Returns 404 if the document does not exist.

- `POST /documents/:documentId/sources`
  - Creates a source for the document.
  - Accepts `type`, `title`, `note`, `url`, and `fileName`.
  - Requires `type` to be one of `text`, `rss`, `pdf`, `image`.
  - Returns 404 if the document does not exist.
  - Returns 400 for invalid JSON or invalid type.

- `PATCH /documents/:documentId/sources/:sourceId`
  - Updates source fields.
  - Returns 404 if the document or source does not exist, or if the source does not belong to the document.
  - Returns 400 for invalid JSON or invalid type.

- `DELETE /documents/:documentId/sources/:sourceId`
  - Deletes the source.
  - Returns 204 when deleted.
  - Returns 404 if the document or source does not exist, or if the source does not belong to the document.

Error shape stays consistent with the existing API:

```json
{
  "error": {
    "message": "Source not found"
  }
}
```

## Website Design

The document editor route becomes a document workspace with two regions.

### Desktop Layout

Use a persistent split pane:

- Left column: `SourcePanel`.
- Right column: existing `DocumentEditor`.

The source panel should be wide enough for scanning source titles and notes without competing with the writing surface.

### Mobile Layout

Stack the source panel above the editor. The editor remains full width.

### SourcePanel Behavior

`SourcePanel` responsibilities:

- Load sources for the active document.
- Show loading, error, and empty states.
- Show source cards with type, title, note preview, and update time.
- Provide a compact form for create/edit:
  - type select
  - title input
  - note textarea
  - URL input for RSS
  - file name input for PDF/image
- Provide delete action for each source.

The panel does not:

- Modify the document body.
- Fetch RSS feeds.
- Upload files.
- Parse PDFs/images.

### Query Keys

Use TanStack Query keys:

- `["documentSources", documentId]`

Mutations invalidate or update this key after create, update, and delete.

Document delete continues to remove the document query and invalidate document list queries. Source cleanup is handled by the API.

## Dev Workflow Adjustments

Update root `dev` so it starts only:

- `website#dev`
- `api#dev`

It should not start `packages/utils#dev`, because the writing app workflow does not need library watch output.

Add a minimal `apps/website/uno.config.ts` to make UnoCSS config explicit and remove the missing-config warning.

Do not change the React plugin warning in this slice. It is a non-fatal toolchain recommendation and should be handled separately if needed.

## Testing Strategy

API:

- Repository tests for source create, list, update, delete.
- Repository test confirming document delete removes child sources.
- Route tests for all source API endpoints.
- Error tests for missing document, missing source, invalid type, and invalid JSON.

Website:

- API client tests for source endpoints.
- `SourcePanel` tests:
  - empty state
  - list rendering
  - create source
  - update source
  - delete source
  - type-specific URL/file name fields
- Route/workspace test confirming editor and source panel render together.

Final verification:

```bash
vp check
vp run -r test
vp run -r build
```

Manual dev verification:

- `vp run dev` starts only website and API.
- Website has no UnoCSS missing-config warning.
- Create a document.
- Add text, RSS, PDF, and image metadata sources.
- Edit and delete a source.
- Save document body independently.
- Delete the document and verify its sources are gone.

## Open Decisions Resolved

- Scope: document-level sources, not global library.
- Layout: persistent split pane on desktop.
- Input handling: metadata and user notes only.
- Source usage: read-only reference, no body insertion.
- File handling: store metadata only, no upload.
