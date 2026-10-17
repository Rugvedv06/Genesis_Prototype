# Milestone 5: Spec Discovery, Tier 2, Orchestrator, OpenAPI Import, Honest Baseline

Place this file at `docs/MILESTONE_5_PLAN.md`. It implements Milestone 5 of `docs/NEW_PLAN.md`. Milestones 0 to 4 are complete. This document is a work order for an automated implementation loop (Codex) and is written to be executed top to bottom.

## 0. How to run this plan (Codex loop protocol)

Read in this order before touching code: `docs/NEW_PLAN.md`, `PS01_BUILD_PLAN.md` (sections 4, 5, 10, 11), `docs/HEALR_PHASE2_TO_FINAL_PLAN.md` section 6.6 (WP4.1 to WP4.6), `docs/DB.md`, then this file. Where this file and an older plan disagree, this file wins for Milestone 5. Where this file is silent, `NEW_PLAN.md` wins.

Loop, per work package (WP), in the order given in section 6:

1. Read every file named in the WP and the tests that cover it.
2. Write the failing tests first.
3. Implement the smallest change that passes them.
4. Run the WP gate commands and the regression anchor (section 0.2).
5. Update the contracts named in the WP.
6. Record the result in `docs/M5_EVIDENCE.md` (section 0.3).
7. Only then start the next WP.

Stop and report instead of guessing when: a VERIFY item (section 0.4) cannot be confirmed, a gate fails twice for the same reason, or a change would alter an existing contract in a way this plan does not list.

### 0.1 Conventions

- Backend is plain JavaScript, ESM, Node 20 or newer. Frontends are Next.js with plain JavaScript. No TypeScript.
- No new dependency unless this plan names it. `ajv` and `ajv-formats` are already present and are the only schema validators to use.
- Do not edit an applied migration (they are checksummed). New schema changes go in a new numbered migration after `0006_runtime_role.sql`.
- Complete, runnable code only. No pseudocode, no TODO placeholders, no stubs that throw. If something cannot be finished, say so in the evidence ledger.
- Feature-based folders. Keep the core independent of `demo-server-and-client` code. The demo server is an external client of the core through public HTTP.
- UI and code comments: no em dashes and no spaced hyphens used as dashes. Use a period, colon, comma or parentheses instead.
- Reuse existing UI primitives (`api-client/components/ui/*`, `Shell.jsx`, `lib/store.js`, `lib/sse.js`, `lib/hooks.js`, `lib/core.js`). Do not introduce a second state or styling approach.

### 0.2 Regression anchor

Before WP5.1 and after every WP, all of these must pass:

- `npm test`
- `npm run verify:p01`
- The M5 mutation heals with the same four op types as before when the spec is unavailable or stale (the four-round Tier 1 path).
- M9 still halts with no write and `retryable:false`.
- Audit verification passes and rollback still creates a new version.

### 0.3 Evidence ledger

Create `docs/M5_EVIDENCE.md` with one row per WP gate: `not started`, `in progress` or `verified`, the exact command, the date, and the result. A source file existing is not a completion signal. Never mark `verified` without the command output.

### 0.4 VERIFY items (read current official docs before coding, record what you found in the ledger)

Do not rely on memory for any of these. Provider APIs change often.

1. Gemini `generateContent` function calling: how tool declarations are passed, how a model function call and a function result are represented in `contents`, any tool-config mode, and where the system instruction goes.
2. Gemini supported JSON Schema subset for function declarations (which keywords are rejected).
3. Gemini `usageMetadata` field names, including whether reasoning or thinking tokens are reported separately and whether they are billed as output. The repo currently reads `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`. Confirm that is complete for the chosen model.
4. Whether the chosen Gemini model allows capping or disabling thinking, and the exact parameter name. Use it for Tier 2 if it exists, to meet the latency target.
5. Gemini structured output (JSON response mode or response schema): exact config names. Always validate with ajv regardless.
6. Gemini API key pools: confirm current project-level quota scope and official retry guidance. Four Gemini keys are rotated round robin by user decision; rotation must not be described as multiplying same-project quota.
7. Function name constraints for both providers (length, allowed characters). Until confirmed, assume `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`.
8. Whether each provider accepts the API key in a header. Prefer a header over a query-string key so keys never appear in URLs or logs. The current repo puts the Gemini key in the URL.
9. Gemini rate-limit scope and 429 retry guidance. Use bounded exponential backoff with jitter and only honor `Retry-After` when the server actually provides a valid value.

## 1. Locked decisions

| ID | Decision | Source |
|---|---|---|
| D1 | Gemini is the only provider for both roles (`agent` and `diagnoser`), using a four-key round-robin pool. There is no alternate provider. | Product owner |
| D2 | Tier 2 may patch tools with risk `low` and `medium`. `high` risk is never auto-patched by Tier 2. | Product owner |
| D3 | Harder cases are flagged to the operator, not silently dropped (section 5.3). Approving and committing a flagged proposal from the UI is out of scope for M5. | Product owner, scoped by this plan |
| D4 | The LLM can only choose typed ops over observed names. It never supplies literals or credentials. `add_field` and `add_header` are not available to Tier 2. | `PS01_BUILD_PLAN.md` |
| D5 | Tier 2 is request-side only in M5. `remap_response_path` stays Tier 1. This matches `TIER_OPS[2]` in `safety/gate.js`. | This plan |
| D6 | One shared provider package is used by the core and the demo server, so the baseline and the healed agent provably use the same client, prompt and tool declarations. | This plan |
| D7 | The baseline default becomes an LLM function-calling agent. The scripted retry baseline stays only as an explicitly labeled backup mode. | `NEW_PLAN.md` M5 |
| D8 | OpenAPI import supports JSON documents, OpenAPI 3.0 and 3.1, operations with a JSON request body. YAML, Swagger 2.0 and path or query parameters are listed as skipped, not silently approximated. | This plan |
| D9 | Existing `POST /tasks` without a `prompt` keeps its scripted behavior so existing scripts and tests keep passing. | This plan |

