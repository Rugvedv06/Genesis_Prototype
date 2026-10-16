# healr — Implementation Plan: Phase 2 → Final (handoff document)


Audience: the implementing agent (and the 4 humans). Repo: `Genesis_Prototype-main` (monorepo: `api-server` :8000, `demo-server-and-client/server` :5001, `api-client` :3000, `demo-server-and-client/client` :3001).

Source of algorithms: `PS01_BUILD_PLAN.md` in the repo root. **This document wins wherever the two disagree**, because this one was written after reading and running the actual Phase 1 code.

Anything marked **(verify)** depends on external library/model docs that change often. Check current docs before relying on it.



---



## 0. Rules of engagement for the implementing agent



1. Never break the Phase 1 demo path (M5 heals in 4 rounds, ops = add_header, move_field, rename_field, coerce_type). Run `npm test` before every commit; it must stay green.

2. `api-server` must never import from `demo-server-and-client`. Core learns about an API only through `POST /apis`.

3. Plain JS, ESM, `node:test`. No TypeScript. No new backend frameworks.

4. No literal values invented by anything (code or LLM). Every request leaf must trace to: caller args, a documented spec default, or a credential provider.

5. One owner per folder, small commits, contracts in `/contracts` updated in the same commit as the code that changes them.

6. Do the work in the order of section 7 (work-package index). Fix section 2 defects **first**; several are correctness/safety bugs that later phases build on.

7. Do not mention or use real Cloudflare branding/logos. "Cloudflare-like" means the dashboard patterns (see section 5), not their assets.



---



## 1. Ground truth: what exists today (verified by running it)



Verified on Node 22 with a clean install of the zip:



| Check | Result |

|---|---|

| `node --test` in `api-server` | **20/20 pass** (needs `ajv`, which is only declared at repo root; see D10) |

| Register `demo-users` via `POST /apis` | works, 2 tools |

| M5 on mock, call `get_user` | heals in **4 rounds, tier 1, 135 to 165 ms** locally (README claims ~1.7 s; the real number is much better) |

| Committed ops | `add_header`, `move_field`, `rename_field`, `coerce_type` |

| `GET /apis/:id/tools/:tool/versions` | **returns `[]` (stub)** |

| `POST .../rollback`, `POST /tasks`, `/audit`, `/metrics` | stubs or missing |

| Mock mutations | only **M5**, only on `/api/users/get`; `/openapi.json` is an empty stub |

| Baseline agent | **not an LLM**: re-sends the identical raw call 10 times with a 50 ms sleep |

| api-client | a static status page |

| demo-client | one 10 KB `page.js`, inline styles, M5-only |



Architecture facts the next agent must know (from reading the code):



- `executor/invoke.js` owns validate, send, classify, heal loop, commit. `diagnoser/index.js` runs Tier 1 rules in the order wrap, rename, type, header (T0/T2 are stubs returning null).

- Adapter objects currently carry tool metadata in underscore keys: `_path`, `_method`, `_logicalSchema` (set in `apis/routes.js`, read in `invoke.js`).

- `registry/store.js` is an in-memory map with a JSON snapshot; `commit` and `rollback` exist, but the version object does not record the ops, tier, confidence or evidence.

- Events are **flat** (`{id, ts, type, callId, runId, apiId, tool, ...fields}`), while `contracts/sse.event.envelope.json` documents a `payload` wrapper. Decision (section 3.1): keep flat, update the contract.

