# Milestone 1.5 implementation plan

## Goal and scope

Move Healr's durable state from JSON files and process-local maps to PostgreSQL, and connect Redis only as a disposable cache/fanout aid. Preserve public API behavior wherever it is safe; document any unavoidable event-cursor or pagination contract change before implementing it. PostgreSQL is the sole authority for API configuration, adapter history, audit decisions, invocation summaries, gateway events, service diagnostics, and verified patch candidates. A Redis outage or eviction must never authorize a write, erase history, or cause an unverified adapter to be used.

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
This is the implementation plan and checkpoint for the required Milestone 1.5 in `NEW_PLAN.md`. The PostgreSQL import and runtime cutover are now active; the full milestone is not complete until the remaining integration, operations, and verification gates below pass.

## Execution status

The execution pass has added pool/migration hardening, transaction and local-workspace helpers, DB-backed registry/config/version management, invocation and terminal event writes, audit routes, durable SSE replay, DB-derived metrics/traces, sanitized service-log persistence, Redis-backed transient negative/circuit state, a verified patch-candidate path, a redaction/rechain-capable file importer, sample data generation, retention, and backup/restore tooling. Migrations 0001–0006 are applied. The imported registry and audit chain are served by the active PostgreSQL-backed process on port 8000.

The importer dry run found 1 API, 1 tool, 1 version, and 137 parseable audit records. It reports a legacy chain failure at source index 136 and 91 records with evidence/value fields. Apply will preserve each source index/hash/previous hash and source file checksum as provenance, redact unsafe fields, and build a new verified PostgreSQL chain. It requires `--confirm-audit-redaction-and-rechain` plus proof that the core writer is stopped. A present audit backup is a hard stop until selected/reconciled. A `sideEffects: "none"` value in live registry data also exposed an existing contract value missing from the original DB enum; migration 0004 and the schema description now preserve it.

Latest import checkpoint (2026-10-16): import committed atomically with fingerprint `787ffd89088d0eb0803b3df58c86b5262bbcc19186ec6374b1d72c1046f9e99e`. PostgreSQL contains 1 imported API, tool, and adapter version plus 137 imported audit entries and 1 import-ledger row. Of those audit entries, 77 had 205 fields redacted; all 137 were rehashed as format v2 with source indices and hashes preserved as provenance. The original audit source chain remains marked invalid at index 136; `/audit/verify` reports the imported DB chain valid. The original files remain byte-for-byte unchanged.

On 2026-10-17 the additive data seeder wrote 1,000 sample invocations over 30 days, 2,000 durable events, and 1,000 audit entries under dataset `m15-demo-v1`. The live metrics endpoint reports 1,000 calls with DB-derived p50/p95 latency; the audit chain verifies at 1,137 entries. A custom-format backup was validated and restored into isolated database `healr_restore_m15_20261017`; that drill verified six migrations, audit chain, active pointers, row counts, and event cursor. A no-write retention preview found no rows eligible under the configured defaults. The runtime role was checked for INSERT-only audit/version permissions. Startup reconciles stale `running` invocations conservatively, transactionally recording read-only calls as failed and possible writes as outcome-uncertain.

Syntax checks, `git diff --check`, importer dry-run/apply, live readiness and DB-backed route reads, sample seeding, audit verification, runtime-grant inspection, backup/restore, and retention dry-run have been run. The test suite and fault-injection gates have not been run. Remaining gates include isolated test-database infrastructure and migration/transaction fault tests, full adapter/config Redis hot-cache behavior and cross-instance event wakeups (multi-instance remains disabled), invocation/metric retention rollups, and prior M0/M1 gates. PostgreSQL remains authoritative; patch-candidate Redis entries are treated only as mirrors and revalidated from PostgreSQL.

## Current-code facts that constrain the work

