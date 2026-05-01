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

test("creates, lists, reads, and updates agent conversations by document scope", () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft" });
  const otherDocument = repository.create({ title: "Other" });

  const workspaceConversation = repository.createAgentConversation({
    messages: [{ id: "message-1", role: "user", content: "Global question" }],
    title: "Global question",
  });
  const documentConversation = repository.createAgentConversation({
    documentId: document.id,
    messages: [{ id: "message-2", role: "user", content: "Document question" }],
    title: "Document question",
  });
  const updated = repository.updateAgentConversation(documentConversation?.id ?? "missing", {
    messages: [
      { id: "message-2", role: "user", content: "Document question" },
      { id: "message-3", role: "assistant", content: "Document answer" },
    ],
    title: "Document question updated",
  });

  expect(workspaceConversation).toMatchObject({
    documentId: null,
    title: "Global question",
  });
  expect(documentConversation).toMatchObject({
    documentId: document.id,
    title: "Document question",
  });
  expect(updated).toMatchObject({
    id: documentConversation?.id,
    title: "Document question updated",
  });
  expect(JSON.parse(updated?.messages ?? "[]")).toHaveLength(2);
  expect(repository.findAgentConversation(documentConversation?.id ?? "missing")).toMatchObject({
    id: documentConversation?.id,
  });
  expect(repository.listAgentConversations(null).map((item) => item.id)).toEqual([
    workspaceConversation?.id,
  ]);
  expect(repository.listAgentConversations(document.id).map((item) => item.id)).toEqual([
    documentConversation?.id,
  ]);
  expect(repository.listAgentConversations(otherDocument.id)).toEqual([]);
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

  const created = repository.createAndLinkSource(document.id, {
    type: "text",
    title: "  Research note  ",
    note: "Useful background",
    url: "   ",
    fileName: " source.pdf ",
    tags: [" Research ", "rss", "research"],
  });
  const listed = repository.listSources(document.id);
  const allSources = repository.listAllSources();
  const updated = repository.updateSource(created?.id ?? "missing", {
    title: "Updated source",
    url: " https://example.com/source ",
    fileName: "",
    tags: ["updated"],
  });
  const unlinked = repository.unlinkSource(document.id, created?.id ?? "missing");
  const deleted = repository.deleteSource(created?.id ?? "missing");

  expect(created).toMatchObject({
    type: "text",
    title: "Research note",
    note: "Useful background",
    url: null,
    fileName: "source.pdf",
    tags: JSON.stringify(["Research", "rss"]),
  });
  expect(created?.createdAt).toEqual(expect.any(Number));
  expect(created?.updatedAt).toEqual(expect.any(Number));
  expect(listed.map((source) => source.id)).toEqual([created?.id]);
  expect(allSources[0]).toMatchObject({
    id: created?.id,
    documents: [{ id: document.id, title: "Draft" }],
  });
  expect(updated).toMatchObject({
    id: created?.id,
    title: "Updated source",
    note: "Useful background",
    url: "https://example.com/source",
    fileName: null,
    tags: JSON.stringify(["updated"]),
  });
  expect(unlinked).toBe(true);
  expect(repository.listSources(document.id)).toEqual([]);
  expect(deleted).toBe(true);
  expect(repository.listAllSources()).toEqual([]);
});

test("normalizes source defaults and preserves unspecified update fields", () => {
  const { repository } = createTempDatabase();

  const created = repository.createSource({
    type: "rss",
    title: "   ",
    url: "https://example.com/feed.xml",
  });
  const updated = repository.updateSource(created?.id ?? "missing", {
    title: "   ",
  });

  expect(created).toMatchObject({
    type: "rss",
    title: "",
    note: "",
    url: "https://example.com/feed.xml",
    fileName: null,
    tags: "[]",
  });
  expect(updated).toMatchObject({
    id: created?.id,
    type: "rss",
    title: "",
    note: "",
    url: "https://example.com/feed.xml",
    fileName: null,
    tags: "[]",
  });
});

test("rejects invalid source types", () => {
  const { repository } = createTempDatabase();
  const source = repository.createSource({
    type: "text",
    title: "Valid",
    note: "Body",
  });

  expect(repository.createSource({ type: "video", title: "Invalid", note: "Body" })).toBeNull();
  expect(repository.updateSource(source?.id ?? "missing", { type: "video" })).toBeNull();
});

test("rejects empty sources without file, URL, or note", () => {
  const { repository } = createTempDatabase();

  expect(repository.createSource({ type: "text", title: "Only a title" })).toBeNull();
});

test("lists sources by newest update first with deterministic tie breaker", async () => {
  const { repository } = createTempDatabase();
  const document = repository.create({ title: "Draft" });

  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  const oldest = repository.createAndLinkSource(document.id, {
    type: "pdf",
    title: "Oldest",
    fileName: "oldest.pdf",
  });
  const tiedOlder = repository.createAndLinkSource(document.id, {
    type: "image",
    title: "Tie older",
    fileName: "older.png",
  });
  const tiedNewer = repository.createAndLinkSource(document.id, {
    type: "text",
    title: "Tie newer",
    note: "Newer",
  });

  vi.mocked(Date.now).mockRestore();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const newest = repository.updateSource(oldest?.id ?? "missing", {
    note: "Promoted",
  });

  const listed = repository.listSources(document.id);

  expect(listed.map((source) => source.id)).toEqual([newest?.id, tiedNewer?.id, tiedOlder?.id]);
});

