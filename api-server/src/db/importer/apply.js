import { sha256, stableStringify } from '../../lib/hash.js';
import { getLocalWorkspaceId } from '../workspace.js';
import { withTransaction } from '../transaction.js';
import { inspectImportSources } from './preflight.js';

const FINGERPRINT_VERSION = 'file-import-v1';

function sourceFingerprint(checksums) {
  return sha256(stableStringify({ version: FINGERPRINT_VERSION, checksums }));
}

function safeChange(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
  const out = {};
  for (const key of ['tier', 'confidence', 'rounds', 'responseOnly', 'verified', 'ms']) {
    if (change[key] !== undefined && ['string', 'number', 'boolean'].includes(typeof change[key])) out[key] = change[key];
  }
  if (Array.isArray(change.ops)) {
    out.ops = change.ops.map((op) => {
      if (!op || typeof op !== 'object' || Array.isArray(op)) return { op: 'unknown' };
      const safe = {};
      for (const key of ['op', 'path', 'from', 'to', 'type', 'name']) {
        if (typeof op[key] === 'string') safe[key] = op[key];
      }
      if (op.source && typeof op.source === 'object') {
        safe.source = Object.fromEntries(['type', 'ref'].filter((key) => typeof op.source[key] === 'string').map((key) => [key, op.source[key]]));
      }
      return safe;
    });
  }
  if (change.evidence !== undefined) out.evidenceCount = Array.isArray(change.evidence) ? change.evidence.length : 1;
  return out;
}

function safeApiConfig(config) {
  const { baseUrl: _baseUrl, specUrl: _specUrl, credentials: _credentials, ...options } = config;
  return options;
}

