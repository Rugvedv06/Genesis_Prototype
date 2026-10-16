import { loadEnv } from '../lib/env.js';
loadEnv();
const [{ migrate }, { closePool }] = await Promise.all([import('./migrate.js'), import('./pool.js')]);
try {
  const result = await migrate();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
} finally {
  await closePool();
}
