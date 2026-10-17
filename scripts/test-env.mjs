// Unit tests use the in-memory registry unless they explicitly configure an
// isolated PostgreSQL runtime inside the test process.
if (!Object.hasOwn(process.env, 'DATABASE_URL')) process.env.DATABASE_URL = '';
