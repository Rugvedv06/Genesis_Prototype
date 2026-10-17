const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

export function isDemoBaseUrl(baseUrl, mockUrl) {
  const base = parseHttpUrl(baseUrl);
  const mock = parseHttpUrl(mockUrl);
  if (!base || !mock) return false;
  if (base.origin === mock.origin) return true;
  return base.protocol === mock.protocol
    && base.port === mock.port
    && LOOPBACK_HOSTS.has(base.hostname.toLowerCase())
    && LOOPBACK_HOSTS.has(mock.hostname.toLowerCase());
}