async function assertDatabaseEmpty(client, workspaceId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM apis WHERE workspace_id = $1) AS apis,
       (SELECT count(*) FROM adapter_versions WHERE workspace_id = $1) AS versions,
       (SELECT count(*) FROM audit_entries WHERE workspace_id = $1) AS audit_entries,
       (SELECT count(*) FROM invocations WHERE workspace_id = $1) AS invocations,
       (SELECT count(*) FROM gateway_events WHERE workspace_id = $1) AS events,
       (SELECT count(*) FROM service_logs WHERE workspace_id = $1) AS service_logs,
       (SELECT count(*) FROM file_imports WHERE workspace_id = $1) AS imports`,
    [workspaceId],
  );
  if (Object.values(rows[0]).some((count) => BigInt(count) !== 0n)) {
    const error = new Error('Database already contains workspace data; refusing to merge a file snapshot');
    error.code = 'database_not_empty_for_import';
    throw error;
  }
}

export async function applyFileImport({ pool, report = inspectImportSources({ includeData: true }) } = {}) {
  if (!report.sourceData) throw new Error('Import preflight data is required');
  if (report.counts.auditEntriesRequiringRedaction > 0) {
    const error = new Error('Audit source contains evidence or value fields that require an explicit redaction and rechain decision');
    error.code = 'audit_redaction_decision_required';
    throw error;
  }
  const fingerprint = sourceFingerprint(report.sourceChecksums);
  return withTransaction(async (client) => {
    const workspaceId = await getLocalWorkspaceId(client);
    await client.query(`LOCK TABLE apis, api_credentials, tools, adapter_versions, audit_entries,
      invocations, gateway_events, service_logs, file_imports IN ACCESS EXCLUSIVE MODE`);
    const { rows: existingImports } = await client.query(
      'SELECT source_fingerprint FROM file_imports WHERE workspace_id = $1 FOR UPDATE', [workspaceId],
    );
    if (existingImports[0]) {
      if (existingImports[0].source_fingerprint === fingerprint) {
        return { ok: true, alreadyImported: true, fingerprint, counts: report.counts };
      }
      const error = new Error('A different file snapshot was already imported into this workspace');
      error.code = 'different_file_import_already_applied';
      throw error;
    }
    await assertDatabaseEmpty(client, workspaceId);

    const { registry, auditRecords } = report.sourceData;
    const normalizedVersions = [];
    for (const [apiId, api] of Object.entries(registry)) {
      const { baseUrl, specUrl, credentials = {}, ...configOptions } = api.config;
      await client.query(
        `INSERT INTO apis(workspace_id, api_id, base_url, spec_url, config, epoch, config_revision, credential_revision)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1, 1)`,
        [workspaceId, apiId, baseUrl, specUrl ?? null, JSON.stringify(safeApiConfig({ ...configOptions })), api.epoch ?? 1],
      );
      for (const [credentialRef, source] of Object.entries(credentials)) {
        await client.query(
          `INSERT INTO api_credentials(workspace_id, api_id, credential_ref, source_kind, source_ref)
           VALUES ($1, $2, $3, 'env', $4)`,
          [workspaceId, apiId, credentialRef, source.env],
        );
      }
      for (const [toolName, entry] of Object.entries(api.tools)) {
        const current = entry.versions.find((item) => item.version === entry.current.version);
        if (!current) throw new Error(`Current adapter missing during import: ${apiId}/${toolName}`);
        const risk = entry.risk ?? current.meta.risk ?? 'low';
        const sideEffects = current.meta.sideEffects ?? current.adapter.sideEffects ?? 'write';
        await client.query(
          `INSERT INTO tools(workspace_id, api_id, tool_name, current_version, risk, side_effects)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workspaceId, apiId, toolName, current.version, risk, sideEffects],
        );
        for (const version of entry.versions) {
          const adapter = version.adapter;
          const adapterHash = sha256(stableStringify(adapter));
          const origin = version.origin ?? 'register';
          await client.query(
            `INSERT INTO adapter_versions
             (workspace_id, api_id, tool_name, version, api_epoch, parent_version, rollback_of, origin,
              adapter, metadata, change, adapter_hash, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13)`,
            [workspaceId, apiId, toolName, version.version, version.apiEpoch ?? api.epoch ?? 1,
              version.parent ?? null, version.rollbackOf ?? null, origin, JSON.stringify(adapter),
              JSON.stringify(version.meta), JSON.stringify(safeChange(version.change)), adapterHash,
              new Date(version.createdAt)],
          );
          normalizedVersions.push(adapterHash);
        }
      }
    }

    for (const record of auditRecords) {
      await client.query(
        `INSERT INTO audit_entries
         (workspace_id, sequence, recorded_at, decision, call_id, api_id, tool_name, version, reason,
          details, previous_hash, record_hash, canonical_record, hash_format_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, 1)`,
        [workspaceId, record.index, new Date(record.ts), record.decision, record.callId ?? null,
          record.apiId ?? null, record.tool ?? null, record.versionAfter ?? record.version ?? null,
          record.reason ?? null, JSON.stringify(record), record.prevHash, record.hash, JSON.stringify(record)],
      );
    }
    if (auditRecords.length) {
      const tail = auditRecords.at(-1);
      await client.query(
        `UPDATE audit_heads SET last_sequence = $2, last_hash = $3, updated_at = now() WHERE workspace_id = $1`,
        [workspaceId, tail.index, tail.hash],
      );
    }
    const finalReport = inspectImportSources();
    if (sourceFingerprint(finalReport.sourceChecksums) !== fingerprint) {
      const error = new Error('Import source files changed while the import transaction was running');
      error.code = 'import_source_changed';
      throw error;
    }
    await client.query(
      `INSERT INTO file_imports(workspace_id, source_fingerprint, source_manifest, imported_counts)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [workspaceId, fingerprint, JSON.stringify(report.sourceChecksums), JSON.stringify({ ...report.counts, adapterHashes: normalizedVersions.length })],
    );
    return { ok: true, alreadyImported: false, fingerprint, counts: report.counts };
  }, { pool });
}
