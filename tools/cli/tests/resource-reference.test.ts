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

async function runOnlyWrite(
  args: string[],
  home: string,
  fetcher?: typeof fetch,
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: args,
    env: { ONLYWRITE_HOME: home },
    fetcher,
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

test("creates and reads a reference resource with a snapshot as stable JSON", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  const create = await runOnlyWrite(
    [
      "resource",
      "create",
      "--type",
      "reference",
      "--title",
      "SQLite FTS",
      "--url",
      "https://example.com/sqlite-fts",
      "--snapshot",
      "# SQLite FTS\nFull text search notes",
      "--note",
      "Useful local search reference",
      "--json",
    ],
    home,
  );

  expect(create).toMatchObject({ code: 0, stderr: "" });
  const created = JSON.parse(create.stdout) as { resource: { id: string } };
  expect(created).toMatchObject({
    ok: true,
    resource: {
      reference: {
        note: "Useful local search reference",
        snapshot: "# SQLite FTS\nFull text search notes",
        url: "https://example.com/sqlite-fts",
      },
      title: "SQLite FTS",
      type: "reference",
    },
    schemaVersion: 1,
  });

  const read = await runOnlyWrite(["resource", "read", created.resource.id, "--json"], home);

  expect(read).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(read.stdout)).toMatchObject({
    ok: true,
    resource: {
      id: created.resource.id,
      reference: {
        note: "Useful local search reference",
        snapshot: "# SQLite FTS\nFull text search notes",
        url: "https://example.com/sqlite-fts",
      },
      title: "SQLite FTS",
      type: "reference",
    },
    schemaVersion: 1,
  });
});

test("imports a URL as a reference snapshot without enrichment", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  const fetcher = async () =>
    new Response(
      "<html><head><title>Local First</title></head><body><h1>Local First</h1><p>Own your notes.</p></body></html>",
      {
        headers: { "content-type": "text/html" },
        status: 200,
      },
    );

  const imported = await runOnlyWrite(
    ["resource", "import", "https://example.com/local-first", "--no-enrich", "--json"],
    home,
    fetcher,
  );

  expect(imported).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(imported.stdout)).toMatchObject({
    ok: true,
    resource: {
      reference: {
        note: "",
        snapshot: "# Local First\n\nOwn your notes.",
        url: "https://example.com/local-first",
      },
      title: "Local First",
      type: "reference",
    },
    schemaVersion: 1,
  });
});

test("rejects unsafe reference import URLs before fetching", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  let fetched = false;
  const fetcher = async () => {
    fetched = true;
    return new Response("should not fetch");
  };

  const fileUrl = await runOnlyWrite(
    ["resource", "import", "file:///etc/passwd", "--json"],
    home,
    fetcher,
  );
  const localhost = await runOnlyWrite(
    ["resource", "import", "http://127.0.0.1:8080/admin", "--json"],
    home,
    fetcher,
  );

  expect(fetched).toBe(false);
  expect(fileUrl).toMatchObject({ code: 1, stderr: "Only http and https URLs can be imported\n" });
  expect(localhost).toMatchObject({
    code: 1,
    stderr: "Local and private network URLs cannot be imported\n",
  });
});
