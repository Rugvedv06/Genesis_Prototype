<<<<<<< HEAD
// Reconnects with backoff and resumes from the last durable decimal-string cursor.
export function connectSSE({ url, getLastId, onOpen, onEvent, onError, onReset }) {
=======
// Reconnects with backoff and resumes from the last seen id. Server sends only `id:` and `data:` lines.
export function connectSSE({ url, getLastId, onOpen, onEvent, onError }) {
>>>>>>> origin/main
  let es = null;
  let closed = false;
  let retry = 0;
  let timer = null;
  const open = () => {
    if (closed) return;
<<<<<<< HEAD
    es = new EventSource(`${url}?since=${encodeURIComponent(getLastId())}`);
    es.onopen = () => { retry = 0; onOpen(); };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore malformed frame */ } };
    es.addEventListener('reset', (m) => {
      try { onReset?.(JSON.parse(m.data), m.lastEventId); } catch { onReset?.({ reason: 'cursor_reset' }, m.lastEventId); }
    });
=======
    es = new EventSource(`${url}?since=${getLastId()}`);
    es.onopen = () => { retry = 0; onOpen(); };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore malformed frame */ } };
>>>>>>> origin/main
    es.onerror = () => {
      onError();
      es.close();
      timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 8000));
    };
  };
  open();
  return () => { closed = true; clearTimeout(timer); es?.close(); };
}
