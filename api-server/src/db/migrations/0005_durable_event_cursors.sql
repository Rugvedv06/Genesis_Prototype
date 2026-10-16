CREATE TABLE gateway_event_cursors (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  retention_floor bigint NOT NULL DEFAULT 0 CHECK (retention_floor >= 0),
  last_committed_id bigint NOT NULL DEFAULT 0 CHECK (last_committed_id >= retention_floor),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO gateway_event_cursors(workspace_id)
  SELECT id FROM workspaces WHERE slug = 'local' ON CONFLICT DO NOTHING;
