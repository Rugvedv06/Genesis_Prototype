import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiServerDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Resolve configured relative data paths from the API service root, regardless of process cwd. */
export function resolveDataDir(configuredPath) {
  if (!configuredPath) return join(apiServerDir, 'data');
  return isAbsolute(configuredPath) ? configuredPath : resolve(apiServerDir, configuredPath);
}
