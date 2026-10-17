import * as audit from './index.js';
import { cfg } from '../../config.js';

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
    app.post('/dev/tamper', (req, res) => {
      const index = Number(req.body?.index);
      if (!audit.tamper(index, req.body?.mode)) return res.status(400).json({ ok: false, error: 'invalid_arguments' });
      res.json({ ok: true });
    });
    app.post('/dev/tamper/restore', (_req, res) => res.json({ ok: audit.restore() }));
  }
}
