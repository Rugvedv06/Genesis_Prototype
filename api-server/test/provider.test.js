import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider, parseProviderSpec } from '../src/features/llm/provider.js';

test('Gemini provider specs separate provider and model', () => {
  assert.deepEqual(parseProviderSpec('gemini:gemini-2.5-flash'), {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
  });
  assert.deepEqual(parseProviderSpec('gemini:default'), {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
  });
});

test('Gemini health reports missing credentials without a network call', async () => {
  let calls = 0;
  const provider = createGeminiProvider({
    model: 'gemini-2.5-flash',
    apiKey: 'your_gemini_api_key_here',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not call network');
    },
  });
  assert.deepEqual(await provider.health(), {
    ok: false,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    code: 'missing_api_key',
  });
  assert.equal(calls, 0);
});

test('Gemini health distinguishes an unsupported model method', async () => {
  const provider = createGeminiProvider({
    model: 'gemini-test',
    apiKey: 'real-key',
    fetchImpl: async () => new Response(JSON.stringify({
      supportedGenerationMethods: ['embedContent'],
    }), { status: 200 }),
  });
  assert.equal((await provider.health()).code, 'unsupported_model_method');
});
