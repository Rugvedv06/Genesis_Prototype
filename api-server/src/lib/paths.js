// Phase 0: dotted-path helpers. Everyone depends on this (registry compile, patch engine, drift detector).
// Dotted paths only; array support not needed per plan.

export function getPath(obj, path) {
  if (path === undefined || path === null || path === '') return obj;
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setPath(obj, path, value) {
  if (path === undefined || path === null || path === '') return value;
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === undefined || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

export function deletePath(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (cur === null || cur === undefined || typeof cur !== 'object') return false;
  }
  const deleted = Object.prototype.hasOwnProperty.call(cur, parts[parts.length - 1]);
  delete cur[parts[parts.length - 1]];
  return deleted;
}

export function leafPaths(obj, prefix = '') {
  const out = [];
  for (const key of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const v = obj[key];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...leafPaths(v, p));
    } else {
      out.push(p);
    }
  }
  return out;
}
