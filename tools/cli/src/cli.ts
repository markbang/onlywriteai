#!/usr/bin/env node

import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type CliIO = {
  argv: string[];
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  stdin?: () => Promise<string> | string;
  onServer?: (server: Server) => void;
  stderr?: (chunk: string) => void;
  stdout?: (chunk: string) => void;
};

type NoteResource = {
  createdAt: number;
  id: string;
  links?: { referenceIds: string[] };
  note: { content: string };
  tags: string[];
  title: string;
  type: "note";
  updatedAt: number;
};

type ReferenceResource = {
  createdAt: number;
  id: string;
  reference: { note: string; snapshot: string; url: string | null };
  tags: string[];
  title: string;
  type: "reference";
  updatedAt: number;
};

type Resource = NoteResource | ReferenceResource;

type ResourceRow = {
  content: string;
  created_at: number;
  id: string;
  note: string | null;
  tags: string;
  title: string;
  type: string;
  updated_at: number;
  url: string | null;
};

type ResourceUpdate = {
  content?: string;
  note?: string;
  tags?: string[];
  title?: string;
  url?: string | null;
};

const localUserId = "local-user";
const version = "0.1.0";

function home(env: Record<string, string | undefined>) {
  return env.ONLYWRITE_HOME || join(env.HOME || process.cwd(), ".onlywrite");
}

function databasePath(env: Record<string, string | undefined>) {
  return join(home(env), "onlywrite.sqlite");
}

function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    create table if not exists resources (
      id text primary key,
      user_id text not null,
      type text not null check (type in ('note', 'reference')),
      title text not null,
      content text not null,
      url text,
      note text,
      tags text not null default '[]',
      deleted_at integer,
      created_at integer not null,
      updated_at integer not null
    );

    create virtual table if not exists resource_search using fts5(
      resource_id unindexed,
      title,
      content,
      tags
    );

    create table if not exists resource_links (
      note_id text not null references resources(id) on delete cascade,
      reference_id text not null references resources(id) on delete cascade,
      created_at integer not null,
      primary key (note_id, reference_id)
    );
  `);
  return db;
}

function normalizeArgv(argv: string[]) {
  if (argv[0] === "note") {
    return ["resource", argv[1] ?? "", "--type", "note", ...argv.slice(2)];
  }

  if (argv[0] === "reference" && argv[1] === "create") {
    return ["resource", "create", "--type", "reference", ...argv.slice(2)];
  }

  if (argv[0] === "reference" && argv[1] === "import") {
    return ["resource", "import", ...argv.slice(2)];
  }

  return argv;
}

function readFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function readRepeatedFlag(args: string[], name: string) {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function readReferenceIds(db: Database.Database, noteId: string) {
  const rows = db
    .prepare("select reference_id from resource_links where note_id = ? order by created_at asc")
    .all(noteId) as Array<{ reference_id: string }>;
  return rows.map((row) => row.reference_id);
}

function toResource(row: ResourceRow, db?: Database.Database): Resource {
  if (row.type === "reference") {
    return {
      createdAt: row.created_at,
      id: row.id,
      reference: { note: row.note ?? "", snapshot: row.content, url: row.url },
      tags: parseTags(row.tags),
      title: row.title,
      type: "reference",
      updatedAt: row.updated_at,
    };
  }

  return {
    createdAt: row.created_at,
    id: row.id,
    ...(db ? { links: { referenceIds: readReferenceIds(db, row.id) } } : {}),
    note: { content: row.content },
    tags: parseTags(row.tags),
    title: row.title,
    type: "note",
    updatedAt: row.updated_at,
  };
}

function writeJson(stdout: (chunk: string) => void, value: unknown) {
  stdout(`${JSON.stringify(value)}\n`);
}

function writeJsonError(stdout: (chunk: string) => void, message: string) {
  writeJson(stdout, { error: { message }, ok: false, schemaVersion: 1 });
}

function writeText(stdout: (chunk: string) => void, value: string) {
  stdout(`${value.replace(/\n?$/, "\n")}`);
}

function helpText() {
  return `OnlyWrite

