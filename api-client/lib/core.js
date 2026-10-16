export const CORE = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000';
export const MOCK = process.env.NEXT_PUBLIC_MOCK_URL || 'http://localhost:5001';

export class CoreError extends Error {
  constructor(message, status, body) { super(message); this.name = 'CoreError'; this.status = status; this.body = body; }
}

// Never throws on HTTP status. Throws CoreError only on network failure or timeout.
async function raw(base, path, { method = 'GET', body, timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    throw new CoreError(err.name === 'AbortError' ? `Timed out after ${timeout} ms` : 'Cannot reach healr core', 0, null);
  } finally {
    clearTimeout(timer);
  }
}

// Throws CoreError on non-2xx.
async function strict(base, path, opts) {
  const r = await raw(base, path, opts);
  if (!r.ok) throw new CoreError(r.data?.message ?? r.data?.error ?? `HTTP ${r.status}`, r.status, r.data);
  return r.data;
}

const e = encodeURIComponent;
export const api = {
  state: () => strict(CORE, '/state'),
  recentEvents: (limit = 5000) => strict(CORE, `/events/recent?limit=${limit}`),
  series: (windowSec = 300, step = 5) => strict(CORE, `/metrics/timeseries?window=${windowSec}&step=${step}`),
  apiDetail: (id) => strict(CORE, `/apis/${e(id)}`),
  versions: (id, tool) => strict(CORE, `/apis/${e(id)}/tools/${e(tool)}/versions`),
  diff: (id, tool, from, to) => strict(CORE, `/apis/${e(id)}/tools/${e(tool)}/diff?from=${from}&to=${to}`),
  rollback: (id, tool, toVersion) => strict(CORE, `/apis/${e(id)}/tools/${e(tool)}/rollback`, { method: 'POST', body: { toVersion } }),
  patchConfig: (id, patch) => strict(CORE, `/apis/${e(id)}/config`, { method: 'PATCH', body: patch }),
  register: (payload) => strict(CORE, '/apis', { method: 'POST', body: payload }),
  remove: (id) => strict(CORE, `/apis/${e(id)}`, { method: 'DELETE' }),
  // invoke returns the body even when ok:false (HTTP 200 or 400). Only network errors throw.
  invoke: async (id, tool, args, runId) => (await raw(CORE, `/apis/${e(id)}/tools/${e(tool)}/invoke`, { method: 'POST', body: { args, runId }, timeout: 15000 })).data,
  audit: ({ limit = 100, offset = 0, decision, apiId, tool } = {}) => {
    const q = new URLSearchParams({ limit, offset, ...(decision && { decision }), ...(apiId && { apiId }), ...(tool && { tool }) });
    return strict(CORE, `/audit?${q}`);
  },
  auditRecent: async (limit = 100) => {
    const head = await api.audit({ limit: 1 });
    return api.audit({ limit, offset: Math.max(0, (head.count ?? 0) - limit) });
  },
  auditVerify: () => strict(CORE, '/audit/verify'),
  auditExportUrl: `${CORE}/audit/export`,
  trace: (callId) => strict(CORE, `/traces/${e(callId)}`),
  providerHealth: async () => (await raw(CORE, '/provider/health')).data,
  tamper: (index, mode) => strict(CORE, '/dev/tamper', { method: 'POST', body: { index, mode } }),
  tamperRestore: () => strict(CORE, '/dev/tamper/restore', { method: 'POST' }),
};

export const mock = {
  mutations: () => strict(MOCK, '/admin/mutations', { timeout: 3000 }),
  mutate: (id) => strict(MOCK, '/admin/mutate', { method: 'POST', body: { id } }),
  reset: () => strict(MOCK, '/admin/reset', { method: 'POST' }),
};
