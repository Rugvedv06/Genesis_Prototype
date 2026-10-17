import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider } from '../src/gemini.js';

test('Gemini generation uses header auth and parses function calls and usage', async () => {
  let request;
  const provider = createGeminiProvider({ model: 'gemini-2.5-flash', keys: ['secret'], startIndex: 0, fetchImpl: async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall: { name: 'read_user', args: { id: 'u1' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14, thoughtsTokenCount: 2 },
    }), { status: 200 });
  }});
  const result = await provider.generate({ system: 'sys', messages: [{ role: 'user', text: 'go' }], tools: [{ name: 'read_user', parameters: { type: 'object', properties: {} } }] });
  assert.equal(new URL(request.url).searchParams.has('key'), false);
  assert.equal(request.init.headers['x-goog-api-key'], 'secret');
  assert.deepEqual(result.toolCalls[0].args, { id: 'u1' });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 6, totalTokens: 14, thinkingTokens: 2 });
  assert.equal(result.keySlot, 0);
});

test('Gemini REST structured output uses the API enum and converted schema', async () => {
  let request;
  const provider = createGeminiProvider({ keys: ['secret'], startIndex: 0, fetchImpl: async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
  }});
  await provider.generate({ jsonSchema: { type: 'object', properties: { ok: { type: 'boolean', unsupportedKeyword: true } }, required: ['ok'], unsupportedRoot: true } });
  assert.deepEqual(request.generationConfig.responseFormat, {
    text: { mimeType: 'APPLICATION_JSON', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
  });
});

test('Gemini errors are classified without leaking response bodies or key material', async () => {
  for (const [status, code] of [[401, 'invalid_or_unauthorized_key'], [403, 'invalid_or_unauthorized_key'], [429, 'quota_or_rate_limit'], [503, 'provider_unavailable'], [400, 'provider_request_failed']]) {
    const provider = createGeminiProvider({ model: 'm', keys: ['secret-key'], startIndex: 0, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'do not leak this or secret-key' } }), { status }) });
    await assert.rejects(provider.generate({ messages: [{ role: 'user', text: 'hi' }] }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes('secret-key'), false);
      return true;
    });
  }
});

test('Gemini request failures retain a bounded provider diagnostic with configured keys redacted', async () => {
  const provider = createGeminiProvider({ keys: ['private-key'], startIndex: 0, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Invalid schema for private-key' } }), { status: 400 }) });
  await assert.rejects(provider.generate({}), (error) => {
    assert.equal(error.providerMessage, 'Invalid schema for [redacted]');
    return true;
  });
});

test('Gemini abort and network failures have stable error codes', async () => {
  const network = createGeminiProvider({ keys: ['k'], startIndex: 0, fetchImpl: async () => { throw new Error('private endpoint'); } });
  await assert.rejects(network.generate({}), { code: 'network_error' });
  const controller = new AbortController(); controller.abort();
  const aborted = createGeminiProvider({ keys: ['k'], startIndex: 0, fetchImpl: async (_url, init) => { assert.equal(init.signal.aborted, true); throw new Error('aborted'); } });
  await assert.rejects(aborted.generate({ signal: controller.signal }), { code: 'aborted' });
});
