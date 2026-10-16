import { sha256, stableStringify } from '../lib/hash.js';
import { getLocalWorkspaceId } from './workspace.js';

const clone = (value) => value == null ? value : structuredClone(value);

function requireSafeUrl(value, field, optional = false) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a valid URL`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${field} must be a valid URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError(`${field} must be an HTTP(S) URL without embedded credentials`);
  }
  return url.toString();
}

function credentialSources(credentials = {}) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new TypeError('credentials must be an object of environment references');
  return Object.entries(credentials).map(([credentialRef, source]) => {
    if (!credentialRef.trim() || !source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).length !== 1 || typeof source.env !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.env)) {
      throw new TypeError(`credential ${credentialRef || '<empty>'} must contain one valid env reference`);
    }
    return { credentialRef, sourceRef: source.env };
  });
}

function assertSafeConfig(value, path = 'config') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(credential|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|^token$)/i.test(key)) {
      throw new TypeError(`${path}.${key} cannot contain secret material; use a credential source reference`);
    }
    assertSafeConfig(child, `${path}.${key}`);
  }
}

function safeChangeForStorage(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
  const safe = {};
  for (const key of ['tier', 'confidence', 'rounds', 'responseOnly', 'verified', 'ms']) {
    if (change[key] !== undefined && ['string', 'number', 'boolean'].includes(typeof change[key])) safe[key] = change[key];
  }
  if (Array.isArray(change.ops)) {
    safe.ops = change.ops.map((op) => {
      if (!op || typeof op !== 'object' || Array.isArray(op)) return { op: 'unknown' };
      const operation = {};
      for (const key of ['op', 'path', 'from', 'to', 'type', 'name']) {
        if (typeof op[key] === 'string') operation[key] = op[key];
      }
      if (op.source && typeof op.source === 'object') {
        operation.source = Object.fromEntries(['type', 'ref'].filter((key) => typeof op.source[key] === 'string').map((key) => [key, op.source[key]]));
      }
      return operation;
    });
  }
  if (change.evidence !== undefined) safe.evidenceCount = Array.isArray(change.evidence) ? change.evidence.length : 1;
  return safe;
}

function apiOptions(payload) {
  const options = {};
  if (payload.healing !== undefined) {
    if (!payload.healing || typeof payload.healing !== 'object' || Array.isArray(payload.healing)) throw new TypeError('healing config must be an object');
    options.healing = clone(payload.healing);
  }
  for (const key of ['confidenceThreshold', 'maxRounds', 'tier2']) {
    if (payload[key] !== undefined) options[key] = clone(payload[key]);
  }
  assertSafeConfig(options);
  return options;
}

function buildRegisteredAdapter(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new TypeError('tool definition must be an object');
  if (typeof tool.path !== 'string' || !tool.path.startsWith('/') || tool.path.startsWith('//') || /[\\\u0000-\u001f]/.test(tool.path)) {
    throw new TypeError('tool path must be an absolute API path without control characters');
  }
  const method = String(tool.method ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) throw new TypeError('unsupported tool HTTP method');
  if (!tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) throw new TypeError('tool parameters must be a JSON schema object');
  if (tool.adapter?.request !== undefined && !Array.isArray(tool.adapter.request)) throw new TypeError('adapter request operations must be an array');
  if (tool.risk !== undefined && !['low', 'medium', 'high', 'critical'].includes(tool.risk)) throw new TypeError('unsupported tool risk');
  if (tool.sideEffects !== undefined && !['read', 'write', 'none'].includes(tool.sideEffects)) throw new TypeError('sideEffects must be read, write, or none');
  const fields = tool.response?.fields ?? {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('response fields must be an object');
  const responseMap = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.path]));
  const responseSchema = tool.response ? {
    type: 'object',
    properties: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, {
      type: value.type ?? 'string',
      ...(value.format ? { format: value.format } : {}),
    }])),
    required: Object.entries(fields).filter(([, value]) => value.required).map(([key]) => key),
    additionalProperties: true,
  } : null;
  const sideEffects = tool.sideEffects ?? 'write';
  const adapter = {
    request: clone(tool.adapter?.request ?? []),
    response: { map: responseMap },
    sideEffects,
  };
  const metadata = {
    path: tool.path,
    method,
    logicalSchema: clone(tool.parameters),
    responseSchema,
    risk: tool.risk ?? 'low',
    sideEffects,
    identity: clone(tool.identity ?? {}),
  };
  return { adapter, metadata, risk: metadata.risk, sideEffects };
}

function toVersion(row) {
  if (!row) return null;
  return {
    version: row.version,
    apiEpoch: row.api_epoch,
    parent: row.parent_version,
    rollbackOf: row.rollback_of,
    tool: row.tool_name,
    createdAt: row.created_at.toISOString(),
    adapter: row.adapter,
    meta: row.metadata,
    origin: row.origin,
    change: row.change,
    adapterHash: row.adapter_hash,
  };
}

export async function getApiConfig(queryable, apiId) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT api_id, base_url, spec_url, config, epoch
     FROM apis WHERE workspace_id = $1 AND api_id = $2 AND deleted_at IS NULL`,
    [workspaceId, apiId],
  );
  if (!rows[0]) return null;
  const { rows: credentialRows } = await queryable.query(
    `SELECT credential_ref, source_ref FROM api_credentials
     WHERE workspace_id = $1 AND api_id = $2 ORDER BY credential_ref`,
    [workspaceId, apiId],
  );
  const credentials = Object.fromEntries(credentialRows.map(({ credential_ref, source_ref }) => [credential_ref, { env: source_ref }]));
  return {
    apiId: rows[0].api_id,
    config: { baseUrl: rows[0].base_url, specUrl: rows[0].spec_url, ...rows[0].config, credentials },
    epoch: rows[0].epoch,
  };
}