- In DB mode `features/registry/store.js` is a disposable compiled cache hydrated from PostgreSQL; startup refuses missing DB/migration state and does not load or write the JSON snapshot. The legacy file-only path remains for isolated tests without `DATABASE_URL`.
- `features/audit/index.js` retains the legacy JSONL implementation for isolated file-mode tests. In server runtime, `DATABASE_URL` is mandatory and audit reads/writes route to PostgreSQL; the legacy files are not runtime authority.
- The event bus remains an in-process notification/cache for local observers. In DB mode it writes sanitized events to PostgreSQL, and SSE polls/replays by durable decimal-string cursor with explicit reset markers.
- DB-mode trace and metrics routes read PostgreSQL; Redis backs transient negative/circuit state when configured. Verified exact patch candidates are stored after successful replay and rechecked against current adapter/schema/API/config provenance before reuse. Reuse is limited to safe GET/HEAD read operations and a failed replay falls back to diagnosis.
- In DB runtime, registration, config changes, deletes, commits, rollbacks, audit records, and domain events are grouped in PostgreSQL transactions. File-only mutation behavior remains for isolated tests without `DATABASE_URL`.
<<<<<<< HEAD
=======
=======
This is an implementation plan for the required Milestone 1.5 in `NEW_PLAN.md`. It is not a claim that the milestone is complete. The current repository has a PostgreSQL pool, migrations through version 0004, and a readiness route, but the runtime registry/audit remain file-backed and Redis has no client.

## Execution status

The initial execution pass has added pool/migration hardening, forward schema migrations through version 0005, transaction and local-workspace helpers, transaction-scoped registry/audit/invocation/event repository functions, and a read-only file-import preflight with an apply guard. Migrations 0001–0005 are applied to the configured local PostgreSQL instance. The registry, audit, invocation, and event routes have **not** been cut over; Redis is still not connected.

The preflight found an active core listener on port 8000 and changing file-backed data, so no import was attempted. The latest sample contained 119 audit records, 73 with evidence/value material that must not be copied to PostgreSQL unchanged. Import apply refuses that source pending an explicit redaction/rechain decision. A `sideEffects: "none"` value in live registry data also exposed an existing contract value missing from the original DB enum; migration 0004 and the schema description now preserve it.

Only syntax checks, migration application, and the read-only preflight have been run in this pass. The test suite has not been run.

## Current-code facts that constrain the work

- `features/registry/store.js` loads `registry.json`; malformed JSON silently becomes `{}`; `_snapshot()` swallows write errors; registration resets all prior tool history to v1; delete removes the API from the snapshot; version numbers are derived from array length.
- `features/audit/index.js` owns a JSONL chain plus a separately written head anchor. It has redaction and tamper/restore routes, but a database representation must preserve enough canonical record data to recompute existing hashes exactly.
- `features/events/bus.js` assigns process-local numeric IDs in a 500-event ring. `events/routes.js` subscribes and then replays, so a durable implementation must close the replay/live race and handle retention gaps.
- `features/events/trace-store.js`, `features/metrics/index.js`, `features/safety/circuit.js`, and `features/patch-cache/index.js` keep state in process memory; patch cache is a stub.
- API registration, rollback, audit append, and event emit are separate calls today. They do not share a transaction; some route handlers can respond successfully after a file write failure because registry snapshots are best effort.
>>>>>>> origin/main
>>>>>>> origin/main
- `invoke.js` may send upstream writes. A process/database failure after the upstream accepted a request is an outcome-uncertainty case; it must never trigger an automatic replay.
- M0/M1 product gates remain prerequisites and must be rerun at the final gate. Do not mix their unrelated closure work into persistence commits.

## Decisions to make and freeze before repository cutover

