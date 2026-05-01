---
name: onlywrite-resource-operator
description: Operate a user's local OnlyWrite resources through the `onlywrite` CLI. Use when an agent needs to list, search, read, create, import, update, delete, restore, purge, or link local writing resources. Do not use MCP or direct database access.
---

# OnlyWrite Resource Operator

OnlyWrite is local-only. The user's resources live under `~/.onlywrite` by default, and the supported agent interface is the `onlywrite` CLI with `--json` output.

## Rules

- Use `onlywrite` commands, not MCP and not direct SQLite access.
- Prefer `resource search` before broad reads.
- Use `--json` for machine-readable operations.
- Treat `delete`, `unlink`, and `purge` as destructive. Ask the user before running them unless the user explicitly asked for that exact operation.
- `delete` moves a resource to Trash. `purge --yes` permanently removes it.
- The local web viewer is read-only: `onlywrite web --json`.

## Common Commands

```bash
onlywrite resource list --json
onlywrite resource list --type note --json
onlywrite resource list --trash --json
onlywrite resource search "query" --json
onlywrite resource read <resource-id> --json
```

```bash
onlywrite note create --title "Title" --stdin --json
onlywrite note create --title "Title" --file ./note.md --json
onlywrite reference import https://example.com/article --json
onlywrite reference create --title "Reference" --url https://example.com --snapshot "Text" --json
```

```bash
onlywrite resource update <resource-id> --title "New title" --text "Markdown" --json
onlywrite resource link <note-id> <reference-id> --json
onlywrite resource unlink <note-id> <reference-id> --yes --json
onlywrite resource delete <resource-id> --yes --json
onlywrite resource restore <resource-id> --json
onlywrite resource purge <resource-id> --yes --json
```

## Output Contract

Core commands return JSON with `schemaVersion: 1` and `ok: true` on success. Failed resource lookups return `ok: false` with an `error.message`.
