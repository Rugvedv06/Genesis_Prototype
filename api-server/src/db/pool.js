import pg from 'pg';

const { Pool } = pg;
let pool;

function boundedInteger(env, key, fallback, min, max) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer between ${min} and ${max}`);
  return value;
}

export function databaseUrl(env = process.env) {
  const value = env.DATABASE_URL;
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// and include a database name');
  }
  return value;
}

export function getPool(env = process.env) {
  const connectionString = databaseUrl(env);
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: boundedInteger(env, 'DB_POOL_MAX', 10, 1, 50),
      connectionTimeoutMillis: boundedInteger(env, 'DB_CONNECT_TIMEOUT_MS', 3000, 100, 60000),
      idleTimeoutMillis: boundedInteger(env, 'DB_IDLE_TIMEOUT_MS', 30000, 1000, 300000),
      statement_timeout: boundedInteger(env, 'DB_STATEMENT_TIMEOUT_MS', 10000, 100, 120000),
      application_name: 'healr-api-server',
    });
    pool.on('error', (error) => console.error(JSON.stringify({
      ts: new Date().toISOString(), level: 'error', service: 'api-server',
      code: 'postgres_pool_error', databaseErrorCode: String(error.code ?? 'unknown').slice(0, 32),
    })));
  }
  return pool;
}

export async function closePool() {
  if (pool) { const current = pool; pool = undefined; await current.end(); }
}

export async function databaseStatus() {
  if (!process.env.DATABASE_URL) return { configured: false, ok: false, code: 'database_not_configured' };
  try {
    const result = await getPool().query('SELECT 1 AS ok');
    return { configured: true, ok: result.rows[0]?.ok === 1 };
  } catch {
    return { configured: true, ok: false, code: 'database_unavailable' };
  }
}
