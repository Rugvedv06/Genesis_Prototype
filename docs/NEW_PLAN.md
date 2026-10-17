# healr — Completion Plan

## Purpose

This plan turns the existing PS01 prototype into a complete, reliable application. `PS01_BUILD_PLAN.md` remains the source for product goals, safety principles, and acceptance expectations. `docs/HEALR_PHASE2_TO_FINAL_PLAN.md` contains later technical clarifications for the trust layer; use those where they correct details in the original plan. This document updates the implementation order to match the repository as it exists now.

The detailed agent workflow and work packages for Milestones 0 and 1 are in [MILESTONE_0_1_AGENT_LOOP.md](./MILESTONE_0_1_AGENT_LOOP.md).

The database schema, persistence/cache ownership rules, transaction timing, migration path, and operational gates are defined in [DB.md](./DB.md). That document is the source of truth for the persistence milestone below.

The product is a self-healing tool gateway between agents and HTTP APIs. It should detect request and response contract drift, derive adapter changes only from evidence, verify them before commit, retain reversible history, and halt safely when proof is insufficient. The demo client presents the behavior; the API client operates and explains the gateway.

## Current state: verified versus reported

| Area | What is present | Assessment |
|---|---|---|
| Phase 0 — foundation | Four npm workspaces, dev launcher, contracts and fixtures, health routes, environment examples, and root test command. Latest `npm test` passes **85/85**; scripted Phase 0/1 acceptance passes **17/17**. | Automated baseline gates pass. Clean-start browser walkthrough across all four services remains open. |
| Phase 1 — M5 vertical slice | M5 four-round healing, exact four patch operations, golden/unit tests, mock, baseline path, demo UI, registration, versions, and SSE are implemented. | Scripted acceptance freshly verifies M5, restart, re-registration, concurrency, credentials, retry policy, and contracts. Browser-level UI acceptance remains open. |
| Phase 2 — trust layer | Source includes safety checks, heal lock, file-backed version history/rollback, audit verification/head anchor, tamper routes, M9, circuits/negative caching, and settings/audit/tool-history UI. Focused and full tests cover the main gates. | Partially verified. Remaining evidence includes broader canonical audit-hash vectors, rollback after mock reset with replay of the restored adapter, and browser acceptance. See the M0/M1 ledger. |
| Persistence and operational logging | PostgreSQL/Redis Compose services, a PostgreSQL driver, checksummed migrations through v0005, transaction-scoped initial repositories, `/ready`, and a read-only importer preflight are present. Registry snapshots and audit JSONL/head remain file-backed; calls, events, traces, metrics, circuit state, and negative cache remain process-local. Redis is not connected. | Not complete. A live core process is still writing the source files; the importer detects unsafe audit evidence and refuses apply until a redaction/rechain policy is settled. Route cutover, Redis integration, durable event/invocation writes, and operational proof remain. See the execution status and work gates in `MILESTONE_1_5_PLAN.md`. |
| Phase 3 — coverage and differentiators | Response validation exists; Tier 1 rules cover the M5 path; ambiguous rename has a unit test. | Incomplete. The mock catalogue contains only M5 and M9. Silent-response drift is not safely resolved, and patch cache is still a stub. |
| Phase 4 — model-powered features | Provider interface and health check exist. | Incomplete. Tier 0 spec discovery, Tier 2 diagnosis, and the core orchestrator remain stubs. No OpenAPI importer is present. |
| App surfaces | Overview, traffic, APIs, tool detail, drift/heals, audit, playground, and settings pages exist in api-client; demo-client has its stage screen. | Incomplete against the product plan: `/safety`, `/cache`, and `/metrics` are absent, as are their complete backend/data contracts. UI pages need to be connected to final capabilities and checked as an integrated product. |
| Completion/release | No complete benchmark, final write-up, preflight flow, or repeated clean-start rehearsal evidence was found. | Not complete. |

The Phase 0 and Phase 1 checkboxes in the original plan and README are historical reports; the current evidence above comes from the latest automated gates. The acceptance harness has been repaired and passes, while the separate browser smoke remains outstanding.

## Product rules that remain fixed

1. Preserve the working M5 path while adding features.
2. Never invent request values. Patched values must trace to caller arguments, a documented default, or a configured credential source.
3. Validate logical arguments before making upstream calls. Never “heal” invalid caller input.
4. Verify a candidate adapter by replay before committing. Discard failed drafts; retain history and make rollback append a new version.
5. Never replay writes to detect silent response drift. Response remapping must be read-side only and pass logical type and identity checks.
6. Keep the core independent of demo-server code. The mock remains a replaceable external API registered through the public API.
7. Keep every feature explainable in the API client and demonstrable in the stage client. Do not add dashboard pages that lack a real data source or operator decision.

## Implementation order

