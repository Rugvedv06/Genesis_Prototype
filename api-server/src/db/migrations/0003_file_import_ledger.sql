ALTER TABLE adapter_versions DROP CONSTRAINT adapter_versions_origin_check;
ALTER TABLE adapter_versions ADD CONSTRAINT adapter_versions_origin_check
  CHECK (origin IN ('register','heal','manual_rollback','watchdog_rollback','import','rollback','dev'));

CREATE TABLE file_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id),
  source_fingerprint char(64) NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_manifest) = 'object'),
  imported_counts jsonb NOT NULL CHECK (jsonb_typeof(imported_counts) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now()
);
