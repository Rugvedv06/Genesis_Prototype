// Phase 1 Track A: normalize error bodies into uniform records (§4.4, §5.1).
// Supported shapes: pydantic-v1 {detail:[{loc,msg,type}]}, pydantic-v2,
// problem-json {errors[]}, and the mock's canonical missing-header shape.
// Each record: {kind, path, expected, received, allowed, header, raw}
//   kind: 'missing' | 'extra' | 'type' | 'missing_header' | 'auth' | 'unknown'
//   path: dotted-key array within the request body (leading 'body'/'header' stripped)

export function parseErrors(body, status) {
  if (body === null || body === undefined || typeof body !== 'object') return [];

  // Mock canonical missing-header header check (§11 M4/M5)
  if (body.error === 'missing_header' && body.header) {
    return [{
      kind: 'missing_header',
      header: body.header,
      allowed: body.allowed ?? null,
      path: [],
      expected: null,
      received: null,
      raw: body,
    }];
  }

  // Auth errors (401 / WWW-Authenticate) — never healed in Phase 1.
  if (status === 401 || body.scheme === 'Bearer' || body.error === 'missing_auth') {
    return [{
      kind: 'auth',
      header: body.header ?? null,
      path: [],
      expected: null,
      received: null,
      allowed: null,
      raw: body,
    }];
  }

  const details = Array.isArray(body.detail) ? body.detail : Array.isArray(body.errors) ? body.errors : [];
  return details.map((d) => normalizeDetail(d, body));
}

function normalizeDetail(d, rootBody) {
  const loc = Array.isArray(d.loc) ? d.loc : (d.loc == null ? [] : [String(d.loc)]);
  const path = stripBodyPrefix(loc);
  const t = String(d.type ?? '');
  let kind = 'unknown';

  // Header errors signalled via loc (e.g. pydantic-v2 loc:['header','x-api-version'])
  if (loc.length > 0 && loc[0] === 'header') {
    kind = 'missing_header';
  } else if (t.includes('missing')) {
    kind = 'missing';
  } else if (t.includes('extra')) {
    kind = 'extra';
  } else if (t.includes('enum')) {
    kind = 'enum';
<<<<<<< HEAD
  } else if (t.includes('integer') || t.includes('int_type') || t.includes('int_parsing') || t.includes('is_instance') || t.includes('type_error')) {
=======
<<<<<<< HEAD
  } else if (t.includes('integer') || t.includes('int_type') || t.includes('int_parsing') || t.includes('is_instance') || t.includes('type_error')) {
=======
  } else if (t.includes('integer') || t.includes('int_parsing') || t.includes('is_instance') || t.includes('type_error')) {
>>>>>>> origin/main
>>>>>>> origin/main
    kind = 'type';
  } else if (t.includes('extra_forbidden')) {
    kind = 'extra';
  } else if (t.includes('regex') || t.includes('pattern') || t.includes('email') || t.includes('length') || t.includes('range') || t.includes('greater') || t.includes('less') || t === 'value_error') {
    kind = 'value';
  }

  return {
    kind,
    path,
    expected: d.ctx?.expected ?? d.ctx?.allowed_values ?? null,
    received: d.input ?? null,
    allowed: d.ctx?.allowed_values ?? d.ctx?.allowed ?? d.ctx?.enum_values ?? d.allowed ?? null,
    header: kind === 'missing_header' ? (loc[1] ?? null) : null,
    raw: d,
    class: kind === 'value' ? 'value' : 'structural',
    _root: rootBody,
  };
}

function stripBodyPrefix(loc) {
  const start = loc.length > 0 && (loc[0] === 'body' || loc[0] === 'header') ? 1 : 0;
  return loc.slice(start);
}

export function classify(errors, status) {
  if (status === 0 || status === null || status === undefined) return 'network';
  if (!errors || errors.length === 0) {
    if (status === 401) return 'auth4xx';
    return status >= 500 ? 'transient' : 'other4xx';
  }
  if (errors.some((e) => e.kind === 'auth')) return 'auth4xx';
  if (errors.some((e) => e.class === 'value')) return 'value_rejected';
  if (errors.some((e) => e.kind === 'missing_header')) return 'header4xx';
  if (status === 401) return 'auth4xx';
  if (status >= 400 && status < 500) return 'validation4xx';
  if (status >= 500) return 'transient';
  return 'other4xx';
}
