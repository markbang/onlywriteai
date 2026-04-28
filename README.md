# OnlyWrite

OnlyWrite is a local-first writing app starter built with Vite+.

## Apps

- `apps/website`: React, TanStack Router, TanStack Query, UnoCSS.
- `apps/api`: Hono, Drizzle, SQLite.

## Development

Install dependencies:

```bash
vp install
```

Run website and API:

```bash
vp run dev
```

Run checks:

```bash
vp check
vp run -r test
vp run -r build
```

The API stores local development data in `apps/api/data/onlywrite.sqlite`.
