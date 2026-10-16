// Phase 1 Track B: GET /events SSE stream (§4.6).
import { bus } from './bus.js';

export function eventsRoute(app) {
  app.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const sinceId = Number(req.get('Last-Event-ID') ?? req.query.since ?? 0);
    const apiId = req.query.apiId;
    const types = req.query.types ? new Set(String(req.query.types).split(',').filter(Boolean)) : null;
    const matches = (e) => (!apiId || e.apiId === apiId) && (!types || types.has(e.type));
    const send = (e) => { if (matches(e)) res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`); };
    const off = bus.on(send);
    bus.since(sinceId).forEach(send);
    const ka = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      off();
      clearInterval(ka);
    });
  });
}
