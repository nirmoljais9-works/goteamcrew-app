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
function needsSsl(url?: string): boolean {
  if (!url) return false;
  if (process.env.DB_SSL === "true")  return true;
  if (process.env.DB_SSL === "false") return false;
  const lower = url.toLowerCase();
  if (/[?&]sslmode=(require|verify-ca|verify-full)/.test(lower)) return true;
  if (/[?&]sslmode=disable/.test(lower)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".neon.tech"))      return true;
    if (host.endsWith(".supabase.co"))    return true;
    if (host.endsWith(".amazonaws.com"))  return true;
    if (host.endsWith(".azure.com"))      return true;
  } catch {}
  return false;
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

function decimalType(): string {
  return dialect === "mysql" ? "DECIMAL(10,2)" : "NUMERIC(10,2)";
}

// ── Schema sync ───────────────────────────────────────────────────────────────

/**
 * ensureTables()
 *
 * Runs on EVERY server start — development and production alike.
 * Idempotent: uses IF NOT EXISTS everywhere — safe to run any number of times.
 * Never drops or modifies existing columns or tables.
 */
export async function ensureTables(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[db] Skipping schema sync — DATABASE_URL not set");
    return;
  }

  console.log("[db] Running schema sync…");
  try {
    await pool.query("SELECT 1");
    console.log("[db] DB connected");
  } catch (err: any) {
    console.error("[db] DB connection failed:", err?.message);
    throw err;
  }

  const dec = decimalType();

  // Helper: ALTER TABLE … ADD COLUMN IF NOT EXISTS, swallowing "already exists"
  async function addCol(table: string, col: string, def: string): Promise<"added" | "exists" | "failed"> {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`);
      return "added";
    } catch (err: any) {
      // MySQL 5.7 doesn't support IF NOT EXISTS — ER_DUP_FIELDNAME means ok
      if (err?.code === "ER_DUP_FIELDNAME" || err?.message?.includes("Duplicate column name")) {
        return "exists";
      }
      console.error(`[db] Failed to add ${table}.${col}:`, err?.message);
      return "failed";
    }
  }

  // Helper: read all column names for a table in one round-trip
  async function existingCols(table: string): Promise<Set<string>> {
    try {
      const q = dialect === "mysql"
        ? `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
        : `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`;
      const { rows } = await pool.query<{ column_name: string }>(q);
      return new Set(rows.map(r => r.column_name));
    } catch {
      return new Set();
    }
  }

  let added = 0;
  let skipped = 0;
  let failed = 0;

  async function syncTable(
    table: string,
    cols: Array<{ col: string; def: string }>,
  ): Promise<void> {
    const existing = await existingCols(table);
    for (const { col, def } of cols) {
      if (existing.has(col)) {
        console.log(`[db] Column already exists: ${table}.${col}`);
        skipped++;
        continue;
      }
      const result = await addCol(table, col, def);
      if (result === "added") {
        console.log(`[db] Column added: ${table}.${col}`);
        added++;
      } else if (result === "exists") {
        console.log(`[db] Column already exists: ${table}.${col}`);
        skipped++;
      } else {
        failed++;
      }
    }
  }

  // ── uploaded_files table ──────────────────────────────────────────────────
  try {
    const idCol = dialect === "mysql" ? "id INT AUTO_INCREMENT PRIMARY KEY" : "id SERIAL PRIMARY KEY";
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

  // ── attendance_breaks table ───────────────────────────────────────────────
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_breaks (
        id           SERIAL PRIMARY KEY,
        claim_id     INTEGER NOT NULL REFERENCES shift_claims(id),
        start_at     TIMESTAMP NOT NULL,
        end_at       TIMESTAMP,
        duration_minutes INTEGER,
        is_outside_window BOOLEAN NOT NULL DEFAULT false,
        lat          TEXT,
        lng          TEXT,
        photo_url    TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[db] Table ready: attendance_breaks");
  } catch (err: any) {
    console.error("[db] Failed to ensure attendance_breaks table:", err?.message);
  }

  // ── events columns ────────────────────────────────────────────────────────
  await syncTable("events", [
    { col: "pay_female",             def: dec },
    { col: "pay_male",               def: dec },
    { col: "pay_fresher",            def: dec },
    { col: "pay_female_max",         def: dec },
    { col: "pay_male_max",           def: dec },
    { col: "role_configs",           def: "TEXT" },
    { col: "city",                   def: "TEXT" },
    { col: "travel_allowance",       def: "TEXT NOT NULL DEFAULT 'not_included'" },
    { col: "meals_provided",         def: "TEXT" },
    { col: "referral_reward",        def: dec },
    { col: "referral_message",       def: "TEXT" },
    { col: "latitude",               def: "TEXT" },
    { col: "longitude",              def: "TEXT" },
    { col: "expected_check_in",      def: "TEXT" },
    { col: "expected_check_out",     def: "TEXT" },
    { col: "late_threshold_minutes", def: "INTEGER NOT NULL DEFAULT 15" },
    { col: "break_window_start",     def: "TEXT" },
    { col: "break_window_end",       def: "TEXT" },
    { col: "allowed_break_minutes",  def: "INTEGER" },
    { col: "is_locked",              def: "BOOLEAN NOT NULL DEFAULT false" },
    { col: "locked_reason",          def: "TEXT" },
    { col: "locked_at",              def: "TIMESTAMP" },
  ]);

  // ── crew_profiles columns ─────────────────────────────────────────────────
  await syncTable("crew_profiles", [
    { col: "wallet_balance",            def: `${dec} NOT NULL DEFAULT 0` },
    { col: "withdrawal_count",          def: "INTEGER NOT NULL DEFAULT 0" },
    { col: "last_withdrawn_at",         def: "TIMESTAMP" },
    { col: "successful_referrals",      def: "INTEGER NOT NULL DEFAULT 0" },
    { col: "temp_approved",             def: "BOOLEAN NOT NULL DEFAULT false" },
    { col: "heard_about_us",            def: "TEXT" },
    { col: "portfolio_photos",          def: "TEXT" },
    { col: "photo_quality",             def: "TEXT" },
    { col: "intro_video_url",           def: "TEXT" },
    { col: "intro_video_quality",       def: "TEXT" },
    { col: "has_pending_changes",       def: "BOOLEAN NOT NULL DEFAULT false" },
    { col: "pending_changes_status",    def: "TEXT" },
    { col: "admin_message",             def: "TEXT" },
    { col: "id_type",                   def: "TEXT" },
    { col: "college_id_url",            def: "TEXT" },
    { col: "pending_pay_holder_name",   def: "TEXT" },
    { col: "pending_pay_bank_name",     def: "TEXT" },
    { col: "pending_pay_branch_name",   def: "TEXT" },
    { col: "pending_pay_account_number",def: "TEXT" },
    { col: "pending_pay_ifsc_code",     def: "TEXT" },
    { col: "pending_pay_upi_id",        def: "TEXT" },
    { col: "pending_pan_number",        def: "TEXT" },
    { col: "pending_pan_card_url",      def: "TEXT" },
    { col: "pending_bank_account",      def: "TEXT" },
    { col: "pending_name",              def: "TEXT" },
    { col: "pending_city",              def: "TEXT" },
    { col: "pending_languages",         def: "TEXT" },
    { col: "pending_experience",        def: "TEXT" },
    { col: "pending_category",          def: "TEXT" },
  ]);

  // ── shifts columns ────────────────────────────────────────────────────────
  await syncTable("shifts", [
    { col: "applications_open",     def: "BOOLEAN NOT NULL DEFAULT true" },
    { col: "payment_type",          def: "TEXT" },
    { col: "dress_code",            def: "TEXT" },
    { col: "grooming_instructions", def: "TEXT" },
  ]);

  // ── shift_claims columns ──────────────────────────────────────────────────
  await syncTable("shift_claims", [
    { col: "check_out_at",          def: "TIMESTAMP" },
    { col: "check_out_status",      def: "TEXT" },
    { col: "break_start_at",        def: "TIMESTAMP" },
    { col: "break_end_at",          def: "TIMESTAMP" },
    { col: "total_break_minutes",   def: "INTEGER NOT NULL DEFAULT 0" },
    { col: "break_exceeded",        def: "BOOLEAN NOT NULL DEFAULT false" },
    { col: "check_out_lat",         def: "TEXT" },
    { col: "check_out_lng",         def: "TEXT" },
    { col: "check_out_photo_url",   def: "TEXT" },
    { col: "attendance_date",       def: "TEXT" },
    { col: "attendance_approved",   def: "BOOLEAN" },
    { col: "approved_pay",          def: dec },
    { col: "is_override",           def: "BOOLEAN NOT NULL DEFAULT false" },
    { col: "override_reason",       def: "TEXT" },
    { col: "distance_from_event",   def: dec },
    { col: "applied_roles",         def: "TEXT" },
    { col: "assigned_role",         def: "TEXT" },
    { col: "withdrawal_reason",     def: "TEXT" },
  ]);

  // ── referrals columns ─────────────────────────────────────────────────────
  await syncTable("referrals", [
    { col: "referred_phone", def: "TEXT" },
    { col: "reward_paid",    def: "TEXT NOT NULL DEFAULT 'no'" },
  ]);

  // ── enum value additions (PostgreSQL only) ────────────────────────────────
  if (dialect === "postgres") {
    const enumAdditions: Array<{ enumName: string; value: string }> = [
      { enumName: "user_status",     value: "resubmitted" },
      { enumName: "user_status",     value: "removed" },
      { enumName: "event_status",    value: "draft" },
      { enumName: "event_status",    value: "archived" },
      { enumName: "claim_status",    value: "revoked" },
      { enumName: "referral_status", value: "selected" },
      { enumName: "referral_status", value: "confirmed" },
      { enumName: "referral_status", value: "pending_approval" },
      { enumName: "referral_status", value: "paid" },
    ];

    for (const { enumName, value } of enumAdditions) {
      try {
        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum e
              JOIN pg_type t ON e.enumtypid = t.oid
              WHERE t.typname = '${enumName}' AND e.enumlabel = '${value}'
            ) THEN
              ALTER TYPE ${enumName} ADD VALUE '${value}';
            END IF;
          END$$;
        `);
      } catch (err: any) {
        console.warn(`[db] Could not add enum value ${enumName}.${value}:`, err?.message);
      }
    }
    console.log("[db] Enum values synced");
  }

  if (failed === 0) {
    console.log(
      `[db] Schema sync complete — ` +
      `${added} added, ${skipped} already existed`,
    );
  } else {
    console.error(
      `[db] Schema sync finished with errors — ` +
      `${added} added, ${skipped} skipped, ${failed} FAILED`,
    );
  }
}
