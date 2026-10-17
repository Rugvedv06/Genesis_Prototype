import { createHash } from 'node:crypto';
import { getPath } from '../../lib/paths.js';

const DANGEROUS_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 24;
const MAX_NODES = 2048;

function pathParts(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) return null;
  const parts = path.split('.');
  return parts.length <= 64 && parts.every((part) => /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(part) && !DANGEROUS_SEGMENTS.has(part))
    ? parts : null;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(value, schema) {
  if (value === undefined) return false;
  if (value === null) return Array.isArray(schema?.type) ? schema.type.includes('null') : schema?.type === 'null';
  const expected = schema?.type;
  return !expected || (Array.isArray(expected) ? expected.includes(typeOf(value)) : expected === typeOf(value)
    || (expected === 'number' && typeOf(value) === 'integer'));
}

function walk(value, path, out, state, depth) {
  if (depth > MAX_DEPTH || state.nodes++ > MAX_NODES) return;
  if (value === null || typeof value !== 'object') {
    out.push(`${path}:${typeOf(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    out.push(`${path}:array`);
    for (const item of value.slice(0, 64)) walk(item, `${path}[]`, out, state, depth + 1);
    return;
  }
  const keys = Object.keys(value).sort();
  out.push(`${path}:object{${keys.join(',')}}`);
  for (const key of keys) {
    if (!DANGEROUS_SEGMENTS.has(key)) walk(value[key], path ? `${path}.${key}` : key, out, state, depth + 1);
  }
}

export function structuralFingerprint(value) {
  const parts = [];
  walk(value, '$', parts, { nodes: 0 }, 0);
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function fieldDefinitions(variant) {
  if (variant?.map && typeof variant.map === 'object' && !Array.isArray(variant.map)) {
    return Object.fromEntries(Object.entries(variant.map).map(([logical, definition]) => [
      logical,
      typeof definition === 'string' ? { from: definition } : definition,
    ]));
  }
  return variant?.fields ?? {};
}

export function recognizeVariant(response, variant, canonical = {}) {
  if (!variant || variant.status && variant.status !== 'verified') return { ok: false, reason: 'variant_unverified' };
  const fields = fieldDefinitions(variant);
  const data = {};
  const errors = [];
  const required = canonical.required ?? Object.entries(fields).filter(([, field]) => field?.required).map(([key]) => key);
  for (const [logical, definition] of Object.entries(fields)) {
    const from = definition?.from ?? definition?.path;
    if (!pathParts(from)) return { ok: false, reason: 'unsafe_variant_path', logical };
    const value = getPath(response, from);
    if (value === undefined) {
      if (required.includes(logical)) errors.push({ logical, reason: 'missing_required_field', path: from });
      continue;
    }
    const schema = canonical.properties?.[logical] ?? definition;
    if (!typeMatches(value, schema)) {
      errors.push({ logical, reason: 'type_mismatch', path: from, expected: schema?.type, received: typeOf(value) });
      continue;
    }
    data[logical] = value;
  }
  return errors.length ? { ok: false, reason: 'variant_contract_violation', errors } : { ok: true, data };
}

export function findKnownVariant(response, variants, canonical) {
  const context = arguments[3] ?? {};
  const matches = [];
  for (const variant of variants ?? []) {
    const selector = variant.selector ?? {};
    const selectorMatches = Object.entries(selector.args ?? {}).every(([key, value]) => context.args?.[key] === value)
      && Object.entries(selector.headers ?? {}).every(([key, value]) => {
        const actual = context.headers?.[key] ?? context.headers?.[key.toLowerCase()];
        return actual === value;
      })
      && Object.entries(selector.query ?? {}).every(([key, value]) => context.query?.[key] === value);
    if (!selectorMatches) continue;
    const result = recognizeVariant(response, variant, canonical);
    if (result.ok) matches.push({ variant, ...result });
  }
  if (matches.length === 1) return { kind: 'known_variant', ...matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous_variant', matches: matches.map(({ variant }) => variant.id) };
  return { kind: 'variant_mismatch' };
}

export function validateVariantConfig(variants) {
  if (variants == null) return [];
  if (!Array.isArray(variants)) throw new TypeError('response variants must be an array');
  const ids = new Set();
  return variants.map((variant) => {
    if (!variant || typeof variant !== 'object' || typeof variant.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(variant.id)) {
      throw new TypeError('response variants require a safe id');
    }
    if (ids.has(variant.id)) throw new TypeError(`duplicate response variant: ${variant.id}`);
    ids.add(variant.id);
    for (const definition of Object.values(fieldDefinitions(variant))) {
      if (!pathParts(definition?.from ?? definition?.path)) throw new TypeError(`unsafe response variant path for ${variant.id}`);
    }
    return structuredClone({ ...variant, status: variant.status ?? 'verified' });
  });
}