1. **API re-registration history:** retain monotonic tool version numbers across API epochs. Re-registration creates a new epoch and appends new `register` versions; it must not erase prior versions. Current file snapshots only contain the latest epoch after a re-registration, so the importer cannot recover history already discarded by the old implementation. Report that limitation in the dry-run result.
2. **Delete/re-register semantics:** deletion is soft; re-registering the same `api_id` revives the row, increments the API epoch, preserves history, and appends new versions. Repeated delete returns the existing documented not-found shape. A removed tool becomes inactive while its history remains.
<<<<<<< HEAD
3. **Audit canonical form:** preserve the full canonical record for clean, safe legacy entries. If the source chain is invalid or contains unsafe fields, explicit operator approval is required to retain source indices/hashes as provenance, redact unsafe fields, and hash a new canonical DB chain. Never present the rebuilt DB chain as verification of the old source chain.
=======
<<<<<<< HEAD
3. **Audit canonical form:** preserve the full canonical record for clean, safe legacy entries. If the source chain is invalid or contains unsafe fields, explicit operator approval is required to retain source indices/hashes as provenance, redact unsafe fields, and hash a new canonical DB chain. Never present the rebuilt DB chain as verification of the old source chain.
=======
3. **Audit canonical form:** store the complete canonical record (including legacy fields and a hash-format version) alongside query columns, so imported hashes can be reproduced exactly. Never compute legacy hashes from only the relational projection.
>>>>>>> origin/main
>>>>>>> origin/main
4. **Event cursor wire type:** use decimal-string IDs on the wire; accept legacy safe-integer numeric IDs during transition. Update both clients and `Last-Event-ID` parsing together; reject unsafe numeric values rather than silently rounding them.
5. **Invocation ambiguity:** add an explicit `outcome_uncertain` terminal state when a write may have reached upstream but durable completion failed. A stale `running` invocation is not automatically equivalent to a known failure.
6. **Single-node versus multi-node:** M1.5 guarantees a single core instance with durable restart behavior. Multi-instance mutation is out of scope until Postgres fencing leases and cross-instance coordination are implemented and tested. Redis Pub/Sub alone is not a lock; deployments with multiple replicas must fail readiness or disable healing mutations.
7. **Migration runner contract:** migrations are immutable, ordered, checksummed, and transactionally applied. Readiness fails on missing, extra, out-of-order, or checksum-drifted history. Production startup does not silently apply schema changes; deployment runs the explicit migration command before app rollout.

## Work packages and order

### WP0 — Inventory, contracts, and persistence boundary

- Define repository interfaces for API/config/tool/version/history, audit, invocations/events, service logs, patch candidates, and metrics. Add a transaction/Unit-of-Work boundary so one logical operation can pass the same transaction to registry, audit, and event repositories. Feature services must depend on those interfaces, never on SQL or `pg` objects.
- Capture current JSON shapes, endpoint statuses, event names/payloads, ordering, and UI assumptions. Include `/apis`, config patch, delete, rollback, history/diff, `/audit*`, `/events`, `/traces`, `/metrics*`, `/state`, and invoke responses.
- Define one default workspace resolver (`local`) and thread its ID through every repository call. Do not treat public API IDs as authorization.
- Specify a safe data allowlist per persisted entity. Add one shared recursive sanitizer for secrets, auth headers, cookies, provider prompts/output, raw arguments, request/response bodies, and URL query/userinfo material. Test nested objects, arrays, casing variants, and malicious values that resemble normal field names.
- Decide stable structured error codes for DB unavailable, migration mismatch, conflict/stale version, invalid imported source, persistence uncertainty, and Redis degraded. Keep response bodies free of SQL, host, credential, and filesystem details.

**Gate:** a reviewed contract map and repository interfaces exist; no feature module imports the SQL driver. Contract changes are recorded before coding.

### WP1 — Database lifecycle, migrations, schema, and isolated integration setup

- Harden the existing pool: validate PostgreSQL URL/protocol, bound pool size/connect/idle/statement timeouts, support TLS provider options, emit non-secret diagnostics, expose saturation/error metrics, and close cleanly on SIGTERM/SIGINT. Ensure concurrent pool creation/close is safe.
- Harden migrations: reject duplicate versions/names, gaps, unsupported filenames, empty migration sets, extra DB versions, drift, and edited deployed files. Use a session advisory lock and guaranteed unlock/release; ensure a failed migration rolls back and a later retry is safe. Make lock acquisition bounded. Keep checksum table bootstrap and migration transactions well-defined.
- Review the already-applied `0001_initial_schema.sql` as immutable. Do not edit it; add a forward `0002` migration for missing canonical audit JSON/hash version, API epoch/version semantics, invocation uncertainty, idempotency keys where supported, event retention metadata, audit immutability/roles, and constraints/indexes justified by actual queries. Check every FK and uniqueness constraint is workspace-scoped. Validate that URL credential rejection and credential-source-only storage are enforced at repository boundaries (not assumed from SQL types).
- Seed the stable local workspace idempotently. Never rely on `gen_random_uuid` or other server extensions without declaring/version-checking their availability; the current PostgreSQL version supports built-ins, but migration prerequisites must be explicit.
- Add a separate test database URL mechanism that refuses developer `.env` and production-looking databases. Create a uniquely named schema or database per test worker, run real migrations, isolate parallel tests, and always drop only the isolated test object in teardown. Do not use mocks as a substitute for constraint/transaction tests.
- Add migration tests for clean install, repeated no-op run, two concurrent runners, failure halfway through a migration, checksum drift, missing/extra/out-of-order versions, failed lock acquisition, connection loss, and recovery after repair.

