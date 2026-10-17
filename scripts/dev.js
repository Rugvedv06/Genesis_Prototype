#!/usr/bin/env node
// Phase 0: boots all four apps in parallel so tracks can code independently.
// Usage: npm run dev  (health: :8000/health, :5001/health, :3000, :3001)
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadEnv } from '../api-server/src/lib/env.js';

const envResult = loadEnv();
if (!envResult.found) {
  process.stderr.write('[dev] warning: no .env file found at repo root\n');
} else if (!process.env.TENANT_ID) {
  process.stderr.write('[dev] warning: TENANT_ID is empty in .env\n');
}

function bin(cwd, name) {
  // npm workspaces hoist bins to root node_modules; fall back to workspace-local.
  const executable = process.platform === 'win32' ? `${name}.cmd` : name;
  const root = join(process.cwd(), 'node_modules', '.bin', executable);
  const local = join(process.cwd(), cwd, 'node_modules', '.bin', executable);
  return root;
}

const APPS = [
  { name: 'api-server', cwd: 'api-server', cmd: 'node', args: ['--watch', 'src/server.js'], env: { PORT: '8000' }, port: 8000 },
  { name: 'demo-server', cwd: 'demo-server-and-client/server', cmd: 'node', args: ['--watch', 'src/server.js'], env: { PORT: '5001' }, port: 5001 },
  { name: 'api-client', cwd: 'api-client', cmd: bin('api-client', 'next'), args: ['dev', '-p', '3000'], env: { PORT: '3000' }, port: 3000 },
  { name: 'demo-client', cwd: 'demo-server-and-client/client', cmd: bin('demo-server-and-client/client', 'next'), args: ['dev', '-p', '3001'], env: { PORT: '3001' }, port: 3001 },
];

const procs = APPS.map((app) => {
  const p = spawn(app.cmd, app.args, {
    cwd: app.cwd,
    env: { ...process.env, ...app.env },
    shell: process.platform === 'win32' && app.cmd.endsWith('.cmd'),
<<<<<<< HEAD
    detached: process.platform !== 'win32',
=======
>>>>>>> origin/main
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => process.stdout.write(`[${app.name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${app.name}] ${d}`));
  p.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[${app.name}] exited with code ${code}\n`);
    }
  });
  return p;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (p.killed || p.exitCode !== null) continue;
    if (process.platform !== 'win32') {
      try { process.kill(-p.pid, 'SIGTERM'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    } else {
      p.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
