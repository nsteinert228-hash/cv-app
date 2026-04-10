-- Enhanced scoring: extract training effect from activities.raw_json
-- into dedicated columns for use by the matcher scoring engine.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS aerobic_training_effect real,
  ADD COLUMN IF NOT EXISTS anaerobic_training_effect real,
  ADD COLUMN IF NOT EXISTS training_effect_label text;

-- Backfill from existing raw_json
UPDATE activities
SET aerobic_training_effect = (raw_json->>'aerobicTrainingEffect')::real,
    anaerobic_training_effect = (raw_json->>'anaerobicTrainingEffect')::real,
    training_effect_label = raw_json->>'aerobicTrainingEffectMessage'
WHERE raw_json IS NOT NULL
  AND aerobic_training_effect IS NULL;