Local-first personal writing resources.

Usage:
  onlywrite resource list [--type note|reference] [--trash] [--json]
  onlywrite resource search <query> [--type note|reference] [--json]
  onlywrite resource read <id> [--json]
  onlywrite note create --title <title> (--text <text> | --file <path> | --stdin) [--json]
  onlywrite reference import <url> [--json]
  onlywrite reference create --title <title> --snapshot <text> [--url <url>] [--json]
  onlywrite resource update <id> [--title <title>] [--text <text>|--snapshot <text>|--file <path>|--stdin] [--json]
  onlywrite resource delete <id> --yes [--json]
  onlywrite resource restore <id> [--json]
  onlywrite resource purge <id> --yes [--json]
  onlywrite resource link <note-id> <reference-id> [--json]
  onlywrite resource unlink <note-id> <reference-id> --yes [--json]
  onlywrite web [--port <port>] [--json]
  onlywrite doctor [--json]

Data:
  Stores resources in ~/.onlywrite/onlywrite.sqlite by default.
  Set ONLYWRITE_HOME to use another local store.
`;
}

function runDoctor(db: Database.Database, env: Record<string, string | undefined>) {
  const path = databasePath(env);
  db.prepare("select count(*) as count from resources").get();
  return {
    database: { ok: true, path },
    home: home(env),
    node: process.version,
    version,
  };
}

function writeDoctor(
  stdout: (chunk: string) => void,
  json: boolean,
  doctor: ReturnType<typeof runDoctor>,
) {
  if (json) {
    writeJson(stdout, { doctor, ok: true, schemaVersion: 1 });
    return;
  }

  writeText(
    stdout,
    [
      "OnlyWrite doctor",
      `Version: ${doctor.version}`,
      `Node: ${doctor.node}`,
      `Local store: ${doctor.home}`,
      `Database: ${doctor.database.path}`,
      "SQLite store: ok",
    ].join("\n"),
  );
}

function resourceBody(resource: Resource) {
  return resource.type === "reference" ? resource.reference.snapshot : resource.note.content;
}

function resourceKindLabel(resource: Resource) {
  return resource.type === "reference" ? "reference" : "note";
}

function formatResourceList(resources: Resource[]) {
  if (resources.length === 0) {
    return "No resources found.";
  }

  return resources
    .map((resource) => `${resource.id}  ${resourceKindLabel(resource)}  ${resource.title}`)
    .join("\n");
}

function formatResourceRead(resource: Resource) {
  const metadata = [`id: ${resource.id}`, `type: ${resourceKindLabel(resource)}`];
  if (resource.type === "reference" && resource.reference.url) {
    metadata.push(`url: ${resource.reference.url}`);
  }
  if (resource.tags.length > 0) {
    metadata.push(`tags: ${resource.tags.join(", ")}`);
  }

  return [`# ${resource.title}`, "", metadata.join("\n"), "", resourceBody(resource)].join("\n");
}

function writeResource(
  stdout: (chunk: string) => void,
  json: boolean,
  resource: Resource,
  text?: string,
) {
  if (json) {
    writeJson(stdout, { ok: true, resource, schemaVersion: 1 });
    return;
  }

  writeText(stdout, text ?? formatResourceRead(resource));
}

function writeResourceCollection(
  stdout: (chunk: string) => void,
  json: boolean,
  resources: Resource[],
) {
  if (json) {
    writeJson(stdout, { ok: true, resources, schemaVersion: 1 });
    return;
  }

  writeText(stdout, formatResourceList(resources));
}

function writeLink(
  stdout: (chunk: string) => void,
  json: boolean,
  link: { noteId: string; referenceId: string },
) {
  if (json) {
    writeJson(stdout, { link, ok: true, schemaVersion: 1 });
    return;
  }

  writeText(stdout, `Linked ${link.noteId} -> ${link.referenceId}`);
}

