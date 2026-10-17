import { createHash } from 'node:crypto';
import { dereferenceLocalRefs } from '../../diagnoser/tier0-spec/deref.js';
import { toolFromOperation } from './tool-from-operation.js';
import { validateUpstreamUrl } from '../../http/url-policy.js';
import { cfg } from '../../../config.js';

const MAX_BYTES = 1_000_000;
const MAX_OPERATIONS = 200;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function decodeSpec(input) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > MAX_BYTES) throw new Error('Spec exceeds the 1 MB size limit.');
    let parsed;
    try { parsed = JSON.parse(input); } catch { throw new Error('Spec must be a JSON document. YAML is not supported.'); }
    return parsed;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('spec must be a JSON object.');
  let encoded;
  try { encoded = JSON.stringify(input); } catch { throw new Error('Spec must be valid JSON data.'); }
  if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error('Spec exceeds the 1 MB size limit.');
  return input;
}

export function previewOpenApi(input) {
  const raw = decodeSpec(input);
  if (raw.swagger === '2.0') throw new Error('Swagger 2.0 is not supported. Convert the document to OpenAPI 3.0 or 3.1.');
  if (!/^3\.(0|1)\.\d+/.test(String(raw.openapi ?? ''))) throw new Error('Only OpenAPI 3.0 and 3.1 documents are supported.');
  if (!raw.paths || typeof raw.paths !== 'object' || Array.isArray(raw.paths)) throw new Error('OpenAPI document must include paths.');
  const spec = dereferenceLocalRefs(raw);
  const usedNames = new Set();
  const tools = [];
  const skipped = [];
  const warnings = [];
  let seen = 0;
  const operationCount = Object.values(spec.paths).reduce((count, pathItem) => count + Object.keys(pathItem ?? {}).filter((method) => HTTP_METHODS.has(method.toLowerCase())).length, 0);
  const baseUrlSuggestion = Array.isArray(spec.servers) ? spec.servers.find((server) => typeof server?.url === 'string')?.url ?? '' : '';
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !operation || typeof operation !== 'object') continue;
      if (seen >= MAX_OPERATIONS) { warnings.push(`Operation cap reached at ${MAX_OPERATIONS}; additional operations were omitted.`); break; }
      seen += 1;
      const result = toolFromOperation({ method, path, operation, pathParameters: pathItem.parameters ?? [], usedNames });
      if (result.skipped) skipped.push({ method: method.toUpperCase(), path, operationId: operation.operationId ?? null, reason: result.skipped });
      else {
        tools.push(result.tool);
        for (const warning of result.warnings ?? []) warnings.push(`${method.toUpperCase()} ${path}: ${warning}${warning === 'no_response_schema' ? '; response validation will be limited.' : '.'}`);
      }
    }
    if (seen >= MAX_OPERATIONS) break;
  }
  if (operationCount > MAX_OPERATIONS && !warnings.some((warning) => warning.includes('Operation cap'))) warnings.push(`Operation cap reached at ${MAX_OPERATIONS}; additional operations were omitted.`);
  if (!baseUrlSuggestion) warnings.push('No server URL is declared; enter a base URL before registration.');
  return {
    specHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    title: String(spec.info?.title ?? 'Imported API').slice(0, 256), baseUrlSuggestion, tools, warnings, skipped,
  };
}

async function readLimited(response) {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Spec exceeds the 1 MB size limit.');
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('Spec response has no readable body.');
  const decoder = new TextDecoder();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Spec exceeds the 1 MB size limit.'); }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally { reader.releaseLock(); }
}

export async function previewOpenApiUrl(sourceUrl, { fetchImpl = fetch, timeoutMs = cfg.openapiImportTimeoutMs } = {}) {
  let url;
  try { url = validateUpstreamUrl(sourceUrl, { allowLocal: cfg.allowLocalUpstreams }); }
  catch { throw new Error('OpenAPI URL must be a valid allowed HTTP(S) destination.'); }
  const controller = new AbortController();
  const boundedTimeout = Math.max(50, Math.min(5000, Number(timeoutMs) || 1800));
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  try {
    const work = (async () => {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) throw new Error('OpenAPI URL redirects are not followed.');
      if (!response.ok) throw new Error(`Could not fetch OpenAPI document (HTTP ${response.status}).`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!/json/i.test(contentType)) throw new Error('OpenAPI URL must return a JSON document.');
      return { ...previewOpenApi(await readLimited(response)), sourceUrl: url.toString() };
    })();
    let timeout;
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('openapi_fetch_timeout')), boundedTimeout); });
    try { return await Promise.race([work, deadline]); }
    catch (error) {
      if (error.message === 'openapi_fetch_timeout') {
        controller.abort();
        throw new Error('OpenAPI fetch exceeded its time limit.');
      }
      throw error;
    } finally { clearTimeout(timeout); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('OpenAPI fetch exceeded its time limit.');
    throw error;
  } finally { clearTimeout(timer); }
}

export const OPENAPI_IMPORT_LIMITS = Object.freeze({ maxBytes: MAX_BYTES, maxOperations: MAX_OPERATIONS, get timeoutMs() { return cfg.openapiImportTimeoutMs; } });