test("links, unlinks, and cascades document source associations", () => {
  const { repository } = createTempDatabase();
  const owner = repository.create({ title: "Owner" });
  const other = repository.create({ title: "Other" });
  const source = repository.createSource({
    type: "text",
    title: "Owned",
    note: "Reusable",
  });

  expect(repository.linkSource(owner.id, source?.id ?? "missing")).toMatchObject({
    id: source?.id,
  });
  expect(repository.linkSource(other.id, source?.id ?? "missing")).toMatchObject({
    id: source?.id,
  });
  expect(repository.linkSource("missing", source?.id ?? "missing")).toBeNull();
  expect(repository.unlinkSource("missing", source?.id ?? "missing")).toBe(false);
  expect(repository.unlinkSource(other.id, source?.id ?? "missing")).toBe(true);

  expect(repository.delete(owner.id)).toBe(true);
  expect(repository.listSources(owner.id)).toEqual([]);
  expect(repository.listAllSources()).toHaveLength(1);
});

test("upserts user profile fields from authentication claims", () => {
  const { repository } = createTempDatabase();

  const created = repository.upsertUser({
    id: "logto-user",
    email: "first@example.com",
    name: "First Name",
    picture: "https://example.com/avatar.png",
  });
  const updated = repository.upsertUser({
    id: "logto-user",
    email: "second@example.com",
    name: "Second Name",
  });

  expect(created).toMatchObject({
    id: "logto-user",
    email: "first@example.com",
    name: "First Name",
    picture: "https://example.com/avatar.png",
  });
  expect(updated).toMatchObject({
    id: "logto-user",
    email: "second@example.com",
    name: "Second Name",
    picture: "https://example.com/avatar.png",
  });
  expect(updated.updatedAt).toEqual(expect.any(Number));
});

test("scopes documents to their owner", () => {
  const { repository } = createTempDatabase();
  repository.upsertUser({ id: "user-a", name: "User A" });
  repository.upsertUser({ id: "user-b", name: "User B" });

  const userDocument = repository.create("user-a", { title: "A draft", content: "Private" });
  const otherDocument = repository.create("user-b", { title: "B draft", content: "Hidden" });

  expect(repository.list("user-a").map((document) => document.id)).toEqual([userDocument.id]);
  expect(repository.list("user-b").map((document) => document.id)).toEqual([otherDocument.id]);
  expect(repository.findById("user-a", otherDocument.id)).toBeNull();
  expect(repository.update("user-a", otherDocument.id, { title: "No access" })).toBeNull();
  expect(repository.delete("user-a", otherDocument.id)).toBe(false);
  expect(repository.findById("user-b", otherDocument.id)).toMatchObject({ title: "B draft" });
});

test("scopes sources and document links to their owner", () => {
  const { repository } = createTempDatabase();
  repository.upsertUser({ id: "user-a", name: "User A" });
  repository.upsertUser({ id: "user-b", name: "User B" });

  const userDocument = repository.create("user-a", { title: "A draft" });
  const otherDocument = repository.create("user-b", { title: "B draft" });
  const userSource = repository.createSource("user-a", {
    type: "text",
    title: "A source",
    note: "Private context",
  });
  const otherSource = repository.createSource("user-b", {
    type: "text",
    title: "B source",
    note: "Other context",
  });

  expect(
    repository.linkSource("user-a", userDocument.id, userSource?.id ?? "missing"),
  ).toMatchObject({
    id: userSource?.id,
  });
  expect(repository.linkSource("user-a", userDocument.id, otherSource?.id ?? "missing")).toBeNull();
  expect(repository.linkSource("user-a", otherDocument.id, userSource?.id ?? "missing")).toBeNull();
  expect(repository.listSources("user-a", userDocument.id).map((source) => source.id)).toEqual([
    userSource?.id,
  ]);
  expect(repository.listAllSources("user-a")).toHaveLength(1);
  expect(repository.listAllSources("user-b")).toHaveLength(1);
  expect(
    repository.updateSource("user-a", otherSource?.id ?? "missing", { title: "No access" }),
  ).toBeNull();
  expect(repository.deleteSource("user-a", otherSource?.id ?? "missing")).toBe(false);
  expect(repository.unlinkSource("user-a", userDocument.id, otherSource?.id ?? "missing")).toBe(
    false,
  );
});

test("stores per-user application settings", () => {
  const { repository } = createTempDatabase();
  repository.upsertUser({ id: "user-a", name: "User A" });
  repository.upsertUser({ id: "user-b", name: "User B" });

  const updated = repository.updateSettings("user-a", {
    defaultDocumentTitle: "New draft",
    editorLineHeight: "relaxed",
    sourcePanelDefaultOpen: false,
  });

  expect(updated).toEqual({
    defaultDocumentTitle: "New draft",
    editorLineHeight: "relaxed",
    sourcePanelDefaultOpen: false,
  });
  expect(repository.getSettings("user-a")).toEqual(updated);
  expect(repository.getSettings("user-b")).toEqual({
    defaultDocumentTitle: "Untitled",
    editorLineHeight: "comfortable",
    sourcePanelDefaultOpen: true,
  });
});
