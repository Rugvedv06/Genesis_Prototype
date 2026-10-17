import { validateUpstreamUrl } from '../../http/url-policy.js';
import { cfg } from '../../../config.js';
import { registryStore } from '../../registry/store.js';
import { createHash } from 'node:crypto';

const MAX_SPEC_BYTES = 1_000_000;
const PROBE_TIMEOUT_MS = 400;
const DEFAULT_CACHE_TTL_MS = 5000;
const specCache = new Map();
const untrusted = new Map();
const inFlight = new Map();

function cacheTtl() {
  const configured = Number(process.env.SPEC_CACHE_TTL_MS);
  return Number.isFinite(configured) ? Math.max(500, Math.min(60_000, configured)) : DEFAULT_CACHE_TTL_MS;
}
function pruneCaches(now) {
  for (const [key, entry] of specCache) if (entry.expiresAt <= now) specCache.delete(key);
  for (const [key, expiresAt] of untrusted) if (expiresAt <= now) untrusted.delete(key);
  while (specCache.size > 256) specCache.delete(specCache.keys().next().value);
  while (untrusted.size > 256) untrusted.delete(untrusted.keys().next().value);
}

function extractLinkSpecUrl(linkHeader, baseUrl) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    if (!/rel\s*=\s*["']?describedby["']?/i.test(part)) continue;
    const match = part.match(/<([^>]+)>/);
    if (match) { try { return new URL(match[1], baseUrl).toString(); } catch {} }
  }
  return null;
}

function extractErrorSpecUrl(failure) {
  const text = typeof failure?.text === 'string' ? failure.text : JSON.stringify(failure?.json ?? '');
  const match = text.match(/https?:\/\/[^\s"'<>]+\.(?:json|ya?ml)(?:\?[^\s"'<>]*)?/i);
  return match?.[0] ?? null;
}

export function candidateSpecUrls(tool, failure = {}) {
  const config = registryStore.config(tool.apiId) ?? tool.apiConfig ?? {};
  const base = config.baseUrl ?? tool.versionObj?.meta?.baseUrl;
  const candidates = [config.specUrl, base && new URL('/openapi.json', base).toString(), base && new URL('/swagger.json', base).toString(), extractLinkSpecUrl(failure.headers?.link, base), extractErrorSpecUrl(failure)].filter(Boolean);
  return [...new Set(candidates)];
}

async function readBoundedJson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SPEC_BYTES) { await reader.cancel(); return null; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } finally { reader.releaseLock(); }
}

async function fetchCandidate(candidate) {
  let url;
  try { url = validateUpstreamUrl(candidate, { allowLocal: cfg.allowLocalUpstreams }); } catch { return null; }
  const cacheKey = url.toString();
  const now = Date.now();
  pruneCaches(now);
  const blockedUntil = untrusted.get(cacheKey) ?? 0;
  if (blockedUntil > now) return null;
  const cached = specCache.get(cacheKey);
  if (cached && cached.expiresAt > now) { specCache.delete(cacheKey); specCache.set(cacheKey, cached); return cached; }
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const pending = fetchAndCache(url, cacheKey, cached, now);
  inFlight.set(cacheKey, pending);
  try { return await pending; } finally { inFlight.delete(cacheKey); }
}

async function fetchAndCache(url, cacheKey, cached, now) {
  const controller = new AbortController();
  let timedOut = false;
  let timeout;
  const work = (async () => {
    try {
      const headers = { Accept: 'application/json' };
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      if (timedOut) return null;
      if (response.status === 304 && cached) {
        cached.expiresAt = now + cacheTtl();
        return cached;
      }
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_SPEC_BYTES) return null;
      const spec = await readBoundedJson(response);
      if (timedOut || !spec || typeof spec !== 'object' || spec['x-healr-spec-stale'] === true || !spec.openapi) return null;
      const etag = response.headers.get('etag') ?? null;
      const fingerprint = createHash('sha256').update(JSON.stringify(spec)).update(etag ?? '').digest('hex');
      const entry = { spec, url: cacheKey, etag, expiresAt: now + cacheTtl(), fingerprint };
      specCache.set(cacheKey, entry);
      pruneCaches(now);
      return entry;
    } catch { return null; }
  })();
  const deadline = new Promise((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(null);
    }, PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  }
  finally { clearTimeout(timeout); }
}

export async function loadSpec(tool, failure = {}) {
  const urls = candidateSpecUrls(tool, failure);
  const results = await Promise.all(urls.map(fetchCandidate));
  const path = tool.versionObj?.meta?.path;
  const method = String(tool.versionObj?.meta?.method ?? 'POST').toLowerCase();
  for (const result of results) {
    if (result && result.spec?.paths?.[path]?.[method]) return {
      ...result,
      urls: results.filter((candidate) => candidate?.fingerprint === result.fingerprint).map((candidate) => candidate.url),
    };
  }
  return null;
}

export function markSpecUntrusted(spec, ttlMs = cacheTtl()) {
  const urls = spec?.urls ?? [spec?.url];
  if (urls.some((url) => specCache.has(url))) {
    const until = Date.now() + Math.max(500, Math.min(60_000, Number(ttlMs) || DEFAULT_CACHE_TTL_MS));
    for (const url of urls) if (specCache.has(url)) untrusted.set(url, until);
    pruneCaches(Date.now());
  }
}

export const SPEC_PROBE_TIMEOUT_MS = PROBE_TIMEOUT_MS;