**Gate:** clean isolated PostgreSQL migrations pass all lifecycle cases; readiness reports exact migration state without revealing connection data; pool closes without hanging.

### WP2 — Transaction-safe repositories and registry cutover

- Implement API, credential-reference, tool, adapter-version, and config repositories with typed mapping between existing camelCase contracts and SQL rows. Handle `timestamptz`, JSONB, `BIGINT`, nulls, and JSON serialization explicitly.
- Registration transaction: validate URL/schema/operation allowlist/credential references before opening a transaction; upsert API and revisions; append a version for each tool; set deferred current pointers; append audit and events in the same transaction. Reject duplicate tool names in one request, empty or malformed tool definitions, and credential values accidentally supplied in place of references.
- Config patch: validate only allowed keys; preserve omitted settings and nested healing values; increment `config_revision` only when effective config changes; bump `credential_revision` only for source-reference changes; audit and event changes atomically. A no-op patch must not spuriously invalidate all caches.
- Re-registration: increment epoch, retain old versions/history, preserve stable tool identities where possible, append new versions, and atomically update current pointers. A tool removed from the new registration must become inactive/soft-deleted without breaking its history. Roll back the whole API registration if any tool/version/audit/event fails.
- Delete: soft-delete and make list/detail/invoke behavior consistent. Historical version, audit, invocation, and event reads continue to work. Repeat delete is idempotent or returns the documented not-found response; reactivation follows the WP0 decision.
- Commit/rollback: validate and replay the candidate outside SQL transactions. In a short transaction, lock tool/current version; compare expected current version, API epoch and config revision; append exactly one immutable row; update active pointer; append audit/event; commit before returning. A stale candidate loses with a conflict and must not overwrite newer state. Rollback creates a new monotonically numbered version pointing to the selected immutable version; reject invalid, deleted, cross-tool, or future targets.
- Use a database transaction per logical mutation; do not emulate atomicity with multiple independent writes or process memory. Convert unique/FK/check violations to safe domain errors, preserve unexpected failure diagnostics only in redacted logs.
- Keep compiled adapter cache local and keyed by workspace/API/tool/version/hash. Load active tools from PostgreSQL during startup. If DB is unavailable or migrations fail, remain live only if desired but not ready; never load JSON snapshots as fallback.

**Gate:** API contracts and M5/M9 behavior match baseline; registration, settings, delete, commit, and rollback survive restart and injected transaction failures; parallel commits produce one winner and no partial version/pointer/audit/event state.

### WP3 — File importer, preflight, and one-way cutover

- Build an explicit CLI with `--dry-run`, `--apply`, and machine-readable summary. Require core writer maintenance/offline mode, lock the import source, and record SHA-256 checksums for every source file plus importer/schema version in an import ledger.
- Preflight `registry.json`: distinguish missing from empty; malformed JSON is fatal, never an empty registry. Validate API/tool shapes, duplicate names, current pointer membership, version uniqueness/order, adapter compilation, canonical adapter hashes, base URLs, credentials as references, and all timestamps. Detect secrets/raw values in registry/config/change metadata and refuse or require a reviewed redaction mapping; do not silently transform history.
- Preflight audit JSONL and head anchor independently: malformed line, duplicate/gapped index, invalid shape, hash mismatch, prev-hash mismatch, anchor ahead/behind/tampered, empty-file-with-anchor, absent anchor, trailing newline/partial final line, and backup-only data. Run current audit verification and report exact failure location. Never import a partial chain or reset it to empty.
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
- Import atomically and resumably, preserving public IDs, epochs available in source, current versions, timestamps, immutable history, and every parseable audit record. For a clean/safe audit source, preserve canonical hashes; for an explicitly approved unsafe/broken source, preserve source hashes/indices as provenance and rechain sanitized canonical records. Persist checksums and importer/schema versions in a per-source ledger so retry after process crash is idempotent; a changed source checksum must stop, not mix snapshots.
- Report irrecoverable history loss caused by the current re-registration reset. Do not invent missing versions or claim a full historical import.
- After apply, compare counts, all current pointers, adapter hashes, config after redaction, audit record count/new sequence/new head, source provenance hashes, and sample/history endpoints. Keep source files read-only and byte-identical. No automatic importer on normal server startup.
- Cutover only after preflight and import checks pass. Enable Postgres-backed routes as the only authority; remove file writes from normal paths. On DB failure return unavailable/uncertain responses, never fallback to files. Preserve files as offline backup until restore/export is proven.

