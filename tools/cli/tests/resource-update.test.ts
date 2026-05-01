import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { runCli } from "../src/cli.ts";

type CliResult = { code: number; stderr: string; stdout: string };

const tempDirs: string[] = [];

async function runOnlyWrite(
  args: string[],
  home: string,
  options: { stdin?: string } = {},
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: args,
    env: { ONLYWRITE_HOME: home },
    stdin: options.stdin ? () => options.stdin ?? "" : undefined,
    stderr: (chunk) => {
      stderr += chunk;
    },
    stdout: (chunk) => {
      stdout += chunk;
    },
  });
  return { code, stderr, stdout };
}

function makeHome() {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  return home;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("updates note title, content, and tags and refreshes search", async () => {
  const home = makeHome();
  const create = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Draft", "--text", "old", "--json"],
    home,
  );
  const id = (JSON.parse(create.stdout) as { resource: { id: string } }).resource.id;

  const updated = await runOnlyWrite(
    [
      "resource",
      "update",
      id,
      "--title",
      "Published note",
      "--text",
      "new searchable body",
      "--tag",
      "essay",
      "--tag",
      "local-first",
      "--json",
    ],
    home,
  );
  const searchOld = await runOnlyWrite(["resource", "search", "old", "--json"], home);
  const searchNew = await runOnlyWrite(["resource", "search", "searchable", "--json"], home);

  expect(updated).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(updated.stdout)).toMatchObject({
    ok: true,
    resource: {
      id,
      note: { content: "new searchable body" },
      tags: ["essay", "local-first"],
      title: "Published note",
      type: "note",
    },
    schemaVersion: 1,
  });
  expect(JSON.parse(searchOld.stdout)).toMatchObject({ ok: true, resources: [] });
  expect(JSON.parse(searchNew.stdout)).toMatchObject({
    ok: true,
    resources: [{ id, title: "Published note" }],
  });
});

test("creates notes from stdin and files", async () => {
  const home = makeHome();
  const sourceFile = join(home, "saved.md");
  writeFileSync(sourceFile, "# From file\n\nBody", "utf8");

  const fromStdin = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Piped", "--stdin", "--json"],
    home,
    { stdin: "Piped body" },
  );
  const fromFile = await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Saved", "--file", sourceFile, "--json"],
    home,
  );

  expect(fromStdin).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(fromStdin.stdout)).toMatchObject({
    ok: true,
    resource: { note: { content: "Piped body" }, title: "Piped", type: "note" },
  });
  expect(JSON.parse(fromFile.stdout)).toMatchObject({
    ok: true,
    resource: { note: { content: "# From file\n\nBody" }, title: "Saved", type: "note" },
  });
});

test("filters list and search results by resource type", async () => {
  const home = makeHome();
  await runOnlyWrite(
    ["resource", "create", "--type", "note", "--title", "Shared", "--text", "alpha", "--json"],
    home,
  );
  await runOnlyWrite(
    [
      "resource",
      "create",
      "--type",
      "reference",
      "--title",
      "Shared",
      "--snapshot",
      "alpha external",
      "--json",
    ],
    home,
  );

  const noteList = await runOnlyWrite(["resource", "list", "--type", "note", "--json"], home);
  const referenceSearch = await runOnlyWrite(
    ["resource", "search", "alpha", "--type", "reference", "--json"],
    home,
  );

  expect(JSON.parse(noteList.stdout)).toMatchObject({
    ok: true,
    resources: [{ title: "Shared", type: "note" }],
  });
  expect(JSON.parse(referenceSearch.stdout)).toMatchObject({
    ok: true,
    resources: [{ title: "Shared", type: "reference" }],
  });
});
