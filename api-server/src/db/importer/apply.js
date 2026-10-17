import { sha256, stableStringify } from '../../lib/hash.js';
import { getLocalWorkspaceId } from '../workspace.js';
import { withTransaction } from '../transaction.js';
import { inspectImportSources } from './preflight.js';

<<<<<<< HEAD
const FINGERPRINT_VERSION = 'file-import-v2-audit-redacted-rechain';
=======
const FINGERPRINT_VERSION = 'file-import-v1';
>>>>>>> origin/main

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
<<<<<<< HEAD
        if (safePathOrName(op[key])) safe[key] = op[key];
      }
      if (op.source && typeof op.source === 'object') {
        safe.source = Object.fromEntries(['type', 'ref'].filter((key) => safeIdentifier(op.source[key])).map((key) => [key, op.source[key]]));
=======
        if (typeof op[key] === 'string') safe[key] = op[key];
      }
      if (op.source && typeof op.source === 'object') {
        safe.source = Object.fromEntries(['type', 'ref'].filter((key) => typeof op.source[key] === 'string').map((key) => [key, op.source[key]]));
>>>>>>> origin/main
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

<<<<<<< HEAD
function safeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) && !/(secret|token|password|credential|apikey)/i.test(value);
}

function safePathOrName(value) {
  return typeof value === 'string' && value.length <= 256
    && /^[A-Za-z0-9_$.[\]{}\/-]+$/.test(value)
    && !/\d{4,}/.test(value)
    && !/(secret|token|password|credential|apikey|authorization|cookie)/i.test(value)
    && !value.startsWith('//');
}

function normalizeAuditRecords(sourceRecords) {
  let previousHash = null;
  const redactedCounts = { records: 0, fields: 0 };
  const records = sourceRecords.map((source, sequence) => {
    const removed = new Set();
    const record = {
      index: sequence,
      ts: new Date(source.ts).toISOString(),
      prevHash: previousHash,
      decision: safeIdentifier(source.decision) ? source.decision : 'legacy_decision_redacted',
      sourceIndex: source.index,
      sourcePreviousHash: source.prevHash,
      sourceHash: source.hash,
    };
    if (!safeIdentifier(source.decision)) {
      record.sourceDecisionHash = sha256(String(source.decision));
      removed.add('decision');
    }
    for (const key of ['apiId', 'tool', 'callId', 'healId']) {
      if (source[key] === undefined) continue;
      if (safeIdentifier(source[key])) record[key] = source[key];
      else removed.add(key);
    }
    for (const key of ['versionBefore', 'versionAfter', 'tier', 'rounds', 'latencyMs']) {
      if (source[key] === undefined) continue;
      if (Number.isSafeInteger(source[key]) && source[key] >= 0) record[key] = source[key];
      else removed.add(key);
    }
    if (source.confidence !== undefined) {
      if (typeof source.confidence === 'number' && Number.isFinite(source.confidence) && source.confidence >= 0 && source.confidence <= 1) record.confidence = source.confidence;
      else removed.add('confidence');
    }
    if (typeof source.responseOnly === 'boolean') record.responseOnly = source.responseOnly;
    else if (source.responseOnly !== undefined) removed.add('responseOnly');
    if (source.reason !== undefined) {
      if (safeIdentifier(source.reason)) record.reason = source.reason;
      else {
        record.reason = 'redacted_reason';
        record.sourceReasonHash = sha256(String(source.reason));
        removed.add('reason');
      }
    }
    if (Array.isArray(source.ops)) {
      record.ops = source.ops.map((operation) => {
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) { removed.add('ops'); return { op: 'unknown' }; }
        const safe = {};
        for (const key of ['op', 'type', 'name', 'path', 'from', 'to']) {
          if (operation[key] === undefined) continue;
          if (safePathOrName(operation[key])) safe[key] = operation[key];
          else removed.add(`ops.${key}`);
        }
        if (operation.source && typeof operation.source === 'object' && !Array.isArray(operation.source)) {
          const sourceInfo = {};
          if (safeIdentifier(operation.source.type)) sourceInfo.type = operation.source.type;
          if (safeIdentifier(operation.source.ref)) sourceInfo.ref = operation.source.ref;
          if (Object.keys(operation.source).some((key) => !['type', 'ref'].includes(key))
            || Object.values(operation.source).some((value) => !safeIdentifier(value))) removed.add('ops.source');
          if (Object.keys(sourceInfo).length) safe.source = sourceInfo;
        } else if (operation.source !== undefined) removed.add('ops.source');
        for (const key of Object.keys(operation)) if (!['op', 'type', 'name', 'path', 'from', 'to', 'source'].includes(key)) removed.add(`ops.${key}`);
        return safe;
      });
    } else if (source.ops !== undefined) removed.add('ops');
    if (source.evidence !== undefined) {
      record.evidenceCount = Array.isArray(source.evidence) ? source.evidence.length : 1;
      removed.add('evidence');
    }
    for (const key of Object.keys(source)) {
      if (!['index', 'ts', 'prevHash', 'hash', 'decision', 'apiId', 'tool', 'callId', 'healId',
        'versionBefore', 'versionAfter', 'tier', 'rounds', 'latencyMs', 'confidence', 'responseOnly', 'reason', 'ops', 'evidence'].includes(key)) {
        removed.add(key);
      }
    }
    if (removed.size) {
      record.redactedFields = [...removed].sort();
      redactedCounts.records += 1;
      redactedCounts.fields += removed.size;
    }
    record.hash = sha256(stableStringify(record));
    previousHash = record.hash;
    return record;
  });
  return { records, redactedCounts };
}

