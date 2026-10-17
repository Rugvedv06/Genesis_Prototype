import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyPool, parseKeys } from '../src/keypool.js';

test('Gemini keys rotate round robin and omit secrets from health', () => {
  const keys = parseKeys({ GEMINI_API_KEYS: 'alpha, beta,alpha,your_gemini_api_key_here' });
  assert.deepEqual(keys, ['alpha', 'beta']);
  const pool = createKeyPool(keys, { startIndex: 0 });
  assert.equal(pool.next().key, 'alpha');
  assert.equal(pool.next().key, 'beta');
  assert.equal(pool.next().key, 'alpha');
  assert.equal(JSON.stringify(pool.health()).includes('alpha'), false);
});

test('Gemini key pool supports legacy key and disables unauthorized slots', () => {
  const [key] = parseKeys({ GEMINI_API_KEY: 'solo' });
  const pool = createKeyPool([key], { startIndex: 0 });
  pool.markUnauthorized(0);
  assert.equal(pool.next(), null);
  assert.deepEqual(pool.health().slots, [{ slot: 0, state: 'disabled' }]);
});

test('429 cooldown makes a slot temporarily ineligible and it returns after expiry', () => {
  let time = 100;
  const keys = ['a', 'b'];
  const pool = createKeyPool(keys, { startIndex: 0, now: () => time, cooldownMs: 50, random: () => 0.5 });
  const first = pool.next();
  pool.markRateLimited(first.slot);
  const second = pool.next();
  assert.equal(second.key, 'b');
  pool.markRateLimited(second.slot);
  assert.equal(pool.next(), null);
  time += 51;
  assert.equal(pool.next().key, 'a');
});

test('agent and diagnoser providers share one process key rotation', async () => {
  const { getProvider } = await import('../src/index.js');
  const env = { GEMINI_API_KEYS: 'one,two', AGENT_LLM: 'gemini:m', DIAGNOSER_LLM: 'gemini:m' };
  const agent = getProvider('agent', env);
  const diagnoser = getProvider('diagnoser', env);
  assert.equal(agent.keyPool, diagnoser.keyPool);
});
