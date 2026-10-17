// Structured stdout remains the emergency sink; PostgreSQL logging is bounded and best-effort.
const SAFE_CONTEXT_KEYS = new Set(['port', 'version', 'signal', 'apiId', 'tool', 'errorClass', 'count']);
const MAX_PENDING_LOGS = 256;
let persistLog;
let pending = 0;
let dropped = 0;
let queue = Promise.resolve();

function safeRecord(record) {
  const line = typeof record === 'string' ? { msg: record } : (record && typeof record === 'object' ? record : {});
  const level = ['info', 'warn', 'error', 'fatal'].includes(line.level) ? line.level : 'info';
  const code = typeof line.code === 'string' && /^[a-z0-9_.:-]{1,96}$/i.test(line.code) ? line.code : 'service_event';
  const safe = { ts: new Date().toISOString(), level, service: 'api-server', code };
  if (typeof line.msg === 'string' && line.msg.length <= 256 && !/[\r\n]/.test(line.msg)
    && !/(https?:\/\/|password|secret|token|credential|authorization|cookie|api[_-]?key)/i.test(line.msg)) safe.msg = line.msg;
  for (const key of SAFE_CONTEXT_KEYS) {
    const value = line[key];
    if ((typeof value === 'string' && value.length <= 160 && /^[A-Za-z0-9_.:-]+$/.test(value)
      && !/(password|secret|token|credential|authorization|cookie)/i.test(value))
      || (typeof value === 'number' && Number.isFinite(value))) safe[key] = value;
  }
  return safe;
}

export function configureLogPersistence(writer) {
  if (writer !== null && typeof writer !== 'function') throw new TypeError('log persistence writer must be a function or null');
  persistLog = writer ?? undefined;
}

export function logPersistenceStatus() {
  return { pending, dropped };
}

export async function flushLogPersistence(timeoutMs = 1500) {
  let timer;
  try {
    await Promise.race([
      queue,
      new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, timeoutMs)); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function log(record) {
  const line = safeRecord(record);
  console.log(JSON.stringify(line));
  if (!persistLog) return;
  if (pending >= MAX_PENDING_LOGS) { dropped += 1; return; }
  pending += 1;
  queue = queue.then(() => persistLog(line)).catch(() => { dropped += 1; }).finally(() => { pending -= 1; });
}
