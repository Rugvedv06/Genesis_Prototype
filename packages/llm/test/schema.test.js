import test from 'node:test';
import assert from 'node:assert/strict';
import { toGeminiSchema } from '../src/gemini.js';

test('Gemini schema converter retains only documented Schema fields recursively', () => {
  assert.deepEqual(toGeminiSchema({
    $schema: 'draft-07', type: 'object', additionalProperties: false, oneOf: [],
    properties: { status: { type: 'string', enum: ['active'], const: 'active', customKeyword: true } },
    required: ['status'],
  }), {
    type: 'object', properties: { status: { type: 'string', enum: ['active'] } }, required: ['status'],
  });
});
