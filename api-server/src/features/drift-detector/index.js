import { getPath } from '../../lib/paths.js';

function responseType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
}

function compatible(value, schema) {
  if (value === undefined || value === null) return false;
  const type = schema?.type;
  if (type && type !== responseType(value) && !(type === 'number' && typeof value === 'number')) return false;
  if (schema?.format === 'email' && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return false;
  return true;
}

function leaves(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

function fieldScore(logical, path) {
  const leaf = path.split('.').at(-1).toLowerCase();
  const name = logical.toLowerCase();
  if (leaf === name) return 1;
  // A full_name -> name rename is a narrow, explainable name containment
  // match. Avoid broad fuzzy matching that could select unrelated fields.
  if (leaf.startsWith(`full_${name}`) || leaf.endsWith(`_${name}`)) return 0.9;
  return 0;
}

/**
 * Propose response-only path remaps from one observed response. The detector
 * does not make network calls. A proposal is returned only when each missing
 * required logical field has one type/format-compatible, uniquely named path.
 */
export function checkResponse({ tool, response }) {
  if (!response?.ok || response.json === null || typeof response.json !== 'object') {
    return { ok: false, reason: 'response_unavailable', ops: [] };
  }
  const mapping = tool.versionObj?.adapter?.response?.map ?? {};
  const schema = tool.versionObj?.meta?.responseSchema;
  if (!schema?.properties) return { ok: false, reason: 'response_schema_unavailable', ops: [] };

  const paths = leaves(response.json);
  const ops = [];
  for (const logical of schema.required ?? []) {
    const fieldSchema = schema.properties[logical] ?? {};
    const currentPath = mapping[logical];
    const currentValue = getPath(response.json, currentPath);
    if (compatible(currentValue, fieldSchema)) continue;

    const candidates = paths
      .map((path) => ({ path, score: fieldScore(logical, path), value: getPath(response.json, path) }))
      .filter((candidate) => candidate.score > 0 && compatible(candidate.value, fieldSchema));
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length) {
      return { ok: false, reason: 'response_mapping_unresolved', logical, ops: [] };
    }
    if (candidates[1] && candidates[1].score === candidates[0].score) {
      return { ok: false, reason: 'response_mapping_ambiguous', logical, ops: [] };
    }
    if (candidates[0].path === currentPath) return { ok: false, reason: 'response_mapping_invalid', logical, ops: [] };
    ops.push({
      op: 'remap_response_path', logical, from: currentPath, to: candidates[0].path,
      evidence: { kind: 'observed_response', path: candidates[0].path, type: responseType(candidates[0].value) },
    });
  }

  if (!ops.length) return { ok: false, reason: 'no_response_drift', ops: [] };
  const next = structuredClone(tool.versionObj.adapter);
  next.response ??= { map: {} };
  next.response.map ??= {};
  for (const op of ops) next.response.map[op.logical] = op.to;
  return { ok: true, adapter: next, ops, evidence: ops.map((op) => op.evidence) };
}
