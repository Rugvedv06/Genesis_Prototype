const PLACEHOLDERS = new Set(['', 'changeme', 'xxx']);
export function isPlaceholderKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return PLACEHOLDERS.has(key) || key.startsWith('your_') || key.includes('placeholder');
}

export function parseKeys(env = process.env) {
  const configured = env.GEMINI_API_KEYS;
  const raw = configured !== undefined ? String(configured).split(',') : [env.GEMINI_API_KEY ?? ''];
  const unique = new Set();
  for (const value of raw) {
    const key = String(value ?? '').trim();
    if (!isPlaceholderKey(key)) unique.add(key);
  }
  return [...unique];
}

export function createKeyPool(keys = [], { startIndex = Math.floor(Math.random() * Math.max(keys.length, 1)), now = Date.now, cooldownMs = 30000, random = Math.random } = {}) {
  const slots = keys.map(() => ({ state: 'healthy', cooldownUntil: 0 }));
  let cursor = keys.length ? ((startIndex % keys.length) + keys.length) % keys.length : 0;
  return {
    get size() { return keys.length; },
    next() {
      if (!keys.length) return null;
      for (let offset = 0; offset < keys.length; offset += 1) {
        const slot = (cursor + offset) % keys.length;
        const state = slots[slot];
        if (state.state === 'cooldown' && state.cooldownUntil <= now()) state.state = 'healthy';
        if (state.state === 'healthy') {
          cursor = (slot + 1) % keys.length;
          return { key: keys[slot], slot };
        }
      }
      return null;
    },
    markUnauthorized(slot) { if (slots[slot]) slots[slot].state = 'disabled'; },
    markRateLimited(slot, retryAfterMs) {
      if (!slots[slot]) return;
      const baseDelay = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, 120000) : cooldownMs;
      const delay = Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.min(120000, baseDelay + Math.floor(random() * Math.min(baseDelay * 0.2, 5000)))
        : Math.floor(baseDelay * (0.8 + random() * 0.4));
      slots[slot].state = 'cooldown';
      slots[slot].cooldownUntil = now() + delay;
    },
    health() {
      for (const slot of slots) if (slot.state === 'cooldown' && slot.cooldownUntil <= now()) slot.state = 'healthy';
      return { size: keys.length, healthy: slots.filter((s) => s.state === 'healthy').length, slots: slots.map((s, slot) => ({ slot, state: s.state })) };
    },
  };
}
