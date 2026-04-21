import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error(
    "[db] WARNING: DATABASE_URL is not set — database queries will fail at runtime. " +
      "Set it in your hosting environment variables.",
  );
}

// ── Dialect detection ─────────────────────────────────────────────────────────
export type DbDialect = "postgres" | "mysql" | "unknown";

export function detectDialect(url?: string): DbDialect {
  if (!url) return "unknown";
  const lower = url.toLowerCase();
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) return "postgres";
  if (lower.startsWith("mysql://") || lower.startsWith("mysql2://")) return "mysql";
  return "unknown";
}

export const dialect: DbDialect = detectDialect(process.env.DATABASE_URL);

// ── SSL detection ─────────────────────────────────────────────────────────────
// SSL is needed for managed cloud databases (Neon, Supabase, RDS) but NOT
// for a local PostgreSQL installation on the same VPS.
// Detection order:
//   1. DB_SSL=true  env var → force SSL on
//   2. DB_SSL=false env var → force SSL off
//   3. URL contains sslmode=require or sslmode=verify-* → SSL on
//   4. URL contains sslmode=disable → SSL off
//   5. URL hostname ends with .neon.tech / .supabase.co / .amazonaws.com → SSL on
//   6. Everything else (localhost, 127.0.0.1, VPS local install) → no SSL
function needsSsl(url?: string): boolean {
  if (!url) return false;

  // Explicit env override always wins
  if (process.env.DB_SSL === "true")  return true;
  if (process.env.DB_SSL === "false") return false;

  const lower = url.toLowerCase();

  // Explicit sslmode in URL
  if (/[?&]sslmode=(require|verify-ca|verify-full)/.test(lower)) return true;
  if (/[?&]sslmode=disable/.test(lower)) return false;

  // Well-known cloud providers that always require SSL
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".neon.tech"))      return true;
    if (host.endsWith(".supabase.co"))    return true;
    if (host.endsWith(".amazonaws.com"))  return true;
    if (host.endsWith(".azure.com"))      return true;
  } catch {}

  return false; // local VPS PostgreSQL — no SSL needed
}

const sslConfig = needsSsl(process.env.DATABASE_URL)
  ? { rejectUnauthorized: false }
  : false;

console.log(`[db] SSL: ${sslConfig ? "enabled" : "disabled"}`);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
});
export const db = drizzle(pool, { schema });

export * from "./schema";

// ── Dialect-aware type helpers ────────────────────────────────────────────────

/** NUMERIC(10,2) for PostgreSQL / DECIMAL(10,2) for MySQL — identical precision */
function decimalType(): string {
  return dialect === "mysql" ? "DECIMAL(10,2)" : "NUMERIC(10,2)";
}

// ── Schema sync ───────────────────────────────────────────────────────────────

/**
 * ensureTables()
 *
 * Runs on EVERY server start — development and production alike.
 * Must be awaited before app.listen() so the server never accepts requests
 * against a stale schema.
 *
 * What it does:
 *  1. Verifies the DB connection ("DB connected")
 *  2. Creates helper tables that may be missing on a fresh deployment
 *  3. Reads current events columns once from information_schema
 *  4. For each expected column:
 *       - already present → logs "Column already exists: <col>"
 *       - missing         → runs ALTER TABLE, logs "Column added: <col>"
 *  5. Logs a final pass/fail summary
 *
 * Idempotent: safe to run any number of times; never drops or modifies
 * existing columns.
 */
