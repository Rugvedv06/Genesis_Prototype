import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/limiter.js';

test('provider limiter bounds concurrent calls and releases slots after failures', async () => {
  const limiter = createLimiter(2); let active = 0; let maximum = 0;
  await Promise.all(Array.from({ length: 8 }, (_, i) => limiter.run(async () => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1;
    if (i === 3) throw new Error('expected');
  }).catch(() => {})));
  assert.equal(maximum, 2);
  assert.equal(limiter.active, 0);
});
