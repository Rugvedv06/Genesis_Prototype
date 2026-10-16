import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUpstreamUrl } from '../src/features/http/url-policy.js';

test('upstream URL policy accepts supported public URLs', () => {
  assert.equal(validateUpstreamUrl('https://api.example.com/v1').hostname, 'api.example.com');
});

test('upstream URL policy rejects unsupported schemes and embedded credentials', () => {
  assert.throws(() => validateUpstreamUrl('file:///etc/passwd'), /http or https/);
  assert.throws(() => validateUpstreamUrl('https://user:pass@example.com'), /embedded credentials/);
});

test('upstream URL policy can disable local and private destinations', () => {
  assert.throws(() => validateUpstreamUrl('http://127.0.0.1:5001', { allowLocal: false }), /local or private/);
  assert.throws(() => validateUpstreamUrl('http://169.254.169.254', { allowLocal: false }), /cloud metadata/);
});
