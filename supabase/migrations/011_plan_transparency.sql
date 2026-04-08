-- ════════════════════════════════════════════════════
-- Plan Transparency — adaptation approval + original plan storage
-- ════════════════════════════════════════════════════

-- 1. Adaptation approval tracking
ALTER TABLE season_adaptations
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'auto_applied'
    CHECK (approval_status IN ('proposed', 'approved', 'rejected', 'auto_applied', 'partially_approved')),
  ADD COLUMN IF NOT EXISTS proposed_changes_json JSONB,
  ADD COLUMN IF NOT EXISTS readiness_snapshot JSONB;

-- 2. Store original prescription so adaptations can be reverted
ALTER TABLE season_workouts
  ADD COLUMN IF NOT EXISTS original_prescription_json JSONB,
  ADD COLUMN IF NOT EXISTS original_workout_type TEXT,
  ADD COLUMN IF NOT EXISTS original_intensity TEXT;

-- 3. Backfill: set original = current for all workouts
UPDATE season_workouts
SET original_prescription_json = COALESCE(original_prescription_json, prescription_json),
    original_workout_type = COALESCE(original_workout_type, workout_type),
    original_intensity = COALESCE(original_intensity, intensity);
