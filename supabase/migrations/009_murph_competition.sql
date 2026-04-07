-- ════════════════════════════════════════════════════
-- Murph Competition & Leaderboard
-- ════════════════════════════════════════════════════

-- ── User Profiles (lightweight display names for leaderboard) ──

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own profile"
  ON user_profiles FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Profiles are publicly readable"
  ON user_profiles FOR SELECT
  USING (TRUE);

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Murph Attempts ──

CREATE TABLE murph_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Master timer
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  total_time_seconds NUMERIC,

  -- Mile 1 (Garmin match)
  mile1_garmin_activity_id BIGINT,
  mile1_start_at TIMESTAMPTZ,
  mile1_end_at TIMESTAMPTZ,
  mile1_time_seconds NUMERIC,
  mile1_distance_meters NUMERIC,
  mile1_avg_pace TEXT,
  mile1_avg_hr INTEGER,

  -- Mile 2 (Garmin match)
  mile2_garmin_activity_id BIGINT,
  mile2_start_at TIMESTAMPTZ,
  mile2_end_at TIMESTAMPTZ,
  mile2_time_seconds NUMERIC,
  mile2_distance_meters NUMERIC,
  mile2_avg_pace TEXT,
  mile2_avg_hr INTEGER,

  -- Bodyweight (CV tracker)
  pullups_completed INTEGER DEFAULT 0,
  pushups_completed INTEGER DEFAULT 0,
  squats_completed INTEGER DEFAULT 0,
  cv_session_data JSONB,

  -- Status
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'verified', 'abandoned')),

  -- Leaderboard
  submitted_to_leaderboard BOOLEAN DEFAULT FALSE,

  -- Phase timestamps (for UX flow)
  mile1_completed_at TIMESTAMPTZ,
  exercises_completed_at TIMESTAMPTZ,
  mile2_started_at TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE murph_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own attempts"
  ON murph_attempts FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view leaderboard entries"
  ON murph_attempts FOR SELECT
  USING (submitted_to_leaderboard = TRUE AND status IN ('completed', 'verified'));

CREATE TRIGGER update_murph_attempts_updated_at
  BEFORE UPDATE ON murph_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for leaderboard queries
CREATE INDEX idx_murph_leaderboard
  ON murph_attempts (submitted_to_leaderboard, status, total_time_seconds)
  WHERE submitted_to_leaderboard = TRUE AND status IN ('completed', 'verified');

-- Index for user's attempts
CREATE INDEX idx_murph_user_attempts
  ON murph_attempts (user_id, created_at DESC);
