const observations = new Map();

export function observeQuarantine({ apiId, tool, version, fingerprint, classification }) {
  const key = `${apiId}:${tool}:v${version}:${fingerprint}`;
  const previous = observations.get(key);
  const now = Date.now();
  const next = {
    apiId, tool, version, fingerprint, classification,
    firstSeen: previous?.firstSeen ?? now,
    lastSeen: now,
    count: (previous?.count ?? 0) + 1,
    status: 'unverified',
  };
  observations.set(key, next);
  return { ...next };
}

export function clearQuarantine() {
  observations.clear();
}

export function listQuarantine() {
  return [...observations.values()].map((item) => ({ ...item }));
}
