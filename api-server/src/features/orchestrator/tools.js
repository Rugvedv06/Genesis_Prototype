import { registryStore } from '../registry/store.js';

// Expose only the current logical tool contract to the model. Runtime adapter
// details remain inside the executor.
export function buildToolDeclarations(apiId) {
  return registryStore.list().filter((item) => item.apiId === apiId).flatMap((item) => {
    const current = registryStore.current(apiId, item.tool);
    const schema = current?.versionObj?.meta?.logicalSchema;
    if (!schema || schema.type !== 'object') return [];
    return [{
      name: item.tool,
      description: `Invoke ${item.tool} using its logical arguments.`,
      parameters: schema,
      sideEffects: current.versionObj.meta.sideEffects ?? current.versionObj.adapter.sideEffects ?? 'write',
    }];
  });
}