=======
>>>>>>> origin/main
async function assertDatabaseEmpty(client, workspaceId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM apis WHERE workspace_id = $1) AS apis,
<<<<<<< HEAD
       (SELECT count(*) FROM api_credentials WHERE workspace_id = $1) AS credentials,
       (SELECT count(*) FROM tools WHERE workspace_id = $1) AS tools,
=======
>>>>>>> origin/main
       (SELECT count(*) FROM adapter_versions WHERE workspace_id = $1) AS versions,
       (SELECT count(*) FROM audit_entries WHERE workspace_id = $1) AS audit_entries,
       (SELECT count(*) FROM invocations WHERE workspace_id = $1) AS invocations,
       (SELECT count(*) FROM gateway_events WHERE workspace_id = $1) AS events,
       (SELECT count(*) FROM service_logs WHERE workspace_id = $1) AS service_logs,
<<<<<<< HEAD
       (SELECT count(*) FROM patch_candidates WHERE workspace_id = $1) AS patch_candidates,
       (SELECT count(*) FROM metric_buckets WHERE workspace_id = $1) AS metric_buckets,
=======
>>>>>>> origin/main
       (SELECT count(*) FROM file_imports WHERE workspace_id = $1) AS imports`,
    [workspaceId],
  );
  if (Object.values(rows[0]).some((count) => BigInt(count) !== 0n)) {
    const error = new Error('Database already contains workspace data; refusing to merge a file snapshot');
    error.code = 'database_not_empty_for_import';
    throw error;
  }
}

<<<<<<< HEAD
export async function applyFileImport({ pool, report = inspectImportSources({ includeData: true }), allowAuditRedactionAndRechain = false } = {}) {
  if (!report.sourceData) throw new Error('Import preflight data is required');
  if (report.sourceData.auditBackupPresent) {
    const error = new Error('Audit backup is present but is not selected as an authoritative source; refusing to omit it');
    error.code = 'audit_backup_source_unselected';
    throw error;
  }
  if ((report.counts.auditEntriesRequiringRedaction > 0 || report.counts.changeEntriesRequiringRedaction > 0 || !report.auditIntegrity?.ok) && !allowAuditRedactionAndRechain) {
    const error = new Error('Legacy audit or adapter change material requires the explicit redaction and rechain policy');
=======
export async function applyFileImport({ pool, report = inspectImportSources({ includeData: true }) } = {}) {
  if (!report.sourceData) throw new Error('Import preflight data is required');
  if (report.counts.auditEntriesRequiringRedaction > 0) {
    const error = new Error('Audit source contains evidence or value fields that require an explicit redaction and rechain decision');
>>>>>>> origin/main
    error.code = 'audit_redaction_decision_required';
    throw error;
  }
  const fingerprint = sourceFingerprint(report.sourceChecksums);
  return withTransaction(async (client) => {
    const workspaceId = await getLocalWorkspaceId(client);
    await client.query(`LOCK TABLE apis, api_credentials, tools, adapter_versions, audit_entries,
      invocations, gateway_events, service_logs, file_imports IN ACCESS EXCLUSIVE MODE`);
    const { rows: existingImports } = await client.query(
<<<<<<< HEAD
      'SELECT source_fingerprint, imported_counts FROM file_imports WHERE workspace_id = $1 FOR UPDATE', [workspaceId],
    );
    if (existingImports[0]) {
      if (existingImports[0].source_fingerprint === fingerprint) {
        return {
          ok: true, alreadyImported: true, fingerprint, counts: existingImports[0].imported_counts,
          auditSourceIntegrity: report.auditIntegrity,
        };
=======
      'SELECT source_fingerprint FROM file_imports WHERE workspace_id = $1 FOR UPDATE', [workspaceId],
    );
    if (existingImports[0]) {
      if (existingImports[0].source_fingerprint === fingerprint) {
        return { ok: true, alreadyImported: true, fingerprint, counts: report.counts };
>>>>>>> origin/main
      }
      const error = new Error('A different file snapshot was already imported into this workspace');
      error.code = 'different_file_import_already_applied';
      throw error;
    }
    await assertDatabaseEmpty(client, workspaceId);

<<<<<<< HEAD
    const { registry } = report.sourceData;
    const requiresAuditRewrite = report.counts.auditEntriesRequiringRedaction > 0 || !report.auditIntegrity?.ok;
    const normalizedAudit = requiresAuditRewrite
      ? normalizeAuditRecords(report.sourceData.auditRecords)
      : { records: report.sourceData.auditRecords, redactedCounts: { records: 0, fields: 0 } };
    const { records: auditRecords, redactedCounts } = normalizedAudit;
    const auditHashFormatVersion = requiresAuditRewrite ? 2 : 1;
=======
    const { registry, auditRecords } = report.sourceData;
>>>>>>> origin/main
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
<<<<<<< HEAD
              JSON.stringify(version.meta), safeChange(version.change) === null ? null : JSON.stringify(safeChange(version.change)), adapterHash,
=======
              JSON.stringify(version.meta), JSON.stringify(safeChange(version.change)), adapterHash,
>>>>>>> origin/main
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
<<<<<<< HEAD
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14)`,
        [workspaceId, record.index, new Date(record.ts), record.decision, record.callId ?? null,
          record.apiId ?? null, record.tool ?? null, record.versionAfter ?? record.versionBefore ?? null,
          record.reason ?? null, JSON.stringify(record), record.prevHash, record.hash, JSON.stringify(record), auditHashFormatVersion],
