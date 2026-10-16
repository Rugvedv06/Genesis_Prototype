import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool } from './pool.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrationName = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const advisoryLockKey = 741903211;
const lockTimeoutMs = 15_000;
const lockPollMs = 100;

async function readMigrations() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql')).map((entry) => entry.name).sort();
  if (sqlFiles.length === 0) throw new Error('No SQL migrations are present');
  const files = [];
  for (const name of sqlFiles) {
    const match = name.match(migrationName);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);
    const version = Number(match[1]);
    if (version < 1) throw new Error(`Migration version must be positive: ${name}`);
    const sql = await readFile(join(migrationsDir, name), 'utf8');
    if (!sql.trim()) throw new Error(`Migration file is empty: ${name}`);
    files.push({ version, name: match[2], file: name, checksum: createHash('sha256').update(sql).digest('hex'), sql });
  }
  const names = new Set();
  for (let index = 0; index < files.length; index += 1) {
    if (names.has(files[index].name)) throw new Error(`Duplicate migration name: ${files[index].name}`);
    names.add(files[index].name);
  }
  for (let index = 1; index < files.length; index += 1) {
    if (files[index].version !== files[index - 1].version + 1) throw new Error('Migration versions must be contiguous');
  }
  if (files[0].version !== 1) throw new Error('Migration history must start at version 0001');
  return files;
}

async function acquireMigrationLock(client) {
  const deadline = Date.now() + lockTimeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [advisoryLockKey]);
    if (rows[0]?.locked) return;
    await new Promise((resolve) => setTimeout(resolve, lockPollMs));
  }
  throw new Error('Timed out waiting for migration lock');
}

function validateApplied(files, applied) {
  if (applied.length > files.length) throw new Error('Database has migrations absent from this application');
  for (let index = 0; index < applied.length; index += 1) {
    const expected = files[index];
    const actual = applied[index];
    if (!expected || expected.version !== actual.version || expected.name !== actual.name || expected.checksum !== actual.checksum) {
      throw new Error(`Migration history mismatch at version ${actual.version}`);
    }
  }
}

export async function migrate(pool = getPool()) {
  const client = await pool.connect();
  let locked = false;
  let primaryError;
  try {
    await acquireMigrationLock(client);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, name text NOT NULL UNIQUE CHECK (length(name) > 0),
      checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = await readMigrations();
    const { rows: applied } = await client.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    validateApplied(files, applied);
    for (const item of files.slice(applied.length)) {
      await client.query('BEGIN');
      try {
        await client.query(item.sql);
        await client.query('INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)', [item.version, item.name, item.checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    return { ok: true, applied: files.length };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let releaseError;
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]);
    } catch {
      releaseError = new Error('Could not release PostgreSQL migration lock');
    }
    client.release(releaseError);
    if (releaseError && !primaryError) throw releaseError;
  }
}

export async function migrationStatus(pool = getPool()) {
  const files = await readMigrations();
  const { rows } = await pool.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
  try {
    validateApplied(files, rows);
    return { ok: rows.length === files.length, applied: rows.length, expected: files.length };
  } catch {
    return { ok: false, applied: rows.length, expected: files.length, code: 'migration_history_mismatch' };
  }
}