Each milestone has an exit gate. Do not start dependent feature work until its gate passes. The order is intentionally different from the original 24-hour parallel-track schedule: this is now a completion effort, so correctness and stable contracts come before breadth and polish.

### Milestone 0 — Establish a trustworthy baseline

**Work**

- Repair `scripts/verify-phase01.mjs` port allocation so each requested port is unique and remains reserved until both test services have started; ensure cleanup runs after failures.
- Run the phase acceptance script from a clean temporary data directory. Preserve its output as evidence; fix any product regressions it reveals.
- Verify the four `npm run dev` processes and their health endpoints, then load both Next.js clients at their configured ports.
- Reconcile README status with current evidence and record the exact Node version and commands used.

**Exit gate**

- `npm test` passes.
- `npm run verify:p01` completes instead of failing during port selection, and its M5, restart, re-registration, concurrency, credential, and lossless-coercion checks pass.
- All four development services start together and return their expected health/status responses.

### Milestone 1 — Close Phase 2 trust and safety gates

Treat this as the first product milestone after baseline. Audit and harden the current implementation against the detailed gate in `HEALR_PHASE2_TO_FINAL_PLAN.md` §3.10.

**Work**

- Add focused tests for heal concurrency, each caller receiving its own arguments/results, exactly one commit, missing credentials, no write retries, and structured halts for unsafe coercions/provenance failures.
- Exercise M9 in both forms (missing credential and non-derivable required field); assert no write, non-retryable response, halt event/audit entry, and fast negative-cache behavior.
- Exercise failed replay and `mode: log`; prove the registry does not change and the correct audit decision is recorded.
- Exercise rollback as a new immutable version, then reset the mock and prove the restored adapter works.
- Exercise audit edit/delete detection at the correct index, head-anchor truncation detection, restore flow, and secret redaction.
- Exercise watchdog rollback of a forced bad commit and verify emitted event/history.
- Check value errors such as malformed email remain `upstream_rejected`, while structural drift enters diagnosis.
- Review the per-API configuration surface for consistent defaults and behavior in `enforce`, `log`, and `off` modes.

**Exit gate**

- Every item above has an automated regression check; the full suite passes.
- M5 remains green, M9 safely halts without writes, failed drafts never replace the active version, rollback succeeds, and audit verification detects tampering.
- Update the event and endpoint contracts to match actual response shapes before the next feature milestone.

### Milestone 1.5 — Add database persistence and Redis cache

This is a required foundation milestone after the current M0/M1 closure work and before Milestone 2 broadens the mutation model. It does not change the existing Phase 0/1 contract; it replaces file/in-process runtime state behind repository interfaces while preserving API and event contracts. Follow the complete schema and rules in [DB.md](./DB.md).

Implement this milestone using the sequenced work packages and edge-case gates in [MILESTONE_1_5_PLAN.md](./MILESTONE_1_5_PLAN.md); freeze its compatibility and import decisions before repository cutover.

**Work**

- Add PostgreSQL access through one `DATABASE_URL`, versioned/checksummed migrations, readiness checks, bounded pool/timeouts, and repositories. Local dependencies use the root Compose file (`postgres:18-alpine`, `redis:8-alpine`). Redis uses its separate `REDIS_URL`.
- Persist workspaces, API/config records, credential source references, tools, immutable adapter versions, current pointers, invocations, sanitized gateway events, audit chain/head, service diagnostics, and verified patch candidates using the constraints in `DB.md`.
- Make registration/config updates, adapter commit/rollback, audit append, and terminal invocation/event writes transactional where specified. Never hold a database transaction during provider or upstream network calls.
<<<<<<< HEAD
- Replace file-backed registry/audit authority with Postgres. Add a dry-run, idempotent importer for registry JSON and audit JSONL/HEAD; preserve all parseable records and source hashes/indices, require explicit confirmation before redacting/rechaining unsafe or invalid legacy audit chains, and stop on malformed/unparseable source data. No silent fallback to files or in-memory state.
=======
<<<<<<< HEAD
- Replace file-backed registry/audit authority with Postgres. Add a dry-run, idempotent importer for registry JSON and audit JSONL/HEAD; preserve all parseable records and source hashes/indices, require explicit confirmation before redacting/rechaining unsafe or invalid legacy audit chains, and stop on malformed/unparseable source data. No silent fallback to files or in-memory state.
=======
- Replace file-backed registry/audit authority with Postgres. Add a dry-run, idempotent importer for existing registry JSON and audit JSONL/HEAD; preserve version/hash history and stop on invalid source data. No silent fallback to files or in-memory state.
>>>>>>> origin/main
>>>>>>> origin/main
- Add Redis-backed bounded negative cache, circuit counters/state, adapter/config hot cache, and patch-candidate mirror with explicit keys, TTLs, version fingerprints, and post-commit invalidation. Redis is disposable and not the only authority for distributed commits or locks.
- Add database event replay for SSE, historical query paths for traffic/traces/metrics, sanitized service-log search, retention rules, backup/restore procedures, and secret/raw-payload redaction tests.

