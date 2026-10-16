// Phase 1 Track C: generic validator driven by mutation data.
// Returns { status, body, headers } for a request against the active mutation,
// or null when the request fully satisfies the mutated contract (200 path).
// Pydantic-v1 style error records (§11).
export function validateRequest(mutation, body, headers) {
  if (!mutation) return null;

  // 1. Required header check first (realistic order: header before body).
  // Node/Express lowercase header keys; compare case-insensitively.
  const present = {};
  for (const k of Object.keys(headers ?? {})) present[String(k).toLowerCase()] = true;
  for (const h of mutation.headers ?? []) {
    if (h.required && !present[h.name.toLowerCase()]) {
      return { status: 400, body: h.error, headers: {} };
    }
  }

  // 2. Layered body validation: first failing layer wins.
  for (const layer of mutation.body?.layers ?? []) {
    if (!layer.when(body)) continue;
    if (!layer.check(body)) {
      return { status: 422, body: { detail: layer.errors() }, headers: {} };
    }
  }

  // 3. All layers pass -> the request matches the mutated contract.
  return null;
}

export function applyResponseMutation(response, operations = []) {
  const result = structuredClone(response);
  for (const operation of operations) {
    if (operation.op !== 'move' || typeof operation.from !== 'string' || typeof operation.to !== 'string') {
      throw new Error('unsupported mock response mutation');
    }
    const from = operation.from.split('.');
    const to = operation.to.split('.');
    let source = result;
    for (const part of from.slice(0, -1)) source = source?.[part];
    if (!source || !Object.hasOwn(source, from.at(-1))) continue;
    const value = source[from.at(-1)];
    delete source[from.at(-1)];
    let target = result;
    for (const part of to.slice(0, -1)) {
      target[part] ??= {};
      target = target[part];
    }
    target[to.at(-1)] = value;
  }
  return result;
}
