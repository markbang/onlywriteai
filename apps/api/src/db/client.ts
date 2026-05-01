import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

const schemaVersion = 1;

export function createDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      applied_at integer not null
    );

    create table if not exists users (
      id text primary key,
      email text,
      name text,
      picture text,
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists user_settings (
      user_id text primary key references users(id) on delete cascade,
      settings text not null,
      updated_at integer not null
    );

    create table if not exists documents (
      id text primary key,
      user_id text not null default 'local-user' references users(id) on delete cascade,
      title text not null,
      content text not null,
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists sources (
      id text primary key,
      user_id text not null default 'local-user' references users(id) on delete cascade,
      type text not null check (type in ('text', 'rss', 'pdf', 'image')),
      title text not null,
      note text not null,
      url text,
      file_name text,
      tags text not null default '[]',
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists document_source_links (
      document_id text not null references documents(id) on delete cascade,
      source_id text not null references sources(id) on delete cascade,
      created_at integer not null,
      primary key (document_id, source_id)
    );

    create table if not exists agent_conversations (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      document_id text references documents(id) on delete cascade,
      title text not null,
      messages text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `);
  sqlite
    .prepare("insert or ignore into schema_migrations (version, applied_at) values (?, ?)")
    .run(schemaVersion, Date.now());
  sqlite.exec(`
    insert or ignore into users (id, email, name, picture, created_at, updated_at)
    values ('local-user', null, 'Local user', null, 0, 0)
  `);
  const documentColumns = sqlite.prepare("pragma table_info(documents)").all() as Array<{
    name: string;
  }>;
  if (!documentColumns.some((column) => column.name === "user_id")) {
    sqlite.exec("alter table documents add column user_id text not null default 'local-user'");
  }
  const sourceColumns = sqlite.prepare("pragma table_info(sources)").all() as Array<{
    name: string;
  }>;
  if (!sourceColumns.some((column) => column.name === "user_id")) {
    sqlite.exec("alter table sources add column user_id text not null default 'local-user'");
  }
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as Array<{
    name: string;
  }>;
  if (tables.some((table) => table.name === "document_sources")) {
    const oldSourceColumns = sqlite.prepare("pragma table_info(document_sources)").all() as Array<{
      name: string;
    }>;
    const hasTags = oldSourceColumns.some((column) => column.name === "tags");
    sqlite.exec(`
      insert or ignore into sources (
        id,
        type,
        title,
        note,
        url,
        file_name,
        tags,
        created_at,
        updated_at
      )
      select
        id,
        type,
        title,
        note,
        url,
        file_name,
        ${hasTags ? "coalesce(tags, '[]')" : "'[]'"},
        created_at,
        updated_at
      from document_sources;

      insert or ignore into document_source_links (
        document_id,
        source_id,
        created_at
      )
      select
        document_id,
        id,
        created_at
      from document_sources;
    `);
  }

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