async function readResourceText(
  args: string[],
  textFlag: string,
  stdin?: () => Promise<string> | string,
) {
  const direct = readFlag(args, textFlag);
  if (direct !== undefined) {
    return direct;
  }

  const file = readFlag(args, "--file");
  if (file !== undefined) {
    return readFileSync(file, "utf8");
  }

  if (hasFlag(args, "--stdin")) {
    const reader = stdin ?? (() => readFileSync(0, "utf8"));
    return await reader();
  }

  return undefined;
}

function searchableText(row: ResourceRow) {
  return [row.content, row.note ?? "", row.url ?? ""].filter(Boolean).join("\n");
}

function upsertSearchIndex(db: Database.Database, row: ResourceRow) {
  db.prepare("delete from resource_search where resource_id = ?").run(row.id);
  db.prepare(
    "insert into resource_search (resource_id, title, content, tags) values (?, ?, ?, ?)",
  ).run(row.id, row.title, searchableText(row), row.tags);
}

function readResourceById(
  db: Database.Database,
  id: string,
  options: { includeDeleted?: boolean; onlyDeleted?: boolean } = {},
) {
  const deletedClause = options.onlyDeleted
    ? "and deleted_at is not null"
    : options.includeDeleted
      ? ""
      : "and deleted_at is null";
  return db
    .prepare(`select * from resources where id = ? and user_id = ? ${deletedClause}`)
    .get(id, localUserId) as ResourceRow | undefined;
}

