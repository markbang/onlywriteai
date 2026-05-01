# OnlyWrite

OnlyWrite is a local-only personal writing resource system. It gives a user a private inventory of writing assets that can be queried and operated through a CLI, an agent skill, and a CLI-started local web viewer.

## Language

**Resource**:
A user-owned writing asset that can be queried, reused, and operated by agents.
_Avoid_: Platform resource, workspace item

**Note**:
A resource that contains user-authored or saved writing content.
_Avoid_: Entry, Document, article, draft, page

**Note Content**:
The Markdown body stored for a note.
_Avoid_: Entry content, generated output, source text

**Reference**:
A resource that captures external reference material or notes used to support writing.
_Avoid_: Source, attachment, import

**Resource Intent**:
The author-and-use distinction that determines whether a resource is a note or a reference.
_Avoid_: File type, source detection

**Resource Link**:
A structured association between a note and a reference.
_Avoid_: Attachment, citation text, backlink

**Trash**:
The recoverable holding area for deleted resources.
_Avoid_: Archive, permanent deletion

**Resource Purge**:
The irreversible removal of a resource from Trash.
_Avoid_: Delete, archive

**Reference Snapshot**:
The offline-readable content captured for a reference, stored as Markdown when conversion succeeds and plain text when it does not.
_Avoid_: Raw HTML, cache, source body

**Reference Note**:
The user-authored or agent-authored description, summary, or interpretation of a reference.
_Avoid_: Snapshot, fetched content

**Reference Enrichment**:
The optional LLM step that improves an imported reference with a title, summary, and tags.
_Avoid_: Required import, fetch

**Resource Search**:
The first-phase SQLite full-text search across resource titles, tags, URLs, notes, note content, and reference snapshots.
_Avoid_: Semantic search, simple title filter

**Conversation**:
A saved exchange between the user and the AI agent.
_Avoid_: Resource, product surface, chat log

**Local Profile**:
A local identity namespace for a user's resources when multiple local profiles are needed.
_Avoid_: Cloud account, login account

**Settings**:
The user's app preferences.
_Avoid_: Resource, profile

**OnlyWrite CLI**:
The primary operation surface for listing, searching, reading, importing, creating, updating, and deleting resources.
_Avoid_: Admin CLI, developer tool

**OnlyWrite Package**:
The npm-distributed package that installs the `onlywrite` CLI binary.
_Avoid_: Source-only install, hosted app

**Resource Command**:
The canonical CLI command family for operating on resources.
_Avoid_: Note-only CLI, reference-only CLI

**Resource Alias**:
A convenience CLI command family for operating on a specific resource type while preserving the resource model.
_Avoid_: Separate product surface

**Stable JSON Output**:
The versioned `--json` contract for core resource CLI commands used by agents and scripts.
_Avoid_: Debug output, incidental serialization

**Local Resource Viewer**:
The read-only local web surface started by the OnlyWrite CLI for browsing, searching, and inspecting local resources.
_Avoid_: Writing platform, cloud dashboard, login page, resource editor

**Landing Page**:
The public website that explains OnlyWrite and points users to install or run the CLI.
_Avoid_: Resource UI, cloud app

**OnlyWrite Skill**:
The agent-facing instruction package that teaches an agent how to operate resources through the OnlyWrite CLI.
_Avoid_: MCP server, direct database integration

**External Agent**:
An AI assistant outside OnlyWrite that uses the OnlyWrite Skill and CLI to operate local resources.
_Avoid_: Built-in chat, in-app agent

**Local Store**:
The user's local OnlyWrite state and default resource database under `~/.onlywrite`.
_Avoid_: Cloud account, hosted workspace

**Resource Database**:
The SQLite database that stores the user's local resources.
_Avoid_: App cache, remote workspace

## Relationships

