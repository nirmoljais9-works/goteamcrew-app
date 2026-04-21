import app from "./app";
import { ensureTables, dialect } from "@workspace/db";

// ── Production environment checks ─────────────────────────────────────────────
// Fail fast with a clear message rather than silently misbehaving.
if (process.env.NODE_ENV === "production") {
  if (!process.env.DATABASE_URL) {
    console.error("[startup] FATAL: DATABASE_URL is not set. Set it in your .env or hosting environment.");
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET) {
    console.error("[startup] FATAL: SESSION_SECRET is not set. Set a long random string in your .env or hosting environment.");
    process.exit(1);
  }
}

const port = Number(process.env["PORT"] ?? "3000");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// Log DB config (mask password)
const rawUrl = process.env.DATABASE_URL || "(not set)";
const maskedUrl = rawUrl.replace(/:([^:@]+)@/, ":***@");
console.log("DB CONFIG:", maskedUrl);
console.log(`[db] Dialect: ${dialect}`);

// ── Global crash guards ────────────────────────────────────────────────────────
// Prevent the process from silently dying on unhandled errors.
// PM2 will restart the process if it exits, but logging here makes debugging easier.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] Unhandled exception — process will exit:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] Unhandled promise rejection — process will exit:", reason);
  process.exit(1);
});

// ── Startup ───────────────────────────────────────────────────────────────────
// Block startup until schema is fully in sync.
// No requests are accepted until every required column exists.
async function main() {
  try {
    await ensureTables();
  } catch (err: any) {
    console.error("[startup] Schema sync failed — server will NOT start:", err?.message);
    process.exit(1);
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
  });
}

main();