### 1.1 Gemini provider and key-pool policy

Env spec format stays `provider:model`; only `gemini` is supported. All Gemini calls rotate across the configured key pool. There is no alternate provider.

| Variable | Meaning | Default |
|---|---|---|
| `GEMINI_API_KEYS` | comma-separated Gemini API keys, rotated round robin | none |
| `GEMINI_API_KEY` | legacy single key, used only when `GEMINI_API_KEYS` is unset | none |
| `AGENT_LLM` | model for agent role | `gemini:gemini-2.5-flash` |
| `DIAGNOSER_LLM` | model for Tier 2 role | `gemini:gemini-2.5-flash` |
| `LLM_MAX_CONCURRENCY` | max in-flight provider calls per process | 4 |
| `TIER2_TIMEOUT_MS` | hard timeout for one Tier 2 call | 2500 |
| `TIER2_MAX_CALLS_PER_HEAL` | Tier 2 calls allowed in one heal | 2 |
| `AGENT_MAX_STEPS` | orchestrator model calls per run | 8 |
| `AGENT_RUN_TIMEOUT_MS` | whole run deadline | 60000 |
| `AGENT_MAX_CONCURRENT_RUNS` | concurrent orchestrator runs per process | 8 |
| `BASELINE_MODE` | `llm` or `scripted` | `llm` |

`.env.example` documents `GEMINI_API_KEYS` as four comma-separated placeholders and never contains real keys. The legacy single-key environment variable remains supported.

Key-pool rules:

- Parse `GEMINI_API_KEYS` as comma separated, trim values, drop empty entries, duplicates and common placeholders. If unset, fall back to a pool of one from `GEMINI_API_KEY`. An empty pool reports `missing_api_key`.
- Each invocation selects the next eligible key in round-robin order. Start at a random offset per process. Keep the selection counter safe under concurrent calls.
- A 401 or 403 disables that slot for this process. A 429 applies bounded cooldown/backoff; do not retry the same request across every key because Google quota is project-scoped. Honor a valid `Retry-After` only if present and within the call budget. Network errors and 5xx do not penalize a key.
- Results and health may expose slot index and state only. Never expose key material, prefixes, or hashes. Redaction covers all configured keys.
- Each process rotates independently. Four keys attached to one Google Cloud project share its quota; do not claim a quota multiplier. Rotation distributes credential use and isolates invalid/revoked credentials.

Every result carries `provider`, `model`, `keySlot`, and usage. No `fallbackUsed` field exists.

## 2. Current state (verified from the repository)

| Area | Fact | File |
|---|---|---|
| Provider | Only `health()`. No `generate()`. `getProvider` throws for any provider except `gemini`. Gemini key is sent in the URL query string. | `api-server/src/features/llm/provider.js` |
| Tier 0 | Fetches only the registered `specUrl`, timeout 1800 ms, runs before Tier 1 and blocks it. Handles `spec_default` for missing fields and enum mapping via the custom `x-healr-enum-aliases` extension. Returns null on any `$ref`. No probing, no deref, no rename, move, type or header derivation. Refetches the spec on every diagnosis. | `diagnoser/tier0-spec/index.js` |
| Tier 1 | `rename`, `wrap`, `type`, `header`, `enum` rules. Ambiguous rename returns null and is documented as escalating to Tier 2. | `diagnoser/tier1-rules/*` |
| Tier 2 | Stub that throws. `runTier2` in the diagnoser returns null. | `diagnoser/tier2-llm/index.js`, `diagnoser/index.js` |
| Gate | `TIER_OPS[2]` allows `move_field`, `rename_field`, `coerce_type`, `set_enum_map`. Only `high` risk is blocked (requires Tier 0, or Tier 1 at 0.95 or more). | `safety/gate.js` |
| Heal loop | Calls `diagnose`, gate, applies ops, replays, commits. Token fields are hard-coded `{input:0, output:0}` in `heal.finished` events and `meta.tokens`. | `executor/invoke.js` |
| Orchestrator | Stub that throws. `POST /tasks` runs a fixed `get_user`, `update_user_email`, `get_user` sequence. | `orchestrator/index.js`, `apis/routes.js` |
| Identity check | `matchesIdentity` only checks that the id echoes back. It does not check that a written value (for example the email) echoes back. | `executor/invoke.js` |
| Baseline | Default `BASELINE_MODE=scripted` retries one call. In Gemini mode it parses a `TOOL_CALL:` text protocol, executes only the first tool call, ends on the first successful call, so it never runs the update step. It has its own Gemini client. | `demo-server-and-client/server/src/baseline-agent/*` |
| Mock | Catalogue M1 to M10. Spec modes `active`, `stale`, `unavailable`. M8 enum alias exists only in the active spec through a custom extension. No mutation reaches Tier 1 ambiguity. | `demo-server-and-client/server/src/mutations/*` |
| Settings UI | Shows one provider health result (diagnoser) and the `tier2` policy switch. | `api-client/app/settings/page.js` |

Known defects this milestone must fix, in addition to the new features:

1. Tier 0 blocks Tier 1 for up to 1.8 s when the spec endpoint is slow or hung.
2. Heal events and `meta.tokens` always report zero tokens.
3. Two separate Gemini clients exist (core and demo server).
4. The baseline cannot perform the defined task.
5. Tier 2 policy says low risk only in the original plan, but the gate only blocks `high`. D2 now makes this explicit and testable.

