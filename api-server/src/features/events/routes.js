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
    const send = (e) => res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    bus.since(sinceId).forEach(send);
    const off = bus.on(send);
    const ka = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      off();
      clearInterval(ka);
    });
  });
}
