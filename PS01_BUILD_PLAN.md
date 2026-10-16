# PS 01: Self-Healing Tool Registry. Build Plan (24 hr, team of 4)

Stack: Node.js (plain JS, ESM) backends, Next.js (JS) frontends, Gemini for LLM work.
Status of external facts: model names, SDK method names and Gemini schema limits change often. Every place marked **(verify)** must be checked against current docs before you rely on it.

---

## 0. How to use this document

1. Read sections 1 to 4 once as a team (architecture, contracts, repo layout, decisions). Freeze them in Phase 0.
2. Each person then lives in section 6 (phases), under their track letter.
3. Section 7 onward are deep dives that phases reference (safety, silent drift, cache, audit, LLM, mutations, metrics, demo).
4. Never merge anything that breaks the Phase 1 demo path. It is your insurance policy.

Tracks (reassign freely, all four are full-stack capable):

| Track | Owns |
|---|---|
| A | Core engine: executor, classifier, diagnoser tiers, patch engine, drift detector |
| B | Core services: registry, safety, audit, cache, events, orchestrator, LLM providers |
| C | demo-server: mock API, mutation engine, baseline agent, benchmark runner |
| D | Both Next.js apps: demo-client (stage UI) and api-client (core dashboard) |

---

## 1. Problem, success definition, rubric mapping

What the PS really asks: a middleware between an agent and any HTTP API that, when the API contract drifts, (1) notices, (2) works out the diff from evidence, (3) patches only what the diff requires, (4) verifies by replay, (5) logs every patch, (6) never invents values, (7) stops instead of looping when it cannot prove a fix.

Your rubric (from you) and how this plan answers it:

| Rubric item | Our answer |
|---|---|
| Problem addressed properly | Covers 4xx drift AND silent 200 drift, with a hard no-invented-values rule |
| Reliable solution | Verify by replay, atomic commit, auto-rollback, loop breaker, single-flight healing, tested rules |
| Wow factor | Split-screen live demo, silent corruption reveal, tamper demo, cache hit on a second endpoint, "any API" registration on stage |
| Extras others will not have | Provenance (taint) guard, patch cache of conventions, hash-chained audit with verifier, OpenAPI importer, Tier 2 that can only choose typed ops (cannot supply literal values) |

Hard success criteria for the final demo:

- Healing a combo mutation completes in under 3 s end to end (PS target 2 to 3 s, MTTR under 4 s).
- Zero corrupted writes across the benchmark.
- Baseline fails visibly using the same model and a sensible iteration limit.
- Unrecoverable mutation ends in a structured safe halt, not a guess.

---

## 2. Architecture and principles

```
demo-server-and-client                         api-server (:8000)                           api-client (:3000)
+------------------------------+  register   +-------------------------------------+  SSE  +------------------+
| server (:5001)               |<----------->| Healing Gateway                     |------>| Core dashboard   |
|  mock API + mutation engine  |  HTTP calls |  registry | executor | classifier   |       | live feed, diffs |
|  baseline agent (LangGraph)  |             |  diagnoser (T0,T1,T2) | patch engine|       | audit, metrics   |
|  benchmark runner            |             |  safety | drift | cache | audit     |       +------------------+
| client (:3001) Drift Control |             | Task orchestrator (Gemini loop)     |
+------------------------------+             +-------------------------------------+
```

Principles (these decide every tradeoff below):

1. **Logical vs wire contract.** The agent sees a stable logical tool schema. Healing patches a wire adapter (request ops, headers, response map). The agent never sees the failure, so it cannot hallucinate a fix and burns no tokens on it.
2. **Evidence or halt.** Every patch op cites evidence (spec pointer, error field, response path). No evidence, no patch.
3. **Provenance.** Every leaf value in a patched request must trace to: the original args, a documented spec default, or a credential provider. Anything else halts.
4. **Verify before commit.** A patch lives in a draft version until a replay succeeds. Failure discards the draft. Registry history is append-only.
5. **Independence.** `api-server` imports nothing from `demo-server-and-client`. It learns about an API only through a registration payload. The mock can be swapped for any URL.
6. **Deterministic first.** Tier 0 and Tier 1 are code. Tier 2 (LLM) is a fallback that can only pick from typed ops over observed names and values.

---

## 3. Repo layout, ports, tooling

```
root/
├── package.json                  # npm workspaces: api-server, api-client, demo-server-and-client/*
├── .env.example
├── api-server/                   # CORE, port 8000
│   ├── package.json              # "type": "module"
│   ├── data/                     # audit.jsonl, registry.json (gitignored)
│   └── src/
│       ├── server.js             # express app, routes wiring only
│       ├── config.js             # env parsing, defaults
│       ├── llm/
│       │   ├── provider.js       # getProvider(role)
│       │   └── gemini.js         # adapter: schema conversion, usage counting
│       ├── lib/                  # paths.js (get/set/delete/leaves), hash.js, ids.js, time.js
│       └── features/
│           ├── apis/             # register/list/reset routes, OpenAPI importer
│           ├── registry/         # versioned tools, compile, rollback, snapshot
│           ├── executor/         # invoke(), single-flight, healing loop
│           ├── classifier/       # parseErrors(), classify()
│           ├── diagnoser/
│           │   ├── index.js      # runs tiers in order
│           │   ├── tier0-spec/   # openapi discovery + diff
│           │   ├── tier1-rules/  # rename.js wrap.js type.js header.js enum.js default.js
│           │   └── tier2-llm/    # prompt.js, validate.js
│           ├── patch-engine/     # ops.js, apply.js, inverse not needed
│           ├── safety/           # provenance.js, gate.js, loop-breaker.js
│           ├── drift-detector/   # silent 200 detection and remap proposals
│           ├── patch-cache/      # conventions + exact-op reuse
│           ├── audit/            # chain.js, routes.js
│           ├── orchestrator/     # task loop (Gemini function calling)
│           ├── metrics/          # counters, histograms, /metrics
│           └── events/           # bus.js (ring buffer), sse route
├── api-client/                   # CORE DASHBOARD, Next.js (JS), port 3000
│   └── src/features/{live-feed,registry,audit,metrics,tasks,register-api}/
└── demo-server-and-client/
    ├── server/                   # port 5001
    │   └── src/features/{mock-api,mutations,baseline-agent,benchmark,demo-control}/
    └── client/                   # Drift Control stage UI, Next.js (JS), port 3001
        └── src/features/{stage,controls,timeline,truth-check,preflight}/
```

Ports and env (fixed now, never discuss again): core 8000, mock 5001, dashboards 3000 and 3001.

Env vars: `GEMINI_API_KEY`, `AGENT_LLM=gemini:<model>`, `DIAGNOSER_LLM=gemini:<model>`, `CORE_URL`, `MOCK_URL`, `TENANT_ID` (demo credential), `ENABLE_DEV_ROUTES=1`.

### Library and approach decisions (tradeoffs)