## 3. Target architecture

Diagnosis order stays T0, T1, T2, then cache is consulted first by the existing `replayVerifiedCandidate`.

```
call fails
  -> classify (existing)
  -> cache candidate replay (existing, DATABASE_URL path)
  -> Tier 0: spec (cached, 400 ms budget, never blocks Tier 1)
  -> Tier 1: deterministic rules
  -> Tier 2: LLM typed ops (Gemini with four-key round robin)
  -> safety gate (risk, ops allowlist, confidence, provenance)
  -> compile + replay + logical response check + identity/echo check
  -> commit (transactional) + audit + events + candidate save
  anything unproven -> structured halt, flagged for the operator
```

Shared provider package:

```
packages/llm/
  package.json            name "@healr/llm", type module, no dependencies
  src/index.js            getProvider(role, env), createProviderChain, parseProviderSpec (moved from core, re-exported)
  src/gemini.js           Gemini adapter
  src/schema.js           JSON Schema to provider subset converters
  src/limiter.js          concurrency limiter (in-memory, optional Redis counter)
  src/keypool.js          Gemini round robin pool with per-slot cooldown and disable (section 1.1)
  src/errors.js           ProviderError and code taxonomy
  src/prompts.js          shared agent system prompt and task prompt builders
  test/                   unit tests with injected fetch
```

Add `packages/llm` to the root `package.json` workspaces and make `api-server` and `demo-server-and-client/server` depend on it. `api-server/src/features/llm/provider.js` becomes a thin re-export so existing imports and `provider.test.js` keep working. This does not break the rule that the core is independent of demo-server code, because the package is neutral.

## 4. Contracts to define (update `contracts/` in the same WP that changes them)

### 4.1 Provider contract

```
provider.generate({
  system,            // string
  messages,          // [{ role: 'user'|'assistant'|'tool', text?, toolCalls?: [{id,name,args}], toolResult?: {id,name,content} }]
  tools,             // [{ name, description, parameters (full JSON Schema) }] optional
  temperature,       // default 0
  maxOutputTokens,   // optional
  jsonSchema,        // optional, for structured output when supported
  signal,            // AbortSignal
}) -> {
  text, toolCalls: [{ id, name, args }],
  usage: { inputTokens, outputTokens, totalTokens },
  provider, model, finishReason, latencyMs, keySlot
}
provider.health() -> { ok, provider, model, code?, message? }   // existing shape kept
```

The core keeps full JSON Schema. Conversion to each provider's accepted subset happens in `schema.js`, covered by unit tests, and strips only what the provider rejects (see VERIFY 2).

### 4.2 Tier 2 model output schema

```
{ "ops": [ { "op": "rename_field|move_field|coerce_type|set_enum_map", ...fields per contracts/patch.ops.json } ],
  "confidence": number 0..1,
  "evidence": [ { "source": "error|spec", "quote": string } ] }
```

Use the exact op field shapes already in `contracts/patch.ops.json` and `registry/compile.js`. Reject any additional property. An empty `ops` array with confidence 0 is a valid, safe outcome.

### 4.3 Proposal returned by Tier 2 to the heal loop

`{ tier: 2, confidence, ops, evidence: [{ kind: 'llm_quote', source, quote }], usage: {inputTokens, outputTokens, totalTokens}, provider, model, latencyMs, keySlot }`

### 4.4 Events and metadata

- `heal.finished`, `patch.proposed`, `halt` events and `meta.tokens` carry real token usage accumulated over the whole heal. Replace every hard-coded zero in `invoke.js` with a per-heal accumulator.
- `diagnosis.started` gains `tierAttempt` where useful. `patch.proposed` already carries `tier`; add `provider` and `model` when tier is 2.
- `agent.step`: `{ runId, apiId, iteration, toolCalls: [{ name, argKeys }], tokens, cumulative, provider, model }`. `agent.final`: `{ runId, apiId, outcome, steps, tokens, provider, model, mode }`. Keep whatever fields the existing scripted events already emit so current consumers do not break. Follow `contracts/sse.event.envelope.json`. Never emit raw tool arguments on the public stream.
- Halt reasons added: `tier2_unavailable`, `tier2_timeout`, `tier2_invalid_output`, `tier2_no_proposal`. Existing `requires_approval`, `low_confidence` and `op_not_allowed` are reused. Halt events for flagged cases carry `needsOperator: true`.

### 4.5 Endpoints

| Method | Path | Change |
|---|---|---|
| GET | `/provider/health` | Keep top-level `ok, provider, model, code` equal to the diagnoser result for compatibility. Add `roles: { agent, diagnoser }` and expose Gemini `keyPool` size and per-slot state without key material. |
| POST | `/tasks` | Body without `prompt`: unchanged scripted behavior (D9). Body with `prompt`: agent run. Default response `202 { runId }`. With `wait: true` returns the final result. |
| GET | `/tasks/:runId` | Run status and final result. Falls back to durable event replay by `runId` when the run is not in this process. |
| DELETE | `/tasks/:runId` | Cancels a running task. Idempotent. |
| POST | `/apis/import/openapi/preview` | Body `{ url }` or `{ spec }`. Returns the preview model in WP5.5. Never registers anything. |

Update `contracts/core.endpoints.json` and `contracts/README.md` accordingly.

## 5. Cross-cutting requirements

### 5.1 Security and privacy