**Exit gate**

- Restart preserves API config, all versions, audit verification, invocation summaries, event timelines, and retained service diagnostics; concurrent commits and audit appends remain consistent.
- Failed transactions cannot report success or partially advance an active adapter pointer. Existing M5/M9, safety, rollback, audit, and settings behavior remains contract-compatible.
- DB migration/import is repeatable and verified against current files. Redis loss/eviction results in safe misses/degraded operation, never unsafe application of a cached patch.
- Readiness reports PostgreSQL/migration state; no application path silently falls back to JSON files. Secrets, request bodies, raw arguments, and auth headers are absent from DB/Redis/logs.
- Automated integration tests run against isolated database state, and a backup/restore drill succeeds.

### Milestone 2 — Complete the mutation model and deterministic request healing

Build broad, reviewable coverage before adding model-generated diagnoses.

**Work**

- Expand the mock mutation catalogue to M1–M10 from `PS01_BUILD_PLAN.md` §11 using declarative mutation data and a shared validator; keep mock-specific fixtures outside `api-server`.
- Add all three error-format emitters and test golden fixtures across applicable mutations and styles.
- Implement and test Tier 1 rules for rename, wrap/move, lossless types, headers, documented defaults, and safe enum mapping. Preserve ambiguity rejection.
- Ensure mutation metadata (`recoverable`, expected outcome, route, category, and expected operations) drives both the demo UI and benchmark rather than duplicated client lists.
- Make the mock's OpenAPI document reflect its active mutation, with explicit missing/stale-spec variants for later Tier 0 checks.

**Exit gate**

- M1–M8 recoverable request mutations heal deterministically with exact expected ops and no LLM use.
- M9 variants halt safely; ambiguous mappings do not get auto-patched; wrong caller input is not healed.
- Golden tests cover each supported error style. The M5 four-op demo remains unchanged.

### Milestone 3 — Implement response-drift safety and truth checking

**Work**

- Complete silent-200 drift detection for required logical response fields, types, formats, and configured identity echoes.
- Support only evidence-backed response-path remapping. Do not issue a replay for a write to verify a response-only change.
- Add ground-truth checks to the demo server for the affected entity and show exact differing fields in the demo client.
- Keep invalid or inconclusive remaps as visible halts with traceable evidence.

**Exit gate**

- M10 (and relevant M6 response mutations) are detected on HTTP 200; correct mapped data matches mock truth.
- No write is replayed during response-drift diagnosis.
- Incorrect/missing identity or response type fails verification without committing an adapter.

### Milestone 4 — Add cache and useful operational metrics

**Work**

- Build on the Redis client and PostgreSQL `patch_candidates` store from Milestone 1.5. Use bounded, version-aware exact-operation reuse and safe convention reuse; every candidate must be replay-verified and stale candidates fall through to normal diagnosis.
- Add cache inspection/clear APIs and durable counters. Never let cache reuse bypass provenance, risk checks, response validation, or identity checks. Redis remains a mirror/acceleration layer; verified candidate metadata survives Redis eviction in Postgres.
- Complete durable metrics from persisted events: requests/outcomes, heal rounds and duration, tier counts, cache hits, halts, token counts, and time-series buckets with retention/rollups.
- Complete trace retrieval from persisted invocation/event rows for every displayed request waterfall and document event retention/replay semantics.

**Exit gate**

- A second endpoint with a matching known convention can heal via cache with zero diagnosis rounds and a `cache.hit` event.
- A stale cache entry cannot commit and correctly falls through.
- `/metrics`, time-series, cache state, and traces return documented, bounded data; dashboard counters match server truth.

### Milestone 5 — Finish spec discovery, Tier 2, and the healed agent

Only build these after safety, response validation, and event contracts are stable.

**Work**

- Implement Tier 0 OpenAPI discovery/import and request mapping from registered specs. Use only compatible logical sources or explicit documented defaults; halt if required values have no safe source.
- Implement Tier 2 structured diagnosis behind the provider interface. Validate schema, op allowlist, evidence quotations, observed names/values, provenance, timeout, and replay before commit. The model must not provide literals or credentials.
- Implement the core tool-calling orchestrator with a hard step limit, parallel tool-call handling where safe, structured tool errors, cancellation/timeouts, and usage accounting.
- Implement OpenAPI registration/import in the API client with preview, validation errors, and a review step before registration. Keep manual tool-JSON registration available.
- Upgrade the baseline comparison so both sides use the same model/task and honest tool access; identify any remaining scripted fallback clearly.

