import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createDatabase } from "./db/client.ts";

const port = Number(process.env.PORT ?? 8787);
const databasePath = process.env.DATABASE_URL ?? "data/onlywrite.sqlite";
const database = createDatabase(databasePath);
const app = createApp(database.db);

const server = serve({ fetch: app.fetch, port }, (info) => {
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
