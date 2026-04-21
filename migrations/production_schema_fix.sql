-- =============================================================================
-- Production Schema Fix — run once on your production database
-- Safe to run multiple times (IF NOT EXISTS guards all statements).
-- =============================================================================
-- Supports:  PostgreSQL (Neon, Supabase, Railway, etc.)
--            MySQL 8.0+ / MariaDB 10.3+ (Hostinger shared hosting)
-- =============================================================================
-- HOW TO USE
-- ----------
-- 1. Identify which database you are using (check DB CONFIG log on startup).
-- 2. Uncomment and run ONLY the section that matches your database.
-- 3. Run the verification SELECT at the bottom to confirm the fix.
-- =============================================================================


-- ┌─────────────────────────────────────────────────────────────────────────────┐
-- │  SECTION A — PostgreSQL (Neon / Supabase / Railway)                         │
-- │  Keyword: NUMERIC   |  IF NOT EXISTS: native                                │
-- └─────────────────────────────────────────────────────────────────────────────┘

-- Run via: Neon dashboard SQL editor, psql, or any PostgreSQL client

ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_female          NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_male            NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_fresher         NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_female_max      NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_male_max        NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS role_configs        TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS city                TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS travel_allowance    TEXT NOT NULL DEFAULT 'not_included';
ALTER TABLE events ADD COLUMN IF NOT EXISTS meals_provided      TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS referral_reward     NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS referral_message    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude            TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude           TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_check_in   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_check_out  TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS late_threshold_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE events ADD COLUMN IF NOT EXISTS break_window_start  TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS break_window_end    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS allowed_break_minutes INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_locked           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_reason       TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_at           TIMESTAMP;


-- ┌─────────────────────────────────────────────────────────────────────────────┐
-- │  SECTION B — MySQL 8.0+ / MariaDB 10.3+  (Hostinger cPanel / phpMyAdmin)   │
-- │  Keyword: DECIMAL   |  IF NOT EXISTS: native on MySQL 8 / MariaDB 10.3+    │
-- └─────────────────────────────────────────────────────────────────────────────┘

-- Uncomment this block if your DATABASE_URL starts with mysql://
/*
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_female          DECIMAL(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_male            DECIMAL(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_fresher         DECIMAL(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_female_max      DECIMAL(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_male_max        DECIMAL(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS role_configs        TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS city                TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS travel_allowance    TEXT NOT NULL DEFAULT 'not_included';
ALTER TABLE events ADD COLUMN IF NOT EXISTS meals_provided      TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS referral_reward     DECIMAL(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS referral_message    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude            TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude           TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_check_in   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_check_out  TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS late_threshold_minutes INT NOT NULL DEFAULT 15;
ALTER TABLE events ADD COLUMN IF NOT EXISTS break_window_start  TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS break_window_end    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS allowed_break_minutes INT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_locked           TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_reason       TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_at           DATETIME;
*/


-- ┌─────────────────────────────────────────────────────────────────────────────┐
-- │  SECTION C — MySQL 5.7  (no native IF NOT EXISTS support)                  │
-- │  Each block checks information_schema before adding the column.             │
-- └─────────────────────────────────────────────────────────────────────────────┘

-- Uncomment this block if your MySQL version is below 8.0
/*
SET @db = DATABASE();

-- pay_female_max
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'events' AND COLUMN_NAME = 'pay_female_max') = 0,
  'ALTER TABLE events ADD COLUMN pay_female_max DECIMAL(10,2)',
  'SELECT "pay_female_max already exists"'
);
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- pay_male_max
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'events' AND COLUMN_NAME = 'pay_male_max') = 0,
  'ALTER TABLE events ADD COLUMN pay_male_max DECIMAL(10,2)',
  'SELECT "pay_male_max already exists"'
);
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- role_configs
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'events' AND COLUMN_NAME = 'role_configs') = 0,
  'ALTER TABLE events ADD COLUMN role_configs TEXT',
  'SELECT "role_configs already exists"'
);
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- is_locked
SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'events' AND COLUMN_NAME = 'is_locked') = 0,
  'ALTER TABLE events ADD COLUMN is_locked TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT "is_locked already exists"'
);
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
*/


-- ┌─────────────────────────────────────────────────────────────────────────────┐
-- │  VERIFICATION — run after whichever section above you chose                 │
-- └─────────────────────────────────────────────────────────────────────────────┘

-- PostgreSQL:
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name   = 'events'
  AND  table_schema = 'public'
  AND  column_name  IN ('pay_female_max', 'pay_male_max', 'role_configs', 'is_locked')
ORDER  BY column_name;

-- MySQL / MariaDB (uncomment if needed):
/*
SELECT COLUMN_NAME, DATA_TYPE
FROM   information_schema.COLUMNS
WHERE  TABLE_SCHEMA = DATABASE()
  AND  TABLE_NAME   = 'events'
  AND  COLUMN_NAME  IN ('pay_female_max', 'pay_male_max', 'role_configs', 'is_locked')
ORDER  BY COLUMN_NAME;
*/

-- Expected: 4 rows returned.
-- If fewer, check the error output above and retry the relevant ALTER statement.
