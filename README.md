# OnlyWrite

OnlyWrite is a local-first personal writing resource system. Its primary product surface is the
`onlywrite` CLI: create Notes, import References, search your local archive, and open a read-only
local Resource Viewer.

OnlyWrite does not require a hosted account or cloud service. By default it stores data in
`~/.onlywrite/onlywrite.sqlite`.

## Install And Use

For users, the npm package installs one binary: `onlywrite`.

```bash
npm install -g onlywrite
onlywrite doctor
```

Or run it without a global install:

```bash
npx onlywrite --help
```

## Quick Start

```bash
printf 'Draft opening paragraph' | onlywrite note create --title "Opening" --stdin
onlywrite reference import https://example.com/article
onlywrite resource search "opening"
onlywrite resource read <resource-id>
onlywrite web
onlywrite doctor
```

Add `--json` to commands for stable machine-readable output used by scripts and external agents:

```bash
onlywrite resource list --json
onlywrite resource read <resource-id> --json
```

## Resource Model

- `Note`: user-authored or saved Markdown content.
- `Reference`: external material with a local text snapshot, URL, and optional note.
- `Resource Link`: a structured link from a Note to a Reference.
- `Trash`: deleted resources stay recoverable until purged.

## Repo Layout

- `tools/cli`: the installable OnlyWrite CLI package.
- `apps/website`: public landing page.
- `.agents/skills/onlywrite-resource-operator`: agent instructions for operating resources through
  the CLI.
- `CONTEXT.md`: product glossary and domain decisions.
- `docs/adr`: architecture decisions.

Legacy website/API code still exists in the repository while the product shape is being simplified,
but the current direction is local-only CLI first.

## Development

Install dependencies:

```bash
vp install
```

Validate the repo:

```bash
vp check
vp run -r test
vp run -r build
```

Run the public landing page locally:

```bash
vp run -F website dev
```

Run the CLI from source:

```bash
vp run -F onlywrite build
ONLYWRITE_HOME=/tmp/onlywrite-demo node tools/cli/dist/cli.mjs resource list
ONLYWRITE_HOME=/tmp/onlywrite-demo node tools/cli/dist/cli.mjs doctor
```

## Safety

- `reference import` only accepts `http` and `https` URLs and rejects localhost/private-network hosts
  before fetching.
- `delete`, `unlink`, and `purge` require `--yes`.
- `purge` is irreversible.
- The local web viewer opened by `onlywrite web` is read-only.
