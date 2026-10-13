export type StepId =
  | 'task'
  | 'request'
  | 'error'
  | 'diagnose'
  | 'patch'
  | 'retry'
  | 'success'

export type StepState = 'pending' | 'active' | 'success' | 'error' | 'blocked'

export type LogStatus = 'info' | 'error' | 'warn' | 'success'

export interface LogEntry {
  t: string
  event: string
  status: LogStatus
  details: string
}

export interface DemoFrame {
  wait: number
  step?: StepId
  stepState?: StepState
  log?: Omit<LogEntry, 't'>
  ui?: {
    request?: unknown
    error?: unknown
    diagnosis?: string
    patch?: unknown
    retryRequest?: unknown
    response?: unknown
  }
  finish?: 'success' | 'human'
}

export interface Scenario {
  id: 'A' | 'B' | 'C'
  name: string
  shortName: string
  tagline: string
  tool: string
  method: string
  endpoint: string
  registryVersion: string
  expectedSchema: Record<string, unknown>
  actualSchema: Record<string, unknown>
  driftSummary: string
  initialRequest: unknown
  errorResponse: unknown
  diagnosis: string
  patchDescription: string
  patch: unknown
  retryRequest: unknown
  successResponse: unknown
  recoverable: boolean
  requiredField?: string
  frames: DemoFrame[]
}

/* ------------------------------------------------------------------ */
/* Shared workflow definition                                          */
/* ------------------------------------------------------------------ */

export const WORKFLOW_STEPS: { id: StepId; label: string; caption: string }[] = [
  { id: 'task', label: 'Task Received', caption: 'Agent picks up goal' },
  { id: 'request', label: 'API Request', caption: 'Registry schema' },
  { id: 'error', label: 'Schema Error', caption: 'HTTP 422' },
  { id: 'diagnose', label: 'Diagnose Drift', caption: 'Diff schemas' },
  { id: 'patch', label: 'Apply Patch', caption: 'Update tool def' },
  { id: 'retry', label: 'Retry Request', caption: 'Patched payload' },
  { id: 'success', label: 'Success', caption: 'Task complete' },
]

export const INITIAL_STEP_STATES: Record<StepId, StepState> = {
  task: 'pending',
  request: 'pending',
  error: 'pending',
  diagnose: 'pending',
  patch: 'pending',
  retry: 'pending',
  success: 'pending',
}

/* ------------------------------------------------------------------ */
/* Timeline builders                                                   */
/* ------------------------------------------------------------------ */