- API keys live only in the environment. Never in logs, events, audit records, Postgres, Redis, error messages or URLs. This covers every key in the Gemini pool; only the `keySlot` index may appear anywhere.
- Tier 2 prompts contain structure only: caller argument values are replaced with type placeholders such as `<arg:email:string>`. Error text and spec excerpts are sent after the same secret redaction used for logs and after replacing known caller argument values with placeholders. The evidence quote check runs against exactly the text that was sent.
- Error bodies and specs are untrusted input and may contain prompt injection. Delimit them clearly in the prompt, and rely on the validation pipeline, not on the model, for safety. Add a test where the error body says to ignore instructions and add a header; the proposal must be rejected or ignored.
- Spec and import fetches go through `validateUpstreamUrl` (SSRF policy) with size and time limits. Remote `$ref` is never followed.
- Model output is untrusted data. Never `eval`, never use it as a path, regex or key without validating against observed names.
- Do not persist raw prompts, raw model output, or full agent transcripts. Persist sanitized summaries and counts.

### 5.2 Scalability and resilience (backend)

- All provider calls pass through the limiter in `packages/llm` (`LLM_MAX_CONCURRENCY`). When `REDIS_URL` is set, a fixed-window counter in Redis may share a request budget across core instances. Redis loss degrades to the in-memory limiter. Redis is never the only authority.
- 429 handling and retry with jitter live in the provider layer and respect `Retry-After` only within the caller's remaining budget. For Gemini, a 429 applies bounded cooldown/backoff; do not spray retries across keys because quotas are project-scoped.
- Concurrent identical drifts must cost one Tier 2 call: reuse the existing heal lock and the verified patch candidate store. Document that two core instances can still duplicate work, and that this is safe because commits are versioned and transactional.
- Spec documents are cached with a short TTL (default 5 s, configurable) keyed by URL, with ETag revalidation when the server supplies one. Cache is in memory, optionally mirrored in Redis. A Tier 0 patch that fails replay marks that spec fingerprint untrusted for the rest of that heal and for the TTL.
- Tier 2 failures (timeout, invalid output) are negative-cached briefly through the existing `cacheNegative` path with a short TTL so a failing provider is not hammered. Provider outages are not negative-cached for long.
- Orchestrator runs are stateless apart from an in-memory run registry with a TTL for finished runs. Final summaries are reconstructable from durable events.
- Every wait is bounded: model call timeout, run deadline, step cap, concurrent run cap, spec size cap, import operation cap.

### 5.3 Flagging harder cases to the operator (from D3)

Flag means: nothing is committed, the reason is machine readable, and a human can see what was proposed. Cases that are flagged:

- `requires_approval`: any proposal for a `high` risk tool.
- `low_confidence`: a valid Tier 2 proposal below the confidence threshold.
- `tier2_no_proposal`: the model returned an empty or ambiguous answer.
- Existing safe halts such as M9 (non-derivable required field or missing credential) are already flagged and keep their behavior.

Implementation:

- The `halt` event carries `needsOperator: true` and the reason.
- When a valid, fully validated proposal exists but was blocked by the gate, write an audit record with decision `proposed` containing ops, tier, confidence, evidence, provider and model (the `mode: log` path already does this; reuse it).
- The API client shows these in the existing heals and tool detail views as a "Needs review" badge with the proposed ops rendered through the existing diff component. Read only. Do not add an approve button in M5.

## 6. Work packages

Order is mandatory: WP5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10. Server work completes before the UI that depends on it.

---

### WP5.0 Baseline and VERIFY pass

**Work**

- Run `npm test` and `npm run verify:p01`. Record versions (Node, npm) and results in the ledger.
- Complete every VERIFY item in section 0.4 and record the answers with the doc location and date.
- Create `docs/M5_EVIDENCE.md`.

**Gate**: all regression anchor checks green and VERIFY answers recorded. No product code changed.

---

### WP5.1 Shared provider layer

**Files**: new `packages/llm/*`, change `api-server/src/features/llm/provider.js` (re-export), `api-server/src/config.js`, `.env.example`, root `package.json`, `api-server/package.json`, `demo-server-and-client/server/package.json`.

**Work**

- Implement `generate()` for Gemini with native function calling, internal message format from 4.1, usage mapping, abort support, header-based keys (if VERIFY 8 allows), and error taxonomy using the existing codes (`missing_api_key`, `invalid_or_unauthorized_key`, `quota_or_rate_limit`, `provider_unavailable`, `provider_request_failed`) plus `timeout`, `aborted`, `network_error`, `invalid_response`.
- Implement the Gemini key pool from section 1.1 (`keypool.js`) and use it in the Gemini adapter.
- Implement `getProvider(role, env)` returning the configured Gemini model with the shared key pool. No provider chain. Unknown provider names still fail with a clear error.
- Implement `health()` per provider and a combined role health used by `/provider/health`.
- Implement the limiter and 429 retry logic.
- Implement schema conversion with a unit test per stripped keyword.
- Update `config.js` and `.env.example` with every variable in 1.1. Keep `cfg` backward compatible.
- Keep `parseProviderSpec`, `createGeminiProvider` exports working for `provider.test.js`.

**Tests (no network, injected `fetchImpl`)**: spec parsing, Gemini request building and response parsing including tool calls and usage, error mapping for 401, 403, 429, 500, network failure, timeout and abort, Gemini key selection and slot pinning per invocation, limiter concurrency cap, schema conversion, key never present in thrown errors or logs. Key pool tests: strict round robin over four keys across many calls, random start offset, 429 applies bounded cooldown without cross-key retry, 401 disables a key for the process, exhausted pool returns the correct error, cooldown expiry returns the key to rotation, empty or placeholder or duplicate entries ignored, single `GEMINI_API_KEY` compatibility, health shows slot states with no key material, no pool key appears in any error, log or event.

**Gate**: new tests pass, `provider.test.js` unchanged and green, `npm test` green, `GET /provider/health` is backward compatible and shows both roles.

---