**Exit gate**

- Ambiguous rename reaches Tier 2 and either passes evidence validation and replay or safely halts; both paths are tested.
- Tier 2 timeout and invalid output halt cleanly. No unsafe operation can be proposed by the model.
- The healed agent completes the defined M5 task without a human step; baseline behavior is measured honestly.
- Tier usage is visible in invoke metadata, metrics, traces, and the UI. Tier 0 only uses a currently available, matching spec.

### Milestone 6 — Finish both applications around real capabilities

Preserve the existing visual direction and shell. Build missing workflows and data surfaces; do not invent empty analytics.

**API client work**

- Complete `/safety` with halt reasons, circuit state, and provenance/safety decisions sourced from audit/state.
- Complete `/cache` with entries, hit rate, last use, evictions, and safe clear controls sourced from the cache API.
- Complete `/metrics` with time range, request outcomes, MTTR percentiles by tier, cache/tier mix, token usage, and benchmark history sourced from metrics endpoints.
- Finish API registration/import, per-API policy editing, tool version diff/rollback, audit export/verification, and traffic trace workflows.
- Ensure every page has honest loading, empty, offline, and error states; filters and actions work with keyboard and narrow viewports.

**Demo client work**

- Source mutation controls from `/admin/mutations`; keep baseline/healed runs separated by run ID.
- Complete truth check, safe halt (including no-write proof), per-round tier/operation timeline, cache-hit feedback, and relevant request/response diff.
- Ensure reset does not erase audit evidence needed by the tamper demonstration.

**Exit gate**

- No navigation item leads to a stub, fake counter, or nonfunctional control.
- API-client pages explain the operational consequence of their data; the demo-client communicates baseline failure, safe halt, wrong data, and successful recovery distinctly.
- Validate responsive behavior and keyboard operation against the existing viewport targets in the Phase 2 handoff.

//////////>>>>>>>>>>>>>>>>>>>>> OUT OF BOUNDS FOR NOW >>>>>>>>>>>>>>>>>>>>>>///////////
### Milestone 7 — Reproducible benchmark and end-to-end hardening

**Work**

- Build a seeded benchmark for each mutation with direct gateway mode and selected full-agent mode.
- Measure ZTAR, safe-halt rate, MTTR p50/p95 by tier, token overhead, wrong-patch rate, loops, and corrupted writes. Report failures honestly; never tune the baseline to lose.
- Add clean-start end-to-end coverage for registration, M5, M9, response drift, cache reuse/stale cache, rollback, audit tampering, and provider timeout.
- Bound event/trace/audit/UI memory paths; check timeouts, reconnect/replay, duplicate events, and teardown.
- Review URL/SSRF policy, secret redaction, log redaction, and write retry rules before release.

**Exit gate**

- One documented command produces machine-readable results and a readable table; a fixed seed reproduces outcomes.
- Corrupted writes and wrong patches are zero for the benchmark run; safe halts are reported separately from successful healing.
- End-to-end gates pass from clean temporary state; all four apps can start together.

### Milestone 8 — Release readiness and demo delivery

**Work**

- Add a preflight screen/command for core, mock, SSE, provider configuration, audit verification, and demo reset state.
- Rehearse the documented end-to-end narrative three consecutive times on the target machine/network; retain a video fallback.
- Finish README setup/run instructions, endpoint and configuration docs, limitations, architecture diagram, measured results, and `WRITEUP.md`.
- Remove stale phase claims and distinguish implemented, tested, and externally configured capabilities (especially Gemini credentials).

**Exit gate**

- A new checkout can be installed, configured, started, and demonstrated from written instructions.
- Three rehearsals complete without code edits. Backup recording plays. Release notes state known limitations and measured results.

## Execution discipline

- Keep work dependency-ordered: M0 → M1 → M1.5 persistence → M2 → M3 → M4 → M5 → M6 → M7 → M8. UI components can be prepared during backend work, but a page is complete only when its real API and error states exist.
- At each milestone, update the relevant contract, automated checks, and operator/demo behavior together.
- Prefer the smallest milestone slice that passes its gate. Do not add stretch features until all required gates through Milestone 7 are green.
- Track each gate as **not started / in progress / verified**, including the command and result. A source file existing is not a completion signal.
- Preserve the M5 path as the regression anchor throughout the build.

## Definition of complete

The app is complete when all milestones pass; PostgreSQL durably stores registry/version history, audit decisions, invocation/event logs, sanitized service diagnostics, and verified patch candidates; Redis is safely used for disposable cache/coordination; every API-client route is backed by real data and functional actions; the demo demonstrates deterministic recovery, evidence-backed escalation, safe halt, rollback, audit integrity, and response-drift truth; benchmark results are reproducible; and a clean checkout can be run and explained without relying on undocumented local state.
