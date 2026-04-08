-- ════════════════════════════════════════════════════
-- User Profile Enhancements for Unified Profile Panel
-- ════════════════════════════════════════════════════

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS member_since DATE,
  ADD COLUMN IF NOT EXISTS preferred_weight_unit TEXT DEFAULT 'lbs'
    CHECK (preferred_weight_unit IN ('lbs', 'kg')),
  ADD COLUMN IF NOT EXISTS preferred_distance_unit TEXT DEFAULT 'mi'
    CHECK (preferred_distance_unit IN ('mi', 'km'));

-- Backfill member_since from auth.users.created_at
UPDATE user_profiles p
SET member_since = (SELECT u.created_at::date FROM auth.users u WHERE u.id = p.user_id)
WHERE member_since IS NULL;
