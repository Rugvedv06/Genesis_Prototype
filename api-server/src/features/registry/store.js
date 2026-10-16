// Phase 1 Track B: versioned registry store (§4.2, §6 Phase 1).
// Immutable version objects; commit appends, never rewrites. JSON snapshot to
// data/registry.json on commit.
import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iso } from '../../lib/time.js';
import { sha256, stableStringify } from '../../lib/hash.js';
import { compileAdapter } from './compile.js';
import { cfg } from '../../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DATA_DIR = join(__dirname, '..', '..', '..', 'data');
const DATA_DIR = cfg.dataDir ?? DEFAULT_DATA_DIR;
const REGISTRY_FILE = join(DATA_DIR, 'registry.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadRegistry() {
  ensureDir();
  if (!existsSync(REGISTRY_FILE)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export class RegistryStore {
  constructor() {
    this._byApi = loadRegistry(); // { apiId: { tools: { toolName: { versions, current } }, config, epoch } }
    this._compiled = new Map(); // key: `${apiId}:${tool}:v${version}` -> compiled adapter
    this._hydrateCompiled();
  }

  _key(apiId, tool) {
    return `${apiId}:${tool}`;
  }

  _hydrateCompiled() {
    for (const apiId of Object.keys(this._byApi)) {
      const api = this._byApi[apiId];
      for (const tool of Object.keys(api.tools ?? {})) {
        const entry = api.tools[tool];
        for (const v of entry.versions) {
          this._compiled.set(`${this._key(apiId, tool)}:v${v.version}`, compileAdapter(v.adapter));
        }
      }
    }
  }

  _toolEntry(apiId, tool) {
    const api = this._byApi[apiId];
    if (!api) return null;
    return api.tools ? api.tools[tool] : null;
  }

  // Register a single tool within an existing or new API. Used internally by
  // registerApi; kept for backward compatibility.
  register(apiId, tool, adapter, risk = 'low', config = {}) {
    ensureDir();
    if (!this._byApi[apiId]) this._byApi[apiId] = { tools: {}, config, epoch: 0 };
    if (!this._byApi[apiId].tools) this._byApi[apiId].tools = {};
    this._byApi[apiId].config = { ...this._byApi[apiId].config, ...config };
    const entry = this._byApi[apiId].tools[tool];
    const version = entry ? entry.versions.length + 1 : 1;
    const versionObj = {
      version,
      parent: entry ? entry.current.version : null,
      rollbackOf: null,
      tool,
      createdAt: iso(),
      adapter,
      origin: 'register',
      change: null,
    };
    if (!entry) {
      this._byApi[apiId].tools[tool] = { versions: [versionObj], current: versionObj, risk };
    } else {
      entry.versions.push(versionObj);
      entry.current = versionObj;
    }
    this._compile(apiId, tool, version, versionObj);
    this._snapshot();
    return versionObj;
  }

  // Replace an entire API atomically: re-registering resets to clean v1 instead
  // of stacking versions. Bumps the API epoch.
  registerApi(apiId, payload) {
    const { baseUrl, specUrl, credentials, healing, tools } = payload;
    ensureDir();
    const existing = this._byApi[apiId];
    const epoch = (existing?.epoch ?? 0) + 1;
    const apiEntry = { tools: {}, config: { baseUrl, specUrl, credentials, healing }, epoch };
    for (const tool of tools) {
      const responseMap = tool.response
        ? Object.fromEntries(Object.entries(tool.response.fields ?? {}).map(([k, v]) => [k, v.path]))
        : {};
      const adapter = {
        request: tool.adapter?.request ?? [],
        response: { map: responseMap },
        _path: tool.path,
        _method: tool.method ?? 'POST',
        _logicalSchema: tool.parameters,
        sideEffects: tool.sideEffects ?? 'write',
      };
      const versionObj = {
        version: 1,
        parent: null,
        rollbackOf: null,
        tool: tool.name,
        createdAt: iso(),
        adapter,
        origin: 'register',
        change: null,
      };
      apiEntry.tools[tool.name] = {
        versions: [versionObj],
        current: versionObj,
        risk: tool.risk ?? 'low',
      };
      this._compile(apiId, tool.name, 1, versionObj);
    }
    this._byApi[apiId] = apiEntry;
    this._snapshot();
    return { apiId, epoch, tools: tools.map((t) => t.name) };
  }

  removeApi(apiId) {
    if (!this._byApi[apiId]) return false;
    delete this._byApi[apiId];
    this._snapshot();
    return true;
  }

  config(apiId) {
    const api = this._byApi[apiId];
    return api ? api.config : null;
  }

  _compile(apiId, tool, version, versionObj) {
    const compiled = compileAdapter(versionObj.adapter);
    this._compiled.set(`${this._key(apiId, tool)}:v${version}`, compiled);
  }

  current(apiId, tool) {
    const entry = this._toolEntry(apiId, tool);
    if (!entry) return null;
    const cur = entry.current;
    return {
      version: cur.version,
      versionObj: cur,
      compiled: this._compiled.get(`${this._key(apiId, tool)}:v${cur.version}`),
      versions: entry.versions.map((v) => ({
        version: v.version,
        parent: v.parent,
        rollbackOf: v.rollbackOf,
        createdAt: v.createdAt,
        origin: v.origin,
        change: v.change,
      })),
    };
  }

  versions(apiId, tool) {
    const entry = this._toolEntry(apiId, tool);
    if (!entry) return null;
    return entry.versions.map((v) => ({
      version: v.version,
      parent: v.parent,
      rollbackOf: v.rollbackOf,
      tool: v.tool,
      createdAt: v.createdAt,
      origin: v.origin,
      change: v.change,
      adapterHash: v.adapter ? sha256(stableStringify(v.adapter)) : null,
    }));
  }

  version(apiId, tool, versionNumber) {
    const entry = this._toolEntry(apiId, tool);
    if (!entry) return null;
    const v = entry.versions.find((x) => x.version === versionNumber);
    if (!v) return null;
    return {
      version: v.version,
      parent: v.parent,
      rollbackOf: v.rollbackOf,
      tool: v.tool,
      createdAt: v.createdAt,
      origin: v.origin,
      change: v.change,
      adapterHash: v.adapter ? sha256(stableStringify(v.adapter)) : null,
    };
  }

  commit(apiId, tool, adapter, change) {
    const entry = this._toolEntry(apiId, tool);
    if (!entry) throw new Error(`registry.commit: ${apiId}/${tool} not registered`);
    const version = entry.versions.length + 1;
    const versionObj = {
      version,
      parent: entry.current.version,
      rollbackOf: null,
      tool,
      createdAt: iso(),
      adapter,
      origin: 'heal',
      change: change ?? null,
    };
    entry.versions.push(versionObj);
    entry.current = versionObj;
    this._compile(apiId, tool, version, versionObj);
    this._snapshot();
    return versionObj;
  }

  rollback(apiId, tool, toVersion) {
    const entry = this._toolEntry(apiId, tool);
    if (!entry) throw new Error(`registry.rollback: ${apiId}/${tool} not registered`);
    const target = entry.versions.find((v) => v.version === toVersion);
    if (!target) throw new Error(`registry.rollback: version ${toVersion} not found`);
    const version = entry.versions.length + 1;
    const versionObj = {
      version,
      parent: entry.current.version,
      rollbackOf: toVersion,
      tool,
      createdAt: iso(),
      adapter: target.adapter,
      origin: 'rollback',
      change: null,
    };
    entry.versions.push(versionObj);
    entry.current = versionObj;
    this._compile(apiId, tool, version, versionObj);
    this._snapshot();
    return versionObj;
  }

  list() {
    const out = [];
    for (const apiId of Object.keys(this._byApi)) {
      const api = this._byApi[apiId];
      for (const tool of Object.keys(api.tools ?? {})) {
        const cur = this.current(apiId, tool);
        out.push({ apiId, tool, version: cur.version, risk: api.tools[tool].risk ?? 'low', epoch: api.epoch });
      }
    }
    return out;
  }

  _snapshot() {
    try {
      ensureDir();
      writeFileSync(REGISTRY_FILE, JSON.stringify(this._byApi, null, 2));
    } catch {
      // best-effort; in-memory remains source of truth
    }
  }

  // Test-only: clear in-memory state. Does not delete the snapshot file.
  reset() {
    this._byApi = {};
    this._compiled = new Map();
  }
}

export const registryStore = new RegistryStore();