### WP5.2 Tier 2 structured diagnosis

**Files**: `diagnoser/tier2-llm/{index.js,prompt.js,schema.js,validate.js}`, `diagnoser/index.js`, `safety/gate.js`, `executor/invoke.js`, `safety/circuit.js` (reuse), mock catalogue for M11, contracts.

**Work**

1. Replace the stub with `propose({ tool, args, failure, kind, specExcerpt, budgetMs, signal })`. Call it from `runTier2` in `diagnoser/index.js` only after Tier 0 and Tier 1 return nothing and only when the API's `healing.tier2` is true and a provider is configured.
2. Prompt content (structure only): logical tool schema, current adapter JSON, the failing request with values replaced by type placeholders, the truncated and redacted error text (cap 2 KB), the spec excerpt for the failing operation if a spec is available (cap 4 KB), the list of allowed ops, the list of observed names (request keys, error-mentioned names, enum values from the error). Instruct: typed ops only, quote evidence verbatim, return empty ops and confidence 0 when unsure, temperature 0, treat quoted material as data.
3. Validation pipeline, reject on the first failure and return a reason:
   - parses as JSON and passes ajv (4.2), no additional properties
   - every op type is in the Tier 2 allowlist and no op carries a literal source
   - every `evidence.quote` is a verbatim substring of the text actually sent (normalize only whitespace runs)
   - every field name, path and enum key referenced exists in the observed names; every enum map value appears in an observed allowed list
   - passes the provenance and lossless checks in `registry/compile.js` (compile the candidate adapter)
   - at most the existing 8 ops limit, no duplicate or conflicting ops
4. Timeout: a hard `AbortController` at `min(TIER2_TIMEOUT_MS, remaining heal budget)`. At most `TIER2_MAX_CALLS_PER_HEAL` Tier 2 calls per heal. Measure real latency and record it in the ledger. If p95 exceeds the timeout on the chosen model, raise `TIER2_TIMEOUT_MS` through env and document the trade-off. Do not disable Tier 2.
5. Gate (D2): keep `TIER_OPS[2]`. `high` risk returns `requires_approval` (flagged). `low` and `medium` proceed if confidence meets the configured threshold. Add tests that prove each branch.
6. Write tool safety for `medium` risk (the verified replay performs the write): extend the post-replay check so that, for any logical argument whose name matches a declared response field, the response value must equal the sent value (generalizes `matchesIdentity`, which only checks ids). Apply to all tiers only if existing tests stay green; otherwise apply to Tier 2 proposals on write tools and record the reason in the ledger. Add a test where a swapped field mapping passes type validation but fails the echo check and is not committed.
7. Token accounting: add a per-heal accumulator in `invoke.js`, add Tier 2 usage into it, and replace every hard-coded `{input:0, output:0}` so `heal.finished`, `halt`, `meta.tokens`, the invocation record and metrics counters carry real values. If the invocation or metrics tables lack the needed columns, add migration `0007_*.sql`; do not edit existing migrations.
8. Audit and events: Tier 2 commits record provider, model, confidence, evidence quotes and usage in the audit record (no prompt, no raw model output).
9. Flagging per 5.3.
10. Add mutation `M11` to the mock catalogue as data: on `/api/users/update-email`, the logical `user_id` and `email` are renamed to two names that have no usable similarity to the originals (so Tier 1 has no margin and returns null), for example `subscriber_ref` and `contact_address`. Metadata: `category: request`, `expected: heal`, `expectedOps: ['rename_field','rename_field']`, `expectedTier: 2`, `llmRequired: true`. It must be reachable with the spec set to `unavailable` or `stale`. Also tag M8 with `expectedTier` 0 when the spec is active and 2 when the spec is `unavailable` or `stale`. Update `contracts/mock.admin.api.json`. The demo client lists mutations from `/admin/mutations`, so no hard-coded client list is allowed.

**Tests (fake provider injected through a documented seam, no network)**: ambiguous rename accepted then replay passes and commits; same case where replay fails and nothing commits; quote not a substring rejected; invented name rejected; `add_field` or `add_header` proposed by the model rejected; malformed JSON halts cleanly; 1 ms timeout halts cleanly; empty answer halts with `tier2_no_proposal`; high risk flagged with `requires_approval` and an audit `proposed` record; medium risk allowed; a provider 503 yields `tier2_unavailable` without alternate-provider fallback, and invalid output is not retried; usage tokens appear in the heal result and metrics; injection test from 5.1; M8 with spec unavailable reaches Tier 2 and maps `active` to the observed allowed value; M5 four-round Tier 1 path unchanged.

**Gate**: all tests pass, regression anchor green, the NEW_PLAN M5 gate lines "ambiguous rename reaches Tier 2 and either passes evidence validation and replay or safely halts" and "Tier 2 timeout and invalid output halt cleanly" are covered by named tests.

---

### WP5.3 Tier 0 spec discovery upgrade

**Files**: `diagnoser/tier0-spec/{index.js,loader.js,deref.js,derive.js}`, `diagnoser/index.js`, `executor/invoke.js` (skip hint only), mock `openapi.js` if needed.

**Work**

