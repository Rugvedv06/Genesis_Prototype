import test from 'node:test';
import assert from 'node:assert/strict';
import { isDemoBaseUrl } from './demo-url.js';

test('demo API detection accepts equivalent configured mock URLs', () => {
  assert.equal(isDemoBaseUrl('http://localhost:5001/', 'http://localhost:5001'), true);
  assert.equal(isDemoBaseUrl('HTTP://LOCALHOST:5001', 'http://localhost:5001/'), true);
  assert.equal(isDemoBaseUrl('http://127.0.0.1:5001', 'http://localhost:5001'), true);
  assert.equal(isDemoBaseUrl('http://localhost:5002', 'http://localhost:5001'), false);
  assert.equal(isDemoBaseUrl('https://example.com', 'http://localhost:5001'), false);
  assert.equal(isDemoBaseUrl('not a URL', 'http://localhost:5001'), false);
  assert.equal(isDemoBaseUrl(undefined, 'http://localhost:5001'), false);
});
