import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
<<<<<<< HEAD
import { validateAdapterForStorage } from '../registry-repository.js';
=======
<<<<<<< HEAD
import { validateAdapterForStorage } from '../registry-repository.js';
=======
import { compileAdapter } from '../../features/registry/compile.js';
>>>>>>> origin/main
>>>>>>> origin/main
import { sha256, stableStringify } from '../../lib/hash.js';
import { resolveDataDir } from '../../lib/data-dir.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function validateSafeConfig(value, apiId, path = 'config') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(credential|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|^token$)/i.test(key)) {
      fail('registry_config_contains_secret_field', { apiId, field: `${path}.${key}` });
    }
    validateSafeConfig(child, apiId, `${path}.${key}`);
  }
}

function normalizeLegacyVersion(version) {
  const normalized = structuredClone(version);
  if (!normalized.meta && normalized.adapter?._path) {
    normalized.meta = {
      path: normalized.adapter._path,
      method: normalized.adapter._method ?? 'POST',
      logicalSchema: normalized.adapter._logicalSchema,
      risk: 'low',
      sideEffects: normalized.adapter.sideEffects ?? 'write',
      identity: {},
    };
    const { _path, _method, _logicalSchema, ...adapter } = normalized.adapter;
    normalized.adapter = adapter;
  }
  return normalized;
}

function validateCredentialReferences(credentials, apiId) {
  if (credentials === undefined) return;
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) fail('invalid_credential_references', { apiId });
  for (const [alias, source] of Object.entries(credentials)) {
    if (!alias.trim() || !source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).length !== 1 || typeof source.env !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.env)) {
      fail('invalid_credential_references', { apiId, credentialAlias: alias });
    }
  }
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
function validateApiConfig(config, apiId) {
  const failConfig = (field) => fail('registry_api_config_invalid', { apiId, field });
  if (config.confidenceThreshold !== undefined && (typeof config.confidenceThreshold !== 'number'
    || !Number.isFinite(config.confidenceThreshold) || config.confidenceThreshold < 0 || config.confidenceThreshold > 1)) failConfig('confidenceThreshold');
  if (config.maxRounds !== undefined && (!Number.isInteger(config.maxRounds) || config.maxRounds < 1 || config.maxRounds > 20)) failConfig('maxRounds');
  if (config.tier2 !== undefined && typeof config.tier2 !== 'boolean') failConfig('tier2');
  const healing = config.healing;
  if (healing === undefined) return;
  if (!healing || typeof healing !== 'object' || Array.isArray(healing)) failConfig('healing');
  if (healing.enabled !== undefined && typeof healing.enabled !== 'boolean') failConfig('healing.enabled');
  if (healing.mode !== undefined && !['enforce', 'log', 'off'].includes(healing.mode)) failConfig('healing.mode');
  if (healing.maxRounds !== undefined && (!Number.isInteger(healing.maxRounds) || healing.maxRounds < 1 || healing.maxRounds > 20)) failConfig('healing.maxRounds');
  if (healing.timeoutMs !== undefined && (!Number.isInteger(healing.timeoutMs) || healing.timeoutMs < 100 || healing.timeoutMs > 60_000)) failConfig('healing.timeoutMs');
  if (healing.confidenceThreshold !== undefined && (typeof healing.confidenceThreshold !== 'number'
    || !Number.isFinite(healing.confidenceThreshold) || healing.confidenceThreshold < 0 || healing.confidenceThreshold > 1)) failConfig('healing.confidenceThreshold');
  if (healing.tier2 !== undefined && typeof healing.tier2 !== 'boolean') failConfig('healing.tier2');
}

