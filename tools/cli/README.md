# OnlyWrite CLI

OnlyWrite is a local-first personal writing resource system. It stores Notes and References in a
SQLite database under `~/.onlywrite` and exposes the same commands to humans, scripts, and external
AI agents.

## Install

```bash
npm install -g onlywrite
onlywrite doctor
```

Or run it without a global install:

```bash
npx onlywrite --help
```

The package installs one binary: `onlywrite`.

## Quick Start

Create a Note from stdin:

```bash
printf 'Draft opening paragraph' | onlywrite note create --title "Opening" --stdin
```

Import a Reference from a URL:

```bash
onlywrite reference import https://example.com/article
```

Search and read resources:

```bash
onlywrite resource search "opening"
onlywrite resource list --type reference
onlywrite resource read <resource-id>
```

Start the read-only local web viewer:

```bash
onlywrite web
```

Check the local installation:

```bash
onlywrite doctor
```

## JSON Mode

Add `--json` to commands when another program or agent needs stable machine-readable output.

```bash
onlywrite resource list --json
onlywrite resource read <resource-id> --json
```

JSON responses include `schemaVersion: 1`.

## Resource Model

- `Note`: user-authored or saved Markdown content.
- `Reference`: external material with a local text snapshot, URL, and optional note.
- `Resource Link`: a structured link from a Note to a Reference.
- `Trash`: deleted resources go here until restored or purged.

## Common Commands

```bash
onlywrite note create --title "Idea" --text "Body"
onlywrite note create --title "From file" --file ./note.md
onlywrite reference create --title "Paper" --url https://example.com --snapshot "Text"
onlywrite reference import https://example.com/article
```

```bash
onlywrite resource list
onlywrite resource list --trash
onlywrite resource search "query" --type note
onlywrite resource read <id>
onlywrite resource update <id> --title "New title" --text "New body"
```

```bash
onlywrite resource link <note-id> <reference-id>
onlywrite resource unlink <note-id> <reference-id> --yes
onlywrite resource delete <id> --yes
onlywrite resource restore <id>
onlywrite resource purge <id> --yes
onlywrite doctor
```

## Local Store

OnlyWrite uses `~/.onlywrite/onlywrite.sqlite` by default. Set `ONLYWRITE_HOME` to use another local
store:

```bash
ONLYWRITE_HOME=/tmp/onlywrite-demo onlywrite resource list
```

## Safety

`reference import` only accepts `http` and `https` URLs and rejects localhost/private-network hosts
before fetching. `delete`, `unlink`, and `purge` require `--yes`.
