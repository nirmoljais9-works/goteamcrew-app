-- ============================================================
-- Goteamcrew VPS schema migration
-- Safe to run multiple times — uses IF NOT EXISTS everywhere.
-- Run as: psql $DATABASE_URL -f migration_vps.sql
-- ============================================================

-- ── Enum value additions ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_status' AND e.enumlabel = 'resubmitted')
  THEN ALTER TYPE user_status ADD VALUE 'resubmitted'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_status' AND e.enumlabel = 'removed')
  THEN ALTER TYPE user_status ADD VALUE 'removed'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'event_status' AND e.enumlabel = 'draft')
  THEN ALTER TYPE event_status ADD VALUE 'draft'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'event_status' AND e.enumlabel = 'archived')
  THEN ALTER TYPE event_status ADD VALUE 'archived'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'revoked')
  THEN ALTER TYPE claim_status ADD VALUE 'revoked'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'referral_status' AND e.enumlabel = 'selected')
  THEN ALTER TYPE referral_status ADD VALUE 'selected'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'referral_status' AND e.enumlabel = 'confirmed')
  THEN ALTER TYPE referral_status ADD VALUE 'confirmed'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'referral_status' AND e.enumlabel = 'pending_approval')
  THEN ALTER TYPE referral_status ADD VALUE 'pending_approval'; END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'referral_status' AND e.enumlabel = 'paid')
  THEN ALTER TYPE referral_status ADD VALUE 'paid'; END IF;
END$$;

-- ── attendance_breaks table (may not exist at all) ───────────
CREATE TABLE IF NOT EXISTS attendance_breaks (
  id                SERIAL PRIMARY KEY,
  claim_id          INTEGER NOT NULL REFERENCES shift_claims(id),
  start_at          TIMESTAMP NOT NULL,
  end_at            TIMESTAMP,
  duration_minutes  INTEGER,
  is_outside_window BOOLEAN NOT NULL DEFAULT false,
  lat               TEXT,
  lng               TEXT,
  photo_url         TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── events — newer columns ────────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_female             NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_male               NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_fresher            NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_female_max         NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS pay_male_max           NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS role_configs           TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS city                   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS travel_allowance       TEXT NOT NULL DEFAULT 'not_included';
ALTER TABLE events ADD COLUMN IF NOT EXISTS meals_provided         TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS referral_reward        NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS referral_message       TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude               TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude              TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_check_in      TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_check_out     TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS late_threshold_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE events ADD COLUMN IF NOT EXISTS break_window_start     TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS break_window_end       TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS allowed_break_minutes  INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_locked              BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_reason          TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_at              TIMESTAMP;

-- ── crew_profiles — newer columns ────────────────────────────
-- CRITICAL: temp_approved is selected directly in /api/auth/me
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS temp_approved              BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS wallet_balance             NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS withdrawal_count           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS last_withdrawn_at          TIMESTAMP;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS successful_referrals       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS heard_about_us             TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS portfolio_photos           TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS photo_quality              TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS intro_video_url            TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS intro_video_quality        TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS has_pending_changes        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_changes_status     TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS admin_message              TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS id_type                    TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS college_id_url             TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pay_holder_name    TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pay_bank_name      TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pay_branch_name    TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pay_account_number TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pay_ifsc_code      TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pay_upi_id         TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pan_number         TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_pan_card_url       TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_bank_account       TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_name               TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_city               TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_languages          TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_experience         TEXT;
ALTER TABLE crew_profiles ADD COLUMN IF NOT EXISTS pending_category           TEXT;

-- ── shifts — newer columns ────────────────────────────────────
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS applications_open      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS payment_type           TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS dress_code             TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS grooming_instructions  TEXT;

-- ── shift_claims — newer columns ──────────────────────────────
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS check_out_at         TIMESTAMP;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS check_out_status     TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS break_start_at       TIMESTAMP;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS break_end_at         TIMESTAMP;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS total_break_minutes  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS break_exceeded       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS check_out_lat        TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS check_out_lng        TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS check_out_photo_url  TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS attendance_date      TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS attendance_approved  BOOLEAN;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS approved_pay         NUMERIC(10,2);
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS is_override          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS override_reason      TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS distance_from_event  NUMERIC(10,2);
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS applied_roles        TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS assigned_role        TEXT;
ALTER TABLE shift_claims ADD COLUMN IF NOT EXISTS withdrawal_reason    TEXT;

-- ── referrals — newer columns ─────────────────────────────────
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_phone TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reward_paid    TEXT NOT NULL DEFAULT 'no';

-- ── Done ──────────────────────────────────────────────────────
SELECT 'Migration complete' AS status;
