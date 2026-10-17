// Reconnects with backoff and resumes from the last seen id. Server sends only `id:` and `data:` lines.
export function connectSSE({ url, getLastId, onOpen, onEvent, onError }) {
  let es = null;
  let closed = false;
  let retry = 0;
  let timer = null;
  const open = () => {
    if (closed) return;
    es = new EventSource(`${url}?since=${getLastId()}`);
    es.onopen = () => { retry = 0; onOpen(); };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore malformed frame */ } };
    es.onerror = () => {
      onError();
      es.close();
      timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 8000));
    };
  };
  open();
  return () => { closed = true; clearTimeout(timer); es?.close(); };
}
