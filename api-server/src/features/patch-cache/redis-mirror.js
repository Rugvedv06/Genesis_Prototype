import { createClient } from 'redis';
import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 75;
let client;
let connecting;
let degraded = false;

function boundedEnvInteger(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function redisNamespace() {
  const raw = process.env.HEALR_CACHE_NAMESPACE ?? 'healr:local';
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) || 'healr:local';
}

async function getClient() {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    const url = new URL(process.env.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://');
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: boundedEnvInteger('REDIS_CONNECT_TIMEOUT_MS', 500, 100, 5000),
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(100 * (retries + 1), 500),
      },
    });
    client.on('error', () => { degraded = true; });
    client.on('ready', () => { degraded = false; });
  }
  if (!client.isOpen) {
    if (!connecting) {
      connecting = client.connect().catch(() => { degraded = true; }).finally(() => { connecting = null; });
    }
    await connecting;
  }
  return client.isReady ? client : null;
}

async function bounded(operation) {
  const timeoutMs = boundedEnvInteger('REDIS_COMMAND_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 10, 1000);
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('redis_timeout')), timeoutMs); }),
    ]);
  } catch {
    degraded = true;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function keyFor(cacheKey) {
  if (typeof cacheKey !== 'string' || !/^[a-f0-9]{64}$/i.test(cacheKey)) throw new TypeError('cacheKey must be a SHA-256 fingerprint');
  return `${redisNamespace()}:patch:${cacheKey.toLowerCase()}`;
}

function stateKey(family, key) {
  const name = String(family).replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  const digest = createHash('sha256').update(String(key)).digest('hex');
  return `${redisNamespace()}:state:${name}:${digest}`;
}

export async function readRedisState(family, key) {
  const redis = await bounded(getClient);
  if (!redis) return null;
  const value = await bounded(() => redis.get(stateKey(family, key)));
  if (typeof value !== 'string' || value.length > 16_000) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function writeRedisState(family, key, value, ttlSeconds) {
  const redis = await bounded(getClient);
  if (!redis) return false;
  const ttl = Number.isInteger(ttlSeconds) ? Math.max(1, Math.min(ttlSeconds, MAX_TTL_SECONDS)) : DEFAULT_TTL_SECONDS;
  let payload;
  try { payload = JSON.stringify(value); } catch { return false; }
  if (payload.length > 16_000) return false;
  const result = await bounded(() => redis.set(stateKey(family, key), payload, { EX: ttl }));
  return result === 'OK';
}

export async function deleteRedisState(family, key) {
  const redis = await bounded(getClient);
  if (!redis) return false;
  return (await bounded(() => redis.del(stateKey(family, key)))) !== null;
}

export async function recordRedisCircuitFailure(key, now, windowMs, openMs) {
  const redis = await bounded(getClient);
  if (!redis) return null;
  const failuresKey = stateKey('circuit-failures', key);
  const openKey = stateKey('circuit-open', key);
  const until = await bounded(() => redis.eval(
    `local now=tonumber(ARGV[1]); local window=tonumber(ARGV[2]); local untilAt=tonumber(ARGV[3]);
     redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now-window);
     redis.call('ZADD', KEYS[1], now, ARGV[4]); redis.call('PEXPIRE', KEYS[1], window);
     local count=redis.call('ZCARD', KEYS[1]);
     if count >= 3 then redis.call('SET', KEYS[2], untilAt, 'PX', ARGV[5]); return untilAt; end;
     return 0;`,
    { keys: [failuresKey, openKey], arguments: [String(now), String(windowMs), String(now + openMs), randomUUID(), String(openMs)] },
  ));
  return Number(until) > 0 ? Number(until) : null;
}

export async function readRedisCircuitOpenUntil(key) {
  const redis = await bounded(getClient);
  if (!redis) return null;
  const value = await bounded(() => redis.get(stateKey('circuit-open', key)));
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) {
    degraded = true;
    return null;
  }
  const until = Number(value);
  if (until > Date.now() + 60_000) {
    degraded = true;
    return null;
  }
  return Number.isFinite(until) && until > Date.now() ? until : null;
}

export async function readCandidateMirror(cacheKey) {
  const redis = await bounded(getClient);
  if (!redis) return null;
  const payload = await bounded(() => redis.get(keyFor(cacheKey)));
  if (typeof payload !== 'string' || payload.length > 64_000) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.cacheKey !== cacheKey.toLowerCase() || parsed?.state !== 'verified') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCandidateMirror(candidate, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!candidate || candidate.state !== 'verified' || !Array.isArray(candidate.operations)) return false;
  const redis = await bounded(getClient);
  if (!redis) return false;
  const ttl = Number.isInteger(ttlSeconds) ? Math.max(1, Math.min(ttlSeconds, MAX_TTL_SECONDS)) : DEFAULT_TTL_SECONDS;
  const payload = JSON.stringify(candidate);
  if (payload.length > 64_000) return false;
  const result = await bounded(() => redis.set(keyFor(candidate.cacheKey), payload, { EX: ttl }));
  return result === 'OK';
}

export async function deleteCandidateMirror(cacheKey) {
  const redis = await bounded(getClient);
  if (!redis) return false;
  return (await bounded(() => redis.del(keyFor(cacheKey)))) !== null;
}

export function redisMirrorStatus() {
  return { configured: Boolean(process.env.REDIS_URL), ready: Boolean(client?.isReady), degraded };
}

export async function probeRedisMirror() {
  await bounded(getClient);
  return redisMirrorStatus();
}

export async function closeRedisMirror() {
  const current = client;
  client = undefined;
  connecting = undefined;
  if (current?.isOpen) {
    try { await current.quit(); }
    catch { current.disconnect(); }
  }
}
