import { loadSpec } from './loader.js';
import { dereferenceLocalRefs } from './deref.js';
import { deriveTier0 } from './derive.js';

function operationFor(spec, tool) {
  const path = tool.versionObj?.meta?.path;
  const method = String(tool.versionObj?.meta?.method ?? 'POST').toLowerCase();
  return spec?.paths?.[path]?.[method] ?? null;
}

/** Use a bounded, matching, current OpenAPI operation as Tier 0 evidence. */
export async function discover({ tool, args, errors = [], failure = {}, apiConfig = {}, skipTiers = [], onSpecExcerpt }) {
  if (skipTiers.includes(0)) return null;
  const loaded = await loadSpec(tool, failure);
  if (!loaded) return null;
  const operation = operationFor(loaded.spec, tool);
  if (!operation) return null;
  if (onSpecExcerpt) onSpecExcerpt(JSON.stringify(operation).slice(0, 4096));
  const rawSchema = operation.requestBody?.content?.['application/json']?.schema;
  if (!rawSchema) return null;
  let schema;
  try { schema = dereferenceLocalRefs(rawSchema, loaded.spec); }
  catch { return null; }
  const proposal = deriveTier0({ tool, args, errors, schema, operation, apiConfig, specUrl: loaded.url });
  if (proposal) proposal.evidence = proposal.evidence.map((item) => ({ ...item, specFingerprint: loaded.fingerprint, specUrls: loaded.urls }));
  return proposal;
}

export const run = discover;
