import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify-m5-live.mjs', import.meta.url));

test('live verification skips cleanly and writes machine-readable evidence when keys are missing', async () => {
  const child = spawn(process.execPath, [script], { env: { ...process.env, GEMINI_API_KEYS: '', GEMINI_API_KEY: '', M5_LIVE_RESULTS: '/tmp/healr-m5-live-skip-test.json' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(code, 0, stderr);
  assert.match(stdout, /SKIP.*Gemini credentials/i);
  const saved = JSON.parse(await readFile('/tmp/healr-m5-live-skip-test.json', 'utf8'));
  assert.equal(saved.status, 'skipped');
  assert.equal(saved.checks[0].status, 'skipped');
});
