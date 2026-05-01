import type { Server } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { runCli } from "../src/cli.ts";

type CliResult = { code: number; stderr: string; stdout: string };
const tempDirs: string[] = [];
const servers: Server[] = [];

async function runOnlyWrite(
  args: string[],
  home: string,
  onServer?: (server: Server) => void,
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: args,
    env: { ONLYWRITE_HOME: home },
    onServer: (server) => {
      servers.push(server);
      onServer?.(server);
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    stdout: (chunk) => {
      stdout += chunk;
    },
  });
  return { code, stderr, stdout };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("starts a read-only local resource viewer", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  await runOnlyWrite(
    ["note", "create", "--title", "Viewer Note", "--text", "visible body", "--json"],
    home,
  );

  let ready!: Promise<void>;
  let resolveReady!: () => void;
  ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const web = await runOnlyWrite(["web", "--port", "0", "--no-open", "--json"], home, () =>
    resolveReady(),
  );
  await ready;

  expect(web).toMatchObject({ code: 0, stderr: "" });
  const body = JSON.parse(web.stdout) as { ok: boolean; url: string };
  expect(body).toMatchObject({ ok: true });

  const response = await fetch(body.url);
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toContain("Viewer Note");
  expect(html).toContain("visible body");
  expect(html).toContain("Search resources");
  expect(html).toContain("onlywrite resource read");
  expect(html).not.toContain('method="post"');
  expect(html).not.toContain("contenteditable");
});

test("local resource viewer exposes read-only type, search, and Trash views", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);
  await runOnlyWrite(
    ["note", "create", "--title", "Alpha Note", "--text", "visible alpha", "--json"],
    home,
  );
  await runOnlyWrite(
    ["reference", "create", "--title", "Alpha Reference", "--snapshot", "external alpha", "--json"],
    home,
  );
  const deleted = await runOnlyWrite(
    ["note", "create", "--title", "Trash Note", "--text", "hidden", "--json"],
    home,
  );
  const deletedId = (JSON.parse(deleted.stdout) as { resource: { id: string } }).resource.id;
  await runOnlyWrite(["resource", "delete", deletedId, "--yes", "--json"], home);

  const web = await runOnlyWrite(["web", "--port", "0", "--no-open", "--json"], home);
  const body = JSON.parse(web.stdout) as { url: string };

  const references = await fetch(`${body.url}?type=reference&q=alpha`).then((response) =>
    response.text(),
  );
  const trash = await fetch(`${body.url}trash`).then((response) => response.text());

  expect(references).toContain("Alpha Reference");
  expect(references).not.toContain("Alpha Note");
  expect(trash).toContain("Trash Note");
  expect(trash).toContain(`onlywrite resource restore ${deletedId} --json`);
  expect(trash).toContain(`onlywrite resource purge ${deletedId} --yes --json`);
  expect(trash).not.toContain("contenteditable");
});
