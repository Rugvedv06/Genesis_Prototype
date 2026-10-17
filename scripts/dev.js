#!/usr/bin/env node
// Phase 0: boots all four apps in parallel so tracks can code independently.
// Usage: npm run dev  (health: :8000/health, :5001/health, :3000, :3001)
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
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
  { name: 'api-client', cwd: 'api-client', cmd: bin('api-client', 'next'), args: ['dev', '-p', '3000'], env: { PORT: '3000', NEXT_DIST_DIR: '.next-dev' }, port: 3000 },
  { name: 'demo-client', cwd: 'demo-server-and-client/client', cmd: bin('demo-server-and-client/client', 'next'), args: ['dev', '-p', '3001'], env: { PORT: '3001', NEXT_DIST_DIR: '.next-dev' }, port: 3001 },
];

function portInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

async function prepareDevRuntime() {
  const occupied = [];
  for (const app of APPS) {
    if (await portInUse(app.port)) occupied.push(`${app.name}:${app.port}`);
  }
  if (occupied.length) {
    throw new Error(`development ports are already in use (${occupied.join(', ')}); stop the existing stack before running npm run dev`);
  }
  for (const cwd of ['api-client', 'demo-server-and-client/client']) {
    const nextDir = join(process.cwd(), cwd, '.next-dev');
    if (existsSync(nextDir)) rmSync(nextDir, { recursive: true, force: true });
  }
}

await prepareDevRuntime();

const procs = APPS.map((app) => {
  const p = spawn(app.cmd, app.args, {
    cwd: app.cwd,
    env: { ...process.env, ...app.env },
    shell: process.platform === 'win32' && app.cmd.endsWith('.cmd'),
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

function shutdown() {
  procs.forEach((p) => p.kill('SIGTERM'));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