let clockMs = 0
function stamp(stepMs: number): string {
  clockMs += stepMs
  const total = 14 * 3600000 + 2 * 60000 + 3000 + clockMs
  const h = Math.floor(total / 3600000)
  const m = Math.floor((total % 3600000) / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const ms = total % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export function nextLogTimestamp(): string {
  return stamp(180)
}

function buildFrames(cfg: {
  tool: string
  method: string
  endpoint: string
  registryVersion: string
  initialRequest: unknown
  errorResponse: unknown
  diagnosis: string
  patch: unknown
  retryRequest: unknown
  successResponse: unknown
  recoverable: boolean
  renameDetail?: string
  requiredField?: string
}): DemoFrame[] {
  const frames: DemoFrame[] = [
    {
      wait: 400,
      step: 'task',
      stepState: 'active',
      log: {
        event: 'TASK_ACCEPTED',
        status: 'info',
        details: `Goal dispatched to ${cfg.tool} via tool registry`,
      },
    },
    {
      wait: 700,
      step: 'task',
      stepState: 'success',
      log: {
        event: 'SCHEMA_LOOKUP',
        status: 'info',
        details: `Loaded tool definition ${cfg.tool}@${cfg.registryVersion} from registry`,
      },
    },
    {
      wait: 750,
      step: 'request',
      stepState: 'active',
      ui: { request: cfg.initialRequest },
      log: {
        event: 'HTTP_REQUEST',
        status: 'info',
        details: `${cfg.method} ${cfg.endpoint} — payload built from registry schema`,
      },
    },
    {
      wait: 900,
      step: 'request',
      stepState: 'success',
      log: {
        event: 'HTTP_RESPONSE',
        status: 'info',
        details: 'Awaiting mock API verdict…',
      },
    },
    {
      wait: 950,
      step: 'error',
      stepState: 'active',
      log: {
        event: 'HTTP_422',
        status: 'error',
        details: 'Mock API rejected payload — schema validation failed',
      },
    },
    {
      wait: 700,
      step: 'error',
      stepState: 'error',
      ui: { error: cfg.errorResponse },
      log: {
        event: 'ERROR_CAPTURED',
        status: 'error',
        details: JSON.stringify(cfg.errorResponse),
      },
    },
    {
      wait: 850,
      step: 'diagnose',
      stepState: 'active',
      ui: { diagnosis: cfg.diagnosis },
      log: {
        event: 'DRIFT_DETECTED',
        status: 'warn',
        details: cfg.diagnosis,
      },
    },
    {
      wait: 900,
      step: 'diagnose',
      stepState: 'success',
      log: {
        event: 'SCHEMA_DIFF',
        status: 'warn',
        details: cfg.renameDetail ?? cfg.diagnosis,
      },
    },
  ]

  if (cfg.recoverable) {
    frames.push(
      {
        wait: 900,
        step: 'patch',
        stepState: 'active',
        ui: { patch: cfg.patch },
        log: {
          event: 'PATCH_AUTHORIZED',
          status: 'info',
          details: 'Field mapping falls inside policy guardrails — auto-apply allowed',
        },
      },
      {
        wait: 850,
        step: 'patch',
        stepState: 'success',
        log: {
          event: 'REGISTRY_PATCHED',
          status: 'success',
          details: 'Tool definition updated in-memory and hot-reloaded by agent',
        },
      },
      {
        wait: 800,
        step: 'retry',
        stepState: 'active',
        ui: { retryRequest: cfg.retryRequest },
        log: {
          event: 'RETRY_SEND',
          status: 'info',
          details: 'Replaying request with patched schema (attempt 2/2)',
        },
      },
      {
        wait: 900,
        step: 'retry',
        stepState: 'success',
        log: {
          event: 'HTTP_200',
          status: 'success',
          details: 'Mock API accepted the patched payload',
        },
      },
      {
        wait: 800,
        step: 'success',
        stepState: 'active',
        ui: { response: cfg.successResponse },
        log: {
          event: 'RESULT_DELIVERED',
          status: 'success',
          details: 'Task completed without human involvement',
        },
      },
      {
        wait: 700,
        step: 'success',
        stepState: 'success',
        finish: 'success',
        log: {
          event: 'SELF_HEAL_COMPLETE',
          status: 'success',
          details: 'Recovery took 2.4s end-to-end · 320 token overhead',
        },
      },
    )
  } else {
    frames.push(
      {
        wait: 900,
        step: 'patch',
        stepState: 'active',
        ui: { patch: cfg.patch },
        log: {
          event: 'PATCH_EVALUATION',
          status: 'warn',
          details: `Required field "${cfg.requiredField}" detected — searching policy vault for a safe value`,
        },
      },
      {
        wait: 950,
        step: 'patch',
        stepState: 'blocked',
        log: {
          event: 'NO_SAFE_VALUE',
          status: 'error',
          details: `No approved value for "${cfg.requiredField}" — guessing would risk data corruption`,
        },
      },
      {
        wait: 800,
        step: 'success',
        stepState: 'blocked',
        finish: 'human',
        log: {
          event: 'HUMAN_INTERVENTION_REQUIRED',
          status: 'warn',
          details: 'Recovery halted safely · incident escalated to on-call engineer',
        },
      },
    )
  }

  return frames
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export const SCENARIOS: Scenario[] = [
  {
    id: 'A',
    name: 'API Field Rename',
    shortName: 'Field Rename',
    tagline: 'user_id → userId — recoverable with a field mapping',
    tool: 'get_user',
    method: 'POST',
    endpoint: '/v2/users/profile',
    registryVersion: '3.2.0',
    expectedSchema: {
      type: 'object',
      required: ['user_id'],
      properties: {
        user_id: { type: 'integer', description: 'Numeric user identifier' },
      },
    },
    actualSchema: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'integer', description: 'Numeric user identifier (camelCase)' },
      },
    },
    driftSummary: 'Field renamed from user_id to userId in API v2.4.1',
    initialRequest: { user_id: 123 },
    errorResponse: {
      status: 422,
      error: 'Unprocessable Entity',
      message: "Request schema mismatch: 'user_id' is not a valid property",
      received: { user_id: 123 },
      expected: { userId: 123 },
    },
    diagnosis: "Field drift: registry expects 'user_id', live API requires 'userId'",
    patchDescription: 'get_user@3.2.0 → get_user@3.2.1',
    patch: {
      tool: 'get_user',
      version: '3.2.1',
      changes: [
        {
          op: 'rename',
          path: '/properties/user_id',
          from: 'user_id',
          to: 'userId',
        },
      ],
      confidence: 0.98,
      policy: 'auto_apply_rename',
    },
    retryRequest: { userId: 123 },
    successResponse: {
      status: 200,
      body: {
        userId: 123,
        name: 'Ava Chen',
        email: 'ava.chen@example.com',
        plan: 'enterprise',
      },
    },
    recoverable: true,
    frames: [],
  },
  {
    id: 'B',
    name: 'Required Header Added',
    shortName: 'Required Header',
    tagline: 'X-Client-Version required — filled from safe policy vault',
    tool: 'create_order',
    method: 'POST',
    endpoint: '/v3/orders',
    registryVersion: '1.8.4',
    expectedSchema: {
      type: 'object',
      required: ['sku', 'qty'],
      properties: {
        sku: { type: 'string' },
        qty: { type: 'integer' },
      },
      headers: {
        'Content-Type': 'application/json',
      },
    },
    actualSchema: {
      type: 'object',
      required: ['sku', 'qty'],
      properties: {
        sku: { type: 'string' },
        qty: { type: 'integer' },
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': { type: 'string', required: true },
      },
    },
    driftSummary: 'New mandatory header X-Client-Version added to API v3.9.0',
    initialRequest: {
      headers: { 'Content-Type': 'application/json' },
      body: { sku: 'WIDGET-42', qty: 3 },
    },
    errorResponse: {
      status: 422,
      error: 'Unprocessable Entity',
      message: 'Missing required header: X-Client-Version',
      missing: ['X-Client-Version'],
    },
    diagnosis: "Header drift: API now requires 'X-Client-Version' — value exists in policy vault",
    patchDescription: 'create_order@1.8.4 → create_order@1.8.5',
    patch: {
      tool: 'create_order',
      version: '1.8.5',
      changes: [
        {
          op: 'add_header',
          path: '/headers/X-Client-Version',
          value: '1.4.2',
          source: 'policy_vault.client_version',
        },
      ],
      confidence: 1.0,
      policy: 'auto_apply_known_header',
    },
    retryRequest: {
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': '1.4.2',
      },
      body: { sku: 'WIDGET-42', qty: 3 },
    },
    successResponse: {
      status: 200,
      body: {
        orderId: 'ord_9f2c81',
        sku: 'WIDGET-42',
        qty: 3,
        status: 'confirmed',
      },
    },
    recoverable: true,
    frames: [],
  },
  {
    id: 'C',
    name: 'Unrecoverable Change',
    shortName: 'Unrecoverable',
    tagline: 'New required field "region" with no safe value — escalate',
    tool: 'get_inventory',
    method: 'GET',
    endpoint: '/v1/inventory',
    registryVersion: '2.0.7',
    expectedSchema: {
      type: 'object',
      required: ['warehouse_id'],
      properties: {
        warehouse_id: { type: 'string' },
      },
    },
    actualSchema: {
      type: 'object',
      required: ['warehouse_id', 'region'],
      properties: {
        warehouse_id: { type: 'string' },
        region: { type: 'string', enum: ['us-east', 'eu-west', 'ap-south'] },
      },
    },
    driftSummary: 'New required field "region" — no policy-approved value available',
    initialRequest: { warehouse_id: 'wh_77' },
    errorResponse: {
      status: 422,
      error: 'Unprocessable Entity',
      message: "Request schema mismatch: missing required property 'region'",
      missing: ['region'],
    },
    diagnosis: "Structural drift: 'region' is required but no safe value exists in context",
    patchDescription: 'get_inventory@2.0.7 → get_inventory@2.0.8 (blocked)',
    patch: {
      tool: 'get_inventory',
      version: '2.0.8 (draft)',
      changes: [
        {
          op: 'add_property',
          path: '/properties/region',
          value: null,
          blocked_reason: 'required value is business-critical — auto-fill forbidden by policy',
        },
      ],
      confidence: 0.12,
      policy: 'BLOCKED_requires_human',
    },
    retryRequest: null,
    successResponse: null,
    recoverable: false,
    requiredField: 'region',
    frames: [],
  },
]