- A **Resource** is either a **Note** or a **Reference** in the first product phase.
- Deleting a **Resource** moves it to **Trash** by default.
- **Resource Purge** is irreversible and requires explicit `--yes` confirmation.
- **Resource Search** and ordinary resource lists exclude **Trash** unless explicitly requested.
- **Resource Intent** determines whether a resource is a **Note** or a **Reference**.
- User-authored writing, ideas, drafts, and manually saved text are **Notes**.
- Collected external material with source context is a **Reference**.
- URL imports default to **Reference**; explicit note creation defaults to **Note**.
- A **Note** has **Note Content** stored as Markdown.
- A **Note** can be created from explicit text, a file, or stdin.
- A **Note** is not enriched by an LLM by default.
- A **Note** can link to zero or more **References**.
- A **Reference** can link to zero or more **Notes**.
- A **Reference** can have one **Reference Snapshot** and one **Reference Note**.
- A **Reference Snapshot** stores extracted content, not raw HTML.
- **Reference Enrichment** runs by default during URL imports and can be disabled with `--no-enrich`.
- **Reference Enrichment** failure does not block saving the imported **Reference**.
- **Resource Search** covers **Note Content**, **Reference Note**, **Reference Snapshot**, titles, tags, and URLs.
- A **Conversation** can refer to a **Note**, but is not a **Resource**.
- **Local Profile** and **Settings** belong to a local user, but are not **Resources**.
- The **OnlyWrite CLI** operates on **Resources** by default and exposes machine-readable output through `--json`.
- The **OnlyWrite Package** is the first-phase distribution path for the **OnlyWrite CLI**.
- The **OnlyWrite Package** installs the `onlywrite` binary.
- The **Resource Command** is the canonical CLI surface for list, search, read, create, import, update, and delete operations.
- **Resource Aliases** such as `note` and `reference` can exist as shortcuts over the **Resource Command**.
- **Stable JSON Output** is guaranteed first for `resource list`, `resource search`, `resource read`, and `resource import`.
- The **OnlyWrite CLI** exposes **Resource Search** for local querying without requiring embeddings or an LLM.
- The **Local Resource Viewer** is started by the **OnlyWrite CLI** and reads the local **Resource Database**.
- The **Local Resource Viewer** hides **Trash** by default and can provide a read-only Trash view.
- The **Local Resource Viewer** is read-only in the first product phase; resource writes happen through the **OnlyWrite CLI**.
- The **Local Resource Viewer** can show copyable resource IDs, URLs, and equivalent CLI commands.
- In the Trash view, the **Local Resource Viewer** can show equivalent CLI commands for restore and **Resource Purge**.
- The **Local Resource Viewer** is not the primary writing surface and should not center a full markdown editor.
- The **Landing Page** is public marketing/documentation and does not access local resources.
- The **OnlyWrite Skill** uses the **OnlyWrite CLI** and does not bypass the CLI or API to access storage directly.
- An **External Agent** is the first-phase AI interaction surface for operating resources.
- The **Local Store** contains CLI configuration, the default **Resource Database**, and disposable cache data.
- The **OnlyWrite CLI** can operate directly on the local **Resource Database** without requiring the API server to be running.
- The **Local Resource Viewer** and local API use the same local **Resource Database** by default.

## Example dialogue

> **Dev:** "Should conversations show up in `onlywrite resource list`?"
> **Domain expert:** "No. A **Conversation** is operation history. Only **Notes** and **References** are **Resources** for now."

> **Dev:** "Is `onlywrite` mostly an API wrapper for agents?"
> **Domain expert:** "No. The **OnlyWrite CLI** is the main product entry point for users, with `--json` for agents and scripts."

> **Dev:** "How do users install the CLI first?"
> **Domain expert:** "Install the **OnlyWrite Package** from npm; it provides the `onlywrite` binary."

> **Dev:** "Should the public website access a user's resources?"
> **Domain expert:** "No. The public **Landing Page** only explains the product. Users inspect resources through the CLI-started, read-only **Local Resource Viewer**."

> **Dev:** "Can users import or edit resources in the local web viewer?"
> **Domain expert:** "Not in the first phase. The **Local Resource Viewer** is read-only; writes happen through the **OnlyWrite CLI**."

> **Dev:** "When a URL is imported, do we save the original HTML?"
> **Domain expert:** "No. Save a **Reference Snapshot** as Markdown when possible, with plain text as fallback. Keep raw HTML out of the resource database."

> **Dev:** "Does importing a URL require an LLM?"
> **Domain expert:** "No. **Reference Enrichment** runs by default, but it can be disabled with `--no-enrich` and must not block saving the **Reference** if it fails."

> **Dev:** "Can users create notes directly from the CLI?"
> **Domain expert:** "Yes. A **Note** can be created from text, a Markdown file, or stdin. Its **Note Content** is stored as Markdown and is not enriched by default."

> **Dev:** "Is pasted text always a note?"
> **Domain expert:** "No. **Resource Intent** decides. A user's own pasted draft is a **Note**; pasted external article text is a **Reference**."

> **Dev:** "Should notes and references only relate through tags and search?"
> **Domain expert:** "No. A **Resource Link** should explicitly connect a **Note** to the **References** it uses."

