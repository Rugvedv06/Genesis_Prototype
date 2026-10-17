import * as audit from './index.js';
import { cfg } from '../../config.js';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
import { getPool } from '../../db/pool.js';
import { exportAuditNdjson, getAuditHead, listAuditRecords, verifyAuditChain } from '../../db/audit-repository.js';
import { withTransaction } from '../../db/transaction.js';

export function auditRoutes(app) {
  app.get('/audit', async (req, res, next) => {
    try {
    const rawLimit = req.query.limit ?? '50';
    const rawOffset = req.query.offset ?? '0';
    const limit = typeof rawLimit === 'string' && /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    const offset = typeof rawOffset === 'string' && /^\d{1,7}$/.test(rawOffset) ? Number(rawOffset) : NaN;
    const validFilter = (value) => value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value));
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset > 1_000_000
      || !validFilter(req.query.decision) || !validFilter(req.query.apiId) || !validFilter(req.query.tool)) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments' });
    }
    const filters = {
      limit,
      offset,
      decision: req.query.decision,
      apiId: req.query.apiId,
      tool: req.query.tool,
    };
    let records;
    let head;
    if (process.env.DATABASE_URL) {
      ({ records, head } = await withTransaction(async (client) => ({
        records: await listAuditRecords(client, filters),
        head: await getAuditHead(client),
      }), { isolation: 'REPEATABLE READ' }));
    } else {
      records = audit.list(filters);
      head = audit.head();
    }
    res.json({ records, ...head });
    } catch (error) { next(error); }
  });
  app.get('/audit/verify', async (_req, res, next) => {
    try { res.json(process.env.DATABASE_URL ? await verifyAuditChain(getPool()) : audit.verify()); }
    catch (error) { next(error); }
  });
  app.get('/audit/export', async (_req, res, next) => {
    try { res.type('application/x-ndjson').send(process.env.DATABASE_URL ? await exportAuditNdjson(getPool()) : audit.exportNdjson()); }
    catch (error) { next(error); }
  });
  if (cfg.enableDevRoutes && !process.env.DATABASE_URL) {
<<<<<<< HEAD
=======
=======

export function auditRoutes(app) {
  app.get('/audit', (req, res) => {
    const records = audit.list({
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
      decision: req.query.decision,
      apiId: req.query.apiId,
      tool: req.query.tool,
    });
    res.json({ records, ...audit.head() });
  });
  app.get('/audit/verify', (_req, res) => res.json(audit.verify()));
  app.get('/audit/export', (_req, res) => {
    res.type('application/x-ndjson').send(audit.exportNdjson());
  });
  if (cfg.enableDevRoutes) {
>>>>>>> origin/main
>>>>>>> origin/main
    app.post('/dev/tamper', (req, res) => {
      const index = Number(req.body?.index);
      if (!audit.tamper(index, req.body?.mode)) return res.status(400).json({ ok: false, error: 'invalid_arguments' });
      res.json({ ok: true });
    });
    app.post('/dev/tamper/restore', (_req, res) => res.json({ ok: audit.restore() }));
  }
}
