import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createDatabase } from "../db/client.ts";
import { createDocumentRepository } from "./repository.ts";

const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

function createTempDatabase() {
  const dir = join(tmpdir(), `onlywrite-api-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const database = createDatabase(join(dir, "test.sqlite"));
  databases.push(database);
  return {
    database,
    repository: createDocumentRepository(database.db),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("creates, lists, reads, updates, and deletes documents", () => {
  const { repository } = createTempDatabase();

  const created = repository.create({ title: "Draft", content: "First body" });
  const listed = repository.list();
  const updated = repository.update(created.id, {
    title: "Updated",
    content: "Second body",
  });
  const foundAfterUpdate = repository.findById(created.id);
  const deleted = repository.delete(created.id);
  const foundAfterDelete = repository.findById(created.id);

  expect(created.title).toBe("Draft");
  expect(created.content).toBe("First body");
  expect(created.createdAt).toEqual(expect.any(Number));
  expect(created.updatedAt).toEqual(expect.any(Number));
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: created.id, title: "Draft" });
  expect(updated).toMatchObject({
    id: created.id,
    title: "Updated",
    content: "Second body",
  });
  expect(foundAfterUpdate).toMatchObject({ id: created.id, title: "Updated" });
  expect(deleted).toBe(true);
  expect(foundAfterDelete).toBeNull();
});

test("defaults empty documents to an untitled blank draft", () => {
  const { repository } = createTempDatabase();

  const created = repository.create({ title: "   " });

  expect(created.title).toBe("Untitled");
  expect(created.content).toBe("");
});

test("lists documents by newest update first", async () => {
  const { repository } = createTempDatabase();

  const older = repository.create({ title: "Older" });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const newer = repository.create({ title: "Newer" });

  const listed = repository.list();

  expect(listed.map((document) => document.id)).toEqual([newer.id, older.id]);
});

test("uses newest-created rows first when updated timestamps tie", () => {
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  const { repository } = createTempDatabase();

  const older = repository.create({ title: "Older" });
  const newer = repository.create({ title: "Newer" });

  const listed = repository.list();

  expect(listed.map((document) => document.id)).toEqual([newer.id, older.id]);
});

test("returns null or false for missing documents", () => {
  const { repository } = createTempDatabase();

  const updated = repository.update("missing", { title: "Nope" });
  const deleted = repository.delete("missing");
  const found = repository.findById("missing");

  expect(found).toBeNull();
  expect(updated).toBeNull();
  expect(deleted).toBe(false);
});

test("creates, lists, updates, and deletes document sources", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft" });

  const created = repository.createSource(document.id, {
    type: "text",
    title: "  Research note  ",
    note: "Useful background",
    url: "   ",
    fileName: " source.pdf ",
  });
  const listed = repository.listSources(document.id);
  const updated = repository.updateSource(document.id, created?.id ?? "missing", {
    title: "Updated source",
    url: " https://example.com/source ",
    fileName: "",
  });
  const deleted = repository.deleteSource(document.id, created?.id ?? "missing");

  expect(created).toMatchObject({
    documentId: document.id,
    type: "text",
    title: "Research note",
    note: "Useful background",
    url: null,
    fileName: "source.pdf",
  });
  expect(created?.createdAt).toEqual(expect.any(Number));
  expect(created?.updatedAt).toEqual(expect.any(Number));
  expect(listed.map((source) => source.id)).toEqual([created?.id]);
  expect(updated).toMatchObject({
    id: created?.id,
    title: "Updated source",
    note: "Useful background",
    url: "https://example.com/source",
    fileName: null,
  });
  expect(deleted).toBe(true);
  expect(repository.listSources(document.id)).toEqual([]);
});

test("normalizes source defaults and preserves unspecified update fields", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft" });

  const created = repository.createSource(document.id, {
    type: "rss",
    title: "   ",
  });
  const updated = repository.updateSource(document.id, created?.id ?? "missing", {
    title: "   ",
  });

  expect(created).toMatchObject({
    type: "rss",
    title: "Untitled source",
    note: "",
    url: null,
    fileName: null,
  });
  expect(updated).toMatchObject({
    id: created?.id,
    type: "rss",
    title: "Untitled source",
    note: "",
    url: null,
    fileName: null,
  });
});

test("rejects invalid source types", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft" });
  const source = repository.createSource(document.id, {
    type: "text",
    title: "Valid",
  });

  expect(repository.createSource(document.id, { type: "video", title: "Invalid" })).toBeNull();
  expect(
    repository.updateSource(document.id, source?.id ?? "missing", { type: "video" }),
  ).toBeNull();
});

test("lists sources by newest update first with deterministic tie breaker", async () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft" });

  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  const oldest = repository.createSource(document.id, {
    type: "pdf",
    title: "Oldest",
  });
  const tiedOlder = repository.createSource(document.id, {
    type: "image",
    title: "Tie older",
  });
  const tiedNewer = repository.createSource(document.id, {
    type: "text",
    title: "Tie newer",
  });

  vi.mocked(Date.now).mockRestore();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const newest = repository.updateSource(document.id, oldest?.id ?? "missing", {
    note: "Promoted",
  });

  const listed = repository.listSources(document.id);

  expect(listed.map((source) => source.id)).toEqual([newest?.id, tiedNewer?.id, tiedOlder?.id]);
});

test("scopes source mutations to existing documents and deletes sources with documents", () => {
  const { repository } = createTempDatabase();
  const owner = repository.create({ title: "Owner" });
  const other = repository.create({ title: "Other" });
  const source = repository.createSource(owner.id, {
    type: "text",
    title: "Owned",
  });

  expect(repository.createSource("missing", { type: "text", title: "Nope" })).toBeNull();
  expect(repository.updateSource(other.id, source?.id ?? "missing", { title: "Nope" })).toBeNull();
  expect(repository.deleteSource(other.id, source?.id ?? "missing")).toBe(false);

  expect(repository.delete(owner.id)).toBe(true);
  expect(repository.listSources(owner.id)).toEqual([]);
});
