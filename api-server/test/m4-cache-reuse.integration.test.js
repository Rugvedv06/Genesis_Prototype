import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { loadEnv } from '../src/lib/env.js';

loadEnv();
const baseDatabaseUrl = process.env.HEALR_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test('a compatible GET endpoint reuses a replay-verified convention candidate', { skip: !baseDatabaseUrl }, async () => {
  const databaseName = `healr_m42_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: baseDatabaseUrl });
  const originalEnv = Object.fromEntries(['DATABASE_URL', 'REDIS_URL', 'HEALR_CACHE_NAMESPACE'].map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let closePool;
  let closeRedisMirror;
  let pool;
  let dropError;

  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const isolatedUrl = new URL(baseDatabaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = isolatedUrl.toString();
  process.env.REDIS_URL = process.env.HEALR_TEST_REDIS_URL ?? originalEnv.REDIS_URL ?? '';
  process.env.HEALR_CACHE_NAMESPACE = `healr:m42:${databaseName}`;

  try {
    const [{ migrate }, poolModule, registry, executor, { bus }, eventRepository, transaction, { registryStore }] = await Promise.all([
      import('../src/db/migrate.js'),
      import('../src/db/pool.js'),
      import('../src/db/registry-service.js'),
      import('../src/features/executor/invoke.js'),
      import('../src/features/events/bus.js'),
      import('../src/db/event-repository.js'),
      import('../src/db/transaction.js'),
      import('../src/features/registry/store.js'),
    ]);
    ({ closePool } = poolModule);
    ({ closeRedisMirror } = await import('../src/features/patch-cache/redis-mirror.js'));
    await migrate();
    pool = poolModule.getPool();
    await registry.refreshRegistryCache();
    bus.configureEventPersistence((event) => transaction.withTransaction((client) =>
      eventRepository.appendGatewayEventInTransaction(client, event)));
    bus.clear();

    const requests = new Map();
    const requestUrls = new Map();
    let raceReplacement;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      requests.set(url.host, (requests.get(url.host) ?? 0) + 1);
      requestUrls.set(url.host, [...(requestUrls.get(url.host) ?? []), url]);
      if (url.host.startsWith('path-')) {
        const userId = decodeURIComponent(url.pathname.split('/').at(-1));
        if (!url.searchParams.has('region_code')) {
          return new Response(JSON.stringify({ detail: [
            { loc: ['query', 'region_code'], msg: 'field required', type: 'value_error.missing' },
            { loc: ['query', 'region'], msg: 'extra fields not permitted', type: 'value_error.extra' },
          ] }), { status: 422, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: userId }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.host === 'revision-race.example' && requests.get(url.host) === 2) {
        await registerEndpoint('m42-revision-race', 'https://revision-race.example');
        raceReplacement = registryStore.current('m42-revision-race', 'lookup');
      }
      if (!url.searchParams.has('user_id')) {
        const missingType = url.host === 'validator-mismatch.example' ? 'missing' : 'value_error.missing';
        if (url.host === 'error-list-bound.example') {
          return new Response(JSON.stringify({ detail: Array.from({ length: 17 }, (_, index) => ({
            loc: ['body', `missing${index}`], msg: 'field required', type: 'value_error.missing',
          })) }), { status: 422, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ detail: [
          { loc: ['body', 'user_id'], msg: 'field required', type: missingType },
          { loc: ['body', 'userId'], msg: 'extra fields not permitted', type: 'value_error.extra' },
        ] }), { status: 422, headers: { 'content-type': 'application/json' } });
      }
      const id = url.host === 'failed.example' ? 'wrong-identity' : url.searchParams.get('user_id');
      const payload = { id };
      if (url.searchParams.has('optionalId')) payload.optionalId = url.searchParams.get('optionalId');
      return new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };

    const inputSchema = {
      type: 'object', properties: { userId: { type: 'string' } },
      required: ['userId'], additionalProperties: false,
    };
    const registerEndpoint = (apiId, baseUrl, {
      schema = inputSchema, mode = 'enforce', identity = { userId: 'id' }, includeOptionalResponse = false,
      path = '/users', method = 'GET',
    } = {}) => registry.registerApi({
      apiId, baseUrl, credentials: {},
      healing: { enabled: true, mode, maxRounds: 3 },
      tools: [{
        name: 'lookup', method, path, sideEffects: 'read',
        parameters: schema,
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          ...(includeOptionalResponse ? { optionalId: { path: 'optionalId', type: 'string', required: false } } : {}),
        } },
        identity,
      }],
    });

    await registerEndpoint('m42-source', 'https://source.example');
    await registerEndpoint('m42-destination', 'https://destination.example');

    const source = await executor.invoke({ apiId: 'm42-source', toolName: 'lookup', args: { userId: '123' } });
    assert.equal(source.ok, true, JSON.stringify({ error: source.error, events: bus.since(0).map(({ type, apiId }) => ({ type, apiId })) }));
    assert.equal(source.meta.cacheHit, false);
    assert.equal(registryStore.current('m42-source', 'lookup').version, 2);

    const destination = await executor.invoke({ apiId: 'm42-destination', toolName: 'lookup', args: { userId: '456' } });
    assert.equal(destination.ok, true, JSON.stringify(destination.error));
    assert.equal(destination.meta.cacheHit, true);
    assert.equal(destination.meta.rounds, 0);
    assert.deepEqual(destination.data, { id: '456' });
    assert.equal(registryStore.current('m42-destination', 'lookup').version, 2);
    assert.equal(registryStore.current('m42-source', 'lookup').version, 2);
    assert.equal(requests.get('source.example'), 2, 'source has one failing request and one verified replay');
    assert.equal(requests.get('destination.example'), 2, 'destination has one failing request and one cache replay');

    const extendedSchema = {
      type: 'object', properties: { userId: { type: 'string' }, locale: { type: 'string' } },
      required: ['userId'], additionalProperties: false,
    };
    await registerEndpoint('m42-schema-mismatch', 'https://schema-mismatch.example', { schema: extendedSchema });
    const schemaMismatch = await executor.invoke({ apiId: 'm42-schema-mismatch', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(schemaMismatch.ok, true, JSON.stringify(schemaMismatch.error));
    assert.equal(schemaMismatch.meta.cacheHit, false);
    assert.equal(schemaMismatch.meta.rounds, 1);
    assert.equal(registryStore.current('m42-schema-mismatch', 'lookup').version, 2);

    await registerEndpoint('m42-validator-mismatch', 'https://validator-mismatch.example');
    const validatorMismatch = await executor.invoke({ apiId: 'm42-validator-mismatch', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(validatorMismatch.ok, true, JSON.stringify(validatorMismatch.error));
    assert.equal(validatorMismatch.meta.cacheHit, false, 'different validator subtype must not reuse the candidate');
    assert.equal(validatorMismatch.meta.rounds, 1);
    assert.equal(registryStore.current('m42-validator-mismatch', 'lookup').version, 2);

    await registerEndpoint('m42-no-identity', 'https://no-identity.example', { identity: {} });
    const noIdentity = await executor.invoke({ apiId: 'm42-no-identity', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(noIdentity.ok, true, JSON.stringify(noIdentity.error));
    assert.equal(noIdentity.meta.cacheHit, false, 'an endpoint without an identity contract must not consume convention candidates');
    assert.equal(noIdentity.meta.rounds, 1);
    assert.equal(registryStore.current('m42-no-identity', 'lookup').version, 2);

    const optionalIdentitySchema = {
      type: 'object', properties: { userId: { type: 'string' }, optionalId: { type: 'string' } },
      required: ['userId'], additionalProperties: false,
    };
    await registerEndpoint('m42-optional-source', 'https://optional-source.example', {
      schema: optionalIdentitySchema, identity: { optionalId: 'optionalId' }, includeOptionalResponse: true,
    });
    const optionalSource = await executor.invoke({
      apiId: 'm42-optional-source', toolName: 'lookup', args: { userId: 'optional-source', optionalId: 'echo-1' },
    });
    assert.equal(optionalSource.ok, true, JSON.stringify(optionalSource.error));
    assert.equal(registryStore.current('m42-optional-source', 'lookup').version, 2);
    await registerEndpoint('m42-optional-identity', 'https://optional-identity.example', {
      schema: optionalIdentitySchema, identity: { optionalId: 'optionalId' }, includeOptionalResponse: true,
    });
    const optionalIdentity = await executor.invoke({ apiId: 'm42-optional-identity', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(optionalIdentity.ok, false, 'an omitted caller and response identity must fail candidate replay and ordinary verification');
    assert.equal(optionalIdentity.meta?.cacheHit ?? false, false);
    assert.equal(registryStore.current('m42-optional-identity', 'lookup').version, 1);
    assert.equal(requests.get('optional-identity.example'), 3,
      'initial failure, rejected convention replay, and ordinary diagnosis replay prove the candidate was found');

    await registerEndpoint('m42-error-list-bound', 'https://error-list-bound.example');
    const errorListBound = await executor.invoke({ apiId: 'm42-error-list-bound', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(errorListBound.meta?.cacheHit ?? false, false, 'oversized validator errors must not probe convention candidates');

    await registerEndpoint('m42-disabled', 'https://disabled.example', { mode: 'log' });
    const disabled = await executor.invoke({ apiId: 'm42-disabled', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(disabled.ok, false);
    assert.equal(registryStore.current('m42-disabled', 'lookup').version, 1);
    assert.equal(requests.get('disabled.example'), 1, 'disabled healing does not replay a candidate');

    await registerEndpoint('m42-failed-replay', 'https://failed.example');
    const failedReplay = await executor.invoke({ apiId: 'm42-failed-replay', toolName: 'lookup', args: { userId: '789' } });
    assert.equal(failedReplay.ok, false);
    assert.equal(registryStore.current('m42-failed-replay', 'lookup').version, 1);
    assert.ok(requests.get('failed.example') >= 2, 'candidate replay was rejected and ordinary diagnosis continued');

    const events = bus.since(0);
    assert.equal(events.filter((event) => event.type === 'diagnosis.started' && event.apiId === 'm42-destination').length, 0);
    assert.equal(events.filter((event) => event.type === 'cache.hit' && event.apiId === 'm42-destination').length, 1);
    assert.equal(events.filter((event) => event.type === 'cache.hit' && event.apiId !== 'm42-destination').length, 0);
    assert.equal(events.filter((event) => event.type === 'diagnosis.started' && event.apiId === 'm42-schema-mismatch').length, 1);
    assert.equal(events.filter((event) => event.type === 'diagnosis.started' && event.apiId === 'm42-validator-mismatch').length, 1);
    assert.equal(events.filter((event) => event.type === 'diagnosis.started' && event.apiId === 'm42-no-identity').length, 1);
    assert.equal(events.filter((event) => event.type === 'diagnosis.started' && event.apiId === 'm42-optional-identity').length, 1);
    assert.equal(events.filter((event) => event.type === 'cache.hit' && event.apiId === 'm42-optional-identity').length, 0);
    assert.equal(events.filter((event) => event.type === 'patch.committed' && event.apiId === 'm42-optional-identity').length, 0);
    assert.equal(events.filter((event) => event.type === 'diagnosis.started' && event.apiId === 'm42-error-list-bound').length, 1);
    assert.equal(events.filter((event) => event.type === 'patch.committed' && event.apiId === 'm42-failed-replay').length, 0);
    assert.equal(events.filter((event) => event.type === 'cache.hit' && event.apiId === 'm42-failed-replay').length, 0);
    const durableHit = await pool.query(
      `SELECT count(*) FROM gateway_events WHERE event_type = 'cache.hit' AND api_id = $1`, ['m42-destination'],
    );
    assert.equal(durableHit.rows[0].count, '1');

    // A learned convention must preserve path substitution while adapting a
    // separate query field. The user ID contains a slash to prove URL encoding.
    const pathSchema = {
      type: 'object', properties: {
        userId: { type: 'string' },
        query: { type: 'object', properties: { region: { type: 'string' } }, required: ['region'], additionalProperties: false },
      }, required: ['userId', 'query'], additionalProperties: false,
    };
    await registerEndpoint('m42-path-source', 'https://path-source.example', {
      schema: pathSchema, path: '/users/{userId}',
    });
    const pathSource = await executor.invoke({
      apiId: 'm42-path-source', toolName: 'lookup', args: { userId: 'a/b', query: { region: 'west' } },
    });
    assert.equal(pathSource.ok, true, JSON.stringify({ error: pathSource.error, urls: requestUrls.get('path-source.example')?.map((url) => url.href) }));
    assert.equal(pathSource.meta.cacheHit, false);
    await registerEndpoint('m42-path-destination', 'https://path-destination.example', {
      schema: pathSchema, path: '/users/{userId}',
    });
    const pathDestination = await executor.invoke({
      apiId: 'm42-path-destination', toolName: 'lookup', args: { userId: 'c/d', query: { region: 'east' } },
    });
    assert.equal(pathDestination.ok, true, JSON.stringify(pathDestination.error));
    assert.equal(pathDestination.meta.cacheHit, true);
    assert.equal(pathDestination.meta.rounds, 0);
    assert.equal(requests.get('path-source.example'), 2);
    assert.equal(requests.get('path-destination.example'), 2);
    assert.equal(requestUrls.get('path-destination.example')[1].pathname, '/users/c%2Fd');
    assert.equal(requestUrls.get('path-destination.example')[1].searchParams.get('region_code'), 'east');
    assert.equal(requestUrls.get('path-destination.example')[1].searchParams.has('region'), false);

    // Change the destination's API epoch/config during its successful candidate
    // replay. The stale in-flight tool snapshot must never commit or emit cache.hit.
    await registerEndpoint('m42-revision-race', 'https://revision-race.example');
    const raceEventsBefore = bus.since(0).length;
    let raceResult;
    let raceError;
    try {
      raceResult = await executor.invoke({
        apiId: 'm42-revision-race', toolName: 'lookup', args: { userId: '456' },
      });
    } catch (error) {
      raceError = error;
    }
    assert.equal(requests.get('revision-race.example'), 2,
      'initial failure and candidate replay occurred; stale revisions halt without diagnosis or another replay');
    assert.ok(raceReplacement, 'destination was re-registered during candidate replay');
    assert.equal(registryStore.current('m42-revision-race', 'lookup').version, raceReplacement.version,
      'stale replay cannot append a version after replacement registration');
    assert.equal(registryStore.current('m42-revision-race', 'lookup').epoch, raceReplacement.epoch,
      'replacement epoch remains current after the stale replay');
    const raceEvents = bus.since(0).slice(raceEventsBefore).filter((event) => event.apiId === 'm42-revision-race');
    assert.equal(raceEvents.some((event) => event.type === 'cache.hit'), false);
    assert.equal(raceEvents.some((event) => event.type === 'patch.committed'), false);
    assert.equal(raceError, undefined, 'revision races are reported as a structured safe halt');
    assert.equal(raceResult?.ok, false);
    assert.equal(raceResult.error.details.reason, 'stale_cache_candidate');
  } finally {
    globalThis.fetch = originalFetch;
    try { await import('../src/features/events/bus.js').then(({ bus }) => bus.configureEventPersistence(null)); } catch {}
    if (closeRedisMirror) await closeRedisMirror();
    if (closePool) await closePool();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch((error) => { dropError = error; });
    await admin.end();
    if (dropError) throw dropError;
  }
});
