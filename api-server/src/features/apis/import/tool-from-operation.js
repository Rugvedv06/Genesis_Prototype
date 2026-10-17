const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);
const IDEMPOTENCY_HEADERS = new Set(['idempotency-key', 'x-idempotency-key']);

function slug(value) {
  let result = String(value).replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-zA-Z]/.test(result)) result = `api_${result}`;
  return result.slice(0, 64) || 'api_operation';
}

function typeName(schema) {
  if (Array.isArray(schema?.type)) return schema.type.find((item) => item !== 'null') ?? 'string';
  return schema?.type ?? (schema?.properties ? 'object' : 'string');
}

const SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'format', 'description', 'default', 'items', 'anyOf', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems']);
function jsonSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) => SCHEMA_KEYS.has(key)));
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, jsonSchema(value)]));
  if (schema.items) result.items = jsonSchema(schema.items);
  if (schema.anyOf) result.anyOf = schema.anyOf.map(jsonSchema);
  return result;
}

function responseSchema(operation) {
  for (const [status, response] of Object.entries(operation.responses ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    if (!/^2\d\d$/.test(status)) continue;
    const content = response?.content ?? {};
    const entry = content['application/json'] ?? content['application/*+json'];
    if (entry?.schema) return entry.schema;
  }
  return null;
}

function paths(schema, prefix = '', out = {}, inheritedRequired = false) {
  if (schema?.type !== 'object' || !schema.properties || !Object.keys(schema.properties).length) {
    if (prefix) out[prefix] = { schema, required: inheritedRequired };
    return out;
  }
  for (const [key, child] of Object.entries(schema.properties)) paths(child, prefix ? `${prefix}.${key}` : key, out, (schema.required ?? []).includes(key));
  return out;
}

export function toolFromOperation({ method, path, operation, pathParameters = [], usedNames }) {
  const lowerMethod = method.toLowerCase();
  if (!METHODS.has(lowerMethod)) return { skipped: 'unsupported_method' };
  const parametersList = [...pathParameters, ...(operation.parameters ?? [])];
  const idempotencyParameters = parametersList.filter((parameter) => parameter?.in === 'header'
    && IDEMPOTENCY_HEADERS.has(String(parameter.name ?? '').toLowerCase()));
  const unsupportedParameters = parametersList.filter((parameter) => !idempotencyParameters.includes(parameter));
  if (idempotencyParameters.length > 1) return { skipped: 'ambiguous_idempotency_header' };
  if (unsupportedParameters.length) return { skipped: 'unsupported_parameter_location' };
  if (/[{}]/.test(path)) return { skipped: 'unsupported_parameter_location' };
  if (!operation.requestBody) return { skipped: 'missing_json_request_body' };
  const requestContent = operation.requestBody.content ?? {};
  const request = requestContent['application/json'] ?? requestContent['application/*+json'];
  if (!request?.schema) return { skipped: Object.keys(requestContent).length ? 'unsupported_content_type' : 'missing_json_request_body' };
  const schema = request.schema;
  if (typeName(schema) !== 'object' || !schema.properties) {
    return { skipped: 'unsupported_request_schema' };
  }
  if (lowerMethod === 'get' || lowerMethod === 'head') return { skipped: 'unsupported_request_body_method' };
  const baseName = slug(operation.operationId || `${lowerMethod}_${path}`);
  const ambiguousName = usedNames.has(baseName);
  let name = baseName;
  for (let suffix = 2; usedNames.has(name); suffix += 1) name = `${baseName.slice(0, 59)}_${suffix}`;
  if (!NAME.test(name)) return { skipped: 'invalid_function_name' };
  usedNames.add(name);
  const parameters = { ...jsonSchema(schema), type: 'object', required: schema.required ?? [], additionalProperties: schema.additionalProperties ?? false };
  const properties = parameters.properties;
  const response = responseSchema(operation);
  const fields = response ? Object.fromEntries(Object.entries(paths(response)).map(([key, item]) => [key.split('.').at(-1), {
    path: key, type: typeName(item.schema), ...(item.schema.format ? { format: item.schema.format } : {}),
    required: item.required,
  }])) : {};
  const suggestions = Object.keys(properties).filter((key) => /(^id$|_id$|Id$)/i.test(key));
  const tool = {
    name, ...(operation.summary ? { description: operation.summary.slice(0, 1000) } : {}),
    method: lowerMethod.toUpperCase(), path, parameters,
    sideEffects: ['GET', 'HEAD'].includes(lowerMethod.toUpperCase()) ? 'none' : 'write',
    risk: lowerMethod === 'delete' ? 'high' : ['get', 'head'].includes(lowerMethod) ? 'low' : 'medium',
    response: { fields },
  };
  if (idempotencyParameters.length === 1) tool.idempotencyKeyHeader = idempotencyParameters[0].name;
  if (suggestions.length === 1 && fields.id) tool.identitySuggestion = { [suggestions[0]]: 'id' };
  return { tool, warnings: [ambiguousName ? 'ambiguous_name' : null, response ? null : 'no_response_schema'].filter(Boolean) };
}