| Concern | Choice | Why / tradeoff |
|---|---|---|
| HTTP framework | Express | Team knows it, SSE is 10 lines. Fastify is faster but speed is not your bottleneck (the upstream call and LLM are). |
| Validation of logical args | ajv (JSON Schema) **(verify current import syntax)** | Tool schemas are JSON Schema already, one source of truth. zod would need conversion. |
| HTTP client | Node built-in `fetch` + `AbortController` | No dependency, keep-alive by default in current Node. Verify `node -v` is a current LTS. |
| Name similarity | Own 40-line token + Levenshtein scorer | Less dependency risk, fully explainable in the write-up. |
| Patch format | Custom typed ops (not RFC 6902) | JSON Patch cannot express type coercion, headers or enum maps. Typed ops are self-describing and explainable to judges. |
| Persistence | In-memory + JSON snapshot on commit | A DB is over-engineering for 24 hr. Hide behind `registry/store.js` so a swap is one file. |
| Events | SSE, not WebSocket | One-directional, works with `EventSource`, supports `Last-Event-ID` replay. |
| Baseline agent | LangGraph JS (time-boxed 45 min) **(verify API)**, fallback hand-rolled loop | PS asks for a "standard framework". Isolated in demo-server so risk is contained. |
| Tests | `node:test` (built in) | Zero setup. Golden fixtures per mutation, run on every commit. |
| Frontend styling | Tailwind + a handful of components | Fast. Add framer-motion only for the diff animation **(verify)**. |
| Dashboard state | `useReducer` + context fed by one `EventSource` hook | No extra state library needed. |
| CORS | `cors` middleware on core and demo-server | Simpler than proxying SSE through Next. No auth in scope, say so in the write-up. |

---

## 4. Contracts (freeze in Phase 0 as JSON fixtures in `/contracts`)

### 4.1 Registration payload

```json
POST /apis
{
  "apiId": "demo-users",
  "baseUrl": "http://localhost:5001",
  "specUrl": "http://localhost:5001/openapi.json",
  "credentials": { "X-Tenant": { "env": "TENANT_ID" } },
  "healing": { "enabled": true, "confidenceThreshold": 0.85, "maxRounds": 5, "tier2": true },
  "tools": [
    {
      "name": "get_user",
      "description": "Fetch a user by id",
      "method": "POST",
      "path": "/api/users/get",
      "risk": "low",
      "parameters": {
        "type": "object",
        "properties": { "user_id": { "type": "string" } },
        "required": ["user_id"],
        "additionalProperties": false
      },
      "response": {
        "fields": {
          "id":    { "path": "result.id",    "type": "string", "required": true },
          "name":  { "path": "result.name",  "type": "string", "required": true },
          "email": { "path": "result.email", "type": "string", "format": "email", "required": true }
        }
      }
    }
  ]
}
```

`specUrl` and `credentials` are optional. Tools can alternatively come from `openapiUrl` (importer, Phase 4).

### 4.2 Tool version object (stored in registry, immutable)

```json
{
  "version": 3,
  "parent": 2,
  "rollbackOf": null,
  "tool": "get_user",
  "createdAt": "2026-10-16T09:41:12.412Z",
  "adapter": {
    "request": [
      { "op": "move_field",  "from": "user_id", "to": "target.user_id", "evidence": {"kind":"error","ref":"body.target missing"} },
      { "op": "rename_field","path": "target", "from": "user_id", "to": "id", "evidence": {"kind":"error","ref":"body.target.id missing"} },
      { "op": "coerce_type", "path": "target.id", "from": "string", "to": "integer", "evidence": {"kind":"error","ref":"not a valid integer"} },
      { "op": "add_header",  "name": "X-Tenant", "source": { "type": "credential", "ref": "X-Tenant" }, "evidence": {"kind":"error","ref":"header X-Tenant required"} }
    ],
    "response": { "map": { "id": "result.id", "name": "result.name", "email": "result.email" } }
  }
}
```

### 4.3 Typed patch ops (complete set)

| Op | Fields | Provenance rule |
|---|---|---|
| `rename_field` | `path` (parent, "" for root), `from`, `to` | value moves with the key, origin preserved |
| `move_field` | `from`, `to` (dotted paths) | origin preserved for every leaf under `from` |
| `coerce_type` | `path`, `from`, `to` | allowed only if lossless (round trip), origin `arg:coerced` |
| `add_header` | `name`, `source` | `source.type` in `credential`, `spec_default`, `error_enum` |
| `add_field` | `path`, `source` | `source.type` in `spec_default`, `credential`; never `llm` |
| `set_enum_map` | `path`, `map` | every key is a logical enum value, every value appears in an observed allowed list |
| `remap_response_path` | `logical`, `to` | read side only, no provenance needed, must pass type check |

### 4.4 Core invoke API

```
POST /apis/:apiId/tools/:tool/invoke     body: { "args": { "user_id": "123" } }

200 { "ok": true,
      "data": { "id": "123", "name": "Asha Rao", "email": "asha@example.com" },
      "meta": { "version": 3, "healed": true, "rounds": 3, "tier": 1, "cacheHit": false,
                "latencyMs": 412, "healMs": 388, "tokens": { "input": 0, "output": 0 } } }

200 { "ok": false,
      "error": { "code": "tool_unavailable", "message": "Contract changed and no safe fix found",
                 "retryable": false, "details": { "reason": "provenance_violation", "field": "approval_code" } } }
```

Error codes returned to the agent: `invalid_arguments` (logical schema violation, never healed), `upstream_rejected` (a real validation error, passed through), `tool_unavailable` (halted, not retryable), `drift_unresolved`, `upstream_error` (5xx/timeouts, one backoff retry for reads only).

Rule: `retryable: false` plus a plain-language message is what stops the Gemini agent from looping. It is the single most important line in the error contract.

### 4.5 Other core endpoints

```
GET    /apis                          list registered APIs and current versions
DELETE /apis/:apiId                   remove (used by demo reset)
GET    /apis/:apiId/tools/:tool/versions
POST   /apis/:apiId/tools/:tool/rollback   { "toVersion": 2 }
POST   /tasks                         { "apiId", "prompt", "runId?" } -> { runId }, progress over SSE
GET    /events?since=<id>             SSE (ring buffer replay)
GET    /audit?limit=50                records
GET    /audit/verify                  { ok, headHash, brokenAt?, reason? }
GET    /metrics                       counters and latency histograms
POST   /dev/tamper {index}            only if ENABLE_DEV_ROUTES=1
```

### 4.6 SSE event envelope (single `message` stream, type inside data)

```json
{ "id": 1042, "ts": 1760607672412, "runId": "r_8f2", "callId": "c_19", "apiId": "demo-users",
  "tool": "get_user", "type": "patch.proposed",
  "payload": { "round": 2, "tier": 1, "ops": [ { "op": "coerce_type", "path": "target.id", "from": "string", "to": "integer" } ],
               "confidence": 0.95, "evidence": ["value is not a valid integer"] } }
```

Event types: `call.started`, `call.failed`, `call.succeeded`, `diagnosis.started`, `patch.proposed`, `patch.verified`, `patch.committed`, `patch.rolledback`, `cache.hit`, `drift.silent`, `halt`, `agent.step`, `agent.final`, `metrics`.

### 4.7 Audit record

```json
{ "index": 7, "ts": "2026-10-16T09:41:12.801Z", "prevHash": "…", "decision": "commit",
  "apiId": "demo-users", "tool": "get_user", "versionBefore": 2, "versionAfter": 3,
  "tier": 1, "ops": [ "…typed ops, secret values redacted, only source refs…" ],
  "confidence": 0.95, "evidence": ["…"], "verification": { "status": 200, "ok": true },
  "latencyMs": 388, "tokens": { "input": 0, "output": 0 }, "hash": "…" }
```

### 4.8 Mock admin API (demo-server, port 5001)

```
POST /admin/mutate   { "id": "M5" }        activate a mutation
POST /admin/reset                          clean contract + reset DB
GET  /admin/state                          { mutation, errorStyle, specAvailable, writes[] }
POST /admin/config   { "errorStyle": "pydantic-v1|pydantic-v2|problem-json", "specAvailable": true }
GET  /openapi.json                         reflects the CURRENT mutation (when specAvailable)
```

