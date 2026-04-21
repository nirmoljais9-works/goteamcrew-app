-- Goteamcrew full database schema for Neon
-- Run this in the Neon Console SQL Editor

-- ENUMS (safe create — skips if already exists)
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'crew'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_status AS ENUM ('pending', 'approved', 'rejected', 'active', 'blacklisted', 'removed', 'resubmitted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE event_status AS ENUM ('upcoming', 'ongoing', 'completed', 'cancelled', 'draft', 'archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE shift_status AS ENUM ('open', 'claimed', 'approved', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE claim_status AS ENUM ('pending', 'approved', 'rejected', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'paid', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE referral_status AS ENUM ('pending', 'joined', 'successful', 'selected', 'confirmed', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'crew',
  status user_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- CREW PROFILES
CREATE TABLE IF NOT EXISTS crew_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  phone TEXT NOT NULL,
  city TEXT,
  age INTEGER,
  gender TEXT,
  category TEXT,
  custom_role TEXT,
  experience_level TEXT,
  languages TEXT,
  height TEXT,
  skills TEXT,
  experience TEXT,
  emergency_contact TEXT,
  bank_account TEXT,
  instagram_url TEXT,
  pay_holder_name TEXT,
  pay_bank_name TEXT,
  pay_branch_name TEXT,
  pay_account_number TEXT,
  pay_ifsc_code TEXT,
  pay_upi_id TEXT,
  pan_number TEXT,
  pan_card_url TEXT,
  pending_pay_holder_name TEXT,
  pending_pay_bank_name TEXT,
  pending_pay_branch_name TEXT,
  pending_pay_account_number TEXT,
  pending_pay_ifsc_code TEXT,
  pending_pay_upi_id TEXT,
  pending_pan_number TEXT,
  pending_pan_card_url TEXT,
  pending_bank_account TEXT,
  pending_name TEXT,
  pending_city TEXT,
  pending_languages TEXT,
  pending_experience TEXT,
  pending_category TEXT,
  heard_about_us TEXT,
  portfolio_photos TEXT,
  photo_quality TEXT,
  intro_video_url TEXT,
  intro_video_quality TEXT,
  has_pending_changes BOOLEAN NOT NULL DEFAULT FALSE,
  pending_changes_status TEXT,
  admin_message TEXT,
  blacklist_reason TEXT,
  rejection_reason TEXT,
  id_type TEXT,
  aadhaar_card_url TEXT,
  college_id_url TEXT,
  close_up_photo_url TEXT,
  full_length_photo_url TEXT,
  total_earnings NUMERIC(10,2) NOT NULL DEFAULT '0',
  completed_shifts INTEGER NOT NULL DEFAULT 0,
  wallet_balance NUMERIC(10,2) NOT NULL DEFAULT '0',
  total_referrals INTEGER NOT NULL DEFAULT 0,
  successful_referrals INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT crew_phone_unique UNIQUE (phone)
);

-- EVENTS
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  city TEXT,
  location TEXT NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  status event_status NOT NULL DEFAULT 'upcoming',
  client_name TEXT,
  role TEXT,
  gender_required TEXT,
  work_task TEXT,
  pay_per_day NUMERIC(10,2),
  pay_female NUMERIC(10,2),
  pay_male NUMERIC(10,2),
  pay_fresher NUMERIC(10,2),
  timings TEXT,
  dress_code TEXT,
  dress_code_image TEXT,
  food_provided BOOLEAN NOT NULL DEFAULT FALSE,
  meals_provided TEXT,
  travel_allowance TEXT NOT NULL DEFAULT 'not_included',
  incentives TEXT,
  referral_reward NUMERIC(10,2),
  referral_message TEXT,
  total_slots INTEGER NOT NULL DEFAULT 10,
  total_shifts INTEGER NOT NULL DEFAULT 0,
  filled_shifts INTEGER NOT NULL DEFAULT 0,
  expected_check_in TEXT,
  expected_check_out TEXT,
  late_threshold_minutes INTEGER NOT NULL DEFAULT 15,
  break_window_start TEXT,
  break_window_end TEXT,
  allowed_break_minutes INTEGER,
  latitude TEXT,
  longitude TEXT,
  role_configs TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_reason TEXT,
  locked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- SHIFTS
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  role TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT '0',
  total_pay NUMERIC(10,2) NOT NULL DEFAULT '0',
  spots_total INTEGER NOT NULL DEFAULT 1,
  spots_filled INTEGER NOT NULL DEFAULT 0,
  status shift_status NOT NULL DEFAULT 'open',
  requirements TEXT,
  gender_preference TEXT,
  experience_required TEXT,
  payment_type TEXT,
  dress_code TEXT,
  grooming_instructions TEXT,
  applications_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- SHIFT CLAIMS
CREATE TABLE IF NOT EXISTS shift_claims (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  crew_id INTEGER NOT NULL,
  status claim_status NOT NULL DEFAULT 'pending',
  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP,
  checked_in_at TIMESTAMP,
  check_in_lat TEXT,
  check_in_lng TEXT,
  selfie_image TEXT,
  is_absent BOOLEAN NOT NULL DEFAULT FALSE,
  check_in_status TEXT,
  check_out_at TIMESTAMP,
  check_out_status TEXT,
  break_start_at TIMESTAMP,
  break_end_at TIMESTAMP,
  total_break_minutes INTEGER NOT NULL DEFAULT 0,
  break_exceeded BOOLEAN NOT NULL DEFAULT FALSE,
  check_out_lat TEXT,
  check_out_lng TEXT,
  check_out_photo_url TEXT,
  attendance_date TEXT,
  attendance_approved BOOLEAN,
  approved_pay NUMERIC(10,2),
  is_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  distance_from_event NUMERIC(10,2),
  applied_roles TEXT,
  assigned_role TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  crew_id INTEGER NOT NULL,
  shift_claim_id INTEGER REFERENCES shift_claims(id),
  amount NUMERIC(10,2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- REFERRALS
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  referrer_id INTEGER NOT NULL REFERENCES crew_profiles(id),
  referred_user_id INTEGER REFERENCES users(id),
  referred_phone TEXT,
  referral_code TEXT NOT NULL,
  status referral_status NOT NULL DEFAULT 'pending',
  reward_amount NUMERIC(10,2),
  reward_paid TEXT NOT NULL DEFAULT 'no',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ATTENDANCE BREAKS
CREATE TABLE IF NOT EXISTS attendance_breaks (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES shift_claims(id),
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP,
  duration_minutes INTEGER,
  is_outside_window BOOLEAN NOT NULL DEFAULT FALSE,
  lat TEXT,
  lng TEXT,
  photo_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- SESSIONS (for express-session / connect-pg-simple)
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions (expire);

-- ADMIN USER (login: nirmol@goteamcrew.com / Hr51bd7491@)
INSERT INTO users (email, password_hash, name, role, status)
VALUES (
  'nirmol@goteamcrew.com',
  '$2b$10$cw2t1e0mKH8JDqn75UeOvuZpA4SLIrzT6kT3A08YYKgvh5M/3vl32',
  'Agency Admin',
  'admin',
  'active'
) ON CONFLICT (email) DO NOTHING;
