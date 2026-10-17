export function createLimiter(limit = 4) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 4;
  let active = 0;
  const waiters = [];
  return {
    get active() { return active; },
    async run(task, { signal } = {}) {
      if (signal?.aborted) { const error = new Error('Provider request aborted'); error.code = 'aborted'; throw error; }
      if (active >= cap) {
        let onAbort;
        await new Promise((resolve, reject) => {
          const waiter = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', onAbort) };
          waiters.push(waiter);
          if (signal) {
            onAbort = () => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              const error = new Error('Provider request aborted'); error.code = 'aborted'; reject(error);
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
      if (signal?.aborted) { const error = new Error('Provider request aborted'); error.code = 'aborted'; throw error; }
      active += 1;
      try { return await task(); }
      finally { active -= 1; const waiter = waiters.shift(); waiter?.cleanup?.(); waiter?.resolve(); }
    },
  };
}