// Attach frames (needs stable timestamps per scenario)
SCENARIOS.forEach((s) => {
  clockMs = 0
  s.frames = buildFrames({
    tool: s.tool,
    method: s.method,
    endpoint: s.endpoint,
    registryVersion: s.registryVersion,
    initialRequest: s.initialRequest,
    errorResponse: s.errorResponse,
    diagnosis: s.diagnosis,
    patch: s.patch,
    retryRequest: s.retryRequest,
    successResponse: s.successResponse,
    recoverable: s.recoverable,
    renameDetail:
      s.id === 'A'
        ? 'Diff: user_id (removed) ↔ userId (added) — same type, same position'
        : s.id === 'B'
          ? 'Diff: + header X-Client-Version (required)'
          : 'Diff: + property region (required, enum)',
    requiredField: s.requiredField,
  })
})

/* ------------------------------------------------------------------ */
/* Schema registry tools                                               */
/* ------------------------------------------------------------------ */

export interface RegistryTool {
  name: string
  endpoint: string
  method: string
  version: string
  status: 'healthy' | 'drifted' | 'patched' | 'escalated'
  calls24h: number
  expectedSchema: Record<string, unknown>
  actualSchema: Record<string, unknown>
  driftNote: string
}

export const REGISTRY_TOOLS: RegistryTool[] = [
  {
    name: 'get_user',
    endpoint: '/v2/users/profile',
    method: 'POST',
    version: '3.2.1',
    status: 'patched',
    calls24h: 1284,
    expectedSchema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'integer' } },
    },
    actualSchema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'integer' } },
    },
    driftNote: 'Healed at 09:14 — user_id renamed to userId (auto-patched, v3.2.0 → v3.2.1)',
  },
  {
    name: 'create_order',
    endpoint: '/v3/orders',
    method: 'POST',
    version: '1.8.4',
    status: 'drifted',
    calls24h: 402,
    expectedSchema: {
      type: 'object',
      required: ['sku', 'qty'],
      properties: { sku: { type: 'string' }, qty: { type: 'integer' } },
      headers: { 'Content-Type': 'application/json' },
    },
    actualSchema: {
      type: 'object',
      required: ['sku', 'qty'],
      properties: { sku: { type: 'string' }, qty: { type: 'integer' } },
      headers: { 'Content-Type': 'application/json', 'X-Client-Version': { type: 'string', required: true } },
    },
    driftNote: 'Live API added mandatory header X-Client-Version (detected 11:42)',
  },
  {
    name: 'search_products',
    endpoint: '/v3/catalog/search',
    method: 'GET',
    version: '5.1.0',
    status: 'healthy',
    calls24h: 3921,
    expectedSchema: {
      type: 'object',
      required: ['q'],
      properties: { q: { type: 'string' }, limit: { type: 'integer', default: 20 } },
    },
    actualSchema: {
      type: 'object',
      required: ['q'],
      properties: { q: { type: 'string' }, limit: { type: 'integer', default: 20 } },
    },
    driftNote: 'No drift — registry matches live API contract',
  },
  {
    name: 'get_inventory',
    endpoint: '/v1/inventory',
    method: 'GET',
    version: '2.0.7',
    status: 'escalated',
    calls24h: 87,
    expectedSchema: {
      type: 'object',
      required: ['warehouse_id'],
      properties: { warehouse_id: { type: 'string' } },
    },
    actualSchema: {
      type: 'object',
      required: ['warehouse_id', 'region'],
      properties: {
        warehouse_id: { type: 'string' },
        region: { type: 'string', enum: ['us-east', 'eu-west', 'ap-south'] },
      },
    },
    driftNote: 'New required field "region" — no safe value, escalated to human (13:07)',
  },
]

