'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync(fn, deps = []) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn); fnRef.current = fn;
  useEffect(() => {
    let live = true;
    setSt((p) => ({ ...p, loading: true }));
    fnRef.current().then((data) => live && setSt({ data, error: null, loading: false }))
      .catch((error) => live && setSt({ data: null, error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...st, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function usePolling(fn, ms, deps = []) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn); fnRef.current = fn;
  useEffect(() => {
    let live = true; let timer;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try { const data = await fnRef.current(); if (live) setSt({ data, error: null, loading: false }); }
        catch (error) { if (live) setSt((p) => ({ ...p, error, loading: false })); }
      }
      if (live) timer = setTimeout(tick, ms);
    };
    tick();
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...st, reload: useCallback(() => setN((x) => x + 1), []) };
}

// Re-render every second so "5s ago" labels stay honest.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
