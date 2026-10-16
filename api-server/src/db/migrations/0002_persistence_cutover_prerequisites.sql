ALTER TABLE tools ADD COLUMN deleted_at timestamptz;

ALTER TABLE adapter_versions
  ADD COLUMN api_epoch integer NOT NULL DEFAULT 1 CHECK (api_epoch > 0);

ALTER TABLE invocations DROP CONSTRAINT invocations_outcome_check;
ALTER TABLE invocations ADD CONSTRAINT invocations_outcome_check
  CHECK (outcome IN ('running','succeeded','healed','halted','rejected','failed','outcome_uncertain'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit_entries LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot add canonical audit records to a non-empty table without an explicit verified backfill';
  END IF;
END;
$$;

ALTER TABLE audit_entries
  ADD COLUMN canonical_record jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(canonical_record) = 'object'),
  ADD COLUMN hash_format_version smallint NOT NULL DEFAULT 1 CHECK (hash_format_version > 0);

CREATE FUNCTION reject_audit_entry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_entries are append-only'; END; $$;
CREATE TRIGGER audit_entries_immutable BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION reject_audit_entry_mutation();

CREATE INDEX service_logs_call_idx ON service_logs(call_id) WHERE call_id IS NOT NULL;
CREATE INDEX service_logs_run_idx ON service_logs(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX service_logs_api_tool_time_idx ON service_logs(api_id, tool_name, occurred_at DESC)
  WHERE api_id IS NOT NULL;