function verifyAuditBytes(text, headText) {
  const records = [];
  let firstChainFailure;
  let firstChainFailureReasons;
<<<<<<< HEAD
=======
=======
function verifyAuditBytes(text, headText) {
  const records = [];
>>>>>>> origin/main
>>>>>>> origin/main
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); }
    catch { fail('audit_malformed_json', { index: records.length, line: lineIndex + 1 }); }
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !Number.isSafeInteger(record.index) || record.index < 0
      || typeof record.ts !== 'string' || Number.isNaN(Date.parse(record.ts))
      || typeof record.decision !== 'string' || !record.decision
      || !(record.prevHash === null || (typeof record.prevHash === 'string' && /^[a-f0-9]{64}$/i.test(record.prevHash)))
      || typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(record.hash)) {
      fail('audit_malformed_record', { index: records.length, line: lineIndex + 1 });
    }
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
    for (const key of ['apiId', 'tool', 'callId', 'healId']) {
      if (record[key] !== undefined && record[key] !== null && typeof record[key] !== 'string') {
        fail('audit_malformed_record', { index: records.length, line: lineIndex + 1, field: key });
      }
    }
    for (const key of ['version', 'versionBefore', 'versionAfter']) {
      if (record[key] !== undefined && record[key] !== null && (!Number.isSafeInteger(record[key]) || record[key] < 1)) {
        fail('audit_malformed_record', { index: records.length, line: lineIndex + 1, field: key });
      }
    }
    const expected = sha256(stableStringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'))));
    const reasons = [
      ...(record.index !== records.length ? ['sequence_mismatch'] : []),
      ...(record.hash !== expected ? ['record_hash_mismatch'] : []),
      ...(record.prevHash !== (records.at(-1)?.hash ?? null) ? ['previous_hash_mismatch'] : []),
    ];
    if (firstChainFailure === undefined && reasons.length) {
      firstChainFailure = records.length;
      firstChainFailureReasons = reasons;
<<<<<<< HEAD
=======
=======
    const expected = sha256(stableStringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'))));
    if (record.index !== records.length || record.hash !== expected
      || record.prevHash !== (records.at(-1)?.hash ?? null)) {
      fail('audit_chain_invalid', { index: records.length });
>>>>>>> origin/main
>>>>>>> origin/main
    }
    records.push(record);
  }

  let head = null;
  if (headText !== null) {
    try { head = JSON.parse(headText); } catch { fail('audit_head_malformed'); }
    if (!head || typeof head !== 'object' || !Number.isSafeInteger(head.index) || head.index < 0
      || typeof head.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(head.hash)) fail('audit_head_malformed');
    const tail = records.at(-1);
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
    if (!tail || head.index !== tail.index || head.hash !== tail.hash) {
      if (firstChainFailure === undefined) {
        firstChainFailure = records.length;
        firstChainFailureReasons = ['head_mismatch'];
      }
    }
  }
  if (records.length && headText === null && firstChainFailure === undefined) firstChainFailure = records.length;
  if (!records.length && headText !== null) {
    if (firstChainFailure === undefined) {
      firstChainFailure = 0;
      firstChainFailureReasons = ['head_without_records'];
    }
  }
  if (records.length && headText === null && firstChainFailure === records.length) firstChainFailureReasons = ['missing_head_anchor'];
  return { records, head, integrity: {
    ok: firstChainFailure === undefined, firstFailureAt: firstChainFailure,
    ...(firstChainFailureReasons ? { firstFailureReasons: firstChainFailureReasons } : {}),
  } };
<<<<<<< HEAD
=======
=======
    if (!tail || head.index !== tail.index || head.hash !== tail.hash) fail('audit_head_mismatch');
  }
  if (!records.length && headText !== null) fail('audit_head_without_records');
  return { records, head };
>>>>>>> origin/main
>>>>>>> origin/main
}

function hasUnsafeAuditMaterial(value, key = '') {
  if (/(credential|secret|password|authorization|cookie|argument|request|response|body|prompt|^value$|^map$)/i.test(key)) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeAuditMaterial(item));
  if (value && typeof value === 'object') return Object.entries(value).some(([childKey, child]) => hasUnsafeAuditMaterial(child, childKey));
  return false;
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
function auditNeedsRedaction(record) {
  const allowed = new Set(['index', 'ts', 'prevHash', 'hash', 'decision', 'apiId', 'tool', 'callId', 'healId',
    'version', 'versionBefore', 'versionAfter', 'tier', 'rounds', 'latencyMs', 'confidence', 'responseOnly', 'reason', 'ops', 'evidence']);
  if (Object.keys(record).some((key) => !allowed.has(key)) || hasUnsafeAuditMaterial(record)) return true;
  for (const key of ['apiId', 'tool', 'callId', 'healId']) {
    if (record[key] !== undefined && record[key] !== null
      && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(record[key])
        || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(record[key]))) return true;
  }
  if (typeof record.decision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(record.decision)
    || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(record.decision)) return true;
  if (record.reason !== undefined && (typeof record.reason !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(record.reason)
    || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(record.reason))) return true;
  if (record.ops !== undefined) {
    if (!Array.isArray(record.ops)) return true;
    const operationKeys = new Set(['op', 'path', 'from', 'to', 'type', 'name', 'source']);
    for (const operation of record.ops) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)
        || Object.keys(operation).some((key) => !operationKeys.has(key))) return true;
      if (operation.source !== undefined && (!operation.source || typeof operation.source !== 'object' || Array.isArray(operation.source)
        || Object.keys(operation.source).some((key) => !['type', 'ref'].includes(key))
        || Object.values(operation.source).some((value) => typeof value !== 'string'
          || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value)
          || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(value)))) return true;
      for (const key of ['op', 'path', 'from', 'to', 'type', 'name']) {
        const value = operation[key];
        if (value !== undefined && (typeof value !== 'string' || value.length > 256
          || !/^[A-Za-z0-9_$.[\]{}\/-]+$/.test(value) || /\d{4,}/.test(value)
          || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(value))) return true;
      }
    }
  }
  for (const key of ['tier', 'rounds', 'latencyMs']) {
    if (record[key] !== undefined && (!Number.isSafeInteger(record[key]) || record[key] < 0)) return true;
  }
  if (record.confidence !== undefined && (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1)) return true;
  if (record.responseOnly !== undefined && typeof record.responseOnly !== 'boolean') return true;
  return false;
}

