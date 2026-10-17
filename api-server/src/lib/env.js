// Phase 0: load .env from the repo root without adding a dependency.
// Walks up from process.cwd() to find .env, parses KEY=VALUE lines,
// ignores comments/blank lines, strips optional quotes, and sets only
// keys not already present in process.env (existing env wins).
import { existsSync, readFileSync } from 'node:fs';

function findEnvFile(start) {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    const candidate = `${dir}/.env`;
    if (existsSync(candidate)) return candidate;
    const parent = dir.split(/[/\\]/).slice(0, -1).join('/') || dir;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(start = process.cwd()) {
  const file = findEnvFile(start);
  if (!file) return { found: false, file: null, loaded: 0 };
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  let loaded = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  return { found: true, file, loaded };
}

// Make configuration available before dependent ES modules capture config at
// import time. Existing process environment values always take precedence.
loadEnv();

export { findEnvFile, parseEnv };