function parseTagsFromArgs(args: string[]) {
  const tagsJson = readFlag(args, "--tags");
  if (tagsJson !== undefined) {
    return parseTags(tagsJson);
  }

  return readRepeatedFlag(args, "--tag")
    .flatMap((tag) => tag.split(","))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function updateResource(db: Database.Database, id: string, update: ResourceUpdate) {
  const existing = readResourceById(db, id);
  if (!existing) {
    return null;
  }

  const title = update.title ?? existing.title;
  const content = update.content ?? existing.content;
  const url = update.url !== undefined ? update.url : existing.url;
  const note = update.note !== undefined ? update.note : existing.note;
  const tags = update.tags ? JSON.stringify(update.tags) : existing.tags;
  const now = Date.now();
  db.prepare(
    `update resources
     set title = ?, content = ?, url = ?, note = ?, tags = ?, updated_at = ?
     where id = ? and user_id = ? and deleted_at is null`,
  ).run(title, content, url, note, tags, now, id, localUserId);
  const row = readResourceById(db, id);
  if (!row) {
    return null;
  }
  upsertSearchIndex(db, row);
  return row;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderViewer(
  resources: Resource[],
  options: { q?: string; trash?: boolean; type?: string },
) {
  const items = resources
    .map((resource) => {
      const body =
        resource.type === "reference" ? resource.reference.snapshot : resource.note.content;
      const commands = options.trash
        ? [
            `onlywrite resource restore ${resource.id} --json`,
            `onlywrite resource purge ${resource.id} --yes --json`,
          ]
        : [`onlywrite resource read ${resource.id} --json`];
      return `<article class="resource-card"><div><h2>${escapeHtml(resource.title)}</h2><p><code>${resource.id}</code> · ${escapeHtml(resource.type)}</p></div><pre>${escapeHtml(body)}</pre><div class="commands">${commands.map((command) => `<code>${escapeHtml(command)}</code>`).join("")}</div></article>`;
    })
    .join("\n");
  const empty = options.trash ? "Trash is empty." : "No matching resources.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OnlyWrite Resources</title><style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
  body { margin: 0; }
  main { width: min(72rem, calc(100vw - 2rem)); margin: 0 auto; padding: 2rem 0 4rem; }
  header { display: flex; justify-content: space-between; gap: 1rem; align-items: end; margin-bottom: 1.5rem; }
  h1 { margin: 0; font-size: clamp(2rem, 5vw, 4rem); letter-spacing: 0; }
  form { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0 0; }
  input, select, button, a.button { height: 2.4rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; background: white; color: inherit; padding: 0 0.75rem; font: inherit; }
  a.button { display: inline-flex; align-items: center; text-decoration: none; }
  button { background: #2563eb; border-color: #2563eb; color: white; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr)); gap: 1rem; }
  .resource-card { border: 1px solid #d8dee8; border-radius: 0.55rem; background: white; padding: 1rem; box-shadow: 0 1px 2px rgb(15 23 42 / 0.05); }
  h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
  p { color: #64748b; margin: 0; font-size: 0.85rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 16rem; overflow: auto; background: #f1f5f9; border-radius: 0.45rem; padding: 0.75rem; font-size: 0.85rem; line-height: 1.5; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .commands { display: grid; gap: 0.4rem; }
  .commands code { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 0.35rem; padding: 0.45rem; color: #334155; }
  @media (prefers-color-scheme: dark) { :root { background: #0b1120; color: #e5e7eb; } input, select, a.button { background: #111827; border-color: rgb(255 255 255 / 0.1); } .resource-card { background: #111827; border-color: rgb(255 255 255 / 0.08); } pre { background: rgb(255 255 255 / 0.04); } p { color: #94a3b8; } .commands code { border-color: rgb(255 255 255 / 0.08); color: #cbd5e1; } }
</style></head><body><main><header><div><p>OnlyWrite local viewer</p><h1>${options.trash ? "Trash" : "Resources"}</h1></div><a class="button" href="${options.trash ? "/" : "/trash"}">${options.trash ? "Resources" : "Trash"}</a></header><form action="/" method="get"><input name="q" placeholder="Search resources" aria-label="Search resources" value="${escapeHtml(options.q ?? "")}"><select name="type" aria-label="Resource type"><option value="">All types</option><option value="note"${options.type === "note" ? " selected" : ""}>Notes</option><option value="reference"${options.type === "reference" ? " selected" : ""}>References</option></select><button type="submit">Search</button></form><section class="grid">${items || `<p>${empty}</p>`}</section></main></body></html>`;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToReference(html: string, url: string) {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || url);
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => decodeHtml(line.replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .join("\n\n");
  return { snapshot: body || title, title };
}

function error(stderr: (chunk: string) => void, message: string) {
  stderr(`${message}\n`);
  return 1;
}

function importUrlError(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Import URL must be valid";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https URLs can be imported";
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return "Local and private network URLs cannot be imported";
  }

  return null;
}

export async function runCli({
  argv,
  env = process.env,
  fetcher = fetch,
  stdin,
  onServer,
  stderr = process.stderr.write.bind(process.stderr),
  stdout = process.stdout.write.bind(process.stdout),
}: CliIO) {
  argv = normalizeArgv(argv);
  const json = hasFlag(argv, "--json");
  if (hasFlag(argv, "--version") || hasFlag(argv, "-v")) {
    writeText(stdout, version);
    return 0;
  }
  if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    writeText(stdout, helpText());
    return 0;
  }

  const db = openDatabase(databasePath(env));
  try {
    if (argv[0] === "web") {
      const port = Number(readFlag(argv, "--port") ?? 37113);
      const path = databasePath(env);
      const server = createServer((request, response) => {
        const requestDb = openDatabase(path);
        try {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          const trash = url.pathname === "/trash";
          const type = url.searchParams.get("type");
          const q = url.searchParams.get("q")?.trim() ?? "";
          const validType = type === "note" || type === "reference" ? type : undefined;
          const rows = q
            ? (requestDb
                .prepare(
                  `select resources.*
                   from resource_search
                   join resources on resources.id = resource_search.resource_id
                   where resource_search match ?
                     and resources.user_id = ?
                     and resources.deleted_at is ${trash ? "not null" : "null"}
                     ${validType ? "and resources.type = ?" : ""}
                   order by bm25(resource_search), resources.updated_at desc`,
                )
                .all(
                  ...(validType ? [q, localUserId, validType] : [q, localUserId]),
                ) as ResourceRow[])
            : (requestDb
                .prepare(
                  `select * from resources
                   where user_id = ?
                     and deleted_at is ${trash ? "not null" : "null"}
                     ${validType ? "and type = ?" : ""}
                   order by updated_at desc, rowid desc`,
                )
                .all(...(validType ? [localUserId, validType] : [localUserId])) as ResourceRow[]);
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(
            renderViewer(
              rows.map((row) => toResource(row, requestDb)),
              {
                q,
                trash,
                type: validType,
              },
            ),
          );
        } finally {
          requestDb.close();
        }
      });
      await new Promise<void>((resolve) => {
        server.listen(port, "127.0.0.1", resolve);
      });
      onServer?.(server);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://127.0.0.1:${actualPort}/`;
      if (json) {
        writeJson(stdout, { ok: true, schemaVersion: 1, url });
      } else {
        writeText(stdout, `OnlyWrite local viewer: ${url}`);
      }
      return 0;
    }

    if (argv[0] !== "resource") {
      if (argv[0] === "doctor") {
        writeDoctor(stdout, json, runDoctor(db, env));
        return 0;
      }

      return error(stderr, "Unknown command");
    }

    const command = argv[1];
    if (command === "create") {
      const type = readFlag(argv, "--type");
      if (type !== "note" && type !== "reference") {
        return error(stderr, "Resource type must be note or reference");
      }
      const title = readFlag(argv, "--title")?.trim() || "Untitled";
      const content = await readResourceText(
        argv,
        type === "reference" ? "--snapshot" : "--text",
        stdin,
      );
      if (content === undefined) {
        return error(
          stderr,
          type === "reference"
            ? "--snapshot, --file, or --stdin is required"
            : "--text, --file, or --stdin is required",
        );
      }
      const referenceNote = type === "reference" ? (readFlag(argv, "--note") ?? "") : null;
      const url = type === "reference" ? (readFlag(argv, "--url") ?? null) : null;
      const tags = parseTagsFromArgs(argv);
      const now = Date.now();
      const id = crypto.randomUUID();
      db.prepare(
        `insert into resources (id, user_id, type, title, content, url, note, tags, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        localUserId,
        type,
        title,
        content,
        url,
        referenceNote,
        JSON.stringify(tags),
        now,
        now,
      );
      const row = db
        .prepare("select * from resources where id = ? and user_id = ?")
        .get(id, localUserId) as ResourceRow;
      upsertSearchIndex(db, row);
      writeResource(stdout, json, toResource(row, db), `Created ${type}: ${title}\n${id}`);
      return 0;
    }

    if (command === "import") {
      const url = argv[2];
      if (!url || url.startsWith("--")) {
        return error(stderr, "URL is required");
      }
      const urlError = importUrlError(url);
      if (urlError) {
        return error(stderr, urlError);
      }
      const response = await fetcher(url);
      if (!response.ok) {
        return error(stderr, `Fetch failed with status ${response.status}`);
      }
      const html = await response.text();
      const { snapshot, title } = htmlToReference(html, url);
      const now = Date.now();
      const id = crypto.randomUUID();
      db.prepare(
        `insert into resources (id, user_id, type, title, content, url, note, tags, created_at, updated_at)
         values (?, ?, 'reference', ?, ?, ?, '', '[]', ?, ?)`,
      ).run(id, localUserId, title, snapshot, url, now, now);
      db.prepare(
        "insert into resource_search (resource_id, title, content, tags) values (?, ?, ?, '')",
      ).run(id, title, snapshot);
      const row = db
        .prepare("select * from resources where id = ? and user_id = ?")
        .get(id, localUserId) as ResourceRow;
      upsertSearchIndex(db, row);
      writeResource(stdout, json, toResource(row, db), `Imported reference: ${title}\n${id}`);
      return 0;
    }

    if (command === "update") {
      const id = argv[2];
      if (!id || id.startsWith("--")) {
        return error(stderr, "Resource id is required");
      }
      const existing = readResourceById(db, id);
      if (!existing) {
        writeJsonError(stdout, "Resource not found");
        return 1;
      }
      const update: ResourceUpdate = {};
      const title = readFlag(argv, "--title");
      if (title !== undefined) {
        update.title = title.trim() || "Untitled";
      }
      const content = await readResourceText(
        argv,
        existing.type === "reference" ? "--snapshot" : "--text",
        stdin,
      );
      if (content !== undefined) {
        update.content = content;
      }
      const referenceNote = readFlag(argv, "--note");
      if (referenceNote !== undefined) {
        update.note = referenceNote;
      }
      if (hasFlag(argv, "--url")) {
        update.url = readFlag(argv, "--url") || null;
      }
      if (hasFlag(argv, "--tags") || hasFlag(argv, "--tag")) {
        update.tags = parseTagsFromArgs(argv);
      }
      const row = updateResource(db, id, update);
      if (!row) {
        writeJsonError(stdout, "Resource not found");
        return 1;
      }
      writeResource(stdout, json, toResource(row, db), `Updated resource: ${row.title}\n${id}`);
      return 0;
    }

    if (command === "list") {
      const trash = hasFlag(argv, "--trash");
      const type = readFlag(argv, "--type");
      if (type !== undefined && type !== "note" && type !== "reference") {
        return error(stderr, "Resource type must be note or reference");
      }
      const rows = db
        .prepare(
          `select * from resources
           where user_id = ? and deleted_at is ${trash ? "not null" : "null"}
             ${type ? "and type = ?" : ""}
           order by updated_at desc, rowid desc`,
        )
        .all(...(type ? [localUserId, type] : [localUserId])) as ResourceRow[];
      writeResourceCollection(
        stdout,
        json,
        rows.map((row) => toResource(row, db)),
      );
      return 0;
    }

    if (command === "search") {
      const query = argv[2];
      if (!query || query.startsWith("--")) {
        return error(stderr, "Search query is required");
      }
      const type = readFlag(argv, "--type");
      if (type !== undefined && type !== "note" && type !== "reference") {
        return error(stderr, "Resource type must be note or reference");
      }
      const rows = db
        .prepare(
          `select resources.*
           from resource_search
           join resources on resources.id = resource_search.resource_id
           where resource_search match ?
             and resources.user_id = ?
             and resources.deleted_at is null
             ${type ? "and resources.type = ?" : ""}
           order by bm25(resource_search), resources.updated_at desc`,
        )
        .all(...(type ? [query, localUserId, type] : [query, localUserId])) as ResourceRow[];
      writeResourceCollection(
        stdout,
        json,
        rows.map((row) => toResource(row, db)),
      );
      return 0;
    }

    if (command === "delete") {
      const id = argv[2];
      if (!id || id.startsWith("--")) {
        return error(stderr, "Resource id is required");
      }
      if (!hasFlag(argv, "--yes")) {
        return error(stderr, "Deleting a resource requires --yes");
      }
      const existing = db
        .prepare("select * from resources where id = ? and user_id = ? and deleted_at is null")
        .get(id, localUserId) as ResourceRow | undefined;
      if (!existing) {
        writeJson(stdout, {
          error: { message: "Resource not found" },
          ok: false,
          schemaVersion: 1,
        });
        return 1;
      }
      const now = Date.now();
      db.prepare(
        "update resources set deleted_at = ?, updated_at = ? where id = ? and user_id = ?",
      ).run(now, now, id, localUserId);
      writeResource(stdout, json, toResource(existing, db), `Moved to Trash: ${existing.title}`);
      return 0;
    }

    if (command === "restore") {
      const id = argv[2];
      if (!id || id.startsWith("--")) {
        return error(stderr, "Resource id is required");
      }
      const existing = db
        .prepare("select * from resources where id = ? and user_id = ? and deleted_at is not null")
        .get(id, localUserId) as ResourceRow | undefined;
      if (!existing) {
        writeJson(stdout, {
          error: { message: "Resource not found" },
          ok: false,
          schemaVersion: 1,
        });
        return 1;
      }
      db.prepare(
        "update resources set deleted_at = null, updated_at = ? where id = ? and user_id = ?",
      ).run(Date.now(), id, localUserId);
      writeResource(stdout, json, toResource(existing, db), `Restored: ${existing.title}`);
      return 0;
    }

    if (command === "purge") {
      const id = argv[2];
      if (!id || id.startsWith("--")) {
        return error(stderr, "Resource id is required");
      }
      if (!hasFlag(argv, "--yes")) {
        return error(stderr, "Purging a resource requires --yes");
      }
      const existing = db
        .prepare("select * from resources where id = ? and user_id = ? and deleted_at is not null")
        .get(id, localUserId) as ResourceRow | undefined;
      if (!existing) {
        writeJson(stdout, {
          error: { message: "Resource not found" },
          ok: false,
          schemaVersion: 1,
        });
        return 1;
      }
      db.prepare("delete from resource_search where resource_id = ?").run(id);
      db.prepare("delete from resources where id = ? and user_id = ?").run(id, localUserId);
      writeResource(stdout, json, toResource(existing, db), `Purged: ${existing.title}`);
      return 0;
    }

    if (command === "link") {
      const noteId = argv[2];
      const referenceId = argv[3];
      if (!noteId || noteId.startsWith("--") || !referenceId || referenceId.startsWith("--")) {
        return error(stderr, "Note id and reference id are required");
      }
      const note = db
        .prepare(
          "select * from resources where id = ? and user_id = ? and type = 'note' and deleted_at is null",
        )
        .get(noteId, localUserId) as ResourceRow | undefined;
      const reference = db
        .prepare(
          "select * from resources where id = ? and user_id = ? and type = 'reference' and deleted_at is null",
        )
        .get(referenceId, localUserId) as ResourceRow | undefined;
      if (!note || !reference) {
        writeJson(stdout, {
          error: { message: "Resource not found" },
          ok: false,
          schemaVersion: 1,
        });
        return 1;
      }
      db.prepare(
        "insert or ignore into resource_links (note_id, reference_id, created_at) values (?, ?, ?)",
      ).run(noteId, referenceId, Date.now());
      writeLink(stdout, json, { noteId, referenceId });
      return 0;
    }

    if (command === "unlink") {
      const noteId = argv[2];
      const referenceId = argv[3];
      if (!noteId || noteId.startsWith("--") || !referenceId || referenceId.startsWith("--")) {
        return error(stderr, "Note id and reference id are required");
      }
      if (!hasFlag(argv, "--yes")) {
        return error(stderr, "Unlinking a reference requires --yes");
      }
      const note = db
        .prepare(
          "select * from resources where id = ? and user_id = ? and type = 'note' and deleted_at is null",
        )
        .get(noteId, localUserId) as ResourceRow | undefined;
      const reference = db
        .prepare(
          "select * from resources where id = ? and user_id = ? and type = 'reference' and deleted_at is null",
        )
        .get(referenceId, localUserId) as ResourceRow | undefined;
      if (!note || !reference) {
        writeJsonError(stdout, "Resource not found");
        return 1;
      }
      db.prepare("delete from resource_links where note_id = ? and reference_id = ?").run(
        noteId,
        referenceId,
      );
      writeLink(stdout, json, { noteId, referenceId });
      return 0;
    }

    if (command === "read") {
      const id = argv[2];
      if (!id || id.startsWith("--")) {
        return error(stderr, "Resource id is required");
      }
      const row = db
        .prepare("select * from resources where id = ? and user_id = ? and deleted_at is null")
        .get(id, localUserId) as ResourceRow | undefined;
      if (!row) {
        writeJson(stdout, {
          error: { message: "Resource not found" },
          ok: false,
          schemaVersion: 1,
        });
        return 1;
      }
      writeResource(stdout, json, toResource(row, db));
      return 0;
    }

    return error(stderr, "Unknown resource command");
  } finally {
    db.close();
  }
}

function isMainModule(importUrl: string, argvPath?: string) {
  if (!argvPath) {
    return false;
  }

  return realpathSync(fileURLToPath(importUrl)) === realpathSync(argvPath);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const code = await runCli({ argv: process.argv.slice(2) });
  process.exitCode = code;
}
