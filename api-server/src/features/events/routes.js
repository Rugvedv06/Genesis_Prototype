// Phase 1 Track B: GET /events SSE stream (§4.6).
import { bus } from './bus.js';
import { getPool } from '../../db/pool.js';
import { readEventsAfter } from '../../db/event-repository.js';

export function eventsRoute(app) {
  app.get('/events', async (req, res, next) => {
    if (process.env.DATABASE_URL) {
      const cursor = req.get('Last-Event-ID') ?? req.query.since ?? '0';
      const apiId = req.query.apiId;
      const types = req.query.types ? new Set(String(req.query.types).split(',').filter(Boolean)) : null;
      let lastSent = typeof cursor === 'string' ? cursor : String(cursor);
      const matches = (event) => (!apiId || event.apiId === apiId) && (!types || types.has(event.type));
      try {
        // Validate cursor and report retention/future resets before starting SSE headers.
        const initial = await readEventsAfter(getPool(), cursor, { apiId, types });
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders();
        const send = (event) => {
          if (!matches(event)) return;
          res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
          lastSent = String(event.id);
        };
        let cursorId = String(cursor);
        if (initial.resetReason) {
          res.write(`event: reset\nid: ${initial.highWaterId}\ndata: ${JSON.stringify({ reason: initial.resetReason, retentionFloor: initial.retentionFloor })}\n\n`);
          cursorId = initial.highWaterId;
          lastSent = cursorId;
        } else {
          for (const event of initial.events) send(event);
          cursorId = initial.events.length ? String(initial.events.at(-1).id) : initial.highWaterId;
          if (initial.events.length < 500) cursorId = initial.highWaterId;
        }
        let polling = false;
        const poll = async () => {
          if (polling || res.writableEnded) return;
          polling = true;
          try {
            const page = await readEventsAfter(getPool(), cursorId, { apiId, types });
            if (page.resetReason) {
              res.write(`event: reset\nid: ${page.highWaterId}\ndata: ${JSON.stringify({ reason: page.resetReason, retentionFloor: page.retentionFloor })}\n\n`);
              cursorId = page.highWaterId;
              lastSent = cursorId;
            } else {
              for (const event of page.events) send(event);
              if (page.events.length >= 500) cursorId = String(page.events.at(-1).id);
              else cursorId = page.highWaterId;
            }
          } catch {
            if (!res.writableEnded) res.write(`event: degraded\ndata: ${JSON.stringify({ code: 'event_store_unavailable', cursor: lastSent })}\n\n`);
          } finally { polling = false; }
        };
        const timer = setInterval(poll, 500);
        timer.unref();
        const ka = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
        req.on('close', () => { clearInterval(timer); clearInterval(ka); });
      } catch (error) {
        if (error instanceof TypeError) return res.status(400).json({ ok: false, error: 'invalid_event_cursor' });
        return next(error);
      }
      return;
    }
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
