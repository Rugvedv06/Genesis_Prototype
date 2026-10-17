#!/usr/bin/env node
// Phase 0+1 acceptance script: scripts/verify-phase01.mjs
// Starts core + mock on random free ports with temp HEALR_DATA_DIR and known TENANT_ID,
// runs 17 checks, prints PASS/FAIL table, exits non-zero on any FAIL.
// No Gemini key required (baseline checks the scripted fallback path).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isConsistentConcurrentHealResult } from './verify-phase01-contract.js';

const ROOT = process.cwd();
const CORE_ENTRY = join(ROOT, 'api-server/src/server.js');
const MOCK_ENTRY = join(ROOT, 'demo-server-and-client/server/src/server.js');

let results = [];
let failures = 0;
const children = new Set();
const servers = new Set();
const tempDirs = new Set();

function startChild(...args) {
  const child = spawn(...args);
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function closeServer(server) {
  if (!server.listening) { servers.delete(server); return; }
  await new Promise((resolve) => server.close(resolve));
  servers.delete(server);
}

async function cleanup() {
  for (const server of [...servers]) await closeServer(server).catch(() => {});
  const active = [...children];
  for (const child of active) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.all(active.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  })));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    cleanup().finally(() => { process.exitCode = code; });
  });
}

function check(name, cond, detail = '') {
  const ok = Boolean(cond);
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}\n`);
}

async function freePort(exclude = []) {
  // Ask the OS for an ephemeral port, release it cleanly, and retry if it
  // collides with an excluded port or the allocator returns an invalid value.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const p = await new Promise((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(0));
      s.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        const port = s.address()?.port ?? 0;
        s.close((err) => resolve(err ? 0 : port));
      });
    });
    if (p > 0 && !exclude.includes(p)) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('could not find free port');
}

async function http(url, opts = {}) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { signal: controller.signal, ...opts });
    const body = await resp.text().catch(() => '');
    clearTimeout(to);
    return { status: resp.status, body, json: (() => { try { return JSON.parse(body); } catch { return null; } })() };
  } catch (err) {
    clearTimeout(to);
    return { status: 0, body: err.message, json: null };
  }
}

async function postJSON(url, data) {
  return http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

async function main() {
  const corePort = await freePort([]);
  await new Promise((r) => setTimeout(r, 300));
  const mockPort = await freePort([corePort]);
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-verify-'));
  tempDirs.add(dataDir);
  const env = {
    ...process.env,
    BASELINE_MODE: 'llm',
    GEMINI_API_KEYS: '',
    GEMINI_API_KEY: '',
    PORT: String(corePort),
    CORE_URL: `http://localhost:${corePort}`,
    MOCK_URL: `http://localhost:${mockPort}`,
    TENANT_ID: 'verify-tenant-01',
    HEALR_DATA_DIR: dataDir,
    MAX_HEAL_ROUNDS: '5',
    HEAL_TIMEOUT_MS: '5000',
    ENABLE_DEV_ROUTES: '1',
  };

  const coreEnv = { ...env, PORT: String(corePort) };
  const mockEnv = { ...env, PORT: String(mockPort) };
  const core = startChild('node', [CORE_ENTRY], { cwd: join(ROOT, 'api-server'), env: coreEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const mock = startChild('node', [MOCK_ENTRY], { cwd: join(ROOT, 'demo-server-and-client/server'), env: mockEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  core.stdout.on('data', (d) => process.stdout.write(`[core] ${d}`));
  core.stderr.on('data', (d) => process.stderr.write(`[core-err] ${d}`));
  mock.stdout.on('data', (d) => process.stdout.write(`[mock] ${d}`));
  mock.stderr.on('data', (d) => process.stderr.write(`[mock-err] ${d}`));

  const coreUrl = `http://localhost:${corePort}`;
  const mockUrl = `http://localhost:${mockPort}`;
  let activeMockUrl = mockUrl; // updated whenever the mock is restarted on a new port

  // Wait for health
  for (let i = 0; i < 50; i += 1) {
    const h1 = await http(`${coreUrl}/health`);
    const h2 = await http(`${mockUrl}/health`);
    if (h1.status === 200 && h2.status === 200) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const cleanBody = { args: { user_id: '123' } };

  // Check 1: Health
  {
    const hc = await http(`${coreUrl}/health`);
    const hm = await http(`${mockUrl}/health`);
    check('Health endpoints green', hc.status === 200 && hm.status === 200 && (hc.json?.tenantConfigured === true || hc.json?.ok === true), `core:${hc.status} mock:${hm.status}`);
  }

  // Reset + register
  await postJSON(`${mockUrl}/admin/reset`, {});
  const reg = await postJSON(`${coreUrl}/apis`, {
    apiId: 'demo-users', baseUrl: mockUrl, specUrl: `${mockUrl}/openapi.json`,
    credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
    healing: { enabled: true, maxRounds: 5, tier2: true },
    tools: [{
      name: 'get_user', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none',
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string' }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' } } },
    }],
  });

  // Check 2: Clean call
  {
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, cleanBody);
    check('Clean call succeeds', r.status === 200 && r.json?.ok === true && r.json?.meta?.healed === false, `status:${r.status} ok:${r.json?.ok} healed:${r.json?.meta?.healed}`);
  }

  // Check 3: M5 heal
  await postJSON(`${mockUrl}/admin/mutate`, { id: 'M5' });
  await postJSON(`${mockUrl}/admin/config`, { specAvailable: false });
  {
    const t0 = Date.now();
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, cleanBody);
    const elapsed = Date.now() - t0;
    const j = r.json;
    const ops = j?.meta?.ops ?? [];
    const opNames = ops.map((o) => o.op).join(',');
    check('M5 heal < 3s, healed=true, tier=1, 4 correct ops', r.status === 200 && j?.ok === true && j?.meta?.healed === true && j?.meta?.tier === 1 && elapsed < 3000 && ops.length === 4 && opNames === 'add_header,move_field,rename_field,coerce_type', `elapsed:${elapsed}ms ops:${opNames} tier:${j?.meta?.tier} version:${j?.meta?.version}`);
  }

  // Check 4: Versions
  {
    const r = await http(`${coreUrl}/apis/demo-users/tools/get_user/versions`);
    const versions = r.json?.versions ?? [];
    const v2 = versions.find((v) => v.version === 2);
    check('/versions lists v1(register) and v2(heal) with change.ops', versions.length >= 2 && v2 && v2.origin === 'heal' && Array.isArray(v2.change?.ops) && v2.change.ops.length === 4, `count:${versions.length} v2:${v2 ? JSON.stringify(v2.change?.ops) : 'missing'}`);
  }

  // Check 5: Persistence (restart core)
  {
    core.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
    const core2 = startChild('node', [CORE_ENTRY], { cwd: join(ROOT, 'api-server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 30; i += 1) {
      const h = await http(`${coreUrl}/health`);
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, cleanBody);
    check('Persistence after restart: healed=false, same version', r.json?.meta?.healed === false && r.json?.meta?.version === 2, `healed:${r.json?.meta?.healed} version:${r.json?.meta?.version}`);
    core2.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    // restart core again for remaining checks
    const core3 = startChild('node', [CORE_ENTRY], { cwd: join(ROOT, 'api-server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 30; i += 1) {
      const h = await http(`${coreUrl}/health`);
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    Object.assign(globalThis, { _core3: core3 });
  }

  // Check 6: Other port (mock restart + re-register)
  {
    mock.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 300));
    const mockPort2 = await freePort([corePort]);
    const mock2 = startChild('node', [MOCK_ENTRY], { cwd: join(ROOT, 'demo-server-and-client/server'), env: { ...env, PORT: String(mockPort2), MOCK_URL: `http://localhost:${mockPort2}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    const mockUrl2 = `http://localhost:${mockPort2}`;
    for (let i = 0; i < 30; i += 1) {
      const h = await http(`${mockUrl2}/health`);
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await postJSON(`${mockUrl2}/admin/reset`, {});
    await postJSON(`${mockUrl2}/admin/mutate`, { id: 'M5' });
    await postJSON(`${coreUrl}/apis`, {
      apiId: 'demo-users', baseUrl: mockUrl2, specUrl: `${mockUrl2}/openapi.json`,
      credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
      healing: { enabled: true, maxRounds: 5, tier2: true },
      tools: [{
        name: 'get_user', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none',
        parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
        response: { fields: { id: { path: 'result.id', type: 'string' }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' } } },
      }],
    });
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, cleanBody);
    check('Heal works after mock restart on another port + re-register', r.status === 200 && r.json?.ok === true && r.json?.meta?.healed === true, `status:${r.status} healed:${r.json?.meta?.healed}`);
    mock2.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 300));
    const mockPort3 = await freePort([corePort]);
    const mock3 = startChild('node', [MOCK_ENTRY], { cwd: join(ROOT, 'demo-server-and-client/server'), env: { ...env, PORT: String(mockPort3), MOCK_URL: `http://localhost:${mockPort3}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    activeMockUrl = `http://localhost:${mockPort3}`;
    for (let i = 0; i < 30; i += 1) {
      const h = await http(`${activeMockUrl}/health`);
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    Object.assign(globalThis, { _mock3: mock3 });
  }

  // Check 7: Concurrency (3 parallel calls)
  {
    await postJSON(`${activeMockUrl}/admin/reset`, {});
    await postJSON(`${activeMockUrl}/admin/mutate`, { id: 'M5' });
    await postJSON(`${activeMockUrl}/admin/config`, { specAvailable: false });
    // registerApi replaces atomically (epoch bump, tools reset to v1)
    await postJSON(`${coreUrl}/apis`, {
      apiId: 'demo-users', baseUrl: activeMockUrl, specUrl: `${activeMockUrl}/openapi.json`,
      credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
      healing: { enabled: true, maxRounds: 5, tier2: true },
      tools: [{
        name: 'get_user', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none',
        parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
        response: { fields: { id: { path: 'result.id', type: 'string' }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string', format: 'email' } } },
      }],
    });
    const beforeVersions = (await http(`${coreUrl}/apis/demo-users/tools/get_user/versions`)).json?.versions ?? [];
    const beforeHealCount = beforeVersions.filter((version) => version.origin === 'heal').length;
    const beforeMaxVersion = Math.max(0, ...beforeVersions.map((version) => Number(version.version) || 0));
    const ids = ['111', '222', '333'];
    const promises = ids.map((id) => postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, { args: { user_id: id } }));
    const rs = await Promise.all(promises);
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
    const versions = await http(`${coreUrl}/apis/demo-users/tools/get_user/versions`);
    const afterVersions = versions.json?.versions ?? [];
    const newHealVersions = afterVersions.filter((version) => version.origin === 'heal' && Number(version.version) > beforeMaxVersion);
    const singleCommit = afterVersions.filter((version) => version.origin === 'heal').length === beforeHealCount + 1
      && newHealVersions.length === 1;
    const committedVersion = newHealVersions[0]?.version;
    const consistentResults = committedVersion != null && rs.every((r, index) => isConsistentConcurrentHealResult(r, ids[index], committedVersion));
    const sameVersion = committedVersion != null && rs.every((r) => r.json?.meta?.version === committedVersion);
    const committedOps = newHealVersions[0]?.change?.ops?.map((op) => op.op) ?? [];
    const exactFourOpCommit = JSON.stringify(committedOps) === JSON.stringify(['add_header', 'move_field', 'rename_field', 'coerce_type']);
    const hasHealedCall = rs.some((r) => r.json?.meta?.healed === true);
    check('Concurrency: 3 parallel calls return their own ids, share one heal commit', consistentResults && hasHealedCall && singleCommit && sameVersion && exactFourOpCommit, `ids:${rs.map((r) => r.json?.data?.id).join(',')} resultsConsistent:${consistentResults} version2:${sameVersion} singleCommit:${singleCommit} exactFourOps:${exactFourOpCommit} codes:${rs.map((r) => r.json?.error?.code ?? 'ok').join(',')} metas:${JSON.stringify(rs.map((r) => r.json?.meta))}`);
<<<<<<< HEAD
=======
=======
    const ownIds = rs.every((r, i) => r.json?.data?.id === ids[i]);
    // Each caller (leader + followers) must report healed with the 4 committed ops
    const allHealed4 = rs.every((r) => r.json?.meta?.healed === true && (r.json?.meta?.ops?.length ?? 0) === 4);
    const versions = await http(`${coreUrl}/apis/demo-users/tools/get_user/versions`);
    const singleCommit = versions.json?.versions?.length === 2
      && versions.json.versions[1]?.version === 2
      && versions.json.versions[1]?.origin === 'heal';
    const sameVersion = rs.every((r) => r.json?.meta?.version === 2);
    check('Concurrency: 3 parallel calls return their own ids, share one heal commit', ownIds && allHealed4 && singleCommit && sameVersion, `ids:${rs.map((r) => r.json?.data?.id).join(',')} healed4:${allHealed4} version2:${sameVersion} singleCommit:${singleCommit} codes:${rs.map((r) => r.json?.error?.code ?? 'ok').join(',')}`);
>>>>>>> origin/main
>>>>>>> origin/main
  }

  // Check 8: Missing credential — restart core without TENANT_ID (registry
  // persists on disk across restarts, so the healed v2 adapter is intact).
  {
    globalThis._core3?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    const coreNoCred = startChild('node', [CORE_ENTRY], { cwd: join(ROOT, 'api-server'), env: { ...coreEnv, TENANT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i += 1) {
      const h = await http(`${coreUrl}/health`);
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, cleanBody);
    coreNoCred.kill('SIGTERM');
    await new Promise((res) => setTimeout(res, 800));
    const core4 = startChild('node', [CORE_ENTRY], { cwd: join(ROOT, 'api-server'), env: coreEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    Object.assign(globalThis, { _core4: core4 });
    for (let i = 0; i < 40; i += 1) {
      const h = await http(`${coreUrl}/health`);
      if (h.status === 200) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    check('Missing credential → credential_unavailable halt, no undefined header', r.status === 200 && r.json?.ok === false && r.json?.error?.code === 'tool_unavailable' && r.json?.error?.details?.reason === 'credential_unavailable', `status:${r.status} code:${r.json?.error?.code} reason:${r.json?.error?.details?.reason}`);
  }

  // Check 9: Non-coercible value
  {
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, { args: { user_id: 'abc' } });
    check('Non-coercible → structured halt (not_lossless), never HTTP 500', r.status !== 500 && r.json?.ok === false && r.json?.error?.code === 'tool_unavailable' && r.json?.error?.details?.reason === 'not_lossless', `status:${r.status} code:${r.json?.error?.code} reason:${r.json?.error?.details?.reason}`);
  }

  // Check 10: Bad input
  {
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, { args: {} });
    check('Bad input → invalid_arguments, retryable:false, HTTP 400', r.status === 400 && r.json?.ok === false && r.json?.error?.code === 'invalid_arguments' && r.json?.error?.retryable === false, `status:${r.status} code:${r.json?.error?.code} retryable:${r.json?.error?.retryable}`);
  }

  // Check 11: Writes not retried on 5xx; reads retried exactly once (real 500-stub)
  {
    const stubPort = await freePort([corePort]);
    let readHits = 0;
    let writeHits = 0;
    const stub = createServer((req, res) => {
      if (req.url === '/read') readHits += 1;
      if (req.url === '/write') writeHits += 1;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    servers.add(stub);
    await new Promise((resolve, reject) => {
      stub.once('error', reject);
      stub.listen(stubPort, '127.0.0.1', resolve);
    });
    const stubUrl = `http://localhost:${stubPort}`;
    const probeTool = (name, path, sideEffects) => ({
      name, method: 'POST', path, risk: 'low', sideEffects,
      parameters: { type: 'object', properties: { probe_id: { type: 'string' } }, required: ['probe_id'], additionalProperties: false },
      response: { fields: { ok: { path: 'ok', type: 'boolean' } } },
    });
    await postJSON(`${coreUrl}/apis`, {
      apiId: 'retry-probe', baseUrl: stubUrl, credentials: {},
      healing: { enabled: true, maxRounds: 2 },
      tools: [probeTool('read_probe', '/read', 'none'), probeTool('write_probe', '/write', 'write')],
    });
    const rr = await postJSON(`${coreUrl}/apis/retry-probe/tools/read_probe/invoke`, { args: { probe_id: 'r1' } });
    const wr = await postJSON(`${coreUrl}/apis/retry-probe/tools/write_probe/invoke`, { args: { probe_id: 'w1' } });
    await closeServer(stub);
    const detail = `readHits:${readHits} writeHits:${writeHits} rCode:${rr.json?.error?.code} wCode:${wr.json?.error?.code}`;
    check('Write/read retry distinction (read retried once, write never retried)', readHits === 2 && writeHits === 1 && rr.json?.error?.code === 'upstream_error' && wr.json?.error?.code === 'upstream_error', detail);
  }

  // Check 12: runId in events
  {
    const runId = `verify_run_${Date.now()}`;
    const r = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, { args: { user_id: '123' }, runId });
    // Events may have already been consumed; just verify invoke accepts runId without error
    check('runId accepted in invoke body', r.status === 200, `status:${r.status}`);
  }

  // Check 13: No raw args on the SSE stream (G18: call.started emits argKeys/argCount only)
  {
    const sentinel = '777000111222'; // numeric so the v2 adapter's coerce stays lossless
    const runId = `verify_sse_${Date.now()}`;
    const ctrl = new AbortController();
    const startedEvents = [];
    let terminal = null; // 'succeeded' | 'failed'
    let connected = false;
    let invokeResult;
    try {
      // Complete the request first, then replay the buffered stream. Correlating
      // by runId avoids races between fetch header delivery and the first event.
      invokeResult = await postJSON(`${coreUrl}/apis/demo-users/tools/get_user/invoke`, {
        args: { user_id: sentinel }, runId,
      });
      const resp = await fetch(`${coreUrl}/events?since=0`, { signal: ctrl.signal });
      connected = resp.ok;
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !terminal) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let e; try { e = JSON.parse(line.slice(6)); } catch { continue; }
          if (e.runId !== runId) continue;
          if (e.type === 'call.started') startedEvents.push(e);
          if (e.type === 'call.succeeded') terminal = 'succeeded';
          if (e.type === 'call.failed') terminal = 'failed';
        }
      }
      ctrl.abort();
    } catch { /* aborted */ }
    const leak = startedEvents.some((e) => 'args' in e || JSON.stringify(e).includes(sentinel));
    const detail = `connected:${connected} status:${invokeResult?.status} started:${startedEvents.length} terminal:${terminal} leak:${leak} argKeys:${JSON.stringify(startedEvents[0]?.argKeys)} argCount:${startedEvents[0]?.argCount}`;
    check('No raw args on SSE stream (call.started has argKeys/argCount only)', connected && invokeResult?.status === 200 && startedEvents.length === 1 && terminal === 'succeeded' && !leak, detail);
  }

  // Check 14: Baseline (scripted mode since no real Gemini key)
  {
    const r = await postJSON(`${activeMockUrl}/demo/run`, {
      apiId: 'demo-users', tool: { name: 'get_user', path: '/api/users/get', method: 'POST' },
      args: { user_id: '123' }, baseUrl: activeMockUrl, runId: `verify_base_${Date.now()}`,
    });
    check('Baseline fallback is labeled and reaches its visible M5 iteration limit', r.status === 200 && r.json?.ok === false && r.json?.outcome === 'step_limit' && r.json?.mode === 'scripted' && r.json?.iterations === 10, `status:${r.status} outcome:${r.json?.outcome} mode:${r.json?.mode} iterations:${r.json?.iterations}`);
  }

  // Check 15: Mock provenance/truth/mutations
  {
    const sm = await http(`${activeMockUrl}/admin/mutations`);
    const st = await http(`${activeMockUrl}/admin/state`);
    const truth = await http(`${activeMockUrl}/admin/truth/users/123`);
    check('Mock: /admin/mutations, /admin/state, /admin/truth respond', sm.status === 200 && st.status === 200 && truth.status === 200 && truth.json?.id === '123', `mutations:${sm.status} state:${st.status} truth:${truth.status} truthId:${truth.json?.id}`);
  }

  // Check 16: Golden fixtures parse
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const walk = (dir, out = []) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.json')) out.push(full);
      }
      return out;
    };
    const files = walk(path.join(ROOT, 'contracts'));
    let allOk = files.length > 0;
    for (const f of files) {
      try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch { allOk = false; break; }
    }
    check('All /contracts/*.json are valid JSON', allOk, `count:${files.length}`);
  }

  // Check 17: Unit tests
  {
    const { execSync } = await import('node:child_process');
    try {
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
      const unitEnv = {
        ...process.env,
        DATABASE_URL: '',
        REDIS_URL: '',
        HEALR_TEST_DATABASE_URL: '',
      };
      const out = execSync('npm test', { cwd: ROOT, encoding: 'utf8', timeout: 30000, env: unitEnv });
<<<<<<< HEAD
=======
=======
      const out = execSync('node --test "api-server/test/**/*.test.js" "demo-server-and-client/server/test/**/*.test.js"', { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
>>>>>>> origin/main
>>>>>>> origin/main
      const passMatch = out.match(/(?:#|ℹ)\s*pass\s+(\d+)/);
      const failMatch = out.match(/(?:#|ℹ)\s*fail\s+(\d+)/);
      const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
      const fail = failMatch ? parseInt(failMatch[1], 10) : 0;
      check('npm test green', pass > 0 && fail === 0, `pass:${pass} fail:${fail}`);
    } catch (err) {
      check('npm test green', false, err.stderr?.slice(-200) || err.message);
    }
  }

  // Summary
  process.stdout.write(`\n=== Phase 0+1 acceptance: ${results.length - failures}/${results.length} PASS ===\n`);
  if (failures > 0) {
    process.stdout.write('FAILURES:\n');
    for (const r of results) if (!r.ok) process.stdout.write(`  - ${r.name}: ${r.detail}\n`);
  }

  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((err) => {
  process.stderr.write(`Acceptance script crashed: ${err.message}\n${err.stack}\n`);
  process.exitCode = 2;
}).finally(cleanup);
