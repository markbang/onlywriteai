import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    create table if not exists documents (
      id text primary key,
      title text not null,
      content text not null,
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists document_sources (
      id text primary key,
      document_id text not null references documents(id) on delete cascade,
      type text not null check (type in ('text', 'rss', 'pdf', 'image')),
      title text not null,
      note text not null,
      url text,
      file_name text,
      created_at integer not null,
      updated_at integer not null
    )
  `);

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