- `loader.js`: candidate spec URLs are the registered `specUrl`, `{baseUrl}/openapi.json`, `{baseUrl}/swagger.json`, a `Link: rel="describedby"` header on the failing response if headers are available, and a spec URL present in the error body. Probe in parallel. Each probe has a 400 ms timeout. Take the first valid OpenAPI document that matches the tool's path and method. All URLs pass `validateUpstreamUrl`. Size cap 1 MB (existing). Add the cache from 5.2.
- Latency fix: start the spec load immediately and wait at most the probe budget. If it is not ready, continue with Tier 1 and discard the late result. A slow or hung spec endpoint must add no more than the probe budget to a Tier 1 heal.
- `deref.js`: resolve local `#/...` `$ref` with a cycle guard, a depth cap and a node cap. Reject remote refs. Remove the current "bail on `$ref`" behavior.
- `derive.js`: derive the whole adapter in one round for the failing operation. For each logical argument locate its spec location: exact name, then `nameScore` (reuse from `tier1-rules/rename.js`) with type compatibility, unique best with margin 0.15 or fail (no Tier 0 proposal, fall through). Emit `rename_field`, `move_field`, `coerce_type` (lossless only), `add_header` (source credential if a matching configured credential exists, or a spec default or a single-value enum, otherwise no proposal), `add_field` with `spec_default`, and `set_enum_map` (lossless case or format variants from the spec enum; keep `x-healr-enum-aliases` support for the mock only and label it so). Required spec fields with no logical source and no default produce no proposal, so M9 still halts.
- Evidence is a JSON pointer into the fetched spec, as the current code already does. Confidence stays at the existing Tier 0 value.
- Stale spec handling: if a Tier 0 patch fails replay, tell the diagnoser to skip Tier 0 for the rest of that heal (add a `skipTiers` hint to the diagnoser input) and mark the spec fingerprint untrusted for the cache TTL. Continue to Tier 1 and Tier 2.
- Keep the existing `x-healr-spec-stale` handling for the mock.

**Tests**: with the spec active, M1 to M5 and M7 each heal in one round (`rounds === 1`) with Tier 0 evidence; M5 with the spec active yields the same four op types as the Tier 1 path; spec `unavailable` falls through to Tier 1 inside the probe budget; a deliberately slow spec server adds no more than the budget; stale spec falls through after one failed Tier 0 round; `$ref` schemas work; cyclic and oversized specs are handled safely; remote `$ref` rejected; SSRF policy enforced; ambiguous locations produce no Tier 0 proposal; cache hit avoids a second fetch within the TTL.

**Gate**: tests pass, regression anchor green, "Tier 0 only uses a currently available, matching spec" is proven by the stale and unavailable tests.

---

### WP5.4 Orchestrator (healed agent)

**Files**: `orchestrator/{index.js,runs.js,tools.js}`, shared prompt in `packages/llm/src/prompts.js`, `apis/routes.js`, contracts, tests.

**Work**

- `tools.js`: build function declarations from the registry's current logical tool schemas for the target API. The agent never sees wire details, adapter versions or heal information.
- `runTask({ apiId, prompt, runId, maxSteps, signal })`: loop up to `AGENT_MAX_STEPS` model calls. Each step calls `provider.generate` with the shared system prompt and the tool declarations. If the model returns tool calls, execute them through `invoke()`: run in parallel when every call in the step has `sideEffects` `none`, otherwise run sequentially in the model's order. Return each result to the model as `{ ok: true, data }` or `{ ok: false, error, message, retryable: false }`. A final text answer without tool calls ends the run.
- Stop rules: step cap, run deadline `AGENT_RUN_TIMEOUT_MS`, per-call timeout, cancellation through `AbortSignal` propagated to provider calls and pending tool calls, and a guard that stops the run with outcome `halted` when the same tool with identical arguments fails twice.
- Outcomes: `completed`, `halted`, `step_limit`, `cancelled`, `error`. The result includes `answer`, `steps`, `tokens`, `provider`, `model`, `mode: 'llm'`, `ms`.
- Provider pinned per run (1.1). Usage accumulated per run and also recorded with `role: agent` so Tier 2 and agent tokens are separable in metrics.
- Routes per 4.5. `POST /tasks` without `prompt` keeps the scripted handler untouched (D9). `AGENT_MAX_CONCURRENT_RUNS` exceeded returns `429` with a structured body. `GET /tasks/:runId` falls back to durable event replay.
- Events per 4.4, emitted on the existing bus so persistence and SSE replay already work.

**Tests (fake provider with scripted tool-call sequences)**: the fixed demo task completes in three tool calls; parallel reads and sequential writes; non-retryable failure ends the run without retry loops; step cap; run deadline; cancellation mid-call; duplicate failing call guard; key slot is selected once per provider invocation; provider error returns a structured result; an M5-mutated API completes with healing invisible to the model and heal tokens kept separate from agent tokens; concurrent run cap; raw args never on the public event stream.

**Gate**: tests pass, regression anchor green, "the healed agent completes the defined M5 task without a human step" is proven in a test with a fake model and by the live script in WP5.10.

---

### WP5.5 OpenAPI importer (server and client)

**Files (server)**: `apis/import/{openapi-import.js,tool-from-operation.js}` reusing `tier0-spec/deref.js`, route added in `apis/routes.js`. **Files (client)**: the `/apis` page and components, `lib/core.js`.

**Server work**

- `POST /apis/import/openapi/preview` accepts `{ url }` (fetched through the SSRF policy, 1 MB cap, 1800 ms timeout configurable) or `{ spec }`. JSON only (D8). Accept OpenAPI 3.0 and 3.1. Reject Swagger 2.0 and YAML with a clear, actionable message.
- Convert each operation to a tool payload that matches `contracts/registration.payload.json`: name from `operationId` (otherwise a slug of method and path), sanitized and made unique within the function-name rule in VERIFY 7; `description` from summary; `method`, `path`; `parameters` from the deref'd JSON request body schema; `response.fields` from the 2xx JSON schema (nested paths, types, formats, required); `sideEffects` and `risk` suggested from the method (GET and HEAD: `none` and `low`; POST, PUT, PATCH: `write` and `medium`; DELETE: `write` and `high`); `identity` suggested only when an obvious id field exists and shown as a suggestion.
- Scope guard: before importing, check what the executor and `registry/compile.js` can actually call today. Import only those operations. List every other operation under `skipped` with a reason such as `unsupported_parameter_location` or `unsupported_content_type`. Do not extend the executor in M5.
- Response: `{ specHash, title, baseUrlSuggestion, tools[], warnings[], skipped[] }`. Warnings include: no response schema (response validation will be limited), no server URL, operation cap exceeded (cap 200), ambiguous names.
- Registration continues through the existing `POST /apis` with the reviewed payload. Set `specUrl` to the source URL so Tier 0 works for the registered API. Manual tool JSON registration remains.