=======
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, 1)`,
        [workspaceId, record.index, new Date(record.ts), record.decision, record.callId ?? null,
          record.apiId ?? null, record.tool ?? null, record.versionAfter ?? record.version ?? null,
          record.reason ?? null, JSON.stringify(record), record.prevHash, record.hash, JSON.stringify(record)],
>>>>>>> origin/main
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
<<<<<<< HEAD
    const importedCounts = {
      ...report.counts,
      redactedAuditRecords: redactedCounts.records,
      redactedAuditFields: redactedCounts.fields,
      rehashedAuditRecords: requiresAuditRewrite ? auditRecords.length : 0,
      adapterHashes: normalizedVersions.length,
      auditHashFormatVersion,
    };
    await client.query(
      `INSERT INTO file_imports(workspace_id, source_fingerprint, source_manifest, imported_counts)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [workspaceId, fingerprint, JSON.stringify({
        ...report.sourceChecksums, auditIntegrity: report.auditIntegrity,
        auditPolicy: requiresAuditRewrite ? 'redact-and-rechain-v2' : 'preserve-legacy-v1',
        importerVersion: FINGERPRINT_VERSION, schemaVersion: (await client.query('SELECT max(version) AS version FROM schema_migrations')).rows[0].version,
        sourceAuditHead: report.sourceData.auditHead,
      }), JSON.stringify(importedCounts)],
    );
    return {
      ok: true, alreadyImported: false, fingerprint, counts: importedCounts,
      auditSourceIntegrity: report.auditIntegrity,
      auditPolicy: requiresAuditRewrite ? 'redact-and-rechain-v2' : 'preserve-legacy-v1',
    };
=======
    await client.query(
      `INSERT INTO file_imports(workspace_id, source_fingerprint, source_manifest, imported_counts)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [workspaceId, fingerprint, JSON.stringify(report.sourceChecksums), JSON.stringify({ ...report.counts, adapterHashes: normalizedVersions.length })],
    );
    return { ok: true, alreadyImported: false, fingerprint, counts: report.counts };
>>>>>>> origin/main
  }, { pool });
}