/* ------------------------------------------------------------------ */
/* Dashboard mock data                                                 */
/* ------------------------------------------------------------------ */

export const METRICS = [
  {
    label: 'Zero-Touch Adaptation Rate',
    value: '92%',
    delta: '+6.4% vs baseline',
    tone: 'violet' as const,
    hint: 'Incidents resolved without human input',
  },
  {
    label: 'Mean Time to Recovery',
    value: '2.4s',
    delta: '−11.2s vs baseline',
    tone: 'cyan' as const,
    hint: 'Detect → diagnose → patch → retry',
  },
  {
    label: 'Successful Recoveries',
    value: '46/50',
    delta: '4 escalated safely',
    tone: 'green' as const,
    hint: 'Last 24 hours across all tools',
  },
  {
    label: 'Token Overhead',
    value: '320',
    delta: 'avg tokens / incident',
    tone: 'amber' as const,
    hint: 'LLM cost of the self-healing loop',
  },
]

export const RECENT_INCIDENTS = [
  {
    id: 'INC-2041',
    tool: 'get_user',
    drift: 'Field rename user_id → userId',
    status: 'Resolved',
    mttR: '2.1s',
    at: '09:14:22',
  },
  {
    id: 'INC-2040',
    tool: 'search_products',
    drift: 'Enum value added to sort_by',
    status: 'Resolved',
    mttR: '1.8s',
    at: '10:02:57',
  },
  {
    id: 'INC-2039',
    tool: 'create_order',
    drift: 'Required header X-Client-Version',
    status: 'Resolved',
    mttR: '2.9s',
    at: '11:42:10',
  },
  {
    id: 'INC-2038',
    tool: 'get_inventory',
    drift: 'New required field region',
    status: 'Escalated',
    mttR: '—',
    at: '13:07:45',
  },
  {
    id: 'INC-2037',
    tool: 'create_order',
    drift: 'Response field total → totalAmount',
    status: 'Resolved',
    mttR: '2.3s',
    at: '13:55:03',
  },
]

