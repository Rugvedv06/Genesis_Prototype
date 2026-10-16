CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE CHECK (length(trim(slug)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
INSERT INTO workspaces(slug) VALUES ('local') ON CONFLICT (slug) DO NOTHING;

CREATE TABLE apis (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), api_id text NOT NULL CHECK (length(trim(api_id)) > 0),
  base_url text NOT NULL, spec_url text, config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  epoch integer NOT NULL DEFAULT 1 CHECK (epoch > 0), config_revision integer NOT NULL DEFAULT 1 CHECK (config_revision > 0),
  credential_revision integer NOT NULL DEFAULT 1 CHECK (credential_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  PRIMARY KEY(workspace_id, api_id)
);
CREATE TABLE api_credentials (
  workspace_id uuid NOT NULL, api_id text NOT NULL, credential_ref text NOT NULL CHECK (length(trim(credential_ref)) > 0),
  source_kind text NOT NULL CHECK (source_kind IN ('env','secret_manager')), source_ref text NOT NULL CHECK (length(trim(source_ref)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, api_id, credential_ref),
  FOREIGN KEY(workspace_id, api_id) REFERENCES apis(workspace_id, api_id)
);
CREATE TABLE tools (
  workspace_id uuid NOT NULL, api_id text NOT NULL, tool_name text NOT NULL CHECK (length(trim(tool_name)) > 0),
  current_version integer NOT NULL CHECK (current_version > 0), risk text NOT NULL CHECK (risk IN ('low','medium','high','critical')),
  side_effects text NOT NULL CHECK (side_effects IN ('read','write')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, api_id, tool_name), FOREIGN KEY(workspace_id, api_id) REFERENCES apis(workspace_id, api_id)
);
CREATE TABLE adapter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, api_id text NOT NULL, tool_name text NOT NULL,
  version integer NOT NULL CHECK(version > 0), parent_version integer, rollback_of integer,
  origin text NOT NULL CHECK(origin IN ('register','heal','manual_rollback','watchdog_rollback','import')),
  adapter jsonb NOT NULL CHECK(jsonb_typeof(adapter) = 'object'), metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata) = 'object'),
  change jsonb CHECK(change IS NULL OR jsonb_typeof(change) = 'object'),
  adapter_hash char(64) NOT NULL CHECK(adapter_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, api_id, tool_name, version),
  FOREIGN KEY(workspace_id, api_id, tool_name) REFERENCES tools(workspace_id, api_id, tool_name),
  CHECK(parent_version IS NULL OR parent_version < version), CHECK(rollback_of IS NULL OR rollback_of < version),
  FOREIGN KEY(workspace_id, api_id, tool_name, parent_version) REFERENCES adapter_versions(workspace_id, api_id, tool_name, version) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(workspace_id, api_id, tool_name, rollback_of) REFERENCES adapter_versions(workspace_id, api_id, tool_name, version) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE tools ADD CONSTRAINT tools_current_version_fk FOREIGN KEY(workspace_id, api_id, tool_name, current_version)
  REFERENCES adapter_versions(workspace_id, api_id, tool_name, version) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION reject_adapter_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'adapter_versions are immutable'; END; $$;
CREATE TRIGGER adapter_versions_immutable BEFORE UPDATE OR DELETE ON adapter_versions FOR EACH ROW EXECUTE FUNCTION reject_adapter_version_mutation();

CREATE TABLE invocations (
  call_id text PRIMARY KEY, run_id text, workspace_id uuid NOT NULL REFERENCES workspaces(id), api_id text, tool_name text,
  started_at timestamptz NOT NULL, finished_at timestamptz, outcome text NOT NULL CHECK(outcome IN ('running','succeeded','healed','halted','rejected','failed')),
  initial_version integer, final_version integer, http_status integer, error_code text, halt_reason text, healing_mode text, tier text,
  rounds integer NOT NULL DEFAULT 0 CHECK(rounds >= 0), duration_ms integer CHECK(duration_ms IS NULL OR duration_ms >= 0),
  cache_hit boolean NOT NULL DEFAULT false, input_tokens integer NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK(output_tokens >= 0), summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary) = 'object'),
  CHECK(finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX invocations_workspace_started_idx ON invocations(workspace_id, started_at DESC);
CREATE INDEX invocations_api_started_idx ON invocations(workspace_id, api_id, tool_name, started_at DESC);
CREATE INDEX invocations_outcome_started_idx ON invocations(workspace_id, outcome, started_at DESC);
CREATE TABLE gateway_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_id text NOT NULL UNIQUE, call_id text REFERENCES invocations(call_id), run_id text,
  workspace_id uuid NOT NULL REFERENCES workspaces(id), api_id text, tool_name text, event_type text NOT NULL,
  occurred_at timestamptz NOT NULL, sequence_in_call integer, payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  UNIQUE(call_id, sequence_in_call)
);
CREATE INDEX gateway_events_replay_idx ON gateway_events(workspace_id, id);
CREATE INDEX gateway_events_call_idx ON gateway_events(workspace_id, call_id, sequence_in_call);
CREATE INDEX gateway_events_type_idx ON gateway_events(workspace_id, event_type, occurred_at DESC);
CREATE TABLE audit_heads (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), last_sequence bigint NOT NULL DEFAULT -1 CHECK(last_sequence >= -1),
  last_hash char(64), updated_at timestamptz NOT NULL DEFAULT now(), CHECK((last_sequence = -1) = (last_hash IS NULL))
);
INSERT INTO audit_heads(workspace_id) SELECT id FROM workspaces WHERE slug = 'local' ON CONFLICT DO NOTHING;
CREATE TABLE audit_entries (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), sequence bigint NOT NULL CHECK(sequence >= 0), recorded_at timestamptz NOT NULL,
  decision text NOT NULL, call_id text, api_id text, tool_name text, version integer, reason text, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash char(64), record_hash char(64) NOT NULL CHECK(record_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(workspace_id, sequence), UNIQUE(workspace_id, record_hash)
);
CREATE TABLE patch_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), cache_key char(64) NOT NULL,
  scope text NOT NULL CHECK(scope IN ('exact','convention')), source_api_id text NOT NULL, source_tool_name text NOT NULL, source_version integer NOT NULL,
  adapter_fingerprint char(64) NOT NULL, schema_fingerprint char(64) NOT NULL, operation_signature text NOT NULL,
  operations jsonb NOT NULL, evidence_class text NOT NULL, evidence_summary jsonb NOT NULL, provenance_requirements jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('verified','invalidated')), verified_at timestamptz NOT NULL, invalidated_at timestamptz,
  use_count bigint NOT NULL DEFAULT 0 CHECK(use_count >= 0), last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, cache_key)
);
CREATE INDEX patch_candidates_lookup_idx ON patch_candidates(workspace_id, state, scope, use_count DESC);
CREATE INDEX patch_candidates_source_idx ON patch_candidates(workspace_id, source_api_id, source_tool_name);
CREATE TABLE metric_buckets (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), bucket_start timestamptz NOT NULL, bucket_seconds integer NOT NULL CHECK(bucket_seconds > 0),
  api_id text NOT NULL DEFAULT '', tool_name text NOT NULL DEFAULT '', requests bigint NOT NULL DEFAULT 0 CHECK(requests >= 0),
  successes bigint NOT NULL DEFAULT 0 CHECK(successes >= 0), healed bigint NOT NULL DEFAULT 0 CHECK(healed >= 0), halts bigint NOT NULL DEFAULT 0 CHECK(halts >= 0),
  rejects bigint NOT NULL DEFAULT 0 CHECK(rejects >= 0), cache_hits bigint NOT NULL DEFAULT 0 CHECK(cache_hits >= 0), token_count bigint NOT NULL DEFAULT 0 CHECK(token_count >= 0),
  duration_histogram jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, bucket_start, bucket_seconds, api_id, tool_name)
);
CREATE TABLE service_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(),
  service text NOT NULL CHECK(service IN ('api-server','api-client','demo-server','demo-client')), level text NOT NULL CHECK(level IN ('info','warn','error','fatal')),
  code text NOT NULL, message text NOT NULL, workspace_id uuid REFERENCES workspaces(id), call_id text, run_id text, api_id text, tool_name text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(context) = 'object')
);
CREATE INDEX service_logs_time_idx ON service_logs(occurred_at DESC);
CREATE INDEX service_logs_service_time_idx ON service_logs(service, occurred_at DESC);
CREATE INDEX service_logs_level_time_idx ON service_logs(level, occurred_at DESC);
