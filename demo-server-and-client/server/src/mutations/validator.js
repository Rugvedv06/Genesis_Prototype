// Phase 1 Track C: generic validator driven by mutation data.
// Returns { status, body, headers } for a request against the active mutation,
// or null when the request fully satisfies the mutated contract (200 path).
// Pydantic-v1 style error records (§11).
const ERROR_STYLES = new Set(['pydantic-v1', 'pydantic-v2', 'problem-json']);

function styledValidationFailure(failure, style) {
  if (!ERROR_STYLES.has(style)) throw new TypeError(`unsupported mock error style: ${style}`);
  if (style === 'pydantic-v1') return failure;

  if (failure.body?.error === 'missing_auth') {
    const auth = {
      error: failure.body?.error ?? 'missing_auth',
      scheme: failure.body?.scheme ?? 'Bearer',
      header: failure.body?.header ?? 'Authorization',
    };
    if (style === 'pydantic-v2') {
      return { ...failure, body: { detail: 'Not authenticated', ...auth } };
    }
    return {
      ...failure,
      body: {
        type: 'https://api.example/problems/authentication-error',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authentication required',
        errors: [],
        ...auth,
      },
    };
  }

  const canonical = failure.body?.error === 'missing_header'
    ? [{
        loc: ['header', failure.body.header.toLowerCase()],
        msg: 'Field required', type: 'missing',
        ctx: Array.isArray(failure.body.allowed) ? { allowed_values: failure.body.allowed } : {},
      }]
    : (failure.body?.detail ?? []);
  const errors = canonical.map((error) => {
    const type = style === 'pydantic-v2'
      ? ({
          'value_error.missing': 'missing',
          'value_error.extra': 'extra_forbidden',
          'type_error.integer': 'int_type',
          'type_error.enum': 'enum',
        }[error.type] ?? error.type)
      : error.type;
    return {
      loc: error.loc,
      msg: error.msg,
      type,
      ...(error.ctx ? { ctx: error.ctx } : {}),
    };
  });

  if (style === 'pydantic-v2') return { ...failure, body: { detail: errors } };
  return {
    ...failure,
    body: {
      type: 'https://api.example/problems/validation-error',
      title: failure.status === 400 ? 'Bad Request' : 'Unprocessable Entity',
      status: failure.status,
      detail: 'Request validation failed',
      errors,
    },
  };
}

export function validateRequest(mutation, body, headers, errorStyle = 'pydantic-v1') {
  if (!mutation) return null;

  // 1. Required header check first (realistic order: header before body).
  // Node/Express lowercase header keys; compare case-insensitively.
  const present = {};
  for (const k of Object.keys(headers ?? {})) present[String(k).toLowerCase()] = true;
  for (const h of mutation.headers ?? []) {
    if (h.required && !present[h.name.toLowerCase()]) {
      return styledValidationFailure({ status: h.status ?? 400, body: h.error, headers: {} }, errorStyle);
    }
  }

  // 2. Layered body validation: first failing layer wins.
  for (const layer of mutation.body?.layers ?? []) {
    if (!layer.when(body)) continue;
    if (!layer.check(body)) {
      return styledValidationFailure({ status: 422, body: { detail: layer.errors() }, headers: {} }, errorStyle);
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
