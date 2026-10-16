const PRIVATE_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts.every((part) => part === 0);
}

export function validateUpstreamUrl(value, { allowLocal = true } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('baseUrl must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('baseUrl must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('baseUrl must not contain embedded credentials');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === '169.254.169.254') {
    throw new Error('cloud metadata destinations are not allowed');
  }
  const local = PRIVATE_HOSTS.has(hostname) || isPrivateIpv4(hostname) || hostname === '::1' || hostname.endsWith('.localhost');
  if (local && !allowLocal) {
    throw new Error('local or private upstream destinations are disabled');
  }
  return url;
}
