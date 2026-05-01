import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { runCli } from "../src/cli.ts";

type CliResult = {
  code: number;
  stderr: string;
  stdout: string;
};

const tempDirs: string[] = [];

async function runOnlyWrite(args: string[], home: string): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: args,
    env: { ONLYWRITE_HOME: home },
    stderr: (chunk) => {
      stderr += chunk;
    },
    stdout: (chunk) => {
      stdout += chunk;
    },
  });

  return { code, stderr, stdout };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("creates and reads a note resource as stable JSON", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  const create = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Idea", "--text", "hello", "--json"],
    home,
  );

  expect(create).toMatchObject({ code: 0, stderr: "" });
  const created = JSON.parse(create.stdout) as {
    ok: boolean;
    resource: { id: string; note: { content: string }; title: string; type: string };
    schemaVersion: number;
  };
  expect(created).toMatchObject({
    ok: true,
    resource: { note: { content: "hello" }, title: "Idea", type: "note" },
    schemaVersion: 1,
  });
  expect(created.resource.id).toMatch(/[0-9a-f-]{36}/);

  const read = await runOnlyWrite(["resource", "read", created.resource.id, "--json"], home);

  expect(read).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(read.stdout)).toMatchObject({
    ok: true,
    resource: {
      id: created.resource.id,
      note: { content: "hello" },
      title: "Idea",
      type: "note",
    },
    schemaVersion: 1,
  });
});

test("lists note resources from the local store as stable JSON", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "First", "--text", "alpha", "--json"],
    home,
  );
  await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Second", "--text", "beta", "--json"],
    home,
  );

  const list = await runOnlyWrite(["resource", "list", "--json"], home);

  expect(list).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(list.stdout)).toMatchObject({
    ok: true,
    resources: [
      { note: { content: "beta" }, title: "Second", type: "note" },
      { note: { content: "alpha" }, title: "First", type: "note" },
    ],
    schemaVersion: 1,
  });
});

test("searches note resources by title and content as stable JSON", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  await runOnlyWrite(
    [
      "resource",
      "create",
      "--type",
      "note",
      "--title",
      "Garden idea",
      "--text",
      "alpha basil notes",
      "--json",
    ],
    home,
  );
  await runOnlyWrite(
    [
      "resource",
      "create",
      "--type",
      "note",
      "--title",
      "Reading list",
      "--text",
      "beta archive",
      "--json",
    ],
    home,
  );

  const search = await runOnlyWrite(["resource", "search", "alpha", "--json"], home);

  expect(search).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(search.stdout)).toMatchObject({
    ok: true,
    resources: [{ note: { content: "alpha basil notes" }, title: "Garden idea", type: "note" }],
    schemaVersion: 1,
  });
});

test("moves deleted resources to Trash and excludes them from ordinary reads and lists", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  const create = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Draft", "--text", "trash me", "--json"],
    home,
  );
  const id = (JSON.parse(create.stdout) as { resource: { id: string } }).resource.id;

  const deleted = await runOnlyWrite(["resource", "delete", id, "--yes", "--json"], home);
  const ordinaryList = await runOnlyWrite(["resource", "list", "--json"], home);
  const trashList = await runOnlyWrite(["resource", "list", "--trash", "--json"], home);
  const read = await runOnlyWrite(["resource", "read", id, "--json"], home);

  expect(deleted).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(deleted.stdout)).toMatchObject({
    ok: true,
    resource: { id, title: "Draft", type: "note" },
    schemaVersion: 1,
  });
  expect(JSON.parse(ordinaryList.stdout)).toMatchObject({ ok: true, resources: [] });
  expect(JSON.parse(trashList.stdout)).toMatchObject({
    ok: true,
    resources: [{ id, title: "Draft", type: "note" }],
    schemaVersion: 1,
  });
  expect(read.code).toBe(1);
  expect(JSON.parse(read.stdout)).toMatchObject({
    error: { message: "Resource not found" },
    ok: false,
    schemaVersion: 1,
  });
});

test("restores trashed resources and purges only with explicit confirmation", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  const create = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Keep", "--text", "recover me", "--json"],
    home,
  );
  const id = (JSON.parse(create.stdout) as { resource: { id: string } }).resource.id;
  await runOnlyWrite(["resource", "delete", id, "--yes", "--json"], home);

  const restored = await runOnlyWrite(["resource", "restore", id, "--json"], home);
  const readRestored = await runOnlyWrite(["resource", "read", id, "--json"], home);
  await runOnlyWrite(["resource", "delete", id, "--yes", "--json"], home);
  const purgeWithoutYes = await runOnlyWrite(["resource", "purge", id, "--json"], home);
  const purged = await runOnlyWrite(["resource", "purge", id, "--yes", "--json"], home);
  const trashList = await runOnlyWrite(["resource", "list", "--trash", "--json"], home);

  expect(restored).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(restored.stdout)).toMatchObject({ ok: true, resource: { id, title: "Keep" } });
  expect(JSON.parse(readRestored.stdout)).toMatchObject({ ok: true, resource: { id } });
  expect(purgeWithoutYes).toMatchObject({
    code: 1,
    stderr: "Purging a resource requires --yes\n",
  });
  expect(purged).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(purged.stdout)).toMatchObject({ ok: true, resource: { id, title: "Keep" } });
  expect(JSON.parse(trashList.stdout)).toMatchObject({ ok: true, resources: [] });
});