**Gate:** dry run is side-effect-free; repeated apply and crash/restart resume safely; malformed and concurrently changing sources stop with originals untouched; recoverable audit forks require explicit approval and remain visible in provenance; exact checksums and a redaction/rechain report are produced.
<<<<<<< HEAD
=======
=======
- Import atomically and resumably, preserving public IDs, epochs available in source, current versions, timestamps, immutable history, canonical audit records/hashes, and head. Persist a per-source checksum ledger so retry after process crash is idempotent; a changed source checksum after partial import must stop, not mix two snapshots.
- Report irrecoverable history loss caused by the current re-registration reset. Do not invent missing versions or claim a full historical import.
- After apply, compare counts, all current pointers, adapter hashes, config after redaction, audit count/sequence/previous hashes/head, and sample/history endpoints. Keep source files read-only and byte-identical. No automatic importer on normal server startup.
- Cutover only after preflight and import checks pass. Enable Postgres-backed routes as the only authority; remove file writes from normal paths. On DB failure return unavailable/uncertain responses, never fallback to files. Preserve files as offline backup until restore/export is proven.

**Gate:** dry run is side-effect-free; repeated apply and crash/restart resume safely; corrupted and concurrently changing sources stop with originals untouched; exact checksums and a documented data-loss report are produced.
>>>>>>> origin/main
>>>>>>> origin/main

### WP4 — Audit chain in PostgreSQL

- Implement `append`, `list`, `head`, `verify`, `export`, backup/restore equivalents against PostgreSQL. Lock the workspace audit head row, allocate the next sequence, compute the legacy canonical hash, insert entry and update head in one transaction. Create/lock an empty head safely under concurrent first append.
<<<<<<< HEAD
- Preserve complete canonical records so optional fields, null/omitted fields, and timestamps survive import/export. Clean legacy records retain their source hashes; redacted/rechained records retain original hashes/indices as provenance and use the explicit imported hash format.
=======
<<<<<<< HEAD
- Preserve complete canonical records so optional fields, null/omitted fields, and timestamps survive import/export. Clean legacy records retain their source hashes; redacted/rechained records retain original hashes/indices as provenance and use the explicit imported hash format.
=======
- Preserve complete canonical records so optional fields, key order canonicalization, null/omitted fields, timestamps, and legacy hashes survive import and export. Version the hash format before any future change.
>>>>>>> origin/main
>>>>>>> origin/main
- Enforce append-only policy in DB privileges and trigger/constraint design; ordinary runtime roles cannot UPDATE/DELETE audit entries or reset heads. Tamper and restore endpoints remain explicitly development-only and must still produce a verifiable outcome.
- Concurrent append tests must prove unique contiguous sequences, no forks, one canonical head, and safe retry behavior after serialization/deadlock/connection failures. A retry must not duplicate an already committed append; use a durable idempotency key or resolve uncertain commit by query.
- Audit read/export/verify pagination and redaction must not reveal secrets. Verify detects edit, deletion, truncation, reorder, duplicate sequence, altered head, malformed canonical data, and restore mismatch.

<<<<<<< HEAD
**Gate:** the imported DB chain verifies; clean source hashes match exactly, or an approved rechain is explicitly identified with source provenance; parallel writers preserve one chain; failed append never reports success; all prior audit routes remain contract-compatible.
=======
<<<<<<< HEAD
**Gate:** the imported DB chain verifies; clean source hashes match exactly, or an approved rechain is explicitly identified with source provenance; parallel writers preserve one chain; failed append never reports success; all prior audit routes remain contract-compatible.
=======
**Gate:** imported chain verifies identically; parallel writers preserve one chain; failed append never reports success; all prior audit routes remain contract-compatible.
>>>>>>> origin/main
>>>>>>> origin/main

