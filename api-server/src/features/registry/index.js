// Phase 1 Track B: versioned tools, compile, rollback, snapshot (§6 Phase 1 / Phase 2).
// compileAdapter + ProvenanceError/NotLossless live in ./compile.js.
// Store instance: ./store.js
export { compileAdapter, ProvenanceError, NotLossless } from './compile.js';
export { registryStore } from './store.js';

export function current() {
  throw new Error('registry.current not implemented yet (use registryStore)');
}
export function commit() {
  throw new Error('registry.commit not implemented yet (use registryStore)');
}
export function rollback() {
  throw new Error('registry.rollback not implemented yet (use registryStore)');
}
