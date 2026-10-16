// Phase 1 Track A: apply() — produce a new immutable draft adapter by appending ops.
// The draft is never mutated in place; provenance enforcement happens at compile time.
export function apply(draft, ops) {
  if (!draft) throw new Error('apply: draft is required');
  // Copy the whole adapter (including _path/_method/_logicalSchema) then
  // replace request/response so metadata is preserved across heals.
  const next = { ...draft };
  next.request = [...(draft.request ?? [])];
  next.response = draft.response ? { ...draft.response, map: { ...draft.response.map } } : undefined;
  for (const op of ops) {
    // Validate op shape early so a malformed proposal fails fast.
    if (!op || !op.op) throw new Error('apply: op missing op field');
    next.request.push({ ...op });
  }
  return next;
}

export function compose(base, ...opLists) {
  let draft = base;
  for (const ops of opLists) draft = apply(draft, ops);
  return draft;
}
