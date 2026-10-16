import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileAdapter } from '../../features/registry/compile.js';
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

function verifyAuditBytes(text, headText) {
  const records = [];
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
    const expected = sha256(stableStringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'))));
    if (record.index !== records.length || record.hash !== expected
      || record.prevHash !== (records.at(-1)?.hash ?? null)) {
      fail('audit_chain_invalid', { index: records.length });
    }
    records.push(record);
  }

  let head = null;
  if (headText !== null) {
    try { head = JSON.parse(headText); } catch { fail('audit_head_malformed'); }
    if (!head || typeof head !== 'object' || !Number.isSafeInteger(head.index) || head.index < 0
      || typeof head.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(head.hash)) fail('audit_head_malformed');
    const tail = records.at(-1);
    if (!tail || head.index !== tail.index || head.hash !== tail.hash) fail('audit_head_mismatch');
  }
  if (!records.length && headText !== null) fail('audit_head_without_records');
  return { records, head };
}

function hasUnsafeAuditMaterial(value, key = '') {
  if (/(credential|secret|password|authorization|cookie|argument|request|response|body|prompt|^value$|^map$)/i.test(key)) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeAuditMaterial(item));
  if (value && typeof value === 'object') return Object.entries(value).some(([childKey, child]) => hasUnsafeAuditMaterial(child, childKey));
  return false;
}

function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('registry_root_invalid');
  let apis = 0;
  let tools = 0;
  let versions = 0;
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
        if (!['register', 'heal', 'manual_rollback', 'watchdog_rollback', 'rollback', 'dev', 'import'].includes(version.origin ?? 'register')) {
          fail('registry_version_origin_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (version.parent != null && (!Number.isInteger(version.parent) || version.parent >= version.version || !seen.has(version.parent))) {
          fail('registry_version_parent_invalid', { apiId, tool: toolName, version: version.version });
        }
        if (version.rollbackOf != null && (!Number.isInteger(version.rollbackOf) || version.rollbackOf >= version.version || !seen.has(version.rollbackOf))) {
          fail('registry_rollback_target_invalid', { apiId, tool: toolName, version: version.version });
        }
        try { compileAdapter(version.adapter); } catch { fail('registry_adapter_invalid', { apiId, tool: toolName, version: version.version }); }
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
  return { apis, tools, versions };
}

export function inspectImportSources({ dataDir = resolveDataDir(process.env.HEALR_DATA_DIR), includeData = false } = {}) {
  const registryPath = join(dataDir, 'registry.json');
  const registryTempPath = `${registryPath}.tmp`;
  const auditPath = join(dataDir, 'audit.jsonl');
  const auditHeadPath = join(dataDir, 'audit.head.json');
  if (!existsSync(registryPath)) fail('registry_snapshot_missing', { path: registryPath });
  if (existsSync(registryTempPath)) fail('registry_snapshot_interrupted_write');
  const sourcePaths = [registryPath, auditPath, auditHeadPath];
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
  const audit = verifyAuditBytes(auditBytes.toString('utf8'), auditHeadText);
  const unsafeAuditEntries = audit.records.reduce((count, record) =>
    count + (record.evidence !== undefined || hasUnsafeAuditMaterial(record) ? 1 : 0), 0);
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
}
