import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

test("shows useful help without requiring a database", async () => {
  const home = makeHome();

  const help = await runOnlyWrite(["--help"], home);

  expect(help).toMatchObject({ code: 0, stderr: "" });
  expect(help.stdout).toContain("OnlyWrite");
  expect(help.stdout).toContain("Usage:");
  expect(help.stdout).toContain("onlywrite note create --title");
  expect(help.stdout).toContain("onlywrite web");
});

test("prints the package version", async () => {
  const home = makeHome();

  const version = await runOnlyWrite(["--version"], home);

  expect(version).toMatchObject({ code: 0, stderr: "" });
  expect(version.stdout).toMatch(/^0\.1\.0\n$/);
});

test("prints readable list, search, and read output without --json", async () => {
  const home = makeHome();
  const created = await runOnlyWrite(
    ["note", "create", "--title", "Readable", "--text", "Plain body", "--json"],
    home,
  );
  const id = (JSON.parse(created.stdout) as { resource: { id: string } }).resource.id;

  const list = await runOnlyWrite(["resource", "list"], home);
  const search = await runOnlyWrite(["resource", "search", "Plain"], home);
  const read = await runOnlyWrite(["resource", "read", id], home);

  expect(list).toMatchObject({ code: 0, stderr: "" });
  expect(list.stdout).toContain("Readable");
  expect(list.stdout).toContain("note");
  expect(search.stdout).toContain("Readable");
  expect(read.stdout).toContain("# Readable");
  expect(read.stdout).toContain("Plain body");
});

test("checks the local installation with doctor", async () => {
  const home = makeHome();

  const doctor = await runOnlyWrite(["doctor"], home);
  const doctorJson = await runOnlyWrite(["doctor", "--json"], home);

  expect(doctor).toMatchObject({ code: 0, stderr: "" });
  expect(doctor.stdout).toContain("OnlyWrite doctor");
  expect(doctor.stdout).toContain("SQLite store: ok");
  expect(doctor.stdout).toContain(home);
  expect(JSON.parse(doctorJson.stdout)).toMatchObject({
    doctor: { database: { ok: true }, home, node: process.version, version: "0.1.0" },
    ok: true,
    schemaVersion: 1,
  });
});

test("built package binary supports help and local store operations", () => {
  const home = makeHome();
  const binary = resolve("dist/cli.mjs");

  const help = execFileSync(process.execPath, [binary, "--help"], {
    cwd: resolve("."),
    encoding: "utf8",
    env: { ...process.env, ONLYWRITE_HOME: home },
  });
  const list = execFileSync(process.execPath, [binary, "resource", "list", "--json"], {
    cwd: resolve("."),
    encoding: "utf8",
    env: { ...process.env, ONLYWRITE_HOME: home },
  });

  expect(help).toContain("OnlyWrite");
  expect(JSON.parse(list)).toMatchObject({ ok: true, resources: [], schemaVersion: 1 });
});

test("built package binary executes through an npm-style symlink", () => {
  const home = makeHome();
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  const link = join(binDir, "onlywrite");
  symlinkSync(resolve("dist/cli.mjs"), link);

  const doctor = execFileSync(link, ["doctor"], {
    cwd: resolve("."),
    encoding: "utf8",
    env: { ...process.env, ONLYWRITE_HOME: home },
  });

  expect(doctor).toContain("OnlyWrite doctor");
  expect(doctor).toContain("SQLite store: ok");
});

test("package manifest is publishable for CLI users", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    files?: string[];
    private?: boolean;
    version?: string;
  };

  expect(manifest.private).not.toBe(true);
  expect(manifest.version).toBe("0.1.0");
  expect(manifest.bin).toEqual({ onlywrite: "dist/cli.mjs" });
  expect((manifest as { engines?: { node?: string } }).engines?.node).toBe(">=22.12.0");
  expect((manifest as { scripts?: { prepack?: string } }).scripts?.prepack).toContain(
    "vp pack src/cli.ts",
  );
  expect(manifest.files).toEqual(["dist", "LICENSE", "README.md", "package.json"]);
  expect(manifest.dependencies?.["better-sqlite3"]).toMatch(/^\^\d+\.\d+\.\d+$/);
});