/** Merge a validated settings patch without losing unrelated stored options. */
export async function updateApiConfigInTransaction(client, apiId, inputPatch) {
  const patch = Object.fromEntries(Object.entries(inputPatch ?? {}).filter(([key]) =>
    ['mode', 'confidenceThreshold', 'maxRounds', 'tier2', 'healing'].includes(key)));
  if (patch.mode !== undefined) patch.healing = { ...(patch.healing ?? {}), mode: patch.mode };
  assertSafeConfig(patch);
  const workspaceId = await getLocalWorkspaceId(client);
  const { rows } = await client.query(
    `SELECT config, deleted_at FROM apis WHERE workspace_id = $1 AND api_id = $2 FOR UPDATE`,
    [workspaceId, apiId],
  );
  const current = rows[0];
  if (!current || current.deleted_at) return null;
  const config = current.config ?? {};
  const { mode, confidenceThreshold, maxRounds, tier2, healing, ...rest } = patch;
  const next = {
    ...config,
    ...rest,
    ...(confidenceThreshold !== undefined ? { confidenceThreshold } : {}),
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    ...(tier2 !== undefined ? { tier2 } : {}),
    ...(healing !== undefined || mode !== undefined ? { healing: { ...(config.healing ?? {}), ...(healing ?? {}), ...(mode !== undefined ? { mode } : {}) } } : {}),
  };
  if (stableStringify(next) !== stableStringify(config)) {
    await client.query(
      `UPDATE apis SET config = $3::jsonb, config_revision = config_revision + 1, updated_at = now()
       WHERE workspace_id = $1 AND api_id = $2`,
      [workspaceId, apiId, JSON.stringify(next)],
    );
  }
  return getApiConfig(client, apiId);
}

