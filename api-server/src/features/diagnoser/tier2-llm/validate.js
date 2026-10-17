import Ajv from 'ajv';
import { compileAdapter } from '../../registry/compile.js';
import { tier2OutputSchema } from './schema.js';

const validateShape = new Ajv({ allErrors: true, strict: false }).compile(tier2OutputSchema);
const ALLOWED = new Set(['rename_field', 'move_field', 'coerce_type', 'set_enum_map']);
const normalize = (value) => String(value).replace(/\s+/g, ' ').trim();

export function validateTier2Output({ output, sentText, evidenceSources = {}, observedNames = new Set(), args = {}, tool }) {
  if (!validateShape(output)) return { ok: false, reason: 'invalid_schema', errors: validateShape.errors ?? [] };
  for (const item of output.evidence) {
    const sourceText = evidenceSources[item.source] ?? sentText;
    if (!normalize(sourceText).includes(normalize(item.quote))) return { ok: false, reason: 'evidence_not_quoted' };
  }
  if (!output.ops.length) return { ok: false, reason: 'no_proposal' };
  const ops = output.ops;
  const seen = new Set();
  const touched = new Set();
  for (const op of ops) {
    if (!ALLOWED.has(op.op)) return { ok: false, reason: 'op_not_allowed' };
    const signature = JSON.stringify(op);
    if (seen.has(signature)) return { ok: false, reason: 'conflicting_ops' };
    seen.add(signature);
    const paths = op.op === 'rename_field' ? [op.from, op.to, ...(op.path ? [op.path] : [])] : op.op === 'move_field' ? [op.from, op.to] : [op.path];
    const targetPath = op.op === 'rename_field' && op.path ? `${op.path}.${op.from}` : op.op === 'rename_field' ? op.from : op.op === 'move_field' ? op.from : op.path;
    if (touched.has(targetPath)) return { ok: false, reason: 'conflicting_ops' };
    touched.add(targetPath);
    const names = paths.flatMap((path) => String(path).split('.'));
    if (names.some((name) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || !observedNames.has(name))) return { ok: false, reason: 'unobserved_name' };
    if (op.op === 'set_enum_map' && [...Object.keys(op.map), ...Object.values(op.map)].some((value) => !observedNames.has(value))) return { ok: false, reason: 'unobserved_enum_value' };
  }
  try {
    const adapter = tool?.versionObj?.adapter;
    if (!adapter) return { ok: false, reason: 'missing_adapter' };
    const candidate = { ...adapter, request: [...(adapter.request ?? []), ...ops] };
    compileAdapter(candidate).buildRequest(args);
  } catch (error) {
    return { ok: false, reason: error?.name === 'NotLossless' ? 'not_lossless' : 'provenance_violation' };
  }
  return { ok: true, value: { ops, confidence: output.confidence, evidence: output.evidence } };
}

export function observedNamesFrom({ args = {}, failure = {}, specExcerpt = '', logicalSchema = {} } = {}) {
  const names = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { names.add(key); walk(child); }
  };
  walk(args);
  const schemaWalk = (schema) => {
    if (!schema || typeof schema !== 'object') return;
    for (const value of schema.enum ?? []) if (typeof value === 'string') names.add(value);
    for (const child of Object.values(schema.properties ?? {})) schemaWalk(child);
    if (schema.items) schemaWalk(schema.items);
  };
  schemaWalk(logicalSchema);
  const text = `${failure.text ?? ''} ${JSON.stringify(failure.json ?? {})} ${specExcerpt}`;
  for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_-]{1,63}/g)) names.add(match[0]);
  return names;
}

export function logicalArgumentPlaceholders(args = {}) {
  const describe = (value, key) => {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    return `<arg:${key}:${type}>`;
  };
  const walk = (value, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return describe(value, prefix || 'value');
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child, prefix ? `${prefix}.${key}` : key)]));
  };
  return walk(args);
}
