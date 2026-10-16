import { get } from './catalogue.js';

const userSchema = {
  type: 'object',
  properties: { user_id: { type: 'string' } },
  required: ['user_id'],
};

function jsonBody(schema) {
  return { required: true, content: { 'application/json': { schema } } };
}

function getUserOperation(mutation) {
  const schema = structuredClone(userSchema);
  const operation = {
    summary: 'Get a user',
    requestBody: jsonBody(schema),
    responses: {
      '200': { description: 'User', content: { 'application/json': { schema: {
        type: 'object', properties: { result: { type: 'object', properties: {
          id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', format: 'email' },
        } } },
      } } } },
    },
  };
  if (!mutation) return operation;

  if (mutation.id === 'M1') {
    schema.properties.userId = schema.properties.user_id;
    delete schema.properties.user_id;
    schema.required = ['userId'];
  } else if (mutation.id === 'M2') {
    schema.properties.user_id = { type: 'integer' };
  } else if (mutation.id === 'M3') {
    schema.properties = { target: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } };
    schema.required = ['target'];
  } else if (mutation.id === 'M4') {
    operation.parameters = [{ in: 'header', name: 'X-API-Version', required: true, schema: { type: 'string', enum: ['2'] } }];
  } else if (mutation.id === 'M5') {
    operation.parameters = [{ in: 'header', name: 'X-Tenant', required: true, schema: { type: 'string' } }];
    schema.properties = { target: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } };
    schema.required = ['target'];
  } else if (mutation.id === 'M6') {
    operation.responses['200'].content['application/json'].schema.properties.result.properties = {
      id: { type: 'string' }, email: { type: 'string', format: 'email' },
      data: { type: 'object', properties: { profile: { type: 'object', properties: { name: { type: 'string' } } } } },
    };
  } else if (mutation.id === 'M7') {
    schema.properties.region = { type: 'string', default: 'IN' };
    schema.required = ['user_id', 'region'];
  } else if (mutation.id === 'M9') {
    operation.parameters = [{ in: 'header', name: 'Authorization', required: true, schema: { type: 'string' } }];
  } else if (mutation.id === 'M10') {
    operation.responses['200'].content['application/json'].schema.properties.result.properties = {
      id: { type: 'string' }, email: { type: 'string', format: 'email' }, full_name: { type: 'string' },
    };
  }
  return operation;
}

export function buildOpenApi(mutationId = null) {
  const mutation = mutationId ? get(mutationId) : null;
  const statusSchema = {
    type: 'object',
    properties: { user_id: { type: 'string' }, status: { type: 'string' } },
    required: ['user_id', 'status'],
  };
  if (mutation?.id === 'M8') statusSchema.properties.status = {
    type: 'string', enum: ['ENABLED', 'DISABLED'],
    'x-healr-enum-aliases': { active: 'ENABLED', inactive: 'DISABLED' },
  };

  return {
    openapi: '3.0.0',
    info: { title: 'Mock API', version: '1.0.0' },
    'x-healr-active-mutation': mutation?.id ?? null,
    paths: {
      '/api/users/get': { post: getUserOperation(mutation) },
      '/api/users/update-email': { post: {
        summary: 'Update user email', requestBody: jsonBody(mutation?.id === 'M9'
          ? {
              type: 'object',
              properties: {
                user_id: { type: 'string' }, email: { type: 'string', format: 'email' },
                approval_code: { type: 'string' },
              },
              required: ['user_id', 'email', 'approval_code'],
            }
          : { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'] }),
        ...(mutation?.id === 'M9' ? { parameters: [{ in: 'header', name: 'Authorization', required: true, schema: { type: 'string' } }] } : {}),
      } },
      '/api/users/set-status': { post: { summary: 'Set user status', requestBody: jsonBody(statusSchema) } },
      '/api/orders/get': { post: { summary: 'Get an order', requestBody: jsonBody({ type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] }) } },
    },
  };
}
