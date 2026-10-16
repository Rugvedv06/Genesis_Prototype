import { getPath } from '../../lib/paths.js';

const TIER_OPS = {
  0: new Set(['add_header', 'move_field', 'rename_field', 'coerce_type', 'set_enum_map', 'add_field']),
  1: new Set(['add_header', 'move_field', 'rename_field', 'coerce_type', 'set_enum_map', 'remap_response_path']),
  2: new Set(['move_field', 'rename_field', 'coerce_type', 'set_enum_map']),
};

export function check({ proposal, tool, mode = 'enforce', apiCfg = {} }) {
  if (mode === 'off') return { ok: false, reason: 'healing_disabled' };
  const healing = apiCfg.healing ?? {};
  const threshold = apiCfg.confidenceThreshold ?? healing.confidenceThreshold ?? 0.85;
  if (proposal.confidence < threshold) return { ok: false, reason: 'low_confidence', details: { threshold } };
  const tier = proposal.tier ?? 1;
  const allowed = TIER_OPS[tier] ?? TIER_OPS[2];
  if (proposal.ops.some((op) => !allowed.has(op.op) || (tier === 2 && op.op === 'add_header' && op.source?.type !== 'credential'))) {
    return { ok: false, reason: 'op_not_allowed', details: { tier } };
  }
  const risk = tool.versionObj?.meta?.risk ?? tool.risk ?? 'low';
  if (risk === 'high' && !(tier === 0 || (tier === 1 && proposal.confidence >= 0.95))) {
    return { ok: false, reason: 'requires_approval' };
  }
  if (proposal.ops.length > 8) return { ok: false, reason: 'too_many_ops' };
  const keys = new Set();
  for (const op of proposal.ops) {
    const key = JSON.stringify(op);
    if (keys.has(key)) return { ok: false, reason: 'conflicting_op' };
    keys.add(key);
    if (op.op === 'move_field' && getPath(tool.versionObj.adapter, `response.map.${op.to}`) !== undefined) {
      return { ok: false, reason: 'conflicting_op', details: { path: op.to } };
    }
  }
  return { ok: true };
}
