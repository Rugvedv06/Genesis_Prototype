import { getPath } from '../../../lib/paths.js';

function caseVariants(value) {
  const text = String(value);
  return new Set([text.toUpperCase(), text.toLowerCase(), text[0]?.toUpperCase() + text.slice(1).toLowerCase()]);
}

// Only infer lossless case/format variants. Semantic mappings require a
// documented spec or Tier 2 evidence and are deliberately left unresolved.
export function enumRule({ errors, request }) {
  const err = errors.find((item) => item.kind === 'enum' && item.path?.length);
  if (!err || !Array.isArray(err.allowed) || !err.allowed.length) return null;
  const path = err.path.join('.');
  const logicalValue = getPath(request ?? {}, path);
  if (typeof logicalValue !== 'string') return null;

  const candidates = [...caseVariants(logicalValue)].filter((value) => err.allowed.includes(value));
  if (candidates.length !== 1 || candidates[0] === logicalValue) return null;
  return {
    tier: 1,
    confidence: 0.9,
    ops: [{ op: 'set_enum_map', path, map: { [logicalValue]: candidates[0] } }],
    evidence: [err.raw],
  };
}
