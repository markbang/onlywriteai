import { serve } from "@hono/node-server";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { createApp } from "./app.ts";
import { validateProductionConfig } from "./app.ts";
import { createDatabase } from "./db/client.ts";
import { loadEnvFile } from "./env.ts";
import { isDevelopmentApiPath } from "./server-paths.ts";

loadEnvFile(new URL("../.env.local", import.meta.url));

const port = Number(process.env.PORT ?? 8787);
const databasePath = process.env.DATABASE_URL ?? "data/onlywrite.sqlite";
const database = createDatabase(databasePath);
const missingConfig = validateProductionConfig();
if (missingConfig.length > 0) {
  console.error(`Missing required production environment variables: ${missingConfig.join(", ")}`);
  process.exit(1);
}

const app = createApp(database.db, { databasePath });
const websiteDist = process.env.WEBSITE_DIST ?? resolve(process.cwd(), "../website/dist");
const apiFetch = app.fetch;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function contentType(path: string) {
  return contentTypes[extname(path)] ?? "application/octet-stream";
}

async function staticResponse(path: string) {
  const body = await readFile(path);
  return new Response(body, {
    headers: {
      "cache-control": path.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-type": contentType(path),
    },
  });
}

function fileForRequest(pathname: string) {
  if (!existsSync(websiteDist)) {
    return null;
  }

  const requested = normalize(pathname).replace(/^\/+/, "");
  const candidate = resolve(websiteDist, requested || "index.html");
  if (relative(websiteDist, candidate).startsWith("..")) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  const indexPath = join(websiteDist, "index.html");
  return existsSync(indexPath) ? indexPath : null;
}

async function fetch(request: Request) {
  const url = new URL(request.url);
  if (!process.env.WEBSITE_DIST && !existsSync(websiteDist)) {
    return apiFetch(request);
  }
  if (url.pathname.startsWith("/api/")) {
    const apiUrl = new URL(request.url);
    apiUrl.pathname = apiUrl.pathname.replace(/^\/api/, "") || "/";
    return apiFetch(new Request(apiUrl, request));
  }
  if (url.pathname === "/health" || url.pathname === "/ready") {
    return apiFetch(request);
  }
  if (process.env.NODE_ENV !== "production" && isDevelopmentApiPath(url.pathname)) {
    return apiFetch(request);
  }

  const file = fileForRequest(url.pathname);
  return file ? staticResponse(file) : apiFetch(request);
}

const server = serve({ fetch, port }, (info) => {
  console.log(`OnlyWrite API listening on http://localhost:${info.port}`);
});

let isShuttingDown = false;

function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
