ALTER TABLE invocations
  ADD COLUMN IF NOT EXISTS token_usage jsonb NOT NULL DEFAULT '{}'::jsonb;
