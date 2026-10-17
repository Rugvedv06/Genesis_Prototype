ALTER TABLE patch_candidates
  ADD COLUMN IF NOT EXISTS adapter jsonb,
  ADD COLUMN IF NOT EXISTS rollout_state text NOT NULL DEFAULT 'promoted'
    CHECK (rollout_state IN ('candidate', 'regression_verified', 'shadow', 'canary', 'promoted', 'rejected', 'rolled_back')),
  ADD COLUMN IF NOT EXISTS rollout_reason text,
  ADD COLUMN IF NOT EXISTS rollout_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

CREATE INDEX IF NOT EXISTS patch_candidates_rollout_idx
  ON patch_candidates(workspace_id, rollout_state, updated_at DESC);
