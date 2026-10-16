// Phase 0: single JSON-lines logger. All service logging goes through log(); no scattered console.log.
export function log(record) {
  const line = typeof record === 'string' ? { msg: record } : record;
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...line }));
}