### WP5 — Durable invocation lifecycle, events, SSE, and traces

- Define a centralized event writer that assigns stable IDs and per-call sequence numbers in PostgreSQL, sanitizes payloads, and commits before local SSE fanout. Every event insertion must be idempotent under a known event key; distinguish legitimate duplicate requests from a retry after unknown commit outcome.
- At accepted invocation, commit a minimal sanitized `running` invocation and `call.started` before any upstream request. If this transaction fails, do not send upstream. Record invalid arguments and safe preflight halts only after input values are redacted/omitted.
- Append meaningful stages (request, diagnosis, proposal, verification, commit, cache decision, safe halt) without persisting prompts, raw arguments, request/response bodies, headers, cookies, provider output, or secret values. Do not persist heartbeats.
- Terminal transition updates invocation outcome, finish time, versions, status/error codes, metrics source fields, terminal event, and associated audit decision in the intended transaction. Add a sweeper for stuck `running` rows that marks known-safe failures versus `outcome_uncertain`; never claim an upstream write failed if its result is unknown.
- If upstream write may have succeeded but terminal DB commit fails: do not retry upstream. Return a structured non-retryable outcome-uncertain response, emit a sanitized stdout diagnostic, and leave a recoverable state for reconciliation. If upstream is read-only, retry policy may differ only where contract permits.
- SSE replay must use durable cursors, workspace filters, and cursor-based pagination. Close the subscribe/replay race by taking a DB high-water mark and replaying through it before live notifications, then deduplicate/order events; avoid missing an event committed between replay query and subscription.
- Handle malformed, negative, nonnumeric, expired, future, duplicated, and too-large `Last-Event-ID`; define explicit reset/resync response when cursor is below retention floor. Redis Pub/Sub notifications are wakeups only; on reconnect or gaps, query PostgreSQL. Reconnection across process restart must preserve cursor semantics.
- Persist trace spans from durable events or derive them deterministically; missing/partial lifecycle events must yield an explicitly incomplete trace, not a fabricated complete one. Keep payload retention and trace retention aligned.
- Maintain existing response/event fields during transition; update client parsers for string IDs and possible `reset` markers before flipping the writer.

**Gate:** restart resumes event streams and call details; race/fault-injection tests show no lost, duplicated-as-new, or reordered events; write uncertainty never auto-replays; privacy scans confirm safe persisted payloads.

### WP6 — Service diagnostics, redaction, and operations

- Keep stdout JSON as the emergency sink and add a bounded best-effort Postgres sink for lifecycle/dependency/migration/unhandled-error/security diagnostics. The DB logger must never recurse into itself, block request completion indefinitely, or mask the original error.
- Use stable codes and safe messages; scrub stack paths, URL query/userinfo, auth, tokens, provider text, request payloads, and nested secrets. Add redaction tests with mixed casing, arrays, deep objects, and encoded secrets. Log DB errors by code/class, not raw connection strings or SQL parameters.
- Bound queue/buffer memory and define whether logs are dropped on DB outage; count drops and retain stdout. Avoid logging each successful request and SSE heartbeat.
- Add retention jobs with bounded batches, vacuum/index guidance, dry-run reporting, and audit records for data-class retention actions. No silent deletion or unbounded table growth.
- Readiness checks DB connectivity and exact migration state. Redis is degraded-but-ready for single-node safe operation when only cache/fanout is affected; features relying on Redis-only coordination must be disabled. Liveness must not depend on DB. Readiness response contains no host/user/password/SQL detail.
- Graceful shutdown stops accepting new requests, drains in-flight calls within a bound, flushes safe log queue, closes Redis and pool, and does not kill a process while a commit outcome is unresolved.
- Add backup/restore runbook and actually restore into an isolated database. Verify audit chain, active pointers, API configs, event cursors, and representative historical reads after restore. Document local destructive `docker compose down -v` separately.

**Gate:** DB outage does not recurse/hang; clean shutdown/restart has no lost committed state; restore drill passes; health semantics match single-node versus multi-node guarantees.

### WP7 — Redis cache and degradation behavior

