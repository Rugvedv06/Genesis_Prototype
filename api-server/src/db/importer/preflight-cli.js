import { loadEnv } from '../../lib/env.js';
loadEnv();
const [{ inspectImportSources }, { applyFileImport }, { getPool, closePool }] = await Promise.all([
  import('./preflight.js'), import('./apply.js'), import('../pool.js'),
]);

function corePortStatus(port) {
  return import('node:net').then(({ createConnection }) => Promise.all(['127.0.0.1', '::1'].map((host) => new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(750, () => finish(null));
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED' ? true : null));
  })))).then((results) => results.includes(false) ? false : (results.every((result) => result === true) ? true : null)).catch(() => null);
}

try {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) throw Object.assign(new Error('Specify exactly one of --dry-run or --apply'), { code: 'import_mode_required' });
  const report = inspectImportSources({ includeData: apply });
  if (dryRun) {
    const { sourceData: _sourceData, ...safeReport } = report;
    console.log(JSON.stringify(safeReport));
  } else {
    if (!process.argv.includes('--confirm-core-stopped')) {
      throw Object.assign(new Error('--apply requires --confirm-core-stopped'), { code: 'core_stop_confirmation_required' });
    }
    const port = Number(process.env.PORT ?? 8000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Invalid core PORT'), { code: 'invalid_core_port' });
    const stopped = await corePortStatus(port);
    if (stopped !== true) throw Object.assign(new Error('Could not confirm the core is stopped'), { code: stopped === false ? 'core_is_running' : 'core_stop_status_unknown' });
    const hasAuditRewrite = report.counts.auditEntriesRequiringRedaction > 0
      || report.counts.changeEntriesRequiringRedaction > 0 || !report.auditIntegrity?.ok;
    const allowAuditRedactionAndRechain = process.argv.includes('--confirm-audit-redaction-and-rechain');
    if (hasAuditRewrite && !allowAuditRedactionAndRechain) {
      throw Object.assign(new Error('Import requires --confirm-audit-redaction-and-rechain; source hashes and indices will be retained as provenance while the database chain is rebuilt from redacted records'), { code: 'audit_redaction_confirmation_required' });
    }
    const result = await applyFileImport({ pool: getPool(), report, allowAuditRedactionAndRechain });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code ?? 'import_preflight_failed',
    details: error.details ?? Object.fromEntries(['constraint', 'table', 'column'].filter((key) => error[key]).map((key) => [key, error[key]])) }));
  process.exitCode = 1;
} finally {
  try { await closePool(); } catch { process.exitCode = 1; }
}