Mock domain: users and orders.

```
POST /api/users/get              { "user_id": "123" }             -> { "result": { "id","name","email" } }
POST /api/users/update-email     { "user_id": "123", "email": "…" } -> { "result": { "id","email","updated_at" } }
POST /api/users/set-status       { "user_id": "123", "status": "active|inactive" }
POST /api/orders/get             { "order_id": "o-9" }
```

Why RPC-style POST bodies: body-shaped mutations (nesting, renames, types) are the whole demo, and query/path drift adds complexity that is out of scope for 24 hr.

---

## 5. Core algorithm (read before Phase 1)

### 5.1 Invoke path

```js
// api-server/src/features/executor/invoke.js
export async function invoke({ apiId, toolName, args, runId }) {
  const callId = newId('c');
  const t0 = performance.now();
  const tool = registry.current(apiId, toolName);                 // compiled, immutable version
  const check = validateArgs(tool, args);                         // ajv on LOGICAL schema
  if (!check.ok) return failure('invalid_arguments', check.errors, false);   // never heal bad input

  const first = await send(tool, args);                           // adapter -> HTTP
  if (first.ok && matchesLogicalResponse(tool, first)) return success(tool, first, { t0 });

  const kind = classify(first, tool);                             // validation4xx | auth4xx | silent200 | transient | ok
  if (kind === 'transient') return handleTransient(tool, args, first);
  if (kind === 'other4xx') return failure('upstream_rejected', first.json ?? first.text, false);

  return healSingleFlight(apiId, toolName, () => healAndRetry({ tool, args, first, kind, callId, t0 }));
}
```

### 5.2 Single-flight healing (concurrency correctness)

If three parallel agent calls hit the same drift, run one heal and let the others await it, then retry once with the new version.

```js
const inflight = new Map();   // key: apiId:tool -> Promise<HealResult>
export function healSingleFlight(apiId, tool, fn) {
  const key = `${apiId}:${tool}`;
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}
```

### 5.3 Heal loop (iterative convergence)

Strict validators (pydantic style) report one layer of problems at a time: after wrapping into `target`, the next error is about `target.id`. So healing is a loop of rounds, each round consuming new evidence, bounded by a round budget and a time budget. Rounds against a validating API are cheap and, crucially, safe: a rejected request wrote nothing.

```js
async function healAndRetry({ tool, args, first, kind, callId, t0 }) {
  const budget = { rounds: cfg.maxRounds, deadline: now() + cfg.healTimeoutMs };
  const seen = new Set();
  let draft = tool;                     // working copy, NOT committed
  let failure = first;
  const applied = [];

  const cached = cache.candidates(tool, failure);               // 0 tokens, replay verified
  for (const c of cached) {
    const trial = patchEngine.apply(draft, c.ops);
    const r = await send(trial, args);
    if (r.ok && matchesLogicalResponse(trial, r)) return commitAndReturn(trial, c.ops, { tier: 'cache', ...});
  }

  while (budget.rounds-- > 0 && now() < budget.deadline) {
    const sig = errorSignature(tool.name, failure);             // tool|status|hash(normalized body)
    if (seen.has(sig)) return halt('loop_detected', { sig });
    seen.add(sig);

    const proposal = await diagnoser.run({ tool: draft, args, failure, kind });   // T0 -> T1 -> T2
    if (!proposal) return halt('no_diagnosis');
    const verdict = guard.check({ proposal, args, tool: draft, risk: tool.risk });
    if (!verdict.ok) return halt(verdict.reason, verdict.details);

    draft = patchEngine.apply(draft, proposal.ops);              // throws NotLossless etc -> halt
    applied.push(...proposal.ops);
    emit('patch.proposed', { ...proposal });

    const r = await send(draft, args);                           // replay = verification
    if (r.ok && matchesLogicalResponse(draft, r)) {
      registry.commit(draft, applied);                           // atomic, new immutable version
      audit.append({ decision: 'commit', ... });
      cache.learn(tool, applied);
      return success(draft, r, { healed: true, t0 });
    }
    failure = r;                                                 // new evidence, next round
  }
  return halt('budget_exhausted');
}
```

Key properties: failure never mutates the registry (draft is discarded); the loop breaker is the `seen` set plus round and time budgets; `halt()` returns the structured `tool_unavailable` error and writes an audit record (`decision: "halt"`).

### 5.4 Compiled adapter with provenance tracking

```js
// registry/compile.js
import { getPath, setPath, deletePath, leafPaths } from '../../lib/paths.js';

export function compileAdapter(adapter, resolveCredential) {
  const reqOps = adapter.request ?? [];
  const respMap = adapter.response?.map ?? {};
  return {
    buildRequest(args) {
      const body = structuredClone(args);
      const origin = new Map(leafPaths(body).map(p => [p, 'arg']));
      const headers = {};
      for (const op of reqOps) applyOp(op, { body, headers, origin, args, resolveCredential });
      for (const p of leafPaths(body)) {
        if (!origin.has(p)) throw new ProvenanceError(p);       // every leaf must be traceable
      }
      return { body, headers };
    },
    extract(json) {
      const out = {};
      for (const [logical, path] of Object.entries(respMap)) out[logical] = getPath(json, path);
      return out;
    },
  };
}

function moveOrigins(origin, from, to) {
  for (const [p, o] of [...origin]) {
    if (p === from || p.startsWith(from + '.')) { origin.delete(p); origin.set(to + p.slice(from.length), o); }
  }
}

function applyOp(op, c) {
  switch (op.op) {
    case 'rename_field': {
      const from = op.path ? `${op.path}.${op.from}` : op.from;
      const to = op.path ? `${op.path}.${op.to}` : op.to;
      setPath(c.body, to, getPath(c.body, from)); deletePath(c.body, from); moveOrigins(c.origin, from, to); break;
    }
    case 'move_field': {
      setPath(c.body, op.to, getPath(c.body, op.from)); deletePath(c.body, op.from); moveOrigins(c.origin, op.from, op.to); break;
    }
    case 'coerce_type': {
      setPath(c.body, op.path, coerceLossless(getPath(c.body, op.path), op.from, op.to));
      c.origin.set(op.path, 'arg:coerced'); break;
    }
    case 'add_header': {
      c.headers[op.name] = resolveSource(op.source, c);       // credential/spec_default only
      break;
    }
    case 'add_field': {
      setPath(c.body, op.path, resolveSource(op.source, c)); c.origin.set(op.path, op.source.type); break;
    }
    case 'set_enum_map': {
      const v = getPath(c.body, op.path);
      if (!(v in op.map)) throw new ProvenanceError(op.path);
      setPath(c.body, op.path, op.map[v]); c.origin.set(op.path, 'arg:enum_mapped'); break;
    }
    default: throw new Error(`unknown op ${op.op}`);
  }
}

export function coerceLossless(v, from, to) {
  if (from === 'string' && to === 'integer') {
    if (typeof v === 'string' && /^-?\d+$/.test(v) && String(Number(v)) === v && Number.isSafeInteger(Number(v))) return Number(v);
  } else if (from === 'integer' && to === 'string') {
    if (Number.isInteger(v)) return String(v);
  }
  throw new NotLossless(v, from, to);       // "007" -> 7 is NOT lossless, so it halts
}
```

