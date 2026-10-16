import { getPool } from './pool.js';

const CONNECTION_FAILURE_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', '57P01', '57P02', '57P03']);
const ISOLATION_LEVELS = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);

export class CommitOutcomeUncertainError extends Error {
  constructor(cause) {
    super('The database connection was lost while committing; the transaction outcome is unknown');
    this.name = 'CommitOutcomeUncertainError';
    this.code = 'database_commit_outcome_uncertain';
    this.cause = cause;
  }
}

function isConnectionFailure(error) {
  return CONNECTION_FAILURE_CODES.has(error?.code) || String(error?.code ?? '').startsWith('08');
}

/** Run database-only work in one transaction. Never automatically retries a callback. */
export async function withTransaction(work, { pool = getPool(), isolation = 'READ COMMITTED' } = {}) {
  if (typeof work !== 'function') throw new TypeError('transaction work must be a function');
  if (!ISOLATION_LEVELS.has(isolation)) throw new TypeError('unsupported transaction isolation level');

  const client = await pool.connect();
  let began = false;
  let commitStarted = false;
  let destroyClient = false;
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    began = true;
    const result = await work(client);
    commitStarted = true;
    try {
      await client.query('COMMIT');
    } catch (error) {
      if (isConnectionFailure(error)) {
        destroyClient = true;
        throw new CommitOutcomeUncertainError(error);
      }
      try { await client.query('ROLLBACK'); }
      catch {
        destroyClient = true;
      }
      throw error;
    }
    return result;
  } catch (error) {
    if (began && !commitStarted) {
      try { await client.query('ROLLBACK'); }
      catch {
        destroyClient = true;
      }
    }
    if (isConnectionFailure(error)) destroyClient = true;
    throw error;
  } finally {
    client.release(destroyClient ? new Error('Discarding unusable PostgreSQL connection') : undefined);
  }
}
