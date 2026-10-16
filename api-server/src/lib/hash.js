// Phase 0: hashing helpers (audit chain, error signatures)
import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
