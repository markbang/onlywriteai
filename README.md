# OnlyWrite

OnlyWrite is a local-first writing app with AI-assisted drafting, source management, Logto auth,
and a Hono API.

## Apps

- `apps/website`: React, TanStack Router, TanStack Query, UnoCSS.
- `apps/api`: Hono, Drizzle ORM, SQLite, Logto, OpenAI-compatible LLM integration.

## Development

Install dependencies:

```bash
vp install
```

Create local API config:

```bash
cp apps/api/.env.example apps/api/.env.local
```

For local development, set at least the LLM variables if you want AI features. Logto is optional in
development; when it is not configured the API uses a local user.

Run website and API:

```bash
vp run dev
```

Validate the repo:

```bash
vp check
vp run -r test
vp run -r build
```

The default local database is `apps/api/data/onlywrite.sqlite`.

## Production On A VPS

The production target is a single Docker service behind an HTTPS reverse proxy. The API serves both
`/api/*` requests and the built website.

1. Create production env:

```bash
cp .env.example .env
```

2. Fill all placeholder values in `.env`. In production, these are required:

- `APP_BASE_URL`
- `DATABASE_URL`
- `AUTH_SESSION_SECRET`
- `AUTH_SESSION_MAX_AGE_SECONDS` controls the OnlyWrite session cookie lifetime. The default is
  `2592000` seconds, or 30 days.
- `LOGTO_APP_ID`
- `LOGTO_APP_SECRET`
- `LOGTO_ISSUER`
- `LOGTO_JWKS_URI`
- `LLM_API_KEY`
- `LLM_MODEL`

3. Build and start:

```bash
docker compose up -d --build
```

4. Configure your reverse proxy to forward HTTPS traffic to `http://127.0.0.1:8787` and preserve
   `X-Forwarded-Proto`.

Health endpoints:

- `/health`: process is alive.
- `/ready`: database and required production configuration are ready.

## Backups

Create a SQLite backup from the host:

```bash
DATABASE_URL=apps/api/data/onlywrite.sqlite BACKUP_DIR=backups ./scripts/backup-sqlite.sh
```

For Docker Compose, the database is stored in the `onlywrite-data` volume. Either run the backup from
a host path where the database is mounted, or copy the database out of the volume before running the
script. Keep `backups/` outside the container lifecycle.

## Configuration Notes

- Never commit `.env`, `.env.local`, SQLite files, or backups.
- `LLM_STREAM_API=responses` is the default. Use `LLM_STREAM_API=chat` for providers whose thinking
  stream is only exposed through chat completions.
- `LLM_TIMEOUT_MS` controls LLM request timeout. `SOURCE_FETCH_TIMEOUT_MS` controls AI source import
  URL fetch timeout.
- Source import refuses localhost and private-network URLs to reduce SSRF risk.