**Client work**

- On the API registration surface add an "Import OpenAPI" tab next to the manual JSON tab using the existing `tabs`, `table`, `badge`, `alert`, `select`, `switch`, `sheet` or `dialog` components.
- Flow: source (URL or paste) then preview then review then register. The review table shows each tool with a checkbox, editable `risk` and `sideEffects`, warnings, skipped operations with reasons, a required base URL field, optional credential mapping (header name to environment variable name), and the API id.
- Honest loading, empty, error and offline states. Keyboard operable. Works on the narrow viewport targets already defined for the app.
- After registration, show a success toast and navigate to the new API page.

**Tests**: importer unit tests on the mock's baseline `/openapi.json`, a small self-written fixture with `$ref`, a cyclic spec, an oversize spec, a spec with only unsupported operations, naming collisions, YAML and Swagger 2.0 rejection, route tests for SSRF and size limits, registration of an imported API followed by a successful invoke against the mock. Client: `next build` passes and the manual browser checklist in 6.1 is recorded in the ledger.

**Gate**: preview never writes state, review step is mandatory, an imported API heals M1 through Tier 0 in one round, manual registration still works.

---

### WP5.6 Honest baseline

**Files**: `demo-server-and-client/server/src/baseline-agent/*` (replace `llm.js`), `routes.js`, `server.js` if needed, shared prompt from `packages/llm`.

**Work**

- Remove `baseline-agent/llm.js`. Use `@healr/llm` with the same `AGENT_LLM` role, so baseline and healed agent use the same provider, model, temperature and the identical system prompt and task prompt (imported from `packages/llm/src/prompts.js`).
- Tool declarations come from the same logical schemas the healed agent gets. Fetch them from the core's public `GET /apis/:apiId` at run start. The raw executor uses the originally registered wire contract (method and path from registration, raw logical args as the JSON body, no adapter, no healing). The tool result sent back to the model is the raw status and body.
- Loop: native function calling, execute all tool calls the model returns, feed raw results back, `max_iterations` 10 (one iteration is one model call). The run ends when the model gives a final answer without tool calls, or at the cap. It must be able to complete the full defined task (get user, update email, report name and email) on a clean API.
- `BASELINE_MODE` is `llm` by default. If `llm` is requested and no usable key exists, run the scripted retry baseline and mark the result `mode: 'scripted'` in the response and in `agent.step` and `agent.final` events so the UI can label it. Never switch silently.
- Return `answer`, `iterations`, `tokens`, `provider`, `model`, `mode`, `outcome` (`completed`, `step_limit`, `error`), and a short tool trace. Stream `agent.step` per iteration with cumulative tokens, keeping the existing `runId` prefix scheme the client uses to split panes.
- Do not tune the baseline to fail. It may succeed on clean and easy drifts. Report whatever happens.

**Tests (fake provider)**: baseline completes the full task on a clean mock; with a fake model that follows errors sensibly it stops at the 10 iteration cap under M5 and its executor never touches an adapter; under M10 it returns a confident answer with missing or wrong data and the existing ground-truth check flags it; the baseline and the orchestrator use byte-identical system prompts and equal tool declarations for the same API (hash comparison test); scripted mode is labeled in result and events.

**Gate**: tests pass, one code path for LLM access across core and demo server, no scripted baseline run without a visible label.

---

### WP5.7 API client integration

**Files**: `api-client/app/settings/page.js`, tool detail, heals, traffic and metrics components that render tiers, `lib/labels.js`, `lib/derive.js`, `lib/core.js`.

**Work**

- Settings: show provider health for `agent` and `diagnoser`, and Gemini key-pool status, using the extended `/provider/health`. Show clear key guidance for `GEMINI_API_KEYS` without ever displaying a key. For the Gemini pool show only pool size, how many keys are healthy, and per-slot state (for example slot 3 cooling down, slot 4 disabled). When Tier 2 is unavailable, say that deterministic Tier 0 and Tier 1 healing remain available.
- Heal timelines and traces: tier chips for T0, T1, T2 and cache; T2 shows provider, model, tokens and latency; evidence view lists quotes with their source (error or spec).
- "Needs review" badge for flagged halts with the proposed ops rendered through the existing diff component (read only), sourced from the audit `proposed` record.
- Metrics plumbing: confirm `/metrics` and the timeseries endpoint expose tokens by role and tier, Tier 2 outcomes (accepted, rejected quote, rejected schema, timeout, unavailable) and fix any gap. Do not build new pages. Milestone 6 consumes this data.
- Use the existing labels and derive helpers so tier naming is defined once.

**Gate**: `next build` passes for the client, every new element reads real data, no fake counters, manual browser checklist (6.1) recorded.

---

### WP5.8 Demo client

**Files**: `demo-server-and-client/client/app/page.js` and related styles, plus server routes it calls.

**Work**