function changeNeedsRedaction(change) {
  if (hasUnsafeAuditMaterial(change)) return true;
  if (!change || typeof change !== 'object' || !Array.isArray(change.ops)) return false;
  return change.ops.some((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return true;
    const allowed = new Set(['op', 'path', 'from', 'to', 'type', 'name', 'source']);
    if (Object.keys(operation).some((key) => !allowed.has(key))) return true;
    for (const key of ['op', 'path', 'from', 'to', 'type', 'name']) {
      const value = operation[key];
      if (value !== undefined && (typeof value !== 'string' || value.length > 256
        || !/^[A-Za-z0-9_$.[\]{}\/-]+$/.test(value) || /\d{4,}/.test(value)
        || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(value))) return true;
    }
    if (operation.source !== undefined) {
      if (!operation.source || typeof operation.source !== 'object' || Array.isArray(operation.source)
        || Object.keys(operation.source).some((key) => !['type', 'ref'].includes(key))
        || Object.values(operation.source).some((value) => typeof value !== 'string'
          || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value)
          || /(secret|token|password|credential|apikey|authorization|cookie)/i.test(value))) return true;
    }
    return false;
  });
}

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('registry_root_invalid');
  let apis = 0;
  let tools = 0;
  let versions = 0;
<<<<<<< HEAD
  let changeEntriesRequiringRedaction = 0;
=======
<<<<<<< HEAD
  let changeEntriesRequiringRedaction = 0;
=======
>>>>>>> origin/main
>>>>>>> origin/main
  for (const [apiId, api] of Object.entries(registry)) {
    if (!apiId.trim() || !api || typeof api !== 'object' || Array.isArray(api)
      || !api.tools || typeof api.tools !== 'object' || Array.isArray(api.tools)) fail('registry_api_invalid', { apiId });
    if (!Number.isInteger(api.epoch ?? 1) || (api.epoch ?? 1) < 1) fail('registry_api_epoch_invalid', { apiId });
    if (!api.config || typeof api.config !== 'object' || Array.isArray(api.config)) fail('registry_api_config_invalid', { apiId });
    if (api.config?.baseUrl) {
      let baseUrl;
      try { baseUrl = new URL(api.config.baseUrl); } catch { fail('registry_base_url_invalid', { apiId }); }
      if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) fail('registry_base_url_invalid', { apiId });
    } else fail('registry_base_url_missing', { apiId });
    if (api.config?.specUrl) {
      let specUrl;
      try { specUrl = new URL(api.config.specUrl); } catch { fail('registry_spec_url_invalid', { apiId }); }
      if (!['http:', 'https:'].includes(specUrl.protocol) || specUrl.username || specUrl.password) fail('registry_spec_url_invalid', { apiId });
    }
    validateCredentialReferences(api.config?.credentials, apiId);
    const { credentials: _credentials, ...safeConfig } = api.config;
    validateSafeConfig(safeConfig, apiId);
<<<<<<< HEAD
    validateApiConfig(safeConfig, apiId);
=======
<<<<<<< HEAD
    validateApiConfig(safeConfig, apiId);