export async function listApiTools(queryable) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT t.api_id, t.tool_name, t.current_version, t.risk, a.epoch
     FROM tools t JOIN apis a USING (workspace_id, api_id)
     WHERE t.workspace_id = $1 AND a.deleted_at IS NULL AND t.deleted_at IS NULL
     ORDER BY t.api_id, t.tool_name`,
    [workspaceId],
  );
  return rows.map((row) => ({ apiId: row.api_id, tool: row.tool_name, version: row.current_version, risk: row.risk, epoch: row.epoch }));
}

export async function getCurrentToolVersion(queryable, apiId, toolName) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT a.epoch AS active_api_epoch, v.*
     FROM apis a JOIN tools t USING (workspace_id, api_id)
     JOIN adapter_versions v ON v.workspace_id = t.workspace_id AND v.api_id = t.api_id
       AND v.tool_name = t.tool_name AND v.version = t.current_version
     WHERE a.workspace_id = $1 AND a.api_id = $2 AND t.tool_name = $3
       AND a.deleted_at IS NULL AND t.deleted_at IS NULL`,
    [workspaceId, apiId, toolName],
  );
  if (!rows[0]) return null;
  const versionObj = toVersion(rows[0]);
  return { apiId, name: toolName, epoch: rows[0].active_api_epoch, version: versionObj.version, versionObj };
}

export async function listToolVersions(queryable, apiId, toolName) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT v.* FROM adapter_versions v
     WHERE v.workspace_id = $1 AND v.api_id = $2 AND v.tool_name = $3
     ORDER BY v.version`,
    [workspaceId, apiId, toolName],
  );
  return rows.map(toVersion);
}

export class StaleAdapterError extends Error {
  constructor() {
    super('The adapter changed while this proposal was being verified');
    this.code = 'stale_adapter_version';
  }
}

/** Append a verified adapter and advance its pointer within the caller's UoW. */
export async function commitAdapterInTransaction(client, {
  apiId, toolName, adapter, change, origin = 'heal', expectedVersion, expectedEpoch, expectedConfigRevision,
}) {
  const workspaceId = await getLocalWorkspaceId(client);
  // All mutation paths lock API first and tool second, preventing stale drafts
  // from racing re-registration or another commit.
  const { rows: apiRows } = await client.query(
    `SELECT epoch, config_revision, deleted_at FROM apis
     WHERE workspace_id = $1 AND api_id = $2 FOR UPDATE`,
    [workspaceId, apiId],
  );
  const api = apiRows[0];
  if (!api || api.deleted_at) throw new Error('API is not registered');
  const { rows: toolRows } = await client.query(
    `SELECT current_version, deleted_at FROM tools
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3 FOR UPDATE`,
    [workspaceId, apiId, toolName],
  );
  const tool = toolRows[0];
  if (!tool || tool.deleted_at) throw new Error('Tool is not registered');
  if (tool.current_version !== expectedVersion || api.epoch !== expectedEpoch || api.config_revision !== expectedConfigRevision) {
    throw new StaleAdapterError();
  }
  const { rows: currentRows } = await client.query(
    `SELECT metadata FROM adapter_versions
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3 AND version = $4`,
    [workspaceId, apiId, toolName, tool.current_version],
  );
  const metadata = currentRows[0]?.metadata;
  if (!metadata) throw new Error('Active adapter version is missing');
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) throw new TypeError('adapter must be an object');
  const { rows: nextRows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM adapter_versions
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3`,
    [workspaceId, apiId, toolName],
  );
  const version = Number(nextRows[0].version);
  const adapterCopy = clone(adapter);
  const adapterHash = sha256(stableStringify(adapterCopy));
  await client.query(
    `INSERT INTO adapter_versions
     (workspace_id, api_id, tool_name, version, api_epoch, parent_version, origin, adapter, metadata, change, adapter_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
    [workspaceId, apiId, toolName, version, api.epoch, tool.current_version, origin,
      JSON.stringify(adapterCopy), JSON.stringify(metadata), JSON.stringify(safeChangeForStorage(change)), adapterHash],
  );
  await client.query(
    `UPDATE tools SET current_version = $4, updated_at = now()
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3`,
    [workspaceId, apiId, toolName, version],
  );
  return {
    workspaceId, apiId, tool: toolName, version, apiEpoch: api.epoch,
    parent: tool.current_version, adapter: adapterCopy, meta: metadata,
    change: change ?? null, origin, adapterHash,
  };
}

export async function rollbackAdapterInTransaction(client, {
  apiId, toolName, toVersion, expectedVersion, expectedEpoch, expectedConfigRevision,
  origin = 'manual_rollback',
}) {
  if (!['manual_rollback', 'watchdog_rollback'].includes(origin)) throw new TypeError('invalid rollback origin');
  const workspaceId = await getLocalWorkspaceId(client);
  const { rows: apiRows } = await client.query(
    `SELECT epoch, config_revision, deleted_at FROM apis
     WHERE workspace_id = $1 AND api_id = $2 FOR UPDATE`,
    [workspaceId, apiId],
  );
  const api = apiRows[0];
  if (!api || api.deleted_at) throw new Error('API is not registered');
  const { rows: toolRows } = await client.query(
    `SELECT current_version, deleted_at FROM tools
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3 FOR UPDATE`,
    [workspaceId, apiId, toolName],
  );
  const tool = toolRows[0];
  if (!tool || tool.deleted_at) throw new Error('Tool is not registered');
  if (tool.current_version !== expectedVersion || api.epoch !== expectedEpoch || api.config_revision !== expectedConfigRevision) {
    throw new StaleAdapterError();
  }
  const { rows: targetRows } = await client.query(
    `SELECT adapter, metadata FROM adapter_versions
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3 AND version = $4`,
    [workspaceId, apiId, toolName, toVersion],
  );
  const target = targetRows[0];
  if (!target || toVersion >= tool.current_version) throw new Error('Rollback target must be an existing earlier version');
  const { rows: nextRows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM adapter_versions
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3`,
    [workspaceId, apiId, toolName],
  );
  const version = Number(nextRows[0].version);
  const adapterHash = sha256(stableStringify(target.adapter));
  await client.query(
    `INSERT INTO adapter_versions
     (workspace_id, api_id, tool_name, version, api_epoch, parent_version, rollback_of, origin, adapter, metadata, change, adapter_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, NULL, $11)`,
    [workspaceId, apiId, toolName, version, api.epoch, tool.current_version, toVersion, origin,
      JSON.stringify(target.adapter), JSON.stringify(target.metadata), adapterHash],
  );
  await client.query(
    `UPDATE tools SET current_version = $4, updated_at = now()
     WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3`,
    [workspaceId, apiId, toolName, version],
  );
  return {
    workspaceId, apiId, tool: toolName, version, apiEpoch: api.epoch,
    parent: tool.current_version, rollbackOf: toVersion,
    adapter: target.adapter, meta: target.metadata, origin, adapterHash,
  };
}