- Add Redis client via `REDIS_URL` with bounded connection/command timeouts, reconnect/backoff caps, graceful close, namespace/environment/workspace separation, and health/degraded reporting. Never block request safety on a slow Redis call.
- Implement only explicit disposable cache families: immutable adapter/config hot cache, verified patch-candidate mirror, deterministic safe negative cache, circuit counters/state where policy permits, and event wakeup Pub/Sub. Apply schema/version envelopes and TTLs; hash any key component that can contain user data or secrets.
- Cache immutable adapters under `(workspace, api, tool, version, adapter_hash)`; do not use an unversioned “current” object as authority. Config cache includes `config_revision`, `epoch`, and credential revision. On mismatch or malformed/old schema envelope, treat as miss.
- Invalidate after PostgreSQL commit, never before. Since a crash can occur between DB commit and invalidation, use versioned keys plus TTL and optional Postgres outbox/revision polling; do not rely on best-effort Pub/Sub invalidation alone.
- Patch candidate can be marked usable only after durable verified state. Every hit reruns provenance, policy, schema, risk, identity, and replay checks. Invalidated/stale candidates must miss; a Redis payload alone cannot make a candidate verified.
- Negative cache only deterministic safe halts, never caller validation errors, transient/network failures, credential rotations, policy changes, or write outcomes. Fingerprints include all relevant revisions without raw values. Invalidate on API epoch, adapter/schema, policy, credential-source changes; cap TTL and size.
- Circuit state must use atomic scripts for rolling counters/transitions and handle clock skew, expiry, simultaneous opens, half-open probe races, restart, and Redis eviction. On Redis outage choose conservative local behavior and expose degradation; do not silently reset an open safety circuit in a way that increases risk.
- Redis Pub/Sub can be lost, duplicated, reordered, or delivered during reconnect. Consumers reconcile from DB cursor. No persisted domain state depends on Pub/Sub delivery.
- Add tests for unavailable, timeout, restart, maxmemory eviction, malformed values, old envelope version, partial invalidation, reconnection, key collision/tenant isolation, and high concurrency.

**Gate:** deleting/flushing Redis changes latency only; every cache loss degrades to a safe DB read or explicit disabled feature; no secret/raw value appears in keys or payloads.

### WP8 — Durable metrics, query APIs, and client compatibility

- Make invocations/events the source for history; derive traffic, traces, and dashboard metrics from durable tables. Define each counter precisely (attempted, completed, healed, halted, rejected, cache hit) and make retries/idempotent event insertion not double-count.
- Use transactionally maintained buckets or an idempotent consumer with checkpoints; define late events, duplicate delivery, replay/rebuild, bucket boundaries/time zone (UTC), retention rollups, and gaps after raw event expiry. Never report missing/expired data as zero.
- Store mergeable latency histograms/sketches sufficient for p50/p95; do not infer percentiles from averages. Version metric bucket format. Rebuild and compare from retained source events.
- Add stable filtering, bounded page sizes, deterministic sort tie-breakers, cursor pagination, query timeouts, and indexes for list/history/event/audit/log routes. Validate invalid/overflow query parameters and avoid unbounded full-table scans/exports.
- Preserve endpoint response shape where possible. Update dashboard code to handle pagination, durable totals, partial history/retention notices, stale cursors, and string event IDs. Keep `/state` semantics consistent with durable sources.
- Prevent N+1 queries and JSONB scans without indexes. Validate representative plans and performance at expected event volume.

**Gate:** API-client and demo-client show the same state after restart as before; metric totals match source event definitions; pagination is deterministic and bounded.

### WP9 — Security roles, retention, backup, and deployment cutover

- Define migration owner and runtime role; runtime role cannot DDL or mutate immutable adapter/audit history. Audit write path has INSERT/SELECT and tightly controlled head update. Do not run app as superuser in production.
- Require TLS for remote PostgreSQL, private networking, secret-manager credentials, rotation, least-privilege Redis ACLs/TLS where remote, and no secrets in command-line logs, health, or URLs. Local Compose credentials remain development-only.
- Set explicit DB pool and statement limits relative to deployment connection budgets. Protect against connection storms on restart and long transactions. Never hold a transaction over provider or upstream requests.
- Document forward-only migrations, rollback strategy (new forward migration or restore; never auto-drop), lock timeout, backup/PITR, restore verification, retention, and operational incident steps for schema drift, corruption, disk full, pool exhaustion, Redis outage, and lost credentials.
- Cut over in a maintenance window: quiesce writes, snapshot files, preflight/import, verify, switch code/config, readiness check, representative read/write smoke, then re-enable traffic. Keep rollback to the prior app only if it cannot write conflicting state; otherwise restore/forward-repair DB. No indefinite dual writes.

