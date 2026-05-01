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

test("supports note and reference aliases over resource commands", async () => {
  const home = join(tmpdir(), `onlywrite-cli-${crypto.randomUUID()}`);
  mkdirSync(home, { recursive: true });
  tempDirs.push(home);

  const note = await runOnlyWrite(
    ["note", "create", "--title", "Alias", "--text", "body", "--json"],
    home,
  );
  const reference = await runOnlyWrite(
    ["reference", "create", "--title", "Alias ref", "--snapshot", "ref body", "--json"],
    home,
  );

  expect(note).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(note.stdout)).toMatchObject({
    ok: true,
    resource: { note: { content: "body" }, title: "Alias", type: "note" },
  });
  expect(reference).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(reference.stdout)).toMatchObject({
    ok: true,
    resource: { reference: { snapshot: "ref body" }, title: "Alias ref", type: "reference" },
  });
});
