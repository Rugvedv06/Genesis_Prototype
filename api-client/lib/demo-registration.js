// One-click first run; matches contracts/registration.payload.json
import { MOCK } from './core';
export const demoRegistration = () => ({
  apiId: 'demo-users',
  baseUrl: MOCK,
  specUrl: `${MOCK}/openapi.json`,
  credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
  healing: { enabled: true, confidenceThreshold: 0.85, maxRounds: 5, tier2: true },
  tools: [
    { name: 'get_user', description: 'Fetch a user by id', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, name: { path: 'result.name', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true } } } },
    { name: 'update_user_email', description: "Update a user's email", method: 'POST', path: '/api/users/update-email', risk: 'medium', sideEffects: 'write', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true }, updated_at: { path: 'result.updated_at', type: 'string', required: true } } } },
  ],
});