export const RECOVERY_ACTIVITY = [
  { time: '14:02', type: 'patch', label: 'get_user patched to v3.2.1', tone: 'success' as const },
  { time: '13:55', type: 'detect', label: 'Drift detected in create_order response', tone: 'warn' as const },
  { time: '13:07', type: 'escalate', label: 'get_inventory escalated — region unknown', tone: 'error' as const },
  { time: '11:42', type: 'retry', label: 'Retry #1 succeeded after header patch', tone: 'success' as const },
  { time: '10:02', type: 'detect', label: 'Enum drift detected in search_products', tone: 'warn' as const },
]

export const SYSTEM_STATUS = [
  { label: 'Registry Sync', status: 'Operational', tone: 'green' as const },
  { label: 'Schema Analyzer', status: 'Operational', tone: 'green' as const },
  { label: 'Patch Engine', status: 'Operational', tone: 'green' as const },
  { label: 'Mock API', status: 'Simulation', tone: 'cyan' as const },
]

export const MOCK_EVENT_LOG: LogEntry[] = [
  { t: '09:14:20.114', event: 'HTTP_422', status: 'error', details: 'get_user — Unprocessable Entity, field user_id unknown' },
  { t: '09:14:20.203', event: 'DRIFT_DETECTED', status: 'warn', details: 'Schema analyzer diffed registry v3.2.0 against live OpenAPI v2.4.1' },
  { t: '09:14:21.010', event: 'PATCH_AUTHORIZED', status: 'info', details: 'Rename policy matched (confidence 0.98) — auto-apply permitted' },
  { t: '09:14:21.442', event: 'REGISTRY_PATCHED', status: 'success', details: 'get_user bumped v3.2.0 → v3.2.1, mapping user_id → userId' },
  { t: '09:14:22.301', event: 'RETRY_SEND', status: 'info', details: 'Attempt 2/2 with patched payload { userId: 123 }' },
  { t: '09:14:22.512', event: 'HTTP_200', status: 'success', details: 'Mock API accepted payload in 211ms' },
  { t: '11:42:08.771', event: 'HTTP_422', status: 'error', details: 'create_order — missing required header X-Client-Version' },
  { t: '11:42:08.902', event: 'DRIFT_DETECTED', status: 'warn', details: 'New mandatory header discovered in live contract' },
  { t: '11:42:09.640', event: 'REGISTRY_PATCHED', status: 'success', details: 'create_order bumped v1.8.4 → v1.8.5 with X-Client-Version: 1.4.2' },
  { t: '11:42:10.214', event: 'HTTP_200', status: 'success', details: 'Order created: ord_8a11bc' },
  { t: '13:07:44.510', event: 'HTTP_422', status: 'error', details: 'get_inventory — missing required property region' },
  { t: '13:07:45.118', event: 'NO_SAFE_VALUE', status: 'error', details: 'Policy vault has no approved value for region — guessing forbidden' },
  { t: '13:07:45.400', event: 'HUMAN_INTERVENTION_REQUIRED', status: 'warn', details: 'Incident INC-2038 escalated to on-call, agent paused tool' },
]