export async function ensureTables(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[db] Skipping schema sync — DATABASE_URL not set");
    return;
  }

  // ── 1. Connection check ───────────────────────────────────────────────────
  console.log("[db] Running schema sync…");
  try {
    await pool.query("SELECT 1");
    console.log("[db] DB connected");
  } catch (err: any) {
    console.error("[db] DB connection failed:", err?.message);
    throw err; // let the caller decide whether to abort startup
  }

  // ── 2. uploaded_files table ───────────────────────────────────────────────
  try {
    const idCol = dialect === "mysql"
      ? "id INT AUTO_INCREMENT PRIMARY KEY"
      : "id SERIAL PRIMARY KEY";
    await pool.query(`
      CREATE TABLE IF NOT EXISTS uploaded_files (
        ${idCol},
        data_b64     TEXT NOT NULL,
        content_type TEXT NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    console.log("[db] Table ready: uploaded_files");
  } catch (err: any) {
    console.error("[db] Failed to ensure uploaded_files table:", err?.message);
  }

  // ── 3. Read existing events columns in one round-trip ────────────────────
  const dec = decimalType();

  /** All columns the events table must have, with their SQL type. */
  const required: Array<{ col: string; def: string }> = [
    { col: "pay_female",              def: dec },
    { col: "pay_male",                def: dec },
    { col: "pay_fresher",             def: dec },
    { col: "pay_female_max",          def: dec },
    { col: "pay_male_max",            def: dec },
    { col: "role_configs",            def: "TEXT" },
    { col: "city",                    def: "TEXT" },
    { col: "travel_allowance",        def: "TEXT NOT NULL DEFAULT 'not_included'" },
    { col: "meals_provided",          def: "TEXT" },
    { col: "referral_reward",         def: dec },
    { col: "referral_message",        def: "TEXT" },
    { col: "latitude",                def: "TEXT" },
    { col: "longitude",               def: "TEXT" },
    { col: "expected_check_in",       def: "TEXT" },
    { col: "expected_check_out",      def: "TEXT" },
    { col: "late_threshold_minutes",  def: "INTEGER NOT NULL DEFAULT 15" },
    { col: "break_window_start",      def: "TEXT" },
    { col: "break_window_end",        def: "TEXT" },
    { col: "allowed_break_minutes",   def: "INTEGER" },
    { col: "is_locked",               def: "BOOLEAN NOT NULL DEFAULT false" },
    { col: "locked_reason",           def: "TEXT" },
    { col: "locked_at",               def: "TIMESTAMP" },
  ];

  // Fetch existing columns once (avoids N round-trips)
  let existing: Set<string> = new Set();
  try {
    const colList = required.map(r => `'${r.col}'`).join(", ");
    const query = dialect === "mysql"
      ? `SELECT column_name FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'events'
           AND column_name IN (${colList})`
      : `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'events'
           AND column_name IN (${colList})`;

    const { rows } = await pool.query<{ column_name: string }>(query);
    existing = new Set(rows.map(r => r.column_name));
  } catch (err: any) {
    // If events table doesn't exist yet drizzle-kit will create it;
    // we can't check columns — skip per-column logging and fall through.
    console.warn("[db] Could not read existing events columns:", err?.message);
  }

  // ── 4. Apply missing columns ──────────────────────────────────────────────
  const added:  string[] = [];
  const skipped: string[] = [];
  const failed:  string[] = [];

  for (const { col, def } of required) {
    if (existing.has(col)) {
      console.log(`[db] Column already exists: ${col}`);
      skipped.push(col);
      continue;
    }

    // Column is missing — add it
    const ifNotExists = dialect === "mysql" ? "" : "IF NOT EXISTS ";
    const sql = `ALTER TABLE events ADD COLUMN ${ifNotExists}${col} ${def}`;
    try {
      await pool.query(sql);
      console.log(`[db] Column added: ${col}`);
      added.push(col);
    } catch (err: any) {
      // MySQL 5.7: no native IF NOT EXISTS — error 1060 means column already exists
      const alreadyExists =
        err?.code === "ER_DUP_FIELDNAME" ||
        (typeof err?.message === "string" && err.message.includes("Duplicate column name"));

      if (alreadyExists) {
        console.log(`[db] Column already exists: ${col}`);
        skipped.push(col);
      } else {
        console.error(`[db] Column FAILED: ${col} —`, err?.message);
        failed.push(col);
      }
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  if (failed.length === 0) {
    console.log(
      `[db] Schema sync complete — ` +
      `${added.length} added, ${skipped.length} already existed` +
      (added.length ? ` (added: ${added.join(", ")})` : ""),
    );
  } else {
    console.error(
      `[db] Schema sync finished with errors — ` +
      `${added.length} added, ${skipped.length} skipped, ` +
      `FAILED: ${failed.join(", ")}`,
    );
  }
}