- Pane titles are honest and derived from run results: "Baseline (same model, raw tools)" for `mode: llm`, "Scripted retry baseline (no LLM)" for `mode: scripted`. Both panes show provider and model. If the two runs differ in provider or model, show a visible "not like for like" notice.
- "Run both" sends the same prompt and the same logical tools. The healed pane calls `POST /tasks` with `prompt` and `wait` semantics or follows SSE by `runId`. Baseline pane calls `/demo/run`. Keep runId prefix separation.
- Counters from `agent.step`: iterations, tokens, elapsed. Healed pane shows per-round tier chips including T2 with tokens, and cache hits.
- Mutation controls come from `/admin/mutations` (M11 appears automatically). Add spec mode controls (`active`, `stale`, `unavailable`) if not already present. Mark Tier 2 scenarios (M8 with spec off, M11) as a separate labeled scenario, not on the stage critical path.
- Show flagged halts distinctly from failures and from wrong data (safe halt with "Needs review").
- Keep the existing truth check unchanged and independent of the agent.

**Gate**: `next build` passes, the five states (baseline fail, wrong data, safe halt, recovery, cache hit) remain visually distinct, manual checklist recorded.

---

### WP5.9 Contracts, metrics and docs

**Work**

- Update `contracts/core.endpoints.json`, `contracts/sse.event.envelope.json`, `contracts/audit.record.json` (Tier 2 evidence shape, provider, model, usage), `contracts/tool.version.object.json` if evidence appears there, `contracts/mock.admin.api.json` (M11, spec modes), and `contracts/README.md`. Add or extend golden tests so the real responses conform.
- Update `README.md`: new environment variables, provider roles and Gemini key rotation behavior, how to run live verification, and an honest statement of what is implemented, tested, and externally configured (Gemini credentials).
- Update `docs/NEW_PLAN.md` status table for M5 only after all gates are `verified`.

**Gate**: contract tests pass, README matches actual behavior.

---

### WP5.10 Live verification script

**Files**: `scripts/verify-m5-live.mjs`, root `package.json` script `verify:m5:live`.

**Work**

- A script that uses real keys and skips cleanly with a clear message and exit code 0 when keys are missing. Steps: provider health for both roles; M8 with the spec unavailable (Tier 2); M11 (Tier 2); M5 with the healed agent and the baseline using the same model; M10 baseline wrong data versus healed correct data; four-key round-robin check that reports how many calls went to each slot (indexes only) and any cooldowns observed; measure Tier 2 latency p50 and p95 over a small number of runs.
- Output a machine-readable JSON file and a readable table. Report failures and baseline successes honestly. Do not retry until green.

**Gate**: script runs end to end on the developer machine with real keys, results saved, latency numbers recorded in the ledger. Do not quote any latency or token number in docs before it is measured.

---

### 6.1 Manual browser checklist (record in the ledger, both apps)

1. Clean start: all four services up, health endpoints green, both clients load.
2. API client Settings shows both provider roles and a correct state for missing and present keys.
3. Import an OpenAPI URL (the mock's spec), review, register, invoke, then mutate M1 and see a one-round Tier 0 heal with spec evidence.
4. Switch the spec to `unavailable`, run M8, see Tier 2 chips, tokens, quotes, then verify the audit chain.
5. Run M11 and see Tier 2 rename with replay and commit, or a flagged halt.
6. Set the update tool risk to `high`, run a Tier 2 case, see "Needs review" with the proposed diff and no commit.
7. Demo client: run both under M5, then under M10. Panes are labeled honestly, counters move, truth check behaves.
8. Narrow viewport and keyboard pass on the import flow and the Needs review view.

## 7. Milestone 5 exit gate (maps to NEW_PLAN.md)

| NEW_PLAN gate | Proven by |
|---|---|
| Ambiguous rename reaches Tier 2 and either passes evidence validation and replay or safely halts; both paths tested | WP5.2 named tests for M11 and the failing-replay case |
| Tier 2 timeout and invalid output halt cleanly | WP5.2 1 ms timeout and malformed output tests |
| No unsafe operation can be proposed by the model | WP5.2 allowlist, quote, observed name, injection tests, plus the gate |
| Healed agent completes the defined M5 task without a human step; baseline measured honestly | WP5.4 and WP5.6 tests, WP5.10 live results |
| Tier usage visible in invoke metadata, metrics, traces and the UI | WP5.2 token accounting, WP5.7 UI, WP5.9 contracts |
| Tier 0 only uses a currently available, matching spec | WP5.3 stale and unavailable tests |
| OpenAPI import has preview, validation errors and a review step; manual registration remains | WP5.5 |
| Same model and task and honest tool access for the baseline; scripted backup mode clearly identified | WP5.6, WP5.8 |

Milestone 5 is complete only when every WP gate is `verified` in `docs/M5_EVIDENCE.md`, the regression anchor is green, and the live script has been run once with real keys.

## 8. Out of scope for M5

- Approve and commit from the UI for flagged proposals (the flag and the read-only proposal are in scope).
- YAML specs, Swagger 2.0, path or query parameter operations, non-JSON bodies.
- Tier 2 response-side ops (`remap_response_path` stays Tier 1).
- Ensembles or multi-model voting, streaming model output, LangGraph.
- A distributed rate limiter beyond the optional Redis counter.
- Benchmark and release work (Milestones 7 and 8).

## 9. Prompt to give Codex

> Implement `docs/MILESTONE_5_PLAN.md` together with `docs/NEW_PLAN.md`. Follow section 0 exactly. Work package by package in the stated order. For each package write tests first, implement, run the gate and the regression anchor, update contracts, and record evidence in `docs/M5_EVIDENCE.md` before moving on. Do not skip VERIFY items; stop and report if one cannot be confirmed. Do not mark a gate verified without command output. Keep frontend behavior and styling consistent with the existing apps, keep the backend bounded and scalable as described in section 5, and report anything this plan did not anticipate instead of guessing.
