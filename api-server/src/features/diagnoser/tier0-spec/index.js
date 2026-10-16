import { registryStore } from '../../registry/store.js';
import { validateUpstreamUrl } from '../../http/url-policy.js';
import { cfg } from '../../../config.js';
import { getPath } from '../../../lib/paths.js';

const SPEC_TIMEOUT_MS = 1800;
const MAX_SPEC_BYTES = 1_000_000;

function atPath(root, path) {
  let current = root;
  for (const part of path ?? []) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return null;
    current = current[part];
  }
  return current;
}

function operationFor(spec, tool) {
  const path = tool.versionObj?.meta?.path;
  const method = String(tool.versionObj?.meta?.method ?? 'POST').toLowerCase();
  return spec?.paths?.[path]?.[method] ?? null;
}

async function readBoundedJson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SPEC_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } finally {
    reader.releaseLock();
  }
}

async function loadSpec(tool) {
  const apiConfig = registryStore.config(tool.apiId);
  if (!apiConfig?.specUrl) return null;
  let url;
  try { url = validateUpstreamUrl(apiConfig.specUrl, { allowLocal: cfg.allowLocalUpstreams }); }
  catch { return null; }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPEC_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_SPEC_BYTES) return null;
    const spec = await readBoundedJson(response);
    if (!spec || typeof spec !== 'object' || spec['x-healr-spec-stale'] === true) return null;
    return { spec, url: url.toString() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Only propose values explicitly documented by the currently fetched spec. */
export async function discover({ tool, args, errors = [] }) {
  const loaded = await loadSpec(tool);
  if (!loaded) return null;
  const operation = operationFor(loaded.spec, tool);
  const schema = operation?.requestBody?.content?.['application/json']?.schema;
  if (!schema || schema.$ref || !schema.properties) return null;

  for (const error of errors) {
    if (error.kind === 'missing' && error.path?.length) {
      const fieldSchema = atPath(schema.properties, error.path);
      if (!fieldSchema || !Object.hasOwn(fieldSchema, 'default')) continue;
      const pointer = `#/paths/${tool.versionObj.meta.path}/${String(tool.versionObj.meta.method ?? 'POST').toLowerCase()}/requestBody/content/application~1json/schema/properties/${error.path.join('/').replaceAll('~', '~0').replaceAll('/', '~1')}`;
      return {
        tier: 0, confidence: 0.99,
        ops: [{ op: 'add_field', path: error.path.join('.'), source: { type: 'spec_default', value: fieldSchema.default } }],
        evidence: [{ kind: 'openapi_default', spec: loaded.url, pointer }],
      };
    }
    if (error.kind === 'enum' && error.path?.length) {
      const fieldSchema = atPath(schema.properties, error.path);
      const aliases = fieldSchema?.['x-healr-enum-aliases'];
      const logicalValue = getPath(args ?? {}, error.path.join('.'));
      const mapped = aliases && Object.hasOwn(aliases, logicalValue) ? aliases[logicalValue] : undefined;
      if (mapped === undefined || !fieldSchema.enum?.includes(mapped)) continue;
      return {
        tier: 0, confidence: 0.99,
        ops: [{ op: 'set_enum_map', path: error.path.join('.'), map: { [logicalValue]: mapped } }],
        evidence: [{ kind: 'openapi_enum_alias', spec: loaded.url, logicalValue, mapped }],
      };
    }
  }
  return null;
}

export const run = discover;
