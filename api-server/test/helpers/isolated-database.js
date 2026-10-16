import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';

const { Pool } = pg;

function quoteIdentifier(identifier) {
  if (!/^healr_test_[a-z0-9_]+$/.test(identifier)) throw new Error('invalid isolated database identifier');
  return `"${identifier}"`;
}

export async function createIsolatedDatabase(prefix = 'runtime') {
  const baseUrl = process.env.HEALR_TEST_DATABASE_URL;
  if (!baseUrl) throw new Error('HEALR_TEST_DATABASE_URL must point to a PostgreSQL owner connection');

  const adminPool = new Pool({ connectionString: baseUrl });
  const databaseName = `healr_test_${prefix}_${process.pid}_${randomBytes(6).toString('hex')}`;
  const identifier = quoteIdentifier(databaseName);
  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let created = false;
  try {
    await adminPool.query(`CREATE DATABASE ${identifier}`);
    created = true;
    const appPool = new Pool({ connectionString: databaseUrl.toString() });
    try {
      await migrate(appPool);
    } finally {
      await appPool.end();
    }
  } catch (error) {
    if (created) await adminPool.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
    throw error;
  }

  let dropped = false;
  return {
    databaseName,
    url: databaseUrl.toString(),
    async drop() {
      if (!dropped) {
        await adminPool.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
        dropped = true;
      }
      const remaining = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
      await adminPool.end();
      return { dropped, databaseExists: remaining.rowCount !== 0 };
    },
  };
}