Tradeoff: ops are data, applied at compile time into a function. Healthy-path cost is one clone plus a few path ops, microseconds. Compile once per version and cache on the version object.

### 5.5 Error signature (loop prevention)

```js
export function errorSignature(tool, res) {
  const normalized = JSON.stringify(res.json ?? res.text)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '<uuid>')
    .replace(/\d+/g, '<n>');
  return `${tool}|${res.status}|${sha256(normalized).slice(0, 12)}`;
}
```

---

## 6. Phases

Timeline (cumulative hours): P0 0 to 1, P1 1 to 5, P2 5 to 9, P3 9 to 13, P4 13 to 17, P5 17 to 20 (FEATURE FREEZE at 20), P6 20 to 22, P7 22 to 24.
Sleep: tracks A and C rest hours 12 to 16, tracks B and D rest hours 16 to 20, so a working owner is always awake.
Rule for every phase: it is complete only when its **Exit gate** passes AND the demo script for that phase runs from a clean start.

---

### Phase 0: Contracts and scaffolding (hours 0 to 1)

**Goal:** four people can code in parallel without waiting on each other.

**Deliverables**
- Monorepo with npm workspaces, `.env.example`, `npm run dev` that boots all four apps.
- `/contracts` folder holding the JSON fixtures from section 4 (registration payload, tool version, ops, events, audit record, error bodies per mutation).
- `/contracts/errors/` golden error bodies for each mutation in each error style (this lets Track A start Tier 1 before the mock exists).
- Health endpoints: `GET /health` on core and mock.

**Implementation notes**
- Use ESM everywhere (`"type": "module"`). Use `node --watch` for dev, no nodemon.
- Write `lib/paths.js` now (`getPath`, `setPath`, `deletePath`, `leafPaths`, dotted path with array support not needed). Everyone depends on it, and it is 40 lines. Unit test it.
- Agree logging: one `log()` helper printing JSON lines, no `console.log` scattered.

**Exit gate (compulsory)**
- [x] `npm run dev` starts 4 processes, 4 health checks green.
- [x] `/contracts` committed, reviewed by all four.
- [x] `npm test` runs (even with 1 trivial test) in CI-like fashion locally.

---

### Phase 1: The demoable vertical slice (hours 1 to 5)