**Gate:** least-privilege role checks, TLS/secret handling, backup restore, runbook and deployment rollback decisions are reviewed and demonstrated.

## Cross-cutting edge-case matrix

| Area | Cases that must be handled |
|---|---|
| Connections | Missing/malformed URL; DNS/TLS/auth failure; connect timeout; pool exhaustion; server restart; idle socket reset; statement timeout; cancellation; graceful close; leaked client/transaction. |
| Migrations | Concurrent deploys; lock timeout; checksum drift; missing/extra/gapped version; process crash before/after DDL/record insert; partially transactional DDL; no migration files; unreadable file; schema_migrations missing/corrupt. |
| Transactions | Deadlock/serialization retry; unique/FK/check violations; lost connection before commit; commit response lost after server commit; rollback error; retry duplicate; stale expected version; concurrent first workspace/head creation. |
| Import | Missing versus empty source; corrupt registry; partial final JSONL line; audit anchor mismatch/truncation; source changes during import; crash/resume; changed source on retry; secret discovery; duplicate tools/versions; unsupported legacy shape; lost old re-registration history. |
| API/versioning | Re-register with fewer/new tools; soft-deleted API; repeated delete; concurrent config and commit; no-op config; credential source rotation; version-number continuity; rollback target missing/future/cross-tool; duplicate register request. |
| Invocation | Crash before upstream; timeout while upstream is executing; upstream write applied but response lost; DB outage after upstream success; terminal event commit unknown; replay of GET versus non-idempotent write; stale running sweeper; duplicate call/idempotency key. |
| Audit/events | Concurrent append; import hash preservation; tamper/delete/reorder/truncate; duplicate event; SSE replay/live race; cursor expired/future/malformed/large; retained event gap; Pub/Sub loss/reorder/duplicate; BIGINT overflow in JS. |
| Redis | Outage, slow response, eviction, restart, reconnect, stale envelope, invalidation crash window, duplicate/malformed values, key namespace collision, clock skew, concurrent circuit transition, half-open race. |
| Privacy/ops | Deep nested secrets, case/encoding variants, URL credentials/query strings, provider output, stack paths, DB error text, log queue saturation, disk full, backup restore mismatch, retention boundary, tenant/workspace isolation. |

## Verification strategy and final exit gate

Use isolated real PostgreSQL integration tests and a disposable Redis instance. Keep unit tests for pure mapping/sanitization/canonicalization. Add fault injection around every transaction boundary and network/upstream boundary. Run prior M0/M1 gates unchanged after each major cutover and perform a clean-start four-service smoke after the persistence work.

Milestone 1.5 is complete only when all of the following hold:

- PostgreSQL is the only source of truth; no normal read/write silently falls back to JSON or process memory.
- API/config/tool/history/rollback behavior survives restart; re-registration and deletes preserve history per the frozen decisions.
- Registration/config/commit/rollback/audit terminal-event transactions are atomic and safe under concurrency and unknown commit outcomes.
- Import is explicit, dry-runnable, idempotent, verifiable, and preserves original sources; unimportable/corrupt data stops safely.
- Audit chain verifies before and after concurrency, restart, export, backup, and restore.
- Invocation/event/SSE/traces are durable and privacy-safe; no missing/duplicate/reordered event is hidden by replay.
- Redis can be flushed or unavailable without data loss or safety bypass; cache invalidation/revision edge cases are covered.
- Readiness/liveness, service logs, retention, pool behavior, shutdown, least privilege, backup/restore, and failure runbooks are demonstrated.
- Metrics and client-facing query results remain correct after restart and retention boundaries.
- M0/M1 acceptance gates and existing contracts still pass, with any event-ID wire changes explicitly versioned and supported by both clients.