=======
>>>>>>> origin/main
>>>>>>> origin/main
    apis += 1;
    for (const [toolName, entry] of Object.entries(api.tools)) {
      if (!toolName.trim() || !entry || typeof entry !== 'object' || !Array.isArray(entry.versions) || entry.versions.length === 0) {
        fail('registry_tool_invalid', { apiId, tool: toolName });
      }
      const seen = new Set();
      let previous = 0;
      const normalized = entry.versions.map(normalizeLegacyVersion);
      for (const version of normalized) {
        if (!Number.isInteger(version.version) || version.version !== previous + 1 || seen.has(version.version)
          || !version.adapter || typeof version.adapter !== 'object' || Array.isArray(version.adapter)) {
          fail('registry_version_order_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (typeof version.createdAt !== 'string' || Number.isNaN(Date.parse(version.createdAt))) {
          fail('registry_version_timestamp_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (!version.meta || typeof version.meta !== 'object' || Array.isArray(version.meta)) {
          fail('registry_version_metadata_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (typeof version.meta.path !== 'string' || !version.meta.path.startsWith('/')
          || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(String(version.meta.method ?? 'POST').toUpperCase())
          || !['low', 'medium', 'high', 'critical'].includes(version.meta.risk ?? 'low')
          || !['read', 'write', 'none'].includes(version.meta.sideEffects ?? version.adapter.sideEffects ?? 'write')) {
          fail('registry_version_metadata_invalid', { apiId, tool: toolName, version: version.version });
        }
        validateSafeConfig(version.meta, apiId, `tools.${toolName}.versions.${version.version}.meta`);
<<<<<<< HEAD
        if (version.change && changeNeedsRedaction(version.change)) changeEntriesRequiringRedaction += 1;
=======
<<<<<<< HEAD
        if (version.change && changeNeedsRedaction(version.change)) changeEntriesRequiringRedaction += 1;
=======
>>>>>>> origin/main
>>>>>>> origin/main
        if (!['register', 'heal', 'manual_rollback', 'watchdog_rollback', 'rollback', 'dev', 'import'].includes(version.origin ?? 'register')) {
          fail('registry_version_origin_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (version.parent != null && (!Number.isInteger(version.parent) || version.parent >= version.version || !seen.has(version.parent))) {
          fail('registry_version_parent_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (version.rollbackOf != null && (!Number.isInteger(version.rollbackOf) || version.rollbackOf >= version.version || !seen.has(version.rollbackOf))) {
          fail('registry_rollback_target_invalid', { apiId, tool: toolName, version: version.version });
        }
<<<<<<< HEAD
        try { validateAdapterForStorage(version.adapter); } catch { fail('registry_adapter_invalid', { apiId, tool: toolName, version: version.version }); }
=======
<<<<<<< HEAD
        try { validateAdapterForStorage(version.adapter); } catch { fail('registry_adapter_invalid', { apiId, tool: toolName, version: version.version }); }
=======
        try { compileAdapter(version.adapter); } catch { fail('registry_adapter_invalid', { apiId, tool: toolName, version: version.version }); }
>>>>>>> origin/main
>>>>>>> origin/main
        version.adapterHash = sha256(stableStringify(version.adapter));
        previous = version.version;
        seen.add(version.version);
        versions += 1;
      }
      const current = normalized.find((version) => version.version === entry.current?.version);
      if (!current || stableStringify(current.adapter) !== stableStringify(entry.current.adapter)) {
        fail('registry_current_pointer_invalid', { apiId, tool: toolName });
      }
      if (!['low', 'medium', 'high', 'critical'].includes(entry.risk ?? current.meta.risk ?? 'low')) {
        fail('registry_tool_risk_invalid', { apiId, tool: toolName });
      }
      entry.versions = normalized;
      entry.current = current;
      tools += 1;
    }
  }
<<<<<<< HEAD
  return { apis, tools, versions, changeEntriesRequiringRedaction };
=======
<<<<<<< HEAD
  return { apis, tools, versions, changeEntriesRequiringRedaction };
=======
  return { apis, tools, versions };
>>>>>>> origin/main
>>>>>>> origin/main
}

export function inspectImportSources({ dataDir = resolveDataDir(process.env.HEALR_DATA_DIR), includeData = false } = {}) {
  const registryPath = join(dataDir, 'registry.json');
  const registryTempPath = `${registryPath}.tmp`;
  const auditPath = join(dataDir, 'audit.jsonl');
  const auditHeadPath = join(dataDir, 'audit.head.json');
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  const auditBackupPath = `${auditPath}.bak`;
  if (!existsSync(registryPath)) fail('registry_snapshot_missing', { path: registryPath });
  if (existsSync(registryTempPath)) fail('registry_snapshot_interrupted_write');
  const sourcePaths = [registryPath, auditPath, auditHeadPath, auditBackupPath];
<<<<<<< HEAD
=======
=======
  if (!existsSync(registryPath)) fail('registry_snapshot_missing', { path: registryPath });
  if (existsSync(registryTempPath)) fail('registry_snapshot_interrupted_write');
  const sourcePaths = [registryPath, auditPath, auditHeadPath];
>>>>>>> origin/main
>>>>>>> origin/main
  const before = sourcePaths.map((path) => {
    if (!existsSync(path)) return null;
    const info = statSync(path, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  });
  const registryBytes = readFileSync(registryPath);
  let registry;
  try { registry = JSON.parse(registryBytes.toString('utf8')); }
  catch { fail('registry_snapshot_malformed'); }
  const counts = validateRegistry(registry);

  const auditBytes = existsSync(auditPath) ? readFileSync(auditPath) : Buffer.alloc(0);
  const auditHeadText = existsSync(auditHeadPath) ? readFileSync(auditHeadPath, 'utf8') : null;
<<<<<<< HEAD
  const auditBackupBytes = existsSync(auditBackupPath) ? readFileSync(auditBackupPath) : null;
  const audit = verifyAuditBytes(auditBytes.toString('utf8'), auditHeadText);
  const unsafeAuditEntries = audit.records.reduce((count, record) => count + (auditNeedsRedaction(record) ? 1 : 0), 0);
=======
<<<<<<< HEAD
  const auditBackupBytes = existsSync(auditBackupPath) ? readFileSync(auditBackupPath) : null;
  const audit = verifyAuditBytes(auditBytes.toString('utf8'), auditHeadText);
  const unsafeAuditEntries = audit.records.reduce((count, record) => count + (auditNeedsRedaction(record) ? 1 : 0), 0);
=======
  const audit = verifyAuditBytes(auditBytes.toString('utf8'), auditHeadText);
  const unsafeAuditEntries = audit.records.reduce((count, record) =>
    count + (record.evidence !== undefined || hasUnsafeAuditMaterial(record) ? 1 : 0), 0);
>>>>>>> origin/main
>>>>>>> origin/main
  const after = sourcePaths.map((path) => {
    if (!existsSync(path)) return null;
    const info = statSync(path, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  });
  if (before.some((token, index) => token !== after[index])) fail('import_source_changed_during_preflight');
  const report = {
    ok: true,
    sourceChecksums: {
      registry: digest(registryBytes),
      audit: digest(auditBytes),
      auditHead: auditHeadText === null ? null : digest(Buffer.from(auditHeadText)),
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
      auditBackup: auditBackupBytes ? digest(auditBackupBytes) : null,
    },
    auditIntegrity: audit.integrity,
    counts: { ...counts, auditEntries: audit.records.length, auditEntriesRequiringRedaction: unsafeAuditEntries },
    warnings: [
      ...(counts.apis === 0 ? ['registry_is_empty'] : []),
      ...(existsSync(auditBackupPath) ? ['audit_backup_present_not_imported'] : []),
      ...(audit.records.length > 0 && auditHeadText === null ? ['audit_head_missing_will_be_reconstructed'] : []),
      ...(unsafeAuditEntries ? ['audit_material_requires_review_before_import'] : []),
      ...(counts.changeEntriesRequiringRedaction ? ['registry_change_material_will_be_redacted'] : []),
      ...(!audit.integrity.ok ? ['audit_source_chain_invalid_will_be_preserved_as_provenance_and_rechained'] : []),
      ...(Object.values(registry).some((api) => (api.epoch ?? 1) > 1) ? ['prior_re_registration_versions_may_be_missing'] : []),
    ],
  };
  return includeData ? { ...report, sourceData: { registry, auditRecords: audit.records, auditHead: audit.head, auditIntegrity: audit.integrity, auditBackupPresent: existsSync(auditBackupPath) } } : report;
<<<<<<< HEAD
=======
=======
    },
    counts: { ...counts, auditEntries: audit.records.length, auditEntriesRequiringRedaction: unsafeAuditEntries },
    warnings: [
      ...(counts.apis === 0 ? ['registry_is_empty'] : []),
      ...(existsSync(`${auditPath}.bak`) ? ['audit_backup_present_not_imported'] : []),
      ...(audit.records.length > 0 && auditHeadText === null ? ['audit_head_missing_will_be_reconstructed'] : []),
      ...(unsafeAuditEntries ? ['audit_material_requires_review_before_import'] : []),
      ...(Object.values(registry).some((api) => (api.epoch ?? 1) > 1) ? ['prior_re_registration_versions_may_be_missing'] : []),
    ],
  };
  return includeData ? { ...report, sourceData: { registry, auditRecords: audit.records, auditHead: audit.head } } : report;
>>>>>>> origin/main
>>>>>>> origin/main
}