**Goal:** the full story on ONE mutation (M5, the PS's own example), with a real UI. If everything after this fails, this is your demo.

**Why this order (first principles):** the demo is the product. The thinnest path that shows break, baseline failure and automatic recovery proves the thesis and exposes integration problems early.

**Track A (executor and Tier 1 core)**
- `executor/invoke.js` per 5.1, simple heal loop per 5.3 (no cache, no safety gate yet beyond provenance via compile).
- `classifier/parseErrors.js`: normalize pydantic-v1 style `{detail:[{loc,msg,type}]}` and the header error body into `{kind, path, expected, received, allowed, header}` records.
- Tier 1 rules for M5 only: `wrap.js` (missing object + extra leaf), `rename.js` (singleton pairing), `type.js` (lossless coerce), `header.js`.
- `patch-engine/apply.js` and `registry/compile.js` per 5.4.

Rule sketches (real code, Track A can start here):

```js
// diagnoser/tier1-rules/rename.js
const tokens = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function nameScore(a, b) {
  const ta = tokens(a), tb = tokens(b);
  const shared = ta.filter(t => tb.includes(t)).length;
  const jac = shared / new Set([...ta, ...tb]).size;
  const sim = 1 - lev(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length);
  return Math.max(jac, sim);
}

export function renameRule({ errors, request }) {
  const missing = errors.filter(e => e.kind === 'missing');
  const extra = errors.filter(e => e.kind === 'extra');
  if (!missing.length || !extra.length) return null;
  const pairs = [];
  for (const m of missing) for (const x of extra) {
    pairs.push({ m, x, score: nameScore(m.path.at(-1), x.path.at(-1)) });
  }
  pairs.sort((p, q) => q.score - p.score);
  const best = pairs[0], second = pairs[1];
  const singleton = missing.length === 1 && extra.length === 1;       // forced pairing by elimination
  const margin = second ? best.score - second.score : 1;
  const confident = singleton ? 0.86 : (best.score >= 0.6 && margin >= 0.15 ? 0.7 + Math.min(best.score, 1) * 0.25 : 0);
  if (!confident) return null;                                         // ambiguous -> Tier 2
  return {
    tier: 1, confidence: Math.min(confident, 0.95),
    ops: [{ op: 'rename_field', path: best.m.path.slice(0, -1).join('.'), from: best.x.path.at(-1), to: best.m.path.at(-1) }],
    evidence: [best.m.raw, best.x.raw],
  };
}
```

Wrap rule idea: error `missing` at a path P whose expected type is object, plus an `extra` leaf L at root: propose `move_field L -> P.L`. The next round's error (`P.id missing`, `P.L extra`) triggers the rename rule inside the wrapper. Convergence in 3 to 4 rounds, each tens of ms against a local API.

**Track B (services)**
- `events/bus.js` ring buffer (last 500 events, monotonically increasing `id`) and `GET /events` per below.
- `apis/routes.js`: `POST /apis`, `DELETE /apis/:id`. Registry in memory.
- Credential provider: `resolveCredential(name)` reads env at call time (never cached into versions or logs).
- A scripted task runner (no LLM yet): `POST /tasks` runs "get_user then update_user_email then get_user" directly via `invoke`. Replace with Gemini in Phase 4.

```js
// events/routes.js
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const since = Number(req.get('Last-Event-ID') ?? req.query.since ?? 0);
  const send = e => res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
  bus.since(since).forEach(send);
  const off = bus.on(send);
  const ka = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { off(); clearInterval(ka); });
});
```

**Track C (demo-server)**
- Mock API with data-driven mutation engine (`mutations/catalogue.js`): each mutation is data `{ id, label, requestSchema(route), headers, transformResponse }`, plus one generic validator that produces pydantic-style errors. Do NOT hand-code if/else per mutation; the same data drives `/openapi.json` later.
- M5 = nesting (`target`), rename inside (`user_id` to `id`), type change (string to integer), mandatory `X-Tenant` header. Realistic error order: header check first (400 with `{"error":"missing_header","header":"X-Tenant"}`), then body validation layers.
- `/admin/mutate`, `/admin/reset`, `/admin/state`.
- Baseline agent: Gemini with the same logical tools, raw HTTP executor, raw status+body returned to the LLM as the tool result, `max_iterations=10`, counters for iterations and tokens. Time-box LangGraph JS to 45 min, else hand-rolled loop.
- Ground truth: mock DB is authoritative; mock records every write with provenance flag (was every field value present in the caller's original task?). This powers the corrupted-write count later.

**Track D (frontends, minimal but real)**
- demo-client single page: two panes (Baseline | Healed), a big "Mutate API" button, a "Run both" button, live event feed per pane, counters (iterations, tokens, elapsed ms), patch chips.
- It talks to core `/events` and demo-server `/demo/events` (SSE) and calls `POST /tasks` (core) and `POST /demo/run` (baseline).
- Skip the core dashboard until Phase 2.

**Demo at end of phase:** press Run both (clean API): both succeed. Press Mutate: baseline loops and fails, healed side finishes with patch chips visible.

**Exit gate (compulsory)**
- [ ] Healed task finishes in under 3 s after the mutation, on the demo laptop.
- [ ] Baseline visibly fails (iteration counter hits the cap, final status red).
- [ ] The patch ops list is shown and matches the true diff exactly (4 ops, none extra).
- [ ] Core was registered via `POST /apis` with only a URL and tool JSON; deleting and restarting the mock on another port and re-registering works.
- [ ] `node --test` has golden tests for the M5 error bodies feeding Tier 1 and producing the expected ops.

**Main risks:** multi-round convergence stalling on one rule (keep a trace per round in events), SSE CORS issues (test cross-origin on hour 2).

---

### Phase 2: Trust layer (hours 5 to 9)

**Goal:** make it safe and auditable. This is what separates a clever hack from a solution judges believe.

**Track A**
- `safety/gate.js`: confidence threshold (default 0.85), risk policy, op whitelist.
- Non-drift pre-check: heal only when the error is explained by a structural op (missing, extra, type with lossless coerce, header, enum with a permitted list). Value-constraint errors (pattern, length, bad email format) are passed through as `upstream_rejected`. This stops "healing" real bad input.
- Replay verification includes an identity echo check where possible (the response `id` equals the requested id).
- Single-flight (5.2) and error signature loop breaker (5.5).

**Track B**
- Versioned registry: immutable version objects, `commit(draft, ops)` appends, `rollback(toVersion)` appends a NEW version with `rollbackOf` (history is never rewritten). JSON snapshot to `data/registry.json` on commit.
- Audit chain (hash chain, appends only on patch decisions, so a synchronous append is fine and crash safe):

```js
// audit/chain.js
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export const GENESIS = '0'.repeat(64);
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export class AuditLog {
  constructor(file) { this.file = file; this.head = GENESIS; this.next = 0; this.load(); }
  load() {
    if (!existsSync(this.file)) return;
    const lines = readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    if (lines.length) { const last = JSON.parse(lines.at(-1)); this.head = last.hash; this.next = last.index + 1; }
  }
  append(record) {
    const body = { index: this.next, ts: new Date().toISOString(), prevHash: this.head, ...record };
    const hash = sha256(stableStringify(body));
    appendFileSync(this.file, JSON.stringify({ ...body, hash }) + '\n');
    this.head = hash; this.next += 1;
    return { ...body, hash };
  }
  verify() {
    if (!existsSync(this.file)) return { ok: true, headHash: GENESIS, count: 0 };
    let prev = GENESIS, i = 0;
    for (const line of readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
      const rec = JSON.parse(line); const { hash, ...body } = rec;
      if (rec.index !== i) return { ok: false, brokenAt: i, reason: 'index_gap' };
      if (rec.prevHash !== prev) return { ok: false, brokenAt: i, reason: 'prev_hash_mismatch' };
      if (sha256(stableStringify(body)) !== hash) return { ok: false, brokenAt: i, reason: 'content_tampered' };
      prev = hash; i += 1;
    }
    return { ok: true, headHash: prev, count: i };
  }
}
```

Honest nuance for the write-up: a hash chain detects edits and middle deletions. Truncating the tail is only detectable if the head hash is anchored elsewhere, so display the head hash prominently in both UIs and say so.

- Secrets: audit stores credential source refs (`{type:'credential', ref:'X-Tenant'}`), never values.

**Track C**
- Add M9 (unrecoverable): required header `Authorization: Bearer <token>` with no credential provider configured, plus variant: new required body field `approval_code` with no documented default. The mock must make clear the field cannot be derived.
- Add `errorStyle` config (`pydantic-v1`, `pydantic-v2`, `problem-json`) so the parser generalization can be shown later.

**Track D**
- api-client v1: live feed page, registry page (per tool: version list, op chips per version, rollback button), audit page (records plus a Verify button that shows green with head hash or red with broken index).
- demo-client: halt state (large STOP card with the structured reason), rollback button wired.

**Demo at end of phase:** M5 heals; M9 halts with a clear reason and zero guesses; roll back to v1 live; tamper a line in `audit.jsonl` and Verify goes red at the exact index.

**Exit gate (compulsory)**
- [ ] M9 returns `tool_unavailable` with `retryable:false`, the Gemini/scripted agent stops without looping, and the mock records no write.
- [ ] A forced failing replay leaves registry version unchanged (draft discarded) and writes a `halt` audit record.
- [ ] Rollback creates a new version, calls succeed against the old contract when the mock is reset.
- [ ] Editing any byte of `audit.jsonl` makes `/audit/verify` return the correct `brokenAt`.
- [ ] A bad-input call (e.g. malformed email value on a clean API) is NOT healed and is returned as `upstream_rejected`.
- [ ] Three parallel calls hitting M5 trigger exactly one heal (assert in a test).

---

### Phase 3: Coverage and differentiators (hours 9 to 13)

**Goal:** the complete mutation catalogue plus the two must-have differentiators: silent 200 drift detection and patch cache.

**Track A**
- Remaining Tier 1 rules: M1 rename (multi-candidate, scoring with margin), M2 type, M3 nesting alone, M4 header alone, M7 default (spec only), M8 enum normalization (lossless case/format changes only, others go to Tier 2), M6 and M10 via the drift detector below.
- Normalizer support for all three error styles (pydantic-v1, pydantic-v2 type names, RFC 9457 problem+json with `errors[]`).

Header name parsing order: structured field (`error.header`) first; then `WWW-Authenticate` scheme; then regex fallback over the message requiring a header-shaped token near the word "header":

```js
const HEADER_TOKEN = /\b[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b/;     // X-Tenant, X-API-Version
```

Header value provenance: value must come from a configured credential provider, a spec default/enum, or an enumerated allowed value in the error body. If none, halt (this is M9).

**Track B**
- `drift-detector/`: silent 200 drift (see section 8).
- `patch-cache/`: conventions and exact reuse (see section 9).
- Metrics counters per tier, per outcome.

**Track C**
- Complete the catalogue M1 to M10 per section 11 with exact before/after payloads.
- `ground-truth` verifier for the demo task: compares the final agent answer to the DB truth (name and email) and reports match/mismatch. It reports whatever happens; never rig the baseline.
- M10 variants: `result.name` moves to `result.data.profile.name` (nesting) and `name` renamed to `full_name`.

**Track D**
- Animated diff component: old payload and new payload side by side, ops appear as chips with a connecting highlight (CSS transitions are enough).
- Truth-check badge per pane (matches DB: yes/no).
- Chaos roulette button (random mutation, shown as "not scripted").
- Cache-hit chip and "tokens saved" counter.

**Demo at end of phase:** all of M1 to M10 selectable; M10 shows baseline returning confident wrong or missing data while the healed side returns correct data; after healing `get_user`, `update_user_email` heals instantly with a `cache.hit` event.

**Exit gate (compulsory)**
- [ ] Each of M1 to M8 heals via Tier 0 or Tier 1 with no LLM, asserted by golden tests.
- [ ] M10 detected on a 200 response, remapped, truth-check green, no replay of writes.
- [ ] Cache: second tool/endpoint drift heals with 0 tokens and a `cache.hit` event, and a deliberately stale cache entry falls through to normal diagnosis (test).
- [ ] Ambiguous rename (two candidates) is NOT auto-patched by Tier 1 (returns null, escalates).

---

### Phase 4: Tier 0, Tier 2, real agent, importer (hours 13 to 17)

**Goal:** the LLM-powered parts, kept subordinate to the deterministic ones.

**Track A: Tier 0 spec discovery and diff**
- Probe in parallel with Tier 1 (do not serialize): `GET {baseUrl}/openapi.json`, `/swagger.json`, any `Link: rel="describedby"` or spec URL in the error body, and the registered `specUrl`. Take the first confident result.
- Algorithm: derive the current request shape for the failing route from the spec (JSON Schema after `$ref` deref, **verify** a deref approach such as a small recursive resolver or a maintained library). For each logical argument find its location: exact name match, then token similarity with type compatibility, unique best match or fail. Required spec fields with no logical source: use spec `default` if present (provenance `spec_default`), else halt. Required header parameters: via credential provider or spec default, else halt.
- Output is a full adapter in one round: confidence 1.0, evidence is a spec JSON pointer.

**Track B: Tier 2 LLM diagnosis and provider layer**
- `llm/provider.js` with roles; `AGENT_LLM` and `DIAGNOSER_LLM` env values like `gemini:<model>` so splitting models is config only:

```js
// llm/provider.js
const factories = { gemini: (model) => import('./gemini.js').then(m => m.createGemini(model)) };
export async function getProvider(role) {
  const raw = process.env[`${role.toUpperCase()}_LLM`] ?? process.env.DEFAULT_LLM ?? 'gemini:default';
  const [name, model] = raw.split(':');
  return factories[name](model);
}
/* Provider contract
 * generate({ system, messages, tools, temperature })        -> { text, toolCalls:[{id,name,args}], usage:{inputTokens,outputTokens} }
 * generateStructured({ system, prompt, schema, timeoutMs }) -> { data, usage }
 * messages use ONE internal shape: { role:'user'|'assistant'|'tool', parts:[{text}|{toolCall}|{toolResult}] }
 */
```

- `gemini.js` converts the internal shape to the SDK shape and converts JSON Schema to the Gemini-supported subset (strip unsupported keywords such as `additionalProperties` if the API rejects them) **(verify supported schema fields and usage metadata field names in current docs)**. Core keeps full JSON Schema.
- Tier 2 input: logical tool schema, current adapter JSON, the failing request with values redacted to types, the error body (truncated), spec excerpt if any. Output schema:

```json
{ "ops": [ { "op": "rename_field | move_field | coerce_type | set_enum_map | remap_response_path", "...": "..." } ],
  "confidence": 0.0,
  "evidence": [ { "quote": "exact substring of the error body or spec" } ],
  "summary": "one sentence" }
```

- Tier 2 validation pipeline (reject on any failure): ajv-validate the output; every `evidence.quote` must be a verbatim substring of the provided error/spec text; op types limited to the list above (**no `add_field`, no `add_header` with free values**, so the LLM cannot invent a literal); every name referenced must exist in the observed request or error; passes provenance. Hard timeout about 2.5 s via `AbortController`, temperature 0.
- Self-reported LLM confidence is weakly calibrated, so treat the verifiable checks (quote is a substring, replay succeeds) as the real gate. Confidence only matters as an extra filter.

**Track B: Orchestrator (Gemini function calling)**
- Tools exposed to the model are the logical schemas from the registry. Loop: call model, execute returned tool calls through `invoke` (in parallel when several), append results, repeat until no tool calls or 8 steps.
- Tool failures go back as structured results (`ok:false`, `retryable:false`) so the agent explains rather than retries.
- Emit `agent.step` and `agent.final` events; count tokens from provider usage.

**Track C**
- Baseline uses the same model and prompt, with static v1 tool mapping and raw error passthrough.
- Mock `specAvailable` toggle so Tier 0 (exact, instant) and Tier 1 (iterative) can both be demoed. M8 enum semantic mapping case (`active` to `ENABLED`) to exercise Tier 2.
- Optional (stretch inside this phase): second mock service with a different domain on port 5002 to prove "any API".

**Track D**
- Registration form in api-client (paste tool JSON or an OpenAPI URL) and a "Register second API" quick action in demo-client.
- Timeline view showing the tier used per round (T0/T1/T2/cache chips) and token cost per tier.

**OpenAPI importer (stretch, assign to B or A, 90 minutes max):** convert operations to tools (name from `operationId`, parameters from requestBody schema, response fields from the 2xx schema or learned on the first successful call). This is the strongest "works on any API" claim, but protect the core path first.

**Exit gate (compulsory)**
- [ ] The ambiguous rename case escalates to Tier 2, returns a patch whose quote is a real substring of the error, replays successfully, or halts. Both outcomes are tested.
- [ ] Gemini agent completes "fetch user 123, update email, report name and email" through the healing layer under M5 with no human step.
- [ ] Tier 2 timeout path returns a clean halt (simulate with a 1 ms timeout in a test).
- [ ] Token counts per tier appear in `meta.tokens` and `/metrics`.
- [ ] Swapping `DIAGNOSER_LLM` to another value changes which provider factory is called (unit test with a fake provider), proving no migration is needed later.

---

### Phase 5: Benchmark and metrics (hours 17 to 20)

**Goal:** the numbers judges ask for, reproducible with one command. FEATURE FREEZE at hour 20.

**Track C (`benchmark`)**
- Seeded runner (`SEED` env): for each mutation M1..M10, R repeats (default 5): reset mock, delete and re-register the API on core (fresh registry and cache), run the task, record outcome and timings.
- Two modes:
  - `direct`: calls tools directly through core (no agent LLM). Measures the healing layer alone, fast, cheap, reliable for ZTAR and MTTR.
  - `agent`: full Gemini task for a subset (M5, M10, M9) for end-to-end and token comparison. Check your key's rate limits first **(verify quota)**.
- Output: JSON plus a printed table.

**Track B (`metrics`)**
- Core records `firstFailureAt`, `verifiedSuccessAt` with `performance.now()`; per-tier counters and latency histograms. Core exposes `/metrics`. The benchmark also measures externally (wall clock around the request) so numbers are independent of core's own instrumentation.

**Track D**
- api-client metrics page and a "Run benchmark" button in demo-client producing the results table live (use the direct mode for speed on stage).

Metric definitions (write these in the write-up verbatim):

| Metric | Definition |
|---|---|
| ZTAR | mutations fully resolved with no human input / recoverable mutations. Also report over all mutations. A correct halt on an unrecoverable mutation counts as a **safe outcome**, reported separately, never as a heal. |
| MTTR | time from first failing (or first drifted 200) response to first verified correct response. Report p50 and p95, split by tier. Target under 4 s, expect under 1 s for Tier 0/1 on localhost, 1 to 3 s with Tier 2. |
| Token overhead | tokens spent on diagnosis (Tier 2 only) vs tokens the baseline burns until it fails. Cache and Tier 0/1 count as zero. |
| Corrupted writes | writes whose field values did not originate from the task or a documented default. Must be 0. |
| Wrong-patch rate | heals that passed replay but produced a wrong result per ground truth. Target 0, report honestly. |
| Loop count | repeated identical error signatures per run. |

**Exit gate (compulsory)**
- [ ] One command prints the metrics table (per category and overall).
- [ ] Two runs with the same seed give the same ZTAR and categories (timing varies, outcomes do not).
- [ ] Corrupted writes = 0 in the table.
- [ ] Numbers are copied into the write-up draft.

---

### Phase 6: Wow polish and stretch (hours 20 to 22)

No new core features. Allowed work:

- Presentation polish: large fonts for a projector, dark theme, animated diff, smooth counters, a giant MTTR stopwatch in ms.
- **Presenter mode:** keyboard shortcuts (1 to 0 select mutation, R reset, B run both, V verify audit, space start), so nothing depends on precise mouse clicks.
- **Preflight page** in demo-client: checks core, mock, both SSE streams, Gemini ping, audit verify, then shows one big green GO. Run it before you walk on stage.
- **Safe reset (one key):** resets mock, deletes and re-registers the API, clears baseline state, keeps the audit log (so the tamper demo still has history).
- Stretch: offline fallback. Record every LLM request/response pair keyed by a hash of the request into `data/llm-cache.json`; in `OFFLINE=1` return from the cache. Deterministic seeds make the stage path replayable. Do this only if everything else is green.

**Exit gate (compulsory)**
- [ ] Preflight shows GO on the demo laptop and on the venue network.
- [ ] Full demo script runs three times in a row without touching code.
- [ ] A recorded backup video of a full run exists.

---

### Phase 7: Rehearsal and delivery (hours 22 to 24)

- Three timed rehearsals (4 minutes each) on the stage laptop and network. Assign roles: presenter, driver (keyboard), narrator for Q and A, fallback owner.
- Freeze: tag `release`, no merges after.
- Write-up (1 to 2 pages): problem, architecture diagram, diagnosis tiers, patch ops, safety rules, audit design, metrics table, limitations.
- 30-second pitch, memorized.
- Backups: video, screenshots, `OFFLINE=1` mode if built, a second laptop with the repo running.

**Exit gate:** pitch timed at or under 30 s, write-up committed as `WRITEUP.md`, backup video verified to play.

---

## 7. Safety deep dive

### 7.1 Provenance (taint) guard

Origin tags travel with values through ops (see 5.4). A final request is legal only if every leaf is tagged `arg`, `arg:coerced`, `arg:enum_mapped`, `spec_default` or `credential`. A new required field with no tag source triggers `halt('provenance_violation', { field })`. This is the mechanical answer to "no hallucinated values", and it makes the unrecoverable demo trivial to explain.

### 7.2 Confidence and risk gate

| Evidence | Base confidence | Auto-apply? |
|---|---|---|
| Tier 0 spec diff | 1.0 | yes |
| Tier 1 structured error field exact (header name, expected type) | 0.95 | yes |
| Tier 1 rename singleton pairing | 0.86 | yes (low and medium risk) |
| Tier 1 rename with scoring and margin | 0.7 to 0.95 | yes if at or above threshold |
| Tier 2 | self reported, plus verifiable quote and replay | yes for low risk only |

Risk policy: tools with `risk: "high"` (DELETE, payments) require Tier 0, or Tier 1 at 0.95 or above, else halt with `requires_approval`. A human approval UI is future scope, say so.

### 7.3 Never heal real bad input

Order of checks before any heal: logical args valid (ajv), error explained by a structural op, op passes provenance. Format and range errors (pattern, min length, invalid email) always pass through as `upstream_rejected`.

### 7.4 Write safety

- Heal only after a validation-type rejection. A rejected request wrote nothing, so replay is safe.
- Never retry 5xx on writes. Reads get one backoff retry on transient errors.
- If the API supports idempotency keys, send one on writes (optional per-tool config `idempotencyHeader`).
- Probes in the multi-round loop are validation rejections by construction, and the last successful replay is the real write, performed once.

### 7.5 What cannot be detected (state this openly)

Semantic drift with the same shape and types (for example two fields swapping meaning) cannot be caught by structure checks. Mention it as a limitation and as future scope (contract tests, value plausibility checks).

---

## 8. Silent 200 drift (must-have)

**Idea:** every tool declares (or learns on first success) its logical response fields: wire path, type, optional format. After every 200, check them. This is O(fields) and costs microseconds.

```js
export function checkResponse(tool, json) {
  const problems = [];
  for (const [logical, spec] of Object.entries(tool.response.fields)) {
    const v = getPath(json, tool.adapter.response.map[logical]);
    if (v === undefined || typeof v !== jsType(spec.type)) problems.push({ logical, spec });
    else if (spec.format === 'email' && !/^\S+@\S+\.\S+$/.test(v)) problems.push({ logical, spec });
  }
  return problems;
}
```

**Locating the new path** for a missing logical field:

1. Walk the response and collect all leaf paths with value types.
2. Candidates: leaves whose last key matches by `nameScore` (reuse from rename), AND type matches, AND format matches.
3. Value fit: if the previous successful response for the same tool and args is cached (last known good value), prefer the candidate with an equal value. This is strong evidence when it exists.
4. Choose a unique best with margin, else Tier 2 on **structure only** (keys and types, values redacted, a privacy point worth mentioning) or halt with `drift_unresolved`.

**Verification:** re-extract from the same response and recheck types. No second request. **For writes, never replay**; the write already happened, so the fix is read-side only (`remap_response_path`). Emit `drift.silent` with the old and new paths.

**Fingerprint when no response schema is declared:** on the first success, store the structural hash of the response (key paths plus types). A later 200 with a different hash raises a drift warning. Without declared fields, only warn, because the system does not know which fields the agent needs.

**Demo value:** this is where the baseline "succeeds" and quietly reports missing or wrong data. The truth-check badge makes it visible.

---

## 9. Patch cache (must-have)

Cache entries come in three kinds, all **replay verified** before use, so a stale entry cannot corrupt anything (worst case: one wasted request, then the normal path runs):

| Kind | Scope | Example |
|---|---|---|
| Exact op reuse | same field name, same API | `get_user` healed `user_id` to `target.id`, so `update_user_email` (also has `user_id`) gets the same ops |
| Convention | whole API | rename `user_id` to `userId` implies snake_case to camelCase; applying it to `order_id` gives `orderId` |
| API-wide headers | whole API | `add_header X-Tenant` applies to every tool of the API |

```js
// patch-cache/index.js
learn(tool, ops) {
  for (const op of ops) {
    if (op.op === 'add_header') this.headers.set(`${tool.apiId}`, [...(this.headers.get(tool.apiId) ?? []), op]);
    if (op.op === 'rename_field' && isSnake(op.from) && isCamel(op.to)) this.conventions.set(tool.apiId, { kind: 'snake_to_camel' });
    this.exact.set(`${tool.apiId}:${op.op}:${op.from ?? op.path}`, op);
  }
}
candidates(tool, failure) { /* build op lists from exact + convention + headers that apply to this tool's args; most specific first */ }
```

Invalidation: drop entries when a replay using them fails, on `DELETE /apis/:id`, and on demo reset. Emit `cache.hit` with tokens saved (estimated from the average Tier 2 cost or 0 if the original was Tier 1; label it clearly as "diagnosis rounds skipped").

Tradeoff: a smarter shared cache across agents is future scope ("one learns, all benefit"). Within one process this already shows the idea.

---

## 10. Gemini integration and fairness

- Same model for agent and diagnoser by default via env, separate providers possible later with zero code change.
- Agent system prompt identical in baseline and healed runs. Tools identical (logical schemas). Only the executor differs.
- Baseline config: `max_iterations=10`, temperature as healed agent, tool results are raw HTTP status plus body.
- Count tokens from provider usage metadata for both **(verify field names)**.
- Retry/backoff on Gemini 429s in the provider layer, not in business code. Keep a small concurrency limit for benchmark runs.
- Prompt for Tier 2: short, only structural data, instruct "output typed ops only, quote evidence verbatim, if uncertain return empty ops and confidence 0". An empty answer is a legitimate, safe outcome.

---

## 11. Mutation catalogue (mock spec and expected healing)

All against `POST /api/users/get` unless noted. v1 contract: request `{ "user_id": "123" }`, response `{ "result": { "id": "123", "name": "...", "email": "..." } }`.

| ID | New contract | Mock error (pydantic-v1 style) | Expected ops | Tier |
|---|---|---|---|---|
| M1 | `user_id` renamed `userId` | 422 `loc [body,userId] value_error.missing` plus `loc [body,user_id] value_error.extra` | `rename_field user_id to userId` | 1 (0 if spec) |
| M2 | `user_id` must be integer | 422 `loc [body,user_id] type_error.integer` | `coerce_type string to integer` (lossless only) | 1 |
| M3 | `{ "target": { "user_id": "123" } }` | 422 `body.target missing`, `body.user_id extra`, then `body.target.user_id` after wrap | `move_field user_id to target.user_id` | 1 (0 if spec) |
| M4 | header `X-API-Version` required | 400 `{ "error": "missing_header", "header": "X-API-Version", "allowed": ["2"] }` | `add_header X-API-Version` source `error_enum` | 1 |
| M5 | `{ "target": { "id": 123 } }` plus header `X-Tenant` | header error first, then layered 422s | move, rename, coerce, add_header | 1 (0 if spec) |
| M6 | response `result.data.profile.name` etc. | 200 | `remap_response_path` for each moved field | drift detector |
| M7 | new required `region` with spec default `"IN"` | 422 `body.region missing` | `add_field region` source `spec_default` (spec needed) | 0 only; halts without spec |
| M8 | `set-status` enum `active/inactive` becomes `ENABLED/DISABLED` | 422 enum error listing permitted values | `set_enum_map` | 1 for case changes, 2 for semantic |
| M9 | required `Authorization: Bearer` with no provider, or required `approval_code` with no source | 401 with `WWW-Authenticate` or 422 missing | none: **safe halt** | n/a |
| M10 | 200, `name` moved or renamed `full_name` | none | `remap_response_path` | drift detector |

Mock realism rules: validate strictly, report layered errors the way real validators do (outer object first), include a header check order, never reveal the full contract in the error body (so Tier 1 must infer and Tier 0 shines when the spec is on).

---

## 12. Performance engineering checklist

- Compile adapters once per version and cache the compiled functions on the version object.
- Healthy path: validate args (ajv compiled validators cached per tool), build request, one `fetch`, check response fields. Measure the added overhead with a micro benchmark and report it (do not claim a number before measuring).
- Run Tier 0 probes concurrently with Tier 1, with a short timeout (for example 400 ms) so a slow spec endpoint never delays a Tier 1 heal.
- Single-flight heals (5.2) so concurrent calls do not multiply work or LLM cost.
- Bound everything: rounds, total heal time, Tier 2 timeout, event ring buffer size, audit write only on decisions.
- Do not log full bodies at info level. Keep structured logs small.
- Seeded determinism for the demo path: fixed task, fixed seed, Tier 1 on the stage path so no LLM latency sits in the critical 3 seconds. Tier 2 is shown as a separate, clearly labeled scenario.

---

## 13. Demo design

### 13.1 Drift Control layout (demo-client)

- Top bar: preflight status, audit head hash, Verify button.
- Left rail: mutation chips M1 to M10 (plus chaos roulette, reset), error style and spec toggles.
- Center: two panes side by side. Each has a timeline (call, fail, diagnose, patch, verify), counters (iterations, tokens, elapsed), final answer with the truth-check badge.
- Bottom: animated schema diff (old payload, new payload) and the typed patch chips for the current heal.
- Giant MTTR stopwatch in ms for the healed pane.

### 13.2 Wow moments (ranked by impact)

1. **Silent corruption reveal (M10):** the baseline "succeeds" with missing or wrong data; the truth check turns red. The healed pane is green.
2. **Live loop vs heal:** token counter climbing on the baseline while the healed side finishes in seconds.
3. **Tamper demo:** edit one character in `audit.jsonl` in front of judges, press Verify, red with the exact index.
4. **Cache hit:** second tool heals instantly, 0 tokens, one chip.
5. **Any API:** register a second API (or the OpenAPI importer) live, core unchanged.
6. **Safe halt:** big STOP with a precise structured reason, no guess.
7. **Chaos roulette:** audience picks "not scripted".

### 13.3 Four minute stage script

| Time | Beat | Operator action |
|---|---|---|
| 0:00 | 30 s pitch | Preflight GO on screen |
| 0:30 | Clean run, both succeed | `B` |
| 0:50 | M5 combo: baseline loops, healed finishes, diff animates | key `5`, `B` |
| 1:40 | M10 silent drift: baseline wrong, healed right | `R`, key `0`, `B` |
| 2:25 | Cache hit on a second tool | run `update_user_email` |
| 2:50 | Tamper audit, Verify red | run `npm run demo:tamper`, `V` |
| 3:20 | M9 safe halt | key `9`, `B` |
| 3:45 | Metrics table, close with the tagline | benchmark button |

Fallback ladder: live (Tier 1 path) then offline replay mode then recorded video. Decide in advance who calls the fallback and at which signal (for example no healed result within 6 seconds).

### 13.4 Judge Q and A prep

- "Does it heal real bad input?" No: logical arg validation plus structural-error requirement, value errors pass through.
- "What if the LLM is wrong?" It cannot supply literal values, evidence quotes are substring checked, replay verifies, high-risk tools need deterministic evidence.
- "What about writes?" Only validation rejections are replayed; 5xx writes never retried.
- "What can't it catch?" Semantic drift with identical shape. Say it plainly.
- "How does this scale?" Sidecar proxy, shared patch cache, schema polling (future scope).

---

## 14. Cut order if you fall behind

Cut in this order: offline mode, chaos roulette, OpenAPI importer, Tier 0 polish, Tier 2 polish, second mock service, metrics page polish.
Never cut: Phase 1 slice, provenance guard, rollback, audit chain, silent drift, patch cache, benchmark table.

## 15. Risk register

| Risk | Mitigation |
|---|---|
| Multi-round heal stalls on an unforeseen error shape | Per-round trace events, golden tests per error style, Tier 2 as fallback, round and time budgets |
| Gemini latency or rate limits on stage | Tier 1 is the stage path, model calls only in the agent loop, offline replay stretch, recorded video |
| LangGraph JS API friction | 45 minute time box, hand-rolled baseline loop fallback (same tools, same prompt) |
| Gemini schema conversion rejects a keyword | Conversion layer in `llm/gemini.js` strips unsupported keywords, covered by a unit test |
| SSE or CORS issues late in the day | Test cross-origin on hour 2, ring buffer replay via `Last-Event-ID` |
| Merge conflicts across 4 people | Feature folders, contracts frozen, small PRs, one owner per folder |
| Demo laptop or network fails | Second laptop, local-only services, preflight page, recorded backup |
| Overbuilding | Exit gates are the definition of done, anything else waits for the next phase |

## 16. Definition of done (whole project)

- [ ] Phase exit gates 0 to 5 all green.
- [ ] Demo script runs three times in a row.
- [ ] Benchmark table committed in `WRITEUP.md` with the seed.
- [ ] `npm test` green, golden fixtures for every mutation and error style.
- [ ] Core has zero imports from `demo-server-and-client`.
- [ ] Backup video recorded.
- [ ] 30 second pitch rehearsed.

**Pitch (30 s):** "APIs drift, agents shouldn't break. Today a renamed field becomes a 422 loop, or worse, a guessed default that corrupts data, or a silent 200 that returns the wrong shape. We put a self-healing layer between the agent and its tools. It reads the evidence, applies a minimal typed patch, verifies it by replay, logs it in a tamper-evident chain, and finishes the task in seconds. If it cannot prove a fix is safe, it stops. It never invents a value."
