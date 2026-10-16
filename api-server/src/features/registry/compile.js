// Phase 1 Track A: compileAdapter + coerceLossless (§5.4).
// Compiles an adapter (typed ops + response map) into a request builder that
// enforces provenance: every leaf value traces to arg, arg:coerced, arg:enum_mapped,
// spec_default, or credential. Anything else throws ProvenanceError -> halt.
import { getPath, setPath, deletePath, leafPaths } from '../../lib/paths.js';
import { sha256 } from '../../lib/hash.js';

export class ProvenanceError extends Error {
  constructor(path) {
    super(`provenance_violation: leaf "${path}" has no traceable origin`);
    this.path = path;
  }
}

export class NotLossless extends Error {
  constructor(value, from, to) {
    super(`coerce_type not lossless: ${JSON.stringify(value)} ${from}->${to}`);
    this.value = value;
    this.from = from;
    this.to = to;
  }
}

function moveOrigins(origin, from, to) {
  for (const [p, o] of [...origin]) {
    if (p === from || p.startsWith(from + '.')) {
      origin.delete(p);
      origin.set(to + p.slice(from.length), o);
    }
  }
}

function resolveSource(source, c) {
  switch (source.type) {
    case 'credential':
      if (!c.resolveCredential) throw new Error(`no resolveCredential for ${source.ref}`);
      return c.resolveCredential(source.ref);
    case 'spec_default':
      return source.value;
    case 'error_enum':
      return source.value;
    default:
      throw new Error(`unsupported source type ${source.type}`);
  }
}

function applyOp(op, c) {
  switch (op.op) {
    case 'rename_field': {
      const from = op.path ? `${op.path}.${op.from}` : op.from;
      const to = op.path ? `${op.path}.${op.to}` : op.to;
      setPath(c.body, to, getPath(c.body, from));
      deletePath(c.body, from);
      moveOrigins(c.origin, from, to);
      break;
    }
    case 'move_field': {
      setPath(c.body, op.to, getPath(c.body, op.from));
      deletePath(c.body, op.from);
      moveOrigins(c.origin, op.from, op.to);
      break;
    }
    case 'coerce_type': {
      setPath(c.body, op.path, coerceLossless(getPath(c.body, op.path), op.from, op.to));
      c.origin.set(op.path, 'arg:coerced');
      break;
    }
    case 'add_header': {
      c.headers[op.name] = resolveSource(op.source, c);
      break;
    }
    case 'add_field': {
      setPath(c.body, op.path, resolveSource(op.source, c));
      c.origin.set(op.path, op.source.type);
      break;
    }
    case 'set_enum_map': {
      const v = getPath(c.body, op.path);
      if (!Object.hasOwn(op.map, v)) throw new ProvenanceError(op.path);
      setPath(c.body, op.path, op.map[v]);
      c.origin.set(op.path, 'arg:enum_mapped');
      break;
    }
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

export function coerceLossless(v, from, to) {
  if (from === 'string' && to === 'integer') {
    if (typeof v === 'string' && /^-?\d+$/.test(v) && String(Number(v)) === v && Number.isSafeInteger(Number(v))) {
      return Number(v);
    }
  } else if (from === 'integer' && to === 'string') {
    if (Number.isInteger(v)) return String(v);
  }
  throw new NotLossless(v, from, to); // "007" -> 7 is NOT lossless, so it halts
}

export function compileAdapter(adapter, resolveCredential) {
  const reqOps = adapter.request ?? [];
  const respMap = adapter.response?.map ?? {};

  return {
    buildRequest(args, resolve = resolveCredential) {
      const body = structuredClone(args);
      const origin = new Map(leafPaths(body).map((p) => [p, 'arg']));
      const headers = {};
      const c = { body, headers, origin, args, resolveCredential: resolve };
      for (const op of reqOps) applyOp(op, c);
      for (const p of leafPaths(c.body)) {
        if (!c.origin.has(p)) throw new ProvenanceError(p); // every leaf traceable
      }
      return { body, headers };
    },
    extract(json) {
      const out = {};
      for (const [logical, path] of Object.entries(respMap)) out[logical] = getPath(json, path);
      return out;
    },
    adapterHash: sha256(JSON.stringify({ request: reqOps, response: respMap })),
  };
}