> **Dev:** "Does deleting a resource permanently remove it?"
> **Domain expert:** "No. Delete moves a **Resource** to **Trash**. Only **Resource Purge** permanently removes it, and purge requires explicit confirmation."

> **Dev:** "Should the local web viewer show deleted resources?"
> **Domain expert:** "Not by default. The **Local Resource Viewer** can provide a read-only **Trash** view with CLI restore and purge commands."

> **Dev:** "Does resource search require embeddings?"
> **Domain expert:** "No. First-phase **Resource Search** uses SQLite full-text search. Semantic search can be added later without changing the first product boundary."

> **Dev:** "Should the CLI expose only `resource`, or separate `note` and `reference` commands?"
> **Domain expert:** "Use the **Resource Command** as canonical, and expose `note` and `reference` as **Resource Aliases** for convenience."

> **Dev:** "Can agents depend on every `--json` output forever?"
> **Domain expert:** "Not yet. **Stable JSON Output** is guaranteed first for the core resource commands: list, search, read, and import."

> **Dev:** "Should OnlyWrite include its own chat UI?"
> **Domain expert:** "No. First-phase AI interaction happens through an **External Agent** using the **OnlyWrite Skill** and **OnlyWrite CLI**."

> **Dev:** "Should we expose resources through an MCP server?"
> **Domain expert:** "No. The first external agent interface is the **OnlyWrite Skill**, which calls the **OnlyWrite CLI**."

> **Dev:** "Is OnlyWrite a hosted writing SaaS?"
> **Domain expert:** "No. OnlyWrite is local-only. The **OnlyWrite CLI** keeps its local state in the **Local Store** under `~/.onlywrite`."

> **Dev:** "Does `onlywrite resource list` require a local web server?"
> **Domain expert:** "No. The **OnlyWrite CLI** can read the local **Resource Database** directly. The local API and **Local Resource Viewer** are service layers over the same local database."

## Flagged ambiguities

- "resource" was used broadly; resolved: **Resource** means user-owned writing assets, and initially includes only **Notes** and **References**.
- "document" was the old implementation term for user-authored writing content; resolved: product language should use **Note**.
- "source" was the old implementation term for external writing material; resolved: product language should use **Reference**.
- "note vs reference" could be mistaken for file type or import path; resolved: **Resource Intent** decides based on authorship and use.
- "link" could mean inline citation text; resolved: a **Resource Link** is a structured association between a **Note** and a **Reference**.
- "delete" could mean irreversible removal; resolved: delete moves a **Resource** to **Trash**, while **Resource Purge** is the irreversible operation.
- "reference content" could mean raw HTML, extracted text, or commentary; resolved: fetched readable content is the **Reference Snapshot**, while user/agent commentary is the **Reference Note**.
- "note creation" could imply only AI-generated content; resolved: users can create a **Note** directly from text, a file, or stdin.
- "search" could imply semantic retrieval; resolved: first-phase **Resource Search** is SQLite full-text search, not embedding search.
- "note/reference commands" could imply separate product models; resolved: they are **Resource Aliases** over the canonical **Resource Command**.
- "JSON output" could mean incidental CLI formatting; resolved: **Stable JSON Output** is a versioned contract for core resource commands only at first.
- "AI agent" could imply an in-app chat product; resolved: first-phase AI interaction uses an **External Agent**, not a built-in chat UI.
- "CLI" could mean a developer-only interface; resolved: the **OnlyWrite CLI** is the main user-facing operation surface and also supports machine-readable use.
- "install" could imply source checkout or hosted signup; resolved: first-phase distribution is the npm **OnlyWrite Package**.
- "web app" could imply a hosted product; resolved: the public website is only the **Landing Page**, while resource browsing happens in the CLI-started **Local Resource Viewer**.
- "skill" could mean a server-side tool protocol; resolved: **OnlyWrite Skill** means an agent-facing instruction package that operates through the **OnlyWrite CLI**, not an MCP server.
- "personal" could imply a hosted account product; resolved: OnlyWrite is local-only, with CLI state and the default **Resource Database** rooted in the **Local Store**.
- "CLI data" could mean only config/session; resolved: the **Local Store** includes the default **Resource Database**, so the **OnlyWrite CLI** can operate locally without the API server.
- "login" was part of the earlier web shape; resolved: OnlyWrite does not provide a cloud service or require login for local resource access.
- "viewer" could imply resource management; resolved: the **Local Resource Viewer** is read-only in the first product phase.
- "Trash in the viewer" could imply recovery controls; resolved: the **Local Resource Viewer** may show **Trash** read-only with equivalent CLI commands.
