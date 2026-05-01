import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { runCli } from "../src/cli.ts";

type CliResult = { code: number; stderr: string; stdout: string };

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

test("links a note to a reference and exposes linked reference ids on read", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  const note = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Draft", "--text", "uses source", "--json"],
    home,
  );
  const reference = await runOnlyWrite(
    [
      "resource",
      "create",
      "--type",
      "reference",
      "--title",
      "Paper",
      "--snapshot",
      "paper body",
      "--json",
    ],
    home,
  );
  const noteId = (JSON.parse(note.stdout) as { resource: { id: string } }).resource.id;
  const referenceId = (JSON.parse(reference.stdout) as { resource: { id: string } }).resource.id;

  const link = await runOnlyWrite(["resource", "link", noteId, referenceId, "--json"], home);
  const read = await runOnlyWrite(["resource", "read", noteId, "--json"], home);

  expect(link).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(link.stdout)).toMatchObject({
    link: { noteId, referenceId },
    ok: true,
    schemaVersion: 1,
  });
  expect(JSON.parse(read.stdout)).toMatchObject({
    ok: true,
    resource: {
      id: noteId,
      links: { referenceIds: [referenceId] },
      type: "note",
    },
    schemaVersion: 1,
  });
});

test("unlinks a note from a reference only with explicit confirmation", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  const note = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Draft", "--text", "uses source", "--json"],
    home,
  );
  const reference = await runOnlyWrite(
    [
      "resource",
      "create",
      "--type",
      "reference",
      "--title",
      "Paper",
      "--snapshot",
      "paper body",
      "--json",
    ],
    home,
  );
  const noteId = (JSON.parse(note.stdout) as { resource: { id: string } }).resource.id;
  const referenceId = (JSON.parse(reference.stdout) as { resource: { id: string } }).resource.id;
  await runOnlyWrite(["resource", "link", noteId, referenceId, "--json"], home);

  const withoutYes = await runOnlyWrite(
    ["resource", "unlink", noteId, referenceId, "--json"],
    home,
  );
  const unlinked = await runOnlyWrite(
    ["resource", "unlink", noteId, referenceId, "--yes", "--json"],
    home,
  );
  const read = await runOnlyWrite(["resource", "read", noteId, "--json"], home);

  expect(withoutYes).toMatchObject({
    code: 1,
    stderr: "Unlinking a reference requires --yes\n",
  });
  expect(unlinked).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(unlinked.stdout)).toMatchObject({
    link: { noteId, referenceId },
    ok: true,
    schemaVersion: 1,
  });
  expect(JSON.parse(read.stdout)).toMatchObject({
    ok: true,
    resource: { id: noteId, links: { referenceIds: [] } },
  });
});
