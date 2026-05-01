import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { loadEnvFile } from "./env.ts";

const tempDirs: string[] = [];

function createTempEnvFile(content: string) {
  const dir = join(tmpdir(), `onlywrite-env-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const path = join(dir, ".env.local");
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("loads env files without overriding existing variables", () => {
  const path = createTempEnvFile(`
    # comment
    LLM_API_KEY=local-key
    LLM_MODEL="local-model"
    EXISTING=from-file
  `);
  const env: NodeJS.ProcessEnv = { EXISTING: "from-process" };

  const loaded = loadEnvFile(path, env);

  expect(loaded).toBe(true);
  expect(env.LLM_API_KEY).toBe("local-key");
  expect(env.LLM_MODEL).toBe("local-model");
  expect(env.EXISTING).toBe("from-process");
});

test("ignores missing env files", () => {
  const env: NodeJS.ProcessEnv = {};

  const loaded = loadEnvFile(join(tmpdir(), `missing-${crypto.randomUUID()}`), env);

  expect(loaded).toBe(false);
  expect(env).toEqual({});
});
