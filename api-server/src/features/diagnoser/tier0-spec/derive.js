import { getPath } from '../../../lib/paths.js';
import { nameScore } from '../tier1-rules/rename.js';

function pathFor(error) { return (error.path ?? []).filter((part) => part !== 'body').map(String); }
function schemaAt(schema, path) {
  return path.reduce((node, part) => node?.properties?.[part], schema);
}
function pathName(path) { return path.at(-1); }
function leaves(node, prefix = []) {
  if (!node?.properties) return [{ path: prefix, schema: node }];
  return Object.entries(node.properties).flatMap(([key, child]) => leaves(child, [...prefix, key]));
}
function logicalFieldSchema(tool, path) {
  return path.reduce((node, part) => node?.properties?.[part], tool.versionObj?.meta?.logicalSchema);
}
function compatibleTypes(source, target) {
  if (!source || !target || source === target) return true;
  return (source === 'string' && target === 'integer') || (source === 'integer' && target === 'string');
}

export function deriveTier0({ tool, args, errors, schema, operation, apiConfig = {}, specUrl }) {
  const ops = [];
  const evidence = [];
  const missing = errors.filter((error) => error.kind === 'missing' && pathFor(error).length);
  const extra = errors.filter((error) => error.kind === 'extra' && pathFor(error).length);
  const logicalNames = Object.keys(args ?? {});
  const expectedLeaves = leaves(schema).filter((item) => item.path.length);

  for (const parameter of operation?.parameters ?? []) {
    if (parameter.in !== 'header' || !parameter.required) continue;
    const name = parameter.name;
    const reportedMissing = errors.some((item) => item.kind === 'missing_header' && item.header?.toLowerCase() === name?.toLowerCase());
    const alreadyConfigured = (tool.versionObj?.adapter?.request ?? []).some((item) => item.op === 'add_header' && item.name?.toLowerCase() === name.toLowerCase());
    if (alreadyConfigured && !reportedMissing) continue;
    const configured = Object.keys(apiConfig.credentials ?? {}).find((key) => key.toLowerCase() === name.toLowerCase());
    const source = configured ? { type: 'credential', ref: configured }
      : Object.hasOwn(parameter.schema ?? {}, 'default') ? { type: 'spec_default', value: parameter.schema.default }
        : parameter.schema?.enum?.length === 1 ? { type: 'error_enum', value: parameter.schema.enum[0] } : null;
    if (source) {
      ops.push({ op: 'add_header', name, source });
      evidence.push({ kind: 'openapi_header', spec: specUrl, pointer: `#/paths/${tool.versionObj.meta.path}/${String(tool.versionObj.meta.method ?? 'POST').toLowerCase()}/parameters` });
    }
  }

  const argsLeaves = leaves({ type: 'object', properties: Object.fromEntries(Object.entries(args ?? {}).map(([key, value]) => [key, { type: typeof value }])) }).map((item) => item.path);
  const inferredMissing = missing.length ? missing.map(pathFor) : expectedLeaves
    .filter((item) => getPath(args ?? {}, item.path.join('.')) === undefined)
    .map((item) => item.path);
  for (const targetPath of inferredMissing) {
    const target = pathName(targetPath);
    const targetSchema = schemaAt(schema, targetPath);
    if (targetSchema && Object.hasOwn(targetSchema, 'default')) {
      ops.push({ op: 'add_field', path: targetPath.join('.'), source: { type: 'spec_default', value: targetSchema.default } });
      evidence.push({ kind: 'openapi_default', spec: specUrl, pointer: `#/paths/${tool.versionObj.meta.path}/${String(tool.versionObj.meta.method ?? 'POST').toLowerCase()}/requestBody/content/application~1json/schema/properties/${targetPath.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}` });
      continue;
    }
    if (getPath(args ?? {}, targetPath.join('.')) !== undefined) continue;
    const relevantTargets = expectedLeaves.filter((item) => item.path.join('.') === targetPath.join('.')
      || (item.path.length > targetPath.length && targetPath.every((part, index) => item.path[index] === part)));
    const targets = relevantTargets.length ? relevantTargets : [{ path: targetPath, schema: targetSchema }];
    const sourcePaths = extra.length ? extra.map(pathFor) : missing.length ? [] : argsLeaves.map((path) => path.map(String));
    const candidatePaths = [...new Map(sourcePaths.map((path) => [path.join('.'), path])).values()];
    const candidates = candidatePaths.flatMap((fromPath) => {
      if (!logicalNames.includes(pathName(fromPath))) return [];
      const fromSchema = logicalFieldSchema(tool, fromPath);
      return targets.filter((item) => compatibleTypes(fromSchema?.type, item.schema?.type)).map((item) => ({ fromPath, target: item, score: nameScore(pathName(fromPath), pathName(item.path)) }));
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const margin = best ? best.score - (candidates[1]?.score ?? 0) : 0;
    if (!best || best.score <= 0 || margin < 0.15) continue;
    const fromPath = best.fromPath;
    const finalPath = best.target.path;
    const parent = finalPath.slice(0, -1);
    const oldParent = fromPath.slice(0, -1);
    if (parent.join('.') !== oldParent.join('.')) {
      const stagedPath = [...parent, pathName(fromPath)];
      ops.push({ op: 'move_field', from: fromPath.join('.'), to: stagedPath.join('.') });
      if (pathName(stagedPath) !== pathName(finalPath)) ops.push({ op: 'rename_field', ...(parent.length ? { path: parent.join('.') } : {}), from: pathName(stagedPath), to: pathName(finalPath) });
    } else if (pathName(fromPath) !== pathName(finalPath)) {
      ops.push({ op: 'rename_field', ...(parent.length ? { path: parent.join('.') } : {}), from: pathName(fromPath), to: pathName(finalPath) });
    }
    const sourceType = logicalFieldSchema(tool, fromPath)?.type;
    if (sourceType && best.target.schema?.type && sourceType !== best.target.schema.type) {
      ops.push({ op: 'coerce_type', path: finalPath.join('.'), from: sourceType, to: best.target.schema.type });
    }
    evidence.push({ kind: 'openapi_schema', spec: specUrl, pointer: `#/paths/${tool.versionObj.meta.path}/${String(tool.versionObj.meta.method ?? 'POST').toLowerCase()}/requestBody/content/application~1json/schema/properties/${finalPath.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/properties/')}` });
  }

  for (const item of expectedLeaves) {
    const path = item.path;
    const value = getPath(args ?? {}, path.join('.'));
    if (value === undefined) continue;
    const sourceType = logicalFieldSchema(tool, path)?.type ?? (typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value);
    const targetType = item.schema?.type;
    const hasCoercion = ops.some((op) => op.op === 'coerce_type' && op.path === path.join('.'));
    if (!hasCoercion && sourceType && targetType && sourceType !== targetType
      && compatibleTypes(sourceType, targetType)) {
      ops.push({ op: 'coerce_type', path: path.join('.'), from: sourceType, to: targetType });
      evidence.push({ kind: 'openapi_type', spec: specUrl, pointer: `#/paths/${tool.versionObj.meta.path}/${String(tool.versionObj.meta.method ?? 'POST').toLowerCase()}/requestBody/content/application~1json/schema` });
    }
  }

  for (const error of errors.filter((item) => item.kind === 'enum' && pathFor(item).length)) {
    const path = pathFor(error);
    const field = schemaAt(schema, path);
    const aliases = field?.['x-healr-enum-aliases'];
    const logicalValue = getPath(args ?? {}, path.join('.'));
    const mapped = aliases && Object.hasOwn(aliases, logicalValue) ? aliases[logicalValue] : undefined;
    if (mapped !== undefined && field.enum?.includes(mapped)) {
      ops.push({ op: 'set_enum_map', path: path.join('.'), map: { [logicalValue]: mapped } });
      evidence.push({ kind: 'openapi_enum_alias', spec: specUrl, logicalValue, mapped });
      continue;
    }
    const values = field?.enum ?? [];
    const variant = values.find((value) => typeof value === 'string' && typeof logicalValue === 'string' && value.toLowerCase() === logicalValue.toLowerCase());
    if (variant !== undefined && variant !== logicalValue) {
      ops.push({ op: 'set_enum_map', path: path.join('.'), map: { [logicalValue]: variant } });
      evidence.push({ kind: 'openapi_enum', spec: specUrl, logicalValue, mapped: variant });
    }
  }

  if (!ops.length) return null;
  return { tier: 0, confidence: 0.99, ops, evidence };
}
