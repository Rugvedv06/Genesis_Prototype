DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'healr_runtime') THEN
    CREATE ROLE healr_runtime NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO healr_runtime;
GRANT SELECT ON workspaces, schema_migrations TO healr_runtime;
GRANT SELECT, INSERT, UPDATE ON apis, api_credentials, tools TO healr_runtime;
GRANT DELETE ON api_credentials TO healr_runtime;
GRANT SELECT, INSERT ON adapter_versions TO healr_runtime;
GRANT SELECT, INSERT, UPDATE ON invocations TO healr_runtime;
GRANT SELECT, INSERT, DELETE ON gateway_events TO healr_runtime;
GRANT SELECT, INSERT, UPDATE ON gateway_event_cursors TO healr_runtime;
GRANT SELECT, INSERT ON audit_entries TO healr_runtime;
GRANT SELECT, UPDATE (last_sequence, last_hash, updated_at) ON audit_heads TO healr_runtime;
GRANT SELECT, INSERT ON file_imports TO healr_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON patch_candidates, metric_buckets TO healr_runtime;
GRANT SELECT, INSERT, DELETE ON service_logs TO healr_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healr_runtime;
