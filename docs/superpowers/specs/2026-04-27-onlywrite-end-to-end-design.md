# OnlyWrite End-to-End Starter Design

Date: 2026-04-27

## Summary

OnlyWrite will start as a local single-user writing app with a focused editor experience. The initial implementation will establish a thin but complete end-to-end slice across `apps/website` and `apps/api`:

- `apps/website` is converted from the vanilla Vite starter to a React app that uses TanStack Router for routes, TanStack Query for server state, and UnoCSS for styling.
- `apps/api` uses Hono for JSON routes.
- Drizzle persists documents into a local SQLite database.

The first useful workflow is: open the app, create a document, edit title and body, save through the API, persist to SQLite, reload the document, and see API health in the UI.

## Current Project Context

The repository is an initial Vite+ monorepo with:

- `apps/website`: Vite starter app using plain TypeScript and CSS.
- `packages/utils`: starter library package with one test.
- No `apps/api` package yet.
- Vite+ commands and wrappers are required for package management, development, checks, tests, and builds.

The existing Vite starter UI, counter code, and starter CSS will be replaced. The website will move from vanilla TypeScript DOM rendering to React because TanStack Router and TanStack Query are intended here through their React adapters.

## Product Scope

The first version is a local writing and notes application:

- Single-user only.
- No authentication or user table.
- A focused editor is the primary experience.
- The editor is intentionally simple: title input plus body textarea.
- Markdown, rich text, publishing, collaboration, syncing, tags, search, and account management are outside this first slice.

## Architecture

The system is split into two apps:

- `apps/website`: browser UI and client-side data access.
- `apps/api`: HTTP API and persistence.

The website never imports database code directly. It talks to the API over HTTP. The API owns validation, persistence, timestamps, and not-found behavior.

This keeps boundaries clear while leaving room to add authentication, richer editor behavior, or PostgreSQL later.

## Website Design

### Technology

Use:

- React as the UI runtime.
- `@tanstack/react-router` for client routing.
- `@tanstack/react-query` for server state and mutations.
- `unocss` for utility-first styling.

The website should expose small modules for:

- Router setup.
- Query client setup.
- API client functions.
- Document query and mutation hooks.
- Page components.

### Routes

Initial routes:

- `/`: focused editor landing route. If documents exist, it may guide the user to the most recent document. If no documents exist, it shows an empty state with a create action.
- `/documents`: document library route. It lists document summaries sorted by most recently updated.
- `/documents/$documentId`: document editor route. It loads one document and displays title input, body textarea, save state, and delete action.

The root layout includes:

- `OnlyWrite` app identity.
- Link to the document library.
- API health status.

### Query Behavior

Use TanStack Query for:

- `health`
- `documents`
- `document(id)`
- `createDocument`
- `updateDocument`
- `deleteDocument`

Mutations should invalidate or update the relevant document queries so the list and editor stay consistent after create, save, and delete.

### UI Behavior

The first editor experience should prioritize a quiet writing surface:

- Title input above body textarea.
- Save affordance with pending and saved states.
- Empty state when there are no documents.
- Error states for failed loads or saves.
- Loading states for list/detail fetches.

The UI should be responsive, with the editor remaining usable on mobile and desktop.

## API Design

### Technology

Use Hono in `apps/api`.

The API app should export a testable Hono instance separately from the server entrypoint so tests can use `app.request()`.

### Routes

- `GET /health`
  - Returns `{ "ok": true }`.

- `GET /documents`
  - Returns document summaries sorted by `updatedAt` descending.

- `POST /documents`
  - Creates a document.
  - Accepts optional `title` and `content`.
  - Uses `"Untitled"` for a missing or empty title.
  - Uses an empty string for missing content.

- `GET /documents/:id`
  - Returns a document by id.
  - Returns 404 if not found.

- `PATCH /documents/:id`
  - Updates `title` and/or `content`.
  - Updates `updatedAt`.
  - Returns 404 if not found.

- `DELETE /documents/:id`
  - Deletes a document by id.
  - Returns 204 when deleted.
  - Returns 404 if not found.

### Error Shape

Use a small consistent JSON error response for non-204 errors:

```json
{
  "error": {
    "message": "Document not found"
  }
}
```

## Data Design

Use Drizzle with SQLite. The local development database file lives under:

```text
apps/api/data/onlywrite.sqlite
```

The `apps/api/data/` directory should be ignored by git.

### documents Table

- `id`: text primary key, generated with `crypto.randomUUID()`.
- `title`: text, defaulted by application code to `"Untitled"`.
- `content`: text, defaulted by application code to `""`.
- `createdAt`: integer timestamp.
- `updatedAt`: integer timestamp.

Timestamps are stored as numeric epoch milliseconds so API responses can serialize them directly and the UI can format them consistently.

## Development Workflow

The repository should continue to use Vite+ wrappers:

- Install dependencies with `vp install`.
- Add dependencies with `vp add`.
- Run checks with `vp check`.
- Run tests with `vp test` or recursive Vite+ task commands.
- Run builds with `vp run -r build`.

Development scripts should make it clear how to run both apps. The preferred outcome is for `vp run dev` to start both the website and API. If the Vite+ task setup is clearer with separate commands, the repo should still expose explicit `website#dev` and `api#dev` tasks.

The website should access the API through either a Vite dev proxy or a small environment-based base URL. The first slice only needs independent production builds for each app; unified deployment is out of scope.

## Testing Strategy

### API Tests

Add tests around the exported Hono app:

- `GET /health` returns ok.
- Document create, list, detail, update, and delete work end to end.
- Missing documents return 404.

Tests should use an isolated SQLite database, either in memory or in a temporary file, so local development data is not modified.

### Website Tests

Keep website tests focused on low-cost boundaries for the first slice:

- API client success and error handling.
- Query/module behavior where practical without a browser.
- Build and TypeScript checks for route/component integration.

Do not add browser E2E testing in the first slice.

### Acceptance Checks

Before considering implementation complete:

- `vp check`
- `vp test`
- `vp run -r build`
- Manual local dev check: create, save, reload, and delete a document through the website.

## Out of Scope

- Authentication and sessions.
- Multiple users.
- Rich text editing.
- Markdown preview.
- Tags, search, folders, and publishing.
- Cloud sync or remote database setup.
- Production deployment integration.
- Browser E2E automation.

## Open Decisions Resolved

- Approach: full but thin end-to-end slice.
- Database: local SQLite.
- Product direction: writing and notes app.
- Layout direction: focused editor.
- Editor format: title plus textarea.
- User model: no users or login in the first version.