- Stubs exist for `safety`, `audit`, `patch-cache`, `drift-detector`, `tier0-spec`, `tier2-llm`, `orchestrator`, `metrics`. The LLM provider stub lives in `features/llm/provider.js` (the plan said `src/llm/`; keep the repo's location).

- Golden error fixtures for M1 to M10 in three styles already exist in `/contracts/errors` and `/contracts/responses`. Tests should iterate over them, not hand-copy bodies.



---



## 2. Defects found, fix before building on top (Phase 2.0)



Severity: **P0** = wrong data, unsafe behaviour or broken demo. **P1** = must fix this phase. **P2** = cleanup.



| ID | Sev | Defect | Evidence | Fix |

|---|---|---|---|---|

| D1 | **P0** | **Single-flight returns the leader's result to every follower, with the wrong args.** Three parallel `get_user` calls for ids 111, 222, 333 under M5 all returned `id: "333"`. This is silent data corruption on the healed path. | Reproduced live (3 parallel curls). Cause: `healSingleFlight` hands back one shared promise whose result was computed from the first caller's `args`. | Section 3.2. Followers wait for the leader's heal, then re-send **their own args** on the new version. Test: 3 parallel calls get 3 different correct ids and exactly one `patch.committed`. |

| D2 | **P0** | **Missing credential becomes the literal string `"undefined"`.** With `TENANT_ID` unset, the heal "succeeded" by sending `X-Tenant: undefined`. This violates the no-invented-values rule and defeats the M9 demo. | Reproduced: unset env, M5, call returned `ok:true, healed:true`. `resolveSource` returns `process.env[...]` unchecked. | Section 3.3: throw `MissingCredential`, map to `halt('credential_unavailable')`. |

| D3 | **P0** | **Writes are retried on 5xx/transient.** `invoke` retries any `transient` kind once, regardless of method. Plan rule: never retry a 5xx write. | Code reading (`kind === 'transient'` branch). Also network errors (`status 0`) are classified `other4xx`, so they surface as `upstream_rejected`. | Add `sideEffects` to tool meta, classify `status 0` as `network`, retry only when `sideEffects === 'none'`. |

| D4 | **P0** | **Healing exceptions are unhandled.** `NotLossless` / `ProvenanceError` thrown inside `send()` (via `buildRequest`) during the heal loop are not caught, so the server returns HTTP 500 `internal` instead of a structured halt. | Code reading: no try/catch in `healAndRetry`; `server.js` catch returns 500. | Wrap build and apply in try/catch, map to `halt('not_lossless' \| 'provenance_violation' \| 'credential_unavailable')`. Add a test using a non-numeric id under M5 (`"abc"` -> must halt, not 500). |

| D5 | **P0** | **Demo-client healed feed is empty.** The client sends `runId` in the JSON body; `server.js` reads `req.headers['x-run-id']`. Healed events therefore have no `runId` and are filtered out by the pane. | Code reading (`server.js` vs `page.js`). | Accept `req.body.runId ?? req.get('x-run-id')`. |

| D6 | P1 | **Confidence gate never runs.** `proposal.confidence` is computed but never checked; there is no op whitelist or risk policy. | Code reading. | Section 3.4 (`safety/gate.js`). |

| D7 | P1 | **Heal budgets are hard-coded** (`rounds: 5`, `5000 ms`), ignoring `cfg.maxHealRounds`, `cfg.healTimeoutMs` and the per-API `healing` block. A local `cfg` variable shadows the concept. | Code reading. | Read budgets from per-API config with global fallback. |

| D8 | P1 | **`send()` silently falls back to `http://localhost:5001`** when `baseUrl` is missing. | Code reading. | Throw a clear `config_error`. |

| D9 | P1 | **Commits record no history**: version objects lack ops, tier, confidence, evidence, verification, latency. Rollback/diff/audit UIs need them. | `registry/store.js`. | Section 3.5 version record. |

| D10 | P1 | `ajv` is declared only in the root `package.json`; `api-server/package.json` omits it. Works only through hoisting. | Failed `heal.test.js` on a per-workspace install. | Add `ajv` to `api-server`. |

| D11 | P1 | **Silent 200 drift is misclassified as `upstream_rejected`**: a 200 whose fields don't match goes through `parseErrors` (empty) then `classify([], 200)` returns `other4xx`. | Code reading. | Add a `silent200` branch before `classify` (Phase 3, section 6.2). Add a placeholder test now. |

| D12 | P1 | `matchesLogicalResponse` only checks that the path exists, not its type or format. | Code reading. | Type-aware check (section 6.2). |

| D13 | P1 | **Re-registering an API appends a new version** (so a UI "reset" produces versions 3, 4, ...), `DELETE /apis/:id` pokes `registryStore._byApi` directly and emits no audit/cache invalidation. | Observed version 4 after re-register. | `registry.registerApi()` that replaces an existing API atomically (new epoch), and `registry.removeApi()`. |

| D14 | P1 | **Baseline is a strawman.** Judges will say the comparison is rigged. It must be a real Gemini function-calling agent (same model, same tools, raw errors, sensible `max_iterations`). | `baseline-agent/index.js`. | Phase 4 WP4.5. Until then label the pane honestly "scripted retry baseline" in the UI. |

| D15 | P2 | Event shape mismatch (flat vs `payload`); `emit` in demo-client reads `ev.payload` with a fallback. | contracts vs code. | Section 3.1. |

| D16 | P2 | `newId()` counters reset on restart, so `callId` values collide with persisted audit/history. | `lib/ids.js`. | `crypto.randomUUID().slice(0, 8)` with prefix. |

| D17 | P2 | `bus.clear()` also drops all SSE listeners. | `events/bus.js`. | Split `reset()` (buffer only) from `dispose()`. |

| D18 | P2 | Demo-client sets healed status to `fail` on the first `call.failed` event (emitted for the drift before healing). | `page.js`. | Replaced by the UI rewrite; meanwhile ignore `call.failed` with `code: 'drift'`. |

| D19 | P2 | Adapter holds `_path/_method/_logicalSchema`, which pollutes adapter hashes and diffs. | `routes.js`, `invoke.js`. | Move to `version.meta` (section 3.5) with a loader migration for existing `registry.json`. |

| D20 | P2 | README port typo ("301"), README claims ~1.7 s heal. | README. | Fix docs. |



**Exit gate for Phase 2.0** (do this first, ~1.5 h):



- [ ] D1 test: 3 parallel calls, 3 distinct correct ids, one commit.

- [ ] D2 test: `TENANT_ID` unset under M5 returns `tool_unavailable` with `details.reason = "credential_unavailable"`, mock `writes` unchanged.

- [ ] D3 test: stubbed 500 on a write tool is **not** retried (fetch call count = 1); on a read tool retried once.

- [ ] D4 test: `user_id: "abc"` under M5 halts with `not_lossless`, HTTP 200 with `ok:false` (never 500).

- [ ] D5: demo-client healed pane shows live events.

- [ ] `npm test` green with the new tests.



---



## 3. Phase 2 — Trust layer (backend), detailed spec



Goal: make healing safe, reversible and auditable, and expose everything the dashboards need. Reference: `PS01_BUILD_PLAN.md` §5, §6 Phase 2, §7. Target: hours 5 to 9 of the original schedule, compressed to run in parallel with section 5 (frontend).



### 3.1 Event contract v2 (freeze first; the frontend depends on it)



Keep events **flat** (matches the running code). Update `contracts/sse.event.envelope.json` to match. Every event has:



```

{ id, ts, type, apiId?, tool?, callId?, runId?, healId? , ...type-specific fields }

```



- `callId`: one per `invoke`. `healId`: one per heal attempt (rounds share it). `runId`: caller-supplied (body `runId` or header `x-run-id`), used by the demo UI to split panes.

- New event types (add to the existing list): `heal.started`, `heal.finished`, `diagnosis.finished`, `upstream.request`, `audit.appended`, `registry.rollback`, `circuit.opened`, `circuit.closed`, `api.registered`, `api.removed`, `config.changed`.



| Event | Extra fields | Why the UI needs it |

|---|---|---|

| `call.started` | `args` (redacted: values kept only for fields the logical schema marks non-sensitive), `version` | traffic log, flow animation |

| `upstream.request` | `round`, `phase: 'live'\|'probe'\|'verify'`, `status`, `ms`, `ok` | request waterfall |

| `diagnosis.started` / `diagnosis.finished` | `round`, `tier`, `ms`, `outcome: 'proposal'\|'none'` | waterfall + tier chips |

| `patch.proposed` | `round`, `tier`, `ops`, `confidence`, `evidence[]` | live chips |

| `patch.verified` | `round`, `status` | verify tick |

| `patch.committed` | `version`, `ops` (delta for this heal), `healId`, `auditIndex` | version timeline |

| `patch.rolledback` | `fromVersion`, `toVersion`, `reason`, `auto: bool` | timeline, toast |

| `halt` | `reason`, `details`, `retryable:false`, `auditIndex` | STOP card |

| `heal.finished` | `healId`, `outcome: 'committed'\|'halted'\|'cache'`, `rounds`, `ms`, `tier`, `tokens` | MTTR, metrics |

| `audit.appended` | `index`, `hash`, `decision` | chain head ticker |

| `circuit.opened` | `key`, `until` | health card goes red |



Rules: events must be small (< 2 KB), never include credential values, and every event on a call carries `callId`. Add `GET /events?apiId=&types=` server-side filtering (comma list) to keep browsers light.



### 3.2 Fix D1: single-flight that is correct



Replace `healSingleFlight` with a **heal lock** that only serialises the *healing*, never shares a *result*:



```js

// executor/heal-lock.js

const leaders = new Map();                      // key -> Promise<void>

export async function heal(key, healFn, onFollower) {

  const existing = leaders.get(key);

  if (existing) { await existing.catch(() => {}); return onFollower(); }   // follower

  const p = healFn().finally(() => leaders.delete(key));

  leaders.set(key, p.catch(() => {}));          // swallow for waiters; leader still gets its own result

  return p;

}

```



In `invoke`: leader runs `healAndRetry` with **its own** args and returns its own result. A follower, once the lock releases, reads `registryStore.current(...)`. If the version advanced, it **re-sends its own args** once (no heal recursion); if that still shows drift it may take the lock once more (`attempt < 2`). If the version did not advance (leader halted), the follower returns the same structured halt (copy the leader's `halt` reason from a short-lived `lastHalt` map keyed by tool, 2 s TTL) instead of burning rounds.



Tradeoff: a "share the result" cache is wrong for any call with different args. Single-flight is only valid for the *patch*, which is what we share.



### 3.3 Fix D2/D3/D4: provenance and error mapping



```js

// registry/compile.js

export class MissingCredential extends Error { constructor(ref){ super(`credential_unavailable: ${ref}`); this.ref = ref; } }

case 'credential': {

  const v = c.resolveCredential?.(source.ref);

  if (v === undefined || v === null || String(v) === '') throw new MissingCredential(source.ref);

  return String(v);

}

```



- Typed errors: `ProvenanceError`, `NotLossless`, `MissingCredential`, `ConfigError`. In `invoke` wrap the whole call in one `try/catch` that maps them to `failure(...)`/`halt(...)`; never let them escape to the HTTP layer. `server.js` should return HTTP 200 for structured `ok:false` bodies (the agent parses the body), HTTP 400 only for `invalid_arguments`.

- Add `sideEffects: 'none' | 'write'` to tool meta (registration field, default **`write`**: the safe default). Transient retry only when `none`.

- Add `network` classification: `status === 0` is `network` (retry once for reads; write -> `upstream_error`, `retryable: false`).

- Add `GET /health` details: `{ ok, version, apis, auditHead }`.



### 3.4 Safety layer (`features/safety/`)



Files: `gate.js`, `circuit.js`, `precheck.js`, `index.js`. Called from the heal loop **before** a proposal is applied.



**gate.js** `check({ proposal, tool, mode, apiCfg }) -> { ok, reason?, details? }`



| Rule | Reason code |

|---|---|

| `proposal.confidence >= apiCfg.confidenceThreshold ?? cfg.confidenceThreshold` | `low_confidence` |

| every op type allowed for the tier (T2: no `add_field`, no literal `add_header`) | `op_not_allowed` |

| risk `high` requires Tier 0, or Tier 1 with confidence >= 0.95 | `requires_approval` |

| at most 8 ops per heal; no duplicate ops; `move_field.to` must not overwrite an existing path | `too_many_ops` / `conflicting_op` |

| `healing.mode === 'off'` | `healing_disabled` |



**Healing modes** (per API, in the registration `healing.mode`, switchable by `PATCH /apis/:id/config`): `enforce` (default), `log` (diagnose and record a `proposed` audit entry, do **not** apply, return `drift_unresolved` with the proposal in `details`), `off`. This mirrors the "log vs block" idea in edge security products, costs ~20 lines, and gives the dashboard a great toggle.



**precheck.js (never heal real bad input)**: extend `classifier` so every error record gets a `class`:



- `structural`: `missing`, `extra`, `type` (lossless candidate), `missing_header`, `enum` (with a permitted list).

- `value`: pattern, min/max length, range, invalid email/format (v1: `value_error.any_str.*`, `value_error.str.regex`, `value_error.email`, `value_error.number.*`; v2: `string_too_short`, `string_pattern_mismatch`, `greater_than`, `less_than`, `value_error`).



`classify` returns `validation4xx` **only if every error is structural**. If any is `value`, return `value_rejected` -> `upstream_rejected` (pass through, `retryable:false`). Tradeoff: a mixed batch is passed through rather than half-healed; that is the conservative choice and is explainable.



**circuit.js**: per `apiId:tool`: after 3 halts in 60 s, open for 30 s (calls return `tool_unavailable / circuit_open` immediately, no upstream traffic); half-open allows one probe. Also a **negative cache**: `unfixable` map keyed by error signature with a 60 s TTL, so a known-unfixable contract (M9) costs one upstream request, not five rounds, on the next call. Emit `circuit.opened/closed`.



**Identity echo check** (replay verification): registration may declare `identity: { "user_id": "id" }` (logical arg -> logical response field). After a replay returns 200, require `String(extracted[field]) === String(args[arg])`; mismatch -> discard draft, `halt('verification_mismatch')`. This is the main defence against a "successful but wrong" patch, and it is also a cheap detector for D1-style cross-talk. Add `identity` to `contracts/registration.payload.json` for `get_user` and `update_user_email`.



**Post-commit watchdog (recommended, ~40 lines)**: after committing version N, watch the next 3 live calls on N. If one fails with a structural validation error or an identity mismatch, auto-rollback to the parent (`patch.rolledback`, `auto:true`), bounded to 2 auto-rollbacks per tool per minute (the circuit breaker prevents ping-pong). Tradeoff: could roll back a legitimate second drift, but the next heal re-applies the fix, and the bound stops loops. Add `POST /dev/force-bad-commit` (dev only) that commits a deliberately wrong patch so the auto-rollback can be demoed and tested.



### 3.5 Registry v2 (`features/registry/`)



Version record (immutable; replaces the current thin object):



```json

{

  "version": 3, "parent": 2, "rollbackOf": null,

  "origin": "register | heal | rollback | cache | drift",

  "tool": "get_user", "createdAt": "ISO",

  "adapter": { "request": [ "typed ops, pure data" ], "response": { "map": { "id": "result.id" } } },

  "meta":    { "path": "/api/users/get", "method": "POST", "logicalSchema": {}, "risk": "low", "sideEffects": "none", "identity": {}, "responseFields": {} },

  "change":  { "ops": [ "delta added by this version" ], "tier": 1, "confidence": 0.95, "evidence": [], "healId": "h_x", "signature": "…", "verification": { "status": 200, "ok": true }, "latencyMs": 135, "tokens": { "input": 0, "output": 0 } },

  "auditIndex": 7

}

```



- Move `_path/_method/_logicalSchema` into `meta`; add a loader migration for old `data/registry.json` files (if an adapter has `_path`, lift it).

- API: `registerApi(apiId, payload)` (replaces the whole API atomically and bumps an `epoch`), `removeApi`, `current(apiId, tool)`, `get(apiId, tool, version)`, `history(apiId, tool)`, `commit(apiId, tool, {adapter, change})`, `rollback(apiId, tool, toVersion, {reason, auto})` (appends a NEW version with `rollbackOf`, `origin:'rollback'`), `config(apiId)`, `setConfig(apiId, patch)`.

- Snapshot: write to `registry.json.tmp` then `rename` (atomic; no torn files on crash). Keep versions forever (plan: history is never rewritten).

- Compile cache keyed by `apiId:tool:vN:epoch`.

- Rollback semantics (demo-critical): rollback restores the parent adapter as a **new** version. If the upstream is still mutated, the next call heals again; that is correct and demo-able ("roll back, reset the mock, calls pass"). Optional `freeze:true` on rollback disables healing for that tool until unfrozen (a kill switch).



### 3.6 Audit chain (`features/audit/`)



Use `PS01_BUILD_PLAN.md` §6 Phase 2 `chain.js` as the base (it uses `stableStringify` from `lib/hash.js`). Changes required for this repo:



1. **Decisions** to log: `commit`, `halt`, `rollback`, `proposed` (log mode), `cache_commit` (Phase 3), `drift_remap` (Phase 3), `circuit_open`. Each record includes `apiId, tool, versionBefore, versionAfter, tier, ops (summary strings), confidence, evidence, verification, latencyMs, tokens, healId, callId`.

2. **Redaction**: ops go in as summaries or with `source` refs only (`credential:X-Tenant`), never resolved values. Add a unit test that sets `TENANT_ID=SECRET123` and asserts the audit file does not contain it.

3. **No `undefined`**: `JSON.stringify(undefined)` yields no output inside `stableStringify`; strip undefined fields before hashing (or the verify recomputation will differ).

4. **Head anchor**: after each append write `data/audit.head.json` `{ index, hash }`. `verify()` also compares the file's tail with the anchor and reports `reason: 'tail_truncated'`. State honestly in the write-up that an attacker who edits both can defeat this; the UI shows the head hash prominently for out-of-band checking.

5. **Hot path**: audit only on decisions (rare), `appendFileSync` is fine. No fsync tuning needed.

6. **Dev routes** (only when `ENABLE_DEV_ROUTES=1`): `POST /dev/tamper {index, mode:'edit'|'delete'}` (backs up to `audit.jsonl.bak` first) and `POST /dev/tamper/restore`. This makes the on-stage tamper demo repeatable. Real manual edits of the file also work because `verify` reads from disk every call.

7. Routes: `GET /audit?limit=&offset=&decision=&apiId=&tool=`, `GET /audit/verify` -> `{ ok, count, headHash, brokenAt?, reason?, anchor }`, `GET /audit/export` (NDJSON download).



### 3.7 Core HTTP surface after Phase 2 (freeze in `contracts/core.endpoints.json`)



| Method | Path | Request | Response |

|---|---|---|---|

| GET | `/state` | none | `{ lastEventId, apis:[{apiId,baseUrl,mode,tools:[{name,version,status,risk,sideEffects}]}], metrics:<snapshot>, audit:{count,headHash,verified}, cache:{entries,hits}, circuit:[…] }` — one call to bootstrap any dashboard |

| GET | `/apis/:apiId` | | API detail, tools, config |

| PATCH | `/apis/:apiId/config` | `{ mode?, confidenceThreshold?, maxRounds?, tier2? }` | updated config; emits `config.changed` |

| GET | `/apis/:apiId/tools/:tool/versions` | | `{ versions:[version records without logicalSchema] }` |

| GET | `/apis/:apiId/tools/:tool/versions/:n` | | full record |

| GET | `/apis/:apiId/tools/:tool/diff?from=&to=` | | `{ added:[ops], removed:[ops], requestBefore, requestAfter }` where the before/after are example wire payloads built from a sample args object (powers the diff animation) |

| POST | `/apis/:apiId/tools/:tool/rollback` | `{ toVersion, reason?, freeze? }` | new version record |

| POST | `/apis/:apiId/tools/:tool/invoke` | `{ args, runId? }` | as §4.4 of the plan; HTTP 200 for `ok:false` except `invalid_arguments` (400) |

| GET | `/traces/:callId` | | `{ callId, spans:[{type,round,tier,ms,status,startOffsetMs}] }` from a 200-call LRU |

| GET | `/audit`, `/audit/verify`, `/audit/export` | see 3.6 | |

| GET | `/metrics`, `/metrics/timeseries?window=300&step=5` | | counters; bucketed series (see 3.8) |

| POST | `/dev/tamper`, `/dev/tamper/restore`, `/dev/force-bad-commit` | dev only | |



### 3.8 Minimal metrics store (needed now by the dashboard, completed in Phase 5)



`metrics/store.js`: a circular array of per-second buckets (3600 entries) `{ t, calls, ok, healed, halted, rejected, cacheHits, tokensIn, tokensOut, healMsSamples[] }`, updated from the same `emit()` path (subscribe to the bus; do not instrument call sites twice). `GET /metrics` returns totals and p50/p95 from the samples; `/metrics/timeseries` returns buckets re-aggregated to `step` seconds. Reservoir cap of 200 samples per bucket.



### 3.9 Demo-server (Track C) in Phase 2



- **M9** both variants: (a) required `Authorization: Bearer` with no credential configured on the core registration; (b) required body field `approval_code` with no documented default. The mock must record **no write** when the request is rejected.

- **`errorStyle`** actually honoured: add `emitters/pydanticV1.js`, `pydanticV2.js`, `problemJson.js`; the validator returns a neutral internal error list and the emitter formats it. Use the golden files in `/contracts/errors/*` as the expected output in tests.

- `GET /admin/mutations` -> `[{id,label,category,recoverable,expected:'heal'|'halt'|'drift'}]` (the UI chips are built from this; no hard-coding in the client).

- `GET /admin/state` additionally returns `lastRequests` (ring of 50: route, status, ms) so the UI can show upstream traffic.

- `GET /admin/truth/users/:id` returns the DB truth for ground-truth checks.

- Make mutations route-keyed (`routes: ['/api/users/*']`) so sibling endpoints drift together (needed for the cache demo in Phase 3).



### 3.10 Phase 2 backend exit gate (compulsory)



- [ ] Phase 2.0 defects closed (section 2).

- [ ] M9 (both variants): `tool_unavailable`, `retryable:false`, `halt` event + audit `halt` record, mock `writes` empty, second identical call returns in < 50 ms via the negative cache.

- [ ] Forced failed replay: registry version unchanged, `halt` audit record written.

- [ ] `POST .../rollback` appends a new version with `rollbackOf`; after `/admin/reset` calls succeed on the restored adapter without healing.

- [ ] `POST /dev/force-bad-commit` then a call: watchdog auto-rolls back, `patch.rolledback{auto:true}` emitted.

- [ ] Edit one byte of `audit.jsonl`: `/audit/verify` returns `{ok:false, brokenAt:<exact index>}`; `/dev/tamper/restore` heals it.

- [ ] A malformed email passed to `update_user_email` (a value error, not a structural one) is **not** healed and returns `upstream_rejected`.

- [ ] Healing `mode: 'log'` records a `proposed` audit entry and does not change the registry.

- [ ] Audit file never contains `TENANT_ID`'s value.

- [ ] All of the above covered by `node --test`; plus one integration test that spawns the mock and core on random ports.



---



## 4. Frontend foundation (build in parallel with section 3; Track D)



Two Next.js apps (plain JS, App Router): **api-client** (:3000, the core control plane, "what an operator watches") and **demo-client** (:3001, "Drift Control", what the judges watch). They share one UI package and one data layer so the look is consistent and the work is done once.



### 4.1 Shared package `packages/ui` (npm workspace `@healr/ui`)



Add `"packages/*"` to root workspaces and `transpilePackages: ['@healr/ui']` to both `next.config.js`. Contents:



- `tokens.css`: CSS variables for color, spacing, radius, shadow, motion (section 5.2). Both apps import it.

- Components (all plain JS, no TypeScript): `Button, IconButton, Badge, StatusPill, Card, StatTile, Tabs, Segmented, Drawer, Modal, Toast, Tooltip, Kbd, Skeleton, EmptyState, DataTable, CodeBlock, HashChip, OpChip, Sparkline, AreaChart, StackedBars, Donut, Histogram, DiffView, Waterfall, FlowDiagram, ChainView, CommandPalette`.

- Fallback if the workspace package fights Next/hoisting for more than 20 minutes: copy the folder into each app under `components/ui` (it is only duplication, not a design change). Decide early; do not spend the hackathon on tooling.



Libraries (all **verify** current versions and React 19 compatibility before installing; keep the list short):



| Need | Choice | Why / tradeoff |

|---|---|---|

| Styling | Tailwind CSS (v4 or v3, verify) + the CSS variables above | fast; variables keep dark/light theming trivial |

| Icons | `lucide-react` | consistent, tree-shakes |

| Charts | **own SVG components** on `d3-scale` + `d3-shape` + `d3-array` | live 1 s updates stay smooth; looks custom rather than "default chart lib"; recharts is the fallback if time is short, but re-rendering animated charts every second is heavier |

| Motion | `motion` / `framer-motion` (verify) only for layout/enter animations; flow packets use `requestAnimationFrame` or SVG `animateMotion` | keeps the hot path cheap |

| Diff | own `DiffView` (JSON key tree, no library) | the data is small and typed ops give us semantic diffs for free |

| Fonts | `next/font` Inter + JetBrains Mono (verify) | tabular numbers for counters |

| Table | own `DataTable` (sticky header, virtualised only if > 500 rows) | avoid TanStack unless filtering needs it |



### 4.2 Data layer (single source of truth for both apps)



```

lib/core.js         fetch wrapper (base from NEXT_PUBLIC_CORE_URL, timeouts, JSON errors)

lib/sse.js          EventSource wrapper: auto-reconnect with backoff, resumes with ?since=<lastId>

lib/event-store.js  singleton store + useSyncExternalStore hooks

```



`event-store` holds: connection state, `lastId`, `events` (ring of 2000), `byCall: Map<callId, events[]>`, `byApiTool` health map, `buckets` (1 s counters for the live charts), and `selectors`. Bootstrap order on every page load: `GET /state` -> render immediately -> open SSE with `?since=state.lastEventId` -> reconcile. If SSE fails for 5 s, fall back to polling `/state` every 2 s and show a "Reconnecting" pill (never a blank screen). The demo-client opens a **second** store against the mock's `/demo/events`, and splits events into the Baseline and Healed panes by `runId` prefix.



Why one store instead of per-page `useReducer`: the same stream feeds the live feed, the flow diagram, health cards and charts; a store with selectors avoids re-subscribing per page and makes navigation instant.



Performance rules: batch SSE messages with `requestAnimationFrame` (apply at most once per frame), cap lists, memoise rows by `event.id`, use `content-visibility: auto` for long logs, respect `prefers-reduced-motion`.



### 4.3 Accessibility and resilience (cheap, judges notice)



Every status uses icon + text + color (never color alone), focus rings visible, all actions reachable by keyboard, error boundaries per route, skeleton states instead of spinners, empty states that tell the operator what to do ("Register an API to see traffic").



---



## 5. Cloudflare-style control plane (api-client) and stage UI (demo-client)



What "Cloudflare-like" means here (patterns, not assets): a left navigation rail with a per-account/zone selector; analytics-first overview with big stat tiles and time-series; a security-events style filterable log with expandable rows; "deployments and rollbacks" for versions; cache analytics with a hit-ratio donut; status pills; toggles for modes (log vs block); a command palette. Do not use Cloudflare's logo, name or exact brand marks. Use `healr` branding.



### 5.1 Information architecture (api-client routes)



| Route | Page | Core data |

|---|---|---|

| `/` | **Overview** (analytics) | `/state`, `/metrics/timeseries`, SSE |

| `/traffic` | **Live Traffic**: log tail + flow diagram + request drawer with waterfall | SSE, `/traces/:callId` |

| `/apis` | **APIs**: cards per registered API (mode toggle, tool health) + "Register API" | `/state`, `PATCH /apis/:id/config`, `POST /apis` |

| `/apis/[apiId]/tools/[tool]` | **Tool detail**: version timeline, diff, rollback, adapter JSON | versions, diff, rollback |

| `/heals` | **Drift events** (the "security events" analogue): table of heals/halts with filters and drawer | SSE, audit |

| `/safety` | **Safety**: halts by reason, circuit states, provenance violations, confidence histogram | audit, `/state` |

| `/audit` | **Audit chain**: block view + Verify | `/audit`, `/audit/verify` |

| `/cache` | **Patch cache** (Phase 3): hit ratio donut, learned patterns, tokens saved | `/cache` |

| `/metrics` | **Performance** (Phase 5): MTTR p50/p95 by tier, tier mix, token overhead, benchmark | `/metrics`, benchmark results |

| `/playground` | Invoke a tool with args, see request/response/meta, quick "mutate" toggles (via mock admin) | invoke |

| `/settings` | thresholds, healing mode, theme, endpoints | config |



Shell: left rail (icons + labels, collapsible), top bar (API selector, time range `Live / 5m / 1h`, connection pill, audit head chip, theme toggle, `Ctrl/Cmd+K`). Default theme: **light for api-client with a dark toggle**, **dark for demo-client** (projector contrast).



### 5.2 Design tokens (put in `packages/ui/tokens.css`)



```css

:root {

  --bg: #ffffff; --bg-subtle: #f7f7f8; --bg-card: #ffffff; --border: #e5e7eb;

  --text: #1f2328; --text-dim: #5b6470;

  --accent: #f6821f;            /* orange: primary action + "healed" highlights */

  --link: #0051c3;

  --ok: #16a34a; --warn: #d97706; --bad: #dc2626; --info: #2563eb; --halt: #7c3aed;

  --radius: 8px; --shadow: 0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04);

  --mono: 'JetBrains Mono', ui-monospace, monospace; --sans: Inter, system-ui, sans-serif;

  --t-fast: 120ms; --t-med: 240ms; --ease: cubic-bezier(.2,.8,.2,1);

}

[data-theme='dark'] { --bg:#0e1116; --bg-subtle:#12161d; --bg-card:#161b22; --border:#252c36; --text:#e6edf3; --text-dim:#8b949e; }

```



Semantic color map (use everywhere, including the demo): healthy/passthrough = green, **healed = orange**, rejected-by-upstream (real bad input) = blue, halted/unrecoverable = violet-red, drift detected = amber, cache hit = teal. Counters use `font-variant-numeric: tabular-nums`.



### 5.3 Signature visualisations (the "wow" components; specs for the implementer)



1. **FlowDiagram (traffic topology).** SVG with nodes `Agent -> Healing Gateway -> Upstream API`, plus satellites `Registry`, `Cache`, `Audit`, `Gemini (T2)`. The gateway node shows the current adapter version (`v3`) and the last committed op chips. Event -> animation mapping: `call.started` spawns a packet on Agent->Gateway; `upstream.request` moves a packet Gateway->API and back, colored by status (green 2xx, amber 4xx drift, red 5xx); `diagnosis.*` pulses the gateway ring; `patch.committed` flashes the registry satellite and pops op chips above the gateway; `cache.hit` draws a short teal arc from Cache; `halt` turns the gateway violet with a STOP glyph; `audit.appended` pings the Audit node. Cap at 30 concurrent packets; aggregate to a density stream at > 20 calls/s. Respect reduced motion (static counts only).

2. **Waterfall (request trace drawer).** From `/traces/:callId`: rows for live request, then per round `diagnosis (tier chip, ms)` and `verify request (status, ms)`; a total bar and MTTR label. Click a row to see ops and evidence quotes.

3. **Overview analytics.** Four `StatTile`s (Requests, Healed %, Halts, p95 heal ms) with sparklines; a stacked area chart of outcomes over time (green passthrough, orange healed, blue rejected, violet halted); a "Tier mix" donut (T0/T1/T2/cache); a "Tokens saved vs spent" bar. Time range switch re-queries `/metrics/timeseries` and then keeps appending from SSE.

4. **Tool health cards.** One card per tool: status pill (`Healthy`, `Healed (v3)`, `Degraded`, `Halted`, `Circuit open`), version chip, last drift time, 60 s sparkline, mode badge. Click through to tool detail.

5. **Version timeline (deployments/rollbacks analogue).** Vertical list: version, origin badge (`register/heal/rollback/cache/drift`), tier, confidence, time, op chips; "Rollback to this version" button with a confirm modal and optional "freeze healing"; expand for the `DiffView`.

6. **DiffView (animated schema morph).** Left: example request before; right: after (from `/diff`). Ops appear one by one as chips in order; each chip highlights the corresponding key path (rename: key text morphs; move: key slides into the new parent; coerce: `"123"` flips to `123`; header: a new line slides in). Under 1.2 s total, replayable with a button. This is the stage hero.

7. **ChainView (audit).** Horizontal scroll of blocks (`#index`, decision, hash prefix, prevHash prefix) joined by links. `Verify` sweeps a highlight along the chain; the first broken block shakes red with the reason and exact index; head hash shown big with a copy button. Works for the tamper demo.

8. **Cache analytics (Phase 3).** Donut "Patch cache hit ratio", table of learned patterns (kind: exact/convention/header, scope, hits, last used), "Diagnosis rounds skipped" and "Tokens saved" counters.

9. **Truth-check badge (demo).** After each run, compare the agent's final answer with `GET /admin/truth/...` and show `MATCH` (green) or `WRONG DATA` (red, with the differing fields). This is what makes the silent-200 reveal land.



### 5.4 demo-client "Drift Control" (stage UI)



Layout (per plan §13.1, using the shared UI): top bar (preflight GO, audit head hash, Verify, theme locked dark, `Presenter mode` toggle). Left rail: mutation chips from `GET /admin/mutations` (grouped: Request drift, Response drift, Unrecoverable), chaos roulette, reset, error-style and spec toggles. Center: two panes **Baseline (Gemini agent, raw tools)** and **Healed (same agent via healing gateway)**: each with timeline, counters (iterations, tokens, elapsed), final answer, truth-check badge; the healed pane also has the giant MTTR stopwatch (ms). Bottom: DiffView + op chips for the current heal; a collapsed FlowDiagram. States to design explicitly: idle, running, success, **FAIL (baseline loops)**, **WRONG DATA (silent drift)**, **STOP (safe halt)**, healed with **cache hit**.



Phase mapping for the demo-client: P2 shell + mutation chips + halt STOP card + rollback + audit head/Verify; P3 DiffView animation + truth-check + chaos + cache chip; P4 tier timeline + token counters + "Register second API"; P5 benchmark table; P6 presenter keys, preflight, safe reset, projector mode.



### 5.5 Phase 2 frontend work packages (Track D)



| WP | Deliverable | Depends on |

|---|---|---|

| F2.1 | `packages/ui` tokens + 10 core components (Button, Badge, StatusPill, Card, StatTile, Tabs, DataTable, Drawer, Toast, Skeleton) | none |

| F2.2 | `event-store` + SSE hook + `/state` bootstrap (mock the API with the golden fixtures until B2.x lands) | event contract 3.1 |

| F2.3 | api-client shell (rail, topbar, theme, connection pill) + Overview with live tiles and stacked area chart | F2.1, F2.2 |

| F2.4 | Live Traffic page: log tail with filters + request drawer (waterfall) | F2.2 |

| F2.5 | APIs page (cards, mode toggle, register form) + Tool detail (version timeline, rollback button + modal) | registry endpoints 3.7 |

| F2.6 | Audit page (ChainView, Verify, tamper-restore dev button when dev routes on) | audit endpoints |

| F2.7 | demo-client rewrite onto shared UI (panes, chips, STOP card, rollback, audit head) | F2.1, F2.2, mock `/admin/mutations` |



Phase 2 frontend exit gate:



- [ ] `npm run dev` shows the new shell on :3000 with live data from a running heal.

- [ ] Running M5 shows: packets animate, a heal row appears in Live Traffic, the version timeline gets v2 with 4 op chips, the waterfall opens for the call.

- [ ] M9 shows a violet STOP state in both apps with the structured reason.

- [ ] Rollback button creates a visible new version; the tamper demo turns a ChainView block red at the exact index.

- [ ] No console errors, works at 1280x720 and 1920x1080, passes a keyboard-only walk-through of rollback.



---



## 6. Phases 3 to 7 (final implementation plan)



Original-plan references: `PS01_BUILD_PLAN.md` §6 (phases), §8 (silent drift), §9 (cache), §10 (Gemini), §11 (mutation catalogue), §12 (performance), §13 (demo). Feature freeze at hour 20 stays.



### 6.1 Phase 3 — Mutation engine v2 and Tier 1 coverage (Track C + A)



**Why change the mock now.** Today each mutation is hand-written lambdas (`when/check/errors`) tied to one route. That cannot produce `/openapi.json` (Tier 0 in Phase 4) or other error styles, and it will not scale to 10 mutations. Replace it with a **declarative contract** that one generic validator walks:



```js

// mutations/catalogue.js  (data only)

export const M5 = {

  id: 'M5', label: 'target nesting + rename + int id + X-Tenant', category: 'request',

  recoverable: true, expected: 'heal',

  routes: ['/api/users/get'],                       // or a glob, e.g. '/api/users/*'

  headers: [{ name: 'X-Tenant', required: true }],

  request: { type: 'object', required: ['target'], additionalProperties: false,

    properties: { target: { type: 'object', required: ['id'], additionalProperties: false,

      properties: { id: { type: 'integer' } } } } },

  response: { /* optional transform for silent drift (M6, M10) */ },

  expectedOps: ['add_header', 'move_field', 'rename_field', 'coerce_type'],   // used by golden tests + benchmark scoring

};

```



Generic validator (outer layer first, to reproduce real layered errors):



```js

// mutations/validator.js

function validateLevel(schema, value, path, errs) {

  for (const k of schema.required ?? []) if (!(k in value)) errs.push({ kind:'missing', loc:[...path, k] });

  if (schema.additionalProperties === false)

    for (const k of Object.keys(value)) if (!(k in (schema.properties ?? {}))) errs.push({ kind:'extra', loc:[...path, k] });

  if (errs.length) return;                                 // stop: report one layer at a time

  for (const [k, sub] of Object.entries(schema.properties ?? {})) {

    if (!(k in value)) continue;

    if (sub.type === 'object') validateLevel(sub, value[k], [...path, k], errs);

    else if (sub.type === 'integer' && !Number.isInteger(value[k])) errs.push({ kind:'type_integer', loc:[...path, k] });

    else if (sub.enum && !sub.enum.includes(value[k])) errs.push({ kind:'enum', loc:[...path, k], allowed: sub.enum });

  }

  if (errs.length) return;

}

```



Emitters (`pydanticV1`, `pydanticV2`, `problemJson`) convert `{kind, loc}` to the style's body; golden files in `/contracts/errors` are the test oracle. The same contract object is compiled to the OpenAPI document served at `/openapi.json` when `specAvailable` is true (Tier 0 gets exact answers for free and Tier 1 still works with the spec off).



Mutation catalogue to implement (plan §11 is authoritative; notes for this repo):



| ID | Notes |

|---|---|

| M1 | `user_id -> userId`; apply to `/api/users/*` (cache demo: sibling endpoints drift together) |

| M2 | `user_id` integer |

| M3 | wrap in `target.user_id` |

| M4 | header `X-API-Version`, `allowed:["2"]` (header value comes from `error_enum` and is verified against the allowed list) |

| M5 | combo; header first |

| M6 | response `result.data.profile.*` (silent 200) |

| M7 | new required `region`, spec default `"IN"`: T0 only; **must halt when the spec is off** |

| M8 | `set-status` enum `active/inactive -> ENABLED/DISABLED` |

| M9 | variants: `Authorization` with no credential; `approval_code` with no source -> safe halt |

| M10 | silent 200: `name` moved to `result.data.profile.full_name` |



Make the write route (`update-email`) mutation-aware too, and have the mock stamp each write with a real provenance check (every field value must be among the values the task supplied), so the benchmark's "corrupted writes" metric is computed by the mock, not trusted from core.



**Tier 1 and parser changes (Track A)**



- `classifier/parseErrors.js`: normalise pydantic-v2 types (`missing`, `extra_forbidden`, `int_parsing`, `int_type`, `string_type`, `enum`, `literal_error`) and problem-json (`errors[]`, plus `header`/`scheme` fields). Today `kind` is derived with `t.includes(...)`, which matches v2 `extra` by luck. Write explicit maps and iterate over **all** golden files in tests.

- Header-location errors (`loc[0] === 'header'`, e.g. v2 M4 `x-api-version`) must become `kind:'missing_header'` with a restored header name; 401 with `WWW-Authenticate` becomes `kind:'auth'`. Currently both fall through, so M4/M9 in v2/problem-json would not classify.

- `typeRule`: take `from` from the **actual argument type** in the request, not an assumption of `string`; support integer <-> string both ways with `coerceLossless`.

- New `enum.js`: `set_enum_map` only for lossless normalisations (case/format) when the permitted list is in the error body; semantic mappings (`active -> ENABLED` where the lists differ in meaning) are Tier 2 (Phase 4). Map values must come from the observed `allowed` list.

- `header.js`: support `source:{type:'error_enum', value}` when the error provides exactly one allowed value; credential-backed headers otherwise; none available -> `halt('credential_unavailable')`.

- `RULE_ORDER`: header, wrap, rename, type, enum (header first because the mock/real APIs check headers first).

- Ambiguity: `renameRule` already returns null for ties; add a golden test with two candidates (`user_id` vs `customer_id` both missing and both extra) asserting `null`.



### 6.2 Silent-200 drift detector (must-have; Track A) — fixes D11/D12



Flow in `invoke`, **before** `classify`:



```

res.ok  &&  !responseMatches(tool, res.json)   ->   silent200 branch

```



1. `responseMatches`: for each logical field `{path,type,format}` require the path to exist, `typeof` to match, and `format:'email'` to pass.

2. `drift-detector/locate.js`: collect all leaves of the response as `{path, type, value}`. For each missing logical field, candidate leaves must satisfy: same type and format; name similarity via `nameScore` (reuse from `rename.js`) on the **last key** (token overlap + Levenshtein); value fit if a last-known-good value for the same tool and args exists in a small LRU (`lastGood`, populated on every verified success). Pick a unique best with margin >= 0.15, else Tier 2 on structure only (keys and types, values redacted) or `drift_unresolved`. Never guess among ties.

3. Propose `remap_response_path {logical, to}` ops. **Verify without a second request**: re-extract from the same response and re-run `responseMatches`; also run the identity echo check where declared.

4. **Writes** (`sideEffects:'write'`): never re-send. The write already happened; return the remapped data and commit the remap for next time. Reads: no replay needed either; the same response is the verification.

5. Commit a new version (`origin:'drift'`), audit `drift_remap`, emit `drift.silent {logical, from, to}` and `patch.committed`.

6. No declared response schema: store a **structural fingerprint** (key paths + types) on first success; on mismatch emit `drift.silent` as a **warning only** (we do not know which fields the agent needs).



Add `remap_response_path` to `compile.js` (`respMap[logical] = to`) and to the op whitelist. Limitation to state openly in the write-up: same-shape semantic swaps (two fields exchanging meaning) are undetectable structurally.



### 6.3 Patch cache (must-have; Track B)



Entry kinds per plan §9, **always replay-verified** before commit, so a stale entry costs one wasted request at worst:



```js

// patch-cache/index.js

learn(apiId, tool, ops, meta)    // called after every verified commit

candidates(apiId, tool, failureKind, errors)   // returns ordered op-lists, most specific first

invalidate(apiId, reason)        // on DELETE /apis, reset, failed replay of that entry

stats()                          // { entries, hits, misses, roundsSkipped, tokensSaved }

```



- **Exact reuse**: key `apiId|op|fieldName|shape` (shape = wrapper path, e.g. `target`). Applies to a sibling tool if its logical args contain the `from` field.

- **Convention**: rename `user_id -> userId` (snake to camel) generalises to `order_id -> orderId` for tools in the same API; compute with name-case functions and require the target field to be an arg of the tool.

- **API-wide header**: `add_header X-Tenant` applies to every tool of the API.

- Integration: in `healAndRetry`, before round 1, try cache candidates; on success commit with `origin:'cache'`, emit `cache.hit {kind, key, roundsSkipped, tokensSaved}`, audit `cache_commit`, and count as `tier:'cache'` in metrics. `tokensSaved` is an estimate: label it clearly in the UI ("estimated diagnosis tokens avoided"), and report actual Tier 2 token usage separately.

- Test: heal `get_user` under M1, then `update_user_email` on the same API heals with **0 rounds of diagnosis**, `cache.hit`, and a stale entry (mock reset between) falls through to normal diagnosis.



### 6.4 Phase 3 frontend (Track D)



- **DiffView** (the animated morph, section 5.3 item 6) fed by `/diff`; op chips animate in order.

- **Truth-check** badge in demo-client (calls `GET /admin/truth/users/:id` and compares with the agent's final data); `WRONG DATA` state for M10.

- **Chaos roulette** (random recoverable mutation, labelled "not scripted").

- **Cache page** (hit ratio donut, learned patterns table) and `cache.hit` chip on the flow diagram and demo timeline.

- Overview: "Drift detected: silent" amber series in the stacked chart.



### 6.5 Phase 3 exit gate (compulsory)



- [ ] Golden tests pass for M1 to M8 (T1 or T0, no LLM) across all three error styles where applicable.

- [ ] M10: baseline returns wrong/missing data; healed returns correct data; truth-check shows red vs green; **no write replayed**.

- [ ] Cache: second endpoint heals with 0 diagnosis rounds and a `cache.hit` event; stale entry test passes.

- [ ] Ambiguous rename is **not** auto-patched (returns null, escalates).

- [ ] M7 halts when the spec is off.

- [ ] All new behaviour appears in the dashboards (cache page, drift events, diff animation).



### 6.6 Phase 4 — Tier 0, Tier 2, orchestrator, honest baseline



**WP4.1 Tier 0 spec diff (Track A).** Probe in parallel with Tier 1 (`/openapi.json`, `/swagger.json`, registered `specUrl`, `Link: rel=describedby`), 400 ms timeout, deref `$ref` with a small recursive resolver. For the failing route, locate each logical arg in the spec's request schema (exact name, then `nameScore` with type compatibility, unique best or fail), build the **whole adapter in one round** with confidence 1.0 and a JSON-pointer evidence string. Required spec fields with no logical source: `default` -> `add_field {source:{type:'spec_default'}}`, else halt. This is what makes M7 solvable and demonstrates "one round vs four".



**WP4.2 Provider layer + Tier 2 (Track B).** Keep the stub path `features/llm/provider.js`; add `gemini.js`. Contract (from the plan, unchanged):



```

generate({ system, messages, tools, temperature }) -> { text, toolCalls:[{id,name,args}], usage:{inputTokens,outputTokens} }

generateStructured({ system, prompt, schema, timeoutMs }) -> { data, usage }

```



Roles `AGENT_LLM` and `DIAGNOSER_LLM` (`gemini:<model>`), so splitting models later is config only. **Verify before coding**: the current npm package (`@google/genai`), the call shape for structured output (`responseMimeType: 'application/json'` plus a response schema field), the function-calling shape, the usage metadata field names, the supported JSON-Schema subset (convert and strip unsupported keywords inside `gemini.js` only), and current model names and rate limits for your key. Use a small/fast model for diagnosis. Put 429 backoff inside the provider.



Tier 2 pipeline (reject on any failure; an empty proposal is a valid safe outcome): ajv-validate output; ops restricted to `rename_field, move_field, coerce_type, set_enum_map, remap_response_path`; **no literal-bearing ops**; every `evidence.quote` must be a verbatim substring of the error/spec text sent; every referenced name must exist in the observed request or error; provenance guard; gate (risk `low` only); replay verification; 2.5 s `AbortController` timeout, temperature 0. Treat LLM confidence as a weak filter; the real gates are the substring check and the replay.



**WP4.3 Orchestrator (Track B).** `POST /tasks {apiId, prompt, runId?}` -> `{runId}`; progress over SSE (`agent.step`, `agent.final`). Gemini function-calling loop over the **logical** tool schemas from the registry; execute tool calls through `invoke` (parallel when several); return structured results (`ok:false, retryable:false`) so the model explains instead of retrying; 8-step cap; token counts from provider usage.



**WP4.4 Task fixture.** Fixed task: "Fetch user 123, update their email to <x>, and tell me the user's name and email." Same prompt for both agents.



**WP4.5 Honest baseline (Track C) — fixes D14.** Replace the replay loop with a Gemini function-calling agent: **same model, same system prompt, same logical tools**, but the executor is raw HTTP (v1 contract, no adapter), the tool result is the raw status+body, `max_iterations=10`, same temperature, token usage counted per iteration and streamed as `agent.step`. Let it succeed on clean and easy drifts (be honest in the report); it should fail or loop on M5 and silently return wrong data on M10. LangGraph JS is optional (45 min time box); a hand-rolled loop with identical behaviour is acceptable. Never rig the baseline.



**WP4.6 OpenAPI importer (stretch, 90 min).** Convert operations to tools (`operationId` -> name, request body schema -> parameters, 2xx schema -> response fields, learn response map on first success). Strongest "works on any API" proof: protect the core path first.



**WP4.7 Second mock (stretch).** A second domain on :5002 (e.g. `orders`/`shipments`) and a "Register second API" button for the stage.



**Phase 4 frontend (Track D):** tier timeline (T0/T1/T2/cache chips, token cost per tier) in both apps; live token and iteration counters on the Baseline pane (`agent.step`); Gemini satellite node on the flow diagram lights up when Tier 2 runs; Register API form with "paste tool JSON" and "OpenAPI URL" tabs; agent transcript drawer.



**Phase 4 exit gate (compulsory):**



- [ ] Ambiguous rename escalates to Tier 2; the patch quote is a verbatim substring of the error; replay passes, or the heal halts. Both outcomes tested.

- [ ] The same Gemini model completes the fixed task through the healing layer under M5 with no human step; the baseline agent fails under M5.

- [ ] Tier 2 timeout (1 ms in a test) yields a clean halt.

- [ ] M7 heals via Tier 0 only when `specAvailable`, and halts otherwise.

- [ ] `meta.tokens` and `/metrics` show tokens per tier; swapping `DIAGNOSER_LLM` to a fake provider changes which factory runs (unit test).



### 6.7 Phase 5 — Benchmark and metrics (Track C + B + D)



**Runner** at `demo-server-and-client/server/src/benchmark/` (`npm run bench`): seeded PRNG (mulberry32) controls mutation order and chaos picks; for each `M1..M10` x `R` repeats (default 5): `POST /admin/reset`, `DELETE`/re-register the API on core (fresh registry, cache and negative cache), run, record. Two modes: `direct` (call tools through core; measures the healing layer; fast, stable, used on stage) and `agent` (full Gemini task for M5, M9, M10; check quota first). Output JSON + printed table + CSV.



Scoring per mutation uses the catalogue's `expected` field: `heal`, `halt` (correct halt = **safe outcome**, reported separately, never as a heal), `drift`, `passthrough` (bad input must not be healed).



Metric definitions are in plan §6 Phase 5; implement exactly: **ZTAR** (also over all), **MTTR p50/p95 by tier** (first failing or drifted response to first verified correct response), **token overhead vs baseline**, **corrupted writes** (computed by the mock; must be 0), **wrong-patch rate** (passed replay but wrong vs ground truth), **loop count**. Measure externally (wall clock around the request) in addition to core's own timestamps. Add one micro-benchmark for the healthy-path overhead (compare a direct upstream call vs through core) and report the measured number; do not quote a number before measuring.



**Frontend:** Performance page (MTTR histogram with p50/p95 markers by tier, tier mix donut, outcome stacked bars, token overhead chart, cache hit ratio); demo-client "Run benchmark" button streaming rows into a results table (direct mode), with export.



**Exit gate (compulsory):** one command prints the table; two runs with the same seed give identical outcomes/ZTAR (timings vary); corrupted writes = 0 in the table; numbers copied into `WRITEUP.md` with the seed.



### 6.8 Phase 6 — Polish and stretch (frozen features; presentation only)



- **Presenter mode** (keyboard): `1..0` pick mutation, `B` run both, `R` reset, `V` verify audit, `T` tamper, `Space` start, `?` help overlay. Nothing on stage depends on precise mouse clicks.

- **Preflight page**: checks core, mock, both SSE streams, Gemini ping, audit verify, registry sanity, then a big green GO (or a red list of what failed).

- **Safe reset** (one key): reset mock, delete and re-register the API, clear baseline state and the cache, **keep the audit log** (so the tamper demo still has history).

- Projector mode (larger type, high contrast, hides secondary panels), giant MTTR stopwatch, smooth counters, sound off by default.

- Animation polish: DiffView timings, flow packets, STOP state, chain verify sweep; `prefers-reduced-motion` honoured.

- **Stretch: offline fallback.** In the provider layer, record every request/response keyed by `sha256(stableStringify({role, model, system, messages, schema}))` into `data/llm-cache.json`; with `OFFLINE=1` serve from the cache and fail loudly on a miss. The deterministic seed makes the stage path replayable. Only after everything else is green.



### 6.9 Phase 7 — Rehearsal and delivery



Three timed 4-minute rehearsals on the stage laptop and network (roles: presenter, driver, Q&A narrator, fallback owner; fallback signal: no healed result in 6 s). Tag `release`, no merges after. Deliver `WRITEUP.md` (problem, architecture, tiers, ops, safety, audit, metrics table with seed, limitations, future scope), the 30 s pitch (plan §16), a recorded backup video, a second laptop running the repo. Add npm scripts: `demo:reset`, `demo:tamper`, `bench`, `preflight`.



---



## 7. Work-package index (assign and parallelise)



| WP | Title | Track | Depends on | Est. |

|---|---|---|---|---|

| 2.0 | Defect fixes D1 to D5, D10 (+ tests) | A | none | 1.5 h |

| 2.1 | Event contract v2 + `/state` + trace store | B | 2.0 | 1 h |

| 2.2 | Registry v2 (version record, rollback, atomic snapshot, API replace/remove) | B | 2.0 | 1.5 h |

| 2.3 | Safety: gate, precheck classes, circuit, negative cache, healing modes, identity echo, watchdog | A | 2.0 | 2 h |

| 2.4 | Audit chain + routes + dev tamper | B | 2.2 | 1 h |

| 2.5 | Mock: M9, emitters, `/admin/mutations`, `/admin/truth`, lastRequests | C | none | 1.5 h |

| 2.6 | Metrics store + timeseries | B | 2.1 | 45 min |

| F2.1 to F2.7 | Frontend foundation, shell, pages | D | 2.1 for real data (use fixtures before) | 5 h total |

| 3.1 | Mutation engine v2 (declarative) + M1 to M10 | C | 2.5 | 2.5 h |

| 3.2 | Tier 1 + parser extensions | A | 2.0 | 1.5 h |

| 3.3 | Silent drift detector | A | 3.2 | 1.5 h |

| 3.4 | Patch cache | B | 2.2 | 1.5 h |

| F3 | DiffView, truth-check, chaos, cache page | D | 3.x events | 3 h |

| 4.1 | Tier 0 | A | 3.1 | 1.5 h |

| 4.2/4.3 | Provider, Tier 2, orchestrator | B | 2.1 | 3 h |

| 4.5 | LLM baseline agent | C | 4.2 | 1.5 h |

| F4 | Timeline, token counters, register form | D | 4.x | 2 h |

| 5.x | Benchmark + metrics + pages | C/B/D | 3.x, 4.x | 3 h |

| 6.x / 7.x | Polish, rehearsal, delivery | all | freeze | 4 h |



Suggested parallelism: A does 2.0 -> 2.3 -> 3.2 -> 3.3 -> 4.1; B does 2.1 -> 2.2 -> 2.4 -> 2.6 -> 3.4 -> 4.2/4.3; C does 2.5 -> 3.1 -> 4.5 -> benchmark; D does F2 -> F3 -> F4 -> polish, building against golden fixtures until the real endpoints land. Reassign freely; keep one owner per folder.



---



## 8. Definition of done and kickoff prompt



**Definition of done (project):** all phase exit gates green; the 4-minute demo script (plan §13.3) runs three times in a row; `npm test` green with golden tests for every mutation and error style; benchmark table in `WRITEUP.md` with the seed; core has zero imports from `demo-server-and-client`; audit file contains no secrets; backup video recorded; preflight shows GO on the stage laptop and network.



**Never cut:** Phase 1 slice, provenance guard, rollback, audit chain, silent drift, patch cache, benchmark table. Cut order if behind: offline mode, chaos roulette, OpenAPI importer, Tier 0 polish, Tier 2 polish, second mock, metrics page polish.



**Paste this to the implementing agent:**



> You are continuing the healr repo (Phase 0 and 1 done). Read `PS01_BUILD_PLAN.md` for algorithms and `HEALR_PHASE2_TO_FINAL_PLAN.md` for the corrected, current plan; the latter wins on conflicts. Start with section 2 (defects D1 to D5, D10): write the failing tests first, then fix. Then execute work packages in the order of section 7, keeping `npm test` green and the Phase 1 M5 demo working at every commit. Update `/contracts` in the same commit as any API or event change. Build the frontend per sections 4 and 5 against the golden fixtures until backend endpoints land. Mark anything depending on Gemini/Next/Tailwind docs as "verify" and check current docs before using it. At the end of each phase, run that phase's exit gate and report each checkbox as pass or fail with evidence.