export async function softDeleteApiInTransaction(client, apiId) {
  const workspaceId = await getLocalWorkspaceId(client);
  const { rows } = await client.query(
    `UPDATE apis SET deleted_at = COALESCE(deleted_at, now()), config_revision = config_revision + 1, updated_at = now()
     WHERE workspace_id = $1 AND api_id = $2 AND deleted_at IS NULL
     RETURNING api_id`,
    [workspaceId, apiId],
  );
  if (!rows[0]) return false;
  await client.query(
    `UPDATE tools SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE workspace_id = $1 AND api_id = $2 AND deleted_at IS NULL`,
    [workspaceId, apiId],
  );
  return true;
}

/**
 * Persist a full API registration using the caller's transaction. The caller
 * must append its audit decision and durable events before committing that
 * same transaction.
 */
export async function registerApiInTransaction(client, payload) {
  const { apiId, baseUrl, specUrl, tools } = payload ?? {};
  if (typeof apiId !== 'string' || !apiId.trim()) throw new TypeError('apiId is required');
  if (!Array.isArray(tools) || tools.length === 0) throw new TypeError('at least one tool is required');
  const toolNames = tools.map((tool) => tool?.name);
  if (toolNames.some((name) => typeof name !== 'string' || !name.trim()) || new Set(toolNames).size !== toolNames.length) {
    throw new TypeError('tool names must be non-empty and unique within an API registration');
  }

  const safeBaseUrl = requireSafeUrl(baseUrl, 'baseUrl');
  const safeSpecUrl = requireSafeUrl(specUrl, 'specUrl', true);
  const credentials = credentialSources(payload.credentials ?? {});
  const options = apiOptions(payload);
  const workspaceId = await getLocalWorkspaceId(client);
  await client.query('SELECT api_id FROM apis WHERE workspace_id = $1 AND api_id = $2 FOR UPDATE', [workspaceId, apiId]);
  const { rows: oldCredentialRows } = await client.query(
    `SELECT credential_ref, source_kind, source_ref FROM api_credentials
     WHERE workspace_id = $1 AND api_id = $2 ORDER BY credential_ref`,
    [workspaceId, apiId],
  );
  const oldCredentials = oldCredentialRows.map((row) => `${row.credential_ref}\u0000${row.source_kind}\u0000${row.source_ref}`).sort();
  const nextCredentials = credentials.map((row) => `${row.credentialRef}\u0000env\u0000${row.sourceRef}`).sort();
  const credentialChanged = oldCredentials.length !== nextCredentials.length
    || oldCredentials.some((value, index) => value !== nextCredentials[index]);
  const { rows: apiRows } = await client.query(
    `INSERT INTO apis(workspace_id, api_id, base_url, spec_url, config, epoch, config_revision, credential_revision, deleted_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 1, 1, 1, NULL)
     ON CONFLICT (workspace_id, api_id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       spec_url = EXCLUDED.spec_url,
       config = EXCLUDED.config,
       epoch = apis.epoch + 1,
       config_revision = apis.config_revision + 1,
       credential_revision = apis.credential_revision + $6,
       deleted_at = NULL,
       updated_at = now()
     RETURNING epoch`,
    [workspaceId, apiId, safeBaseUrl, safeSpecUrl, JSON.stringify(options), credentialChanged ? 1 : 0],
  );
  const epoch = apiRows[0].epoch;

  await client.query('DELETE FROM api_credentials WHERE workspace_id = $1 AND api_id = $2', [workspaceId, apiId]);
  for (const { credentialRef, sourceRef } of credentials) {
    await client.query(
      `INSERT INTO api_credentials(workspace_id, api_id, credential_ref, source_kind, source_ref)
       VALUES ($1, $2, $3, 'env', $4)`,
      [workspaceId, apiId, credentialRef, sourceRef],
    );
  }

  await client.query(
    `UPDATE tools SET deleted_at = now(), updated_at = now()
     WHERE workspace_id = $1 AND api_id = $2 AND deleted_at IS NULL AND NOT (tool_name = ANY($3::text[]))`,
    [workspaceId, apiId, toolNames],
  );

  for (const tool of tools) {
    const { rows: priorRows } = await client.query(
      `SELECT current_version FROM tools
       WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3 FOR UPDATE`,
      [workspaceId, apiId, tool.name],
    );
    const parentVersion = priorRows[0]?.current_version ?? null;
    const { rows: versionRows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM adapter_versions
       WHERE workspace_id = $1 AND api_id = $2 AND tool_name = $3`,
      [workspaceId, apiId, tool.name],
    );
    const version = Number(versionRows[0].version);
    const { adapter, metadata, risk, sideEffects } = buildRegisteredAdapter(tool);
    const adapterHash = sha256(stableStringify(adapter));

    await client.query(
      `INSERT INTO tools(workspace_id, api_id, tool_name, current_version, risk, side_effects, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)
       ON CONFLICT (workspace_id, api_id, tool_name) DO UPDATE SET
         current_version = EXCLUDED.current_version, risk = EXCLUDED.risk,
         side_effects = EXCLUDED.side_effects, deleted_at = NULL, updated_at = now()`,
      [workspaceId, apiId, tool.name, version, risk, sideEffects],
    );
    await client.query(
      `INSERT INTO adapter_versions
       (workspace_id, api_id, tool_name, version, api_epoch, parent_version, rollback_of, origin, adapter, metadata, change, adapter_hash)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, 'register', $7::jsonb, $8::jsonb, NULL, $9)`,
      [workspaceId, apiId, tool.name, version, epoch, parentVersion, JSON.stringify(adapter), JSON.stringify(metadata), adapterHash],
    );
  }

  return { workspaceId, apiId, epoch, tools: [...toolNames] };
}