export const COMPARISON_DATA = [
  { metric: 'Recovery rate %', baseline: 12, selfHealing: 92 },
  { metric: 'MTTR (s)', baseline: 48, selfHealing: 2.4 },
  { metric: 'Human tickets / 100 calls', baseline: 31, selfHealing: 3 },
  { metric: 'Task success %', baseline: 64, selfHealing: 97 },
]

export const NODE_CARDS = [
  { id: 'agent', title: 'AI Agent', desc: 'Executes tool calls to complete user goals', icon: 'bot' },
  { id: 'registry', title: 'Tool Registry', desc: 'Versioned tool definitions the agent trusts', icon: 'database' },
  { id: 'api', title: 'Mock API', desc: 'Simulated live service with drifting schema', icon: 'server' },
  { id: 'detector', title: 'Error Detector', desc: 'Intercepts non-2xx and validation failures', icon: 'alert' },
  { id: 'analyzer', title: 'Schema Analyzer', desc: 'Diffs registry schema vs live API contract', icon: 'scan' },
  { id: 'patcher', title: 'Patch Engine', desc: 'Applies policy-safe patches to tool defs', icon: 'wrench' },
  { id: 'retry', title: 'Retry Controller', desc: 'Replays the call with the healed schema', icon: 'refresh' },
]
