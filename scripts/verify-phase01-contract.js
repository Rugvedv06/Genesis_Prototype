const M5_OPS = ['add_header', 'move_field', 'rename_field', 'coerce_type'];

export function isConsistentConcurrentHealResult(response, expectedId, committedVersion) {
  const { ok, data, meta } = response?.json ?? {};
  if (!ok || String(data?.id) !== String(expectedId) || meta?.version !== committedVersion) return false;
  const ops = Array.isArray(meta.ops) ? meta.ops.map((op) => op.op) : [];
  const healedRequest = meta.healed === true && meta.rounds === 4 && ops.length === 4
    && ops.every((op, index) => op === M5_OPS[index]);
  const requestAfterCommit = meta.healed === false && meta.rounds === 0 && meta.tier === 0 && ops.length === 0;
  return healedRequest || requestAfterCommit;
}
