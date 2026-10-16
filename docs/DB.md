# Database and cache design

## Status and goal

This document defines the durable persistence layer for Healr. PostgreSQL and Redis local Compose services are configured. The application has a PostgreSQL driver, bounded pool, checksummed migration runner, schema through migration 0005, readiness checks, transaction helpers, DB-backed API/config/version/audit/invocation/event/metrics/log query paths, and a one-way importer. The current source now requires PostgreSQL at startup and does not load or write registry JSON in DB mode. The already-running process may still be the pre-cutover binary; restart is required to activate this source. The importer preserves every parseable legacy audit record, but if legacy hashes/indices are unsafe or secret/value fields are present, apply must be explicitly confirmed: it records source hashes/indices as provenance, removes unsafe material, and builds a new verifiable database chain. Redis provides disposable negative/circuit state and candidate-mirror primitives; the patch-candidate feature itself is not yet connected. The persistence milestone remains in progress until the imported state is verified and the running service is switched over.

The target is PostgreSQL as the durable source of truth for configuration, adapter history, invocation/event history, audit decisions, and verified patch candidates. Redis is an explicitly disposable acceleration and coordination layer. Losing Redis must never lose application history or change whether an adapter is safe to apply.

This plan is part of the completion roadmap. `docs/NEW_PLAN.md` links this design and adds the persistence milestone before feature expansion that depends on durable history, cache state, and metrics.

The implementation work packages, cutover decisions, and edge-case matrix are in [MILESTONE_1_5_PLAN.md](./MILESTONE_1_5_PLAN.md). Use that document for execution order; this document remains the data/operations design reference.

## Local services

The root [`docker-compose.yml`](../docker-compose.yml) starts PostgreSQL and Redis only; the existing Node and Next.js processes continue to run through `npm run dev` on the host.

```bash
docker compose up -d postgres redis
docker compose ps
# Apply versioned PostgreSQL schema migrations
npm run db:migrate
# After development: docker compose down
```

PostgreSQL uses `postgres:18-alpine`, the named `postgres_data` volume, and the PostgreSQL 18 volume root at `/var/lib/postgresql`. Redis uses `redis:8-alpine`, a local-only published port, a 256 MiB development cap, LRU eviction, and no persistence. The Redis volume is intentionally absent: cache loss is safe. The service tags are the requested major-version Alpine tags; pin digests for controlled production deployments.

Copy `.env.example` to `.env`. The core reads its complete database connection from one variable:

```dotenv
DATABASE_URL=postgresql://healr:healr_dev_only@127.0.0.1:5432/healr
REDIS_URL=redis://127.0.0.1:6379
```

`DATABASE_URL` is the only database connection setting the application reads. Do not add separate `DB_HOST`, `DB_PORT`, `DB_USER`, or `DB_PASSWORD` application settings. The local Compose bootstrap values (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`) configure the container; keep the URL credentials and port in sync when overriding them. The example password is for local development only. Production credentials belong in a secret manager, and the production URL should require TLS.

The checked-in example targets Node processes running on the host (`127.0.0.1`). If the core later runs as a Compose service, set the same single variable to use the Compose DNS name, for example `postgresql://healr:<password>@postgres:5432/healr`; never use `localhost` from inside the application container.

Redis has its own `REDIS_URL`, since it is a separate optional service. It must not be folded into `DATABASE_URL`.

Changing the PostgreSQL host/provider is a connection-string change when the provider speaks PostgreSQL. The application boundary will accept a URL and hide driver details behind repositories. Moving to a different SQL engine is not a URL-only switch: dialect-specific DDL, locking, JSON support, and migrations must be implemented and verified for that engine. Keep domain services unaware of driver objects so that work is localized to the repository/migration adapter.

## Ownership and invariants

1. PostgreSQL owns durable state. Redis and in-process maps are never authoritative.
2. Adapter versions and audit entries are append-only. Changes create new rows; rollback appends a version that points at the restored version.
3. An active tool points at exactly one existing adapter version. A version commit and active-version pointer update happen in one transaction.
4. API deletion is soft deletion. Historical versions, calls, events, and audit records remain queryable.
5. Every row that belongs to a workspace carries `workspace_id`; unique keys and foreign keys include it. Until authentication/multiple workspaces ships, seed and use one local default workspace. Do not pretend API IDs alone are an authorization boundary.
6. Secrets and raw credentials never enter Postgres, Redis, events, traces, or logs. Persist only credential source references and redacted evidence. Resolve secret values from the process environment or a future secret manager at request time.
7. Do not persist raw invoke arguments, request bodies, response bodies, authorization headers, cookies, or provider prompts by default. Store caller argument names/count, safe status/error codes, schema-diff metadata, timings, version IDs, and redacted evidence. Any future payload capture requires an explicit per-workspace opt-in, field allowlist, retention limit, and separate review.
8. Every durable operator-relevant outcome has an audit decision. Every UI-visible call/event is queryable from durable storage after process restart.
9. Never report a successful write/commit until its database transaction commits. On database failure, fail closed for registry mutations, audit decisions, and adapter commits. A request already sent upstream may have taken effect; return a clear persistence failure and do not retry a write automatically.
10. Redis failure can reduce performance or cross-process live fanout, but cannot bypass safety checks or make an unverified candidate eligible.

## Relational model

Use UUID primary keys for internal rows and keep existing caller-facing `apiId`, tool names, `callId`, and `runId` as text so current contracts do not change. Use `timestamptz` in UTC. Use `jsonb` for versioned domain documents where the structure intentionally evolves, while keeping lookup, ownership, status, and ordering columns relational and constrained.

### `schema_migrations`

| Column | Rule |
|---|---|
| `version` | Primary key; monotonically ordered migration identifier |
| `name` | Unique, non-empty migration name |
| `checksum` | Required digest of the applied migration contents |
| `applied_at` | Required timestamp |

Migrations are immutable after deployment. A changed migration gets a new version. Startup/readiness must fail if migrations are missing, out of order, or have checksum drift.

### `workspaces`

`id` UUID primary key; `slug` unique and non-empty; `created_at`; `updated_at`; optional `deleted_at`. Seed a stable `local` workspace for the current single-operator app. Authentication and membership tables are intentionally deferred until a real user/authentication flow is designed.

### `apis`

One row per registered API within a workspace.

| Column | Rule |
|---|---|
| `workspace_id` | Required FK to `workspaces` |
| `api_id` | Existing stable public ID; non-empty; unique within workspace |
| `base_url` | Required validated URL; reject embedded username/password |
| `spec_url` | Optional validated URL |
| `config` | JSONB for non-secret options only: healing policy, limits, identity settings |
| `epoch` | Positive integer, incremented on whole-API re-registration |
| `config_revision` | Positive integer, incremented for any policy/config mutation |
| `credential_revision` | Positive integer, incremented when credential source metadata changes; never contains a credential value |
| `created_at`, `updated_at` | Required UTC timestamps |
| `deleted_at` | Nullable soft-delete timestamp |

Primary key `(workspace_id, api_id)`. Check constraints enforce a valid epoch and object-shaped `config`. `base_url`, spec contents, credentials, and arbitrary config payloads must be sanitized before persistence. Unique live API IDs are scoped to a workspace.

### `api_credentials`

One metadata row per credential alias, not per secret value: `(workspace_id, api_id, credential_ref)` primary key; `source_kind` constrained to `env` or a future secret-manager kind; `source_ref` non-empty; timestamps. Do **not** put the resolved secret in this table. Credential changes bump a credential revision/fingerprint used to invalidate relevant cache entries without exposing the value. A future encrypted secret store requires a separate threat review and key-management design.

### `tools`

One current tool record per API tool: `(workspace_id, api_id, tool_name)` primary key; `current_version` positive; `risk` constrained to the supported risk enum; `side_effects` constrained to `read|write|none` (the existing API contract uses `none` for tools with no side effects); timestamps. Composite FK to `apis`. Add a deferred composite FK `(workspace_id, api_id, tool_name, current_version)` to the matching version row so the current pointer cannot reference a missing version.

### `adapter_versions`

Immutable adapter history.

| Column | Rule |
|---|---|
| `id` | UUID primary key |
| `workspace_id`, `api_id`, `tool_name` | Required composite FK to `tools` |
| `version` | Positive integer, unique per workspace/API/tool |
| `parent_version` | Nullable positive integer; references an earlier version of same tool |
| `rollback_of` | Nullable positive integer; references a prior version of same tool |
| `origin` | Constrained enum such as `register`, `heal`, `manual_rollback`, `watchdog_rollback`, `import` |
| `adapter` | Required JSONB object, stored as an immutable snapshot |
| `metadata` | Required JSONB object with method/path, schemas, risk/effects, identity rules; no secrets |
| `change` | Nullable JSONB object with exact operations, evidence, tier, confidence, verification, rounds and timings |
| `adapter_hash` | Required 64-character lowercase hex digest of canonical adapter JSON |
| `created_at` | Required UTC timestamp |

Unique `(workspace_id, api_id, tool_name, version)`. `parent_version` must be less than `version`; `rollback_of` must point to an existing version and cannot equal the new version. Enforce immutability through repository permissions and, where practical, a database trigger rejecting `UPDATE`/`DELETE`. Re-registration creates a new API epoch/history boundary rather than rewriting prior records; decide whether versions continue monotonically across epochs during the migration implementation and encode that choice in a constraint (recommended: monotonic history continues).

### `invocations`

One durable summary per gateway call, including success, rejection, safe halt, cache hit, timeout, and internal failure.

`call_id` text primary key; `run_id` nullable text; `workspace_id`; nullable `api_id`/`tool_name` snapshots; `started_at`; nullable `finished_at`; `outcome` constrained to `running|succeeded|healed|halted|rejected|failed|outcome_uncertain`; `initial_version` and `final_version`; `http_status`; `error_code`; `halt_reason`; `healing_mode`; `tier`; `rounds`; `duration_ms`; cache-hit boolean; token counts default zero; sanitized summary JSONB. `outcome_uncertain` means an upstream side effect may have happened but its result could not be durably recorded; it is not safe to retry automatically.

Checks require non-negative duration/rounds/token counts and `finished_at >= started_at`. Index `(workspace_id, started_at DESC)`, `(workspace_id, api_id, tool_name, started_at DESC)`, and `(workspace_id, outcome, started_at DESC)`. Do not FK invocation rows to live API rows in a way that deletes history; retain string snapshots and optionally use `ON DELETE SET NULL` on nullable surrogate references.

### `gateway_events`

Append-only durable event log backing traffic, traces, SSE replay, and operational diagnosis.

`id` BIGINT identity primary key; `event_id` unique text (existing event IDs remain compatible); `call_id` nullable FK to `invocations`; `run_id`; `workspace_id`; nullable API/tool snapshots; `event_type`; `occurred_at`; `sequence_in_call`; `payload` JSONB containing the sanitized event envelope. Unique `(call_id, sequence_in_call)` where call ID exists. Index `(workspace_id, id)` for replay, `(workspace_id, call_id, sequence_in_call)`, and `(workspace_id, event_type, occurred_at DESC)`.

The event writer assigns durable IDs/sequence numbers and commits before publishing the event to local SSE listeners. On restart, SSE `Last-Event-ID` resumes from the database; a retention floor must return an explicit reset/resync response instead of silently pretending old events exist. Redis Pub/Sub can notify other core replicas that a committed event is available, but subscribers re-read the durable event row from Postgres.

`gateway_event_cursors` stores a workspace-scoped committed high-water ID and retention floor. This separates actual retention from gaps caused by rolled-back sequence allocations, so SSE does not mistake a harmless ID gap for lost data. Wire cursors are decimal strings to avoid JavaScript `BIGINT` rounding.

### `audit_entries`

Durable, hash-chained operator and safety decisions.

`workspace_id`; `sequence` BIGINT; `recorded_at`; `decision`; nullable `call_id`; API/tool/version snapshots; `reason`; redacted `details` JSONB; `previous_hash`; `record_hash`; primary key `(workspace_id, sequence)`; unique `(workspace_id, record_hash)`.

Store the complete `canonical_record` JSONB and a positive `hash_format_version` with each row. Query columns are projections for filtering; they are not enough to reconstruct a legacy audit hash.

The canonical record hash retains the current stable JSON hashing contract (or is versioned explicitly if it changes). Append in a transaction that locks the workspace audit-head row, allocates the next sequence, computes `previous_hash` and `record_hash`, inserts the row, and updates the head. Concurrent writers must not create duplicate sequence values or forks. Verify checks sequence continuity, canonical hash, previous-hash linkage, and saved head. Tamper/restore developer routes remain disabled outside explicit development mode. Normal application roles have INSERT/SELECT but no UPDATE/DELETE permission on audit entries; administrative restore is a separate audited operation.

### `audit_heads`

`workspace_id` primary key; `last_sequence` default `-1`; nullable `last_hash`; `updated_at`. Head update and entry insert are one transaction. The empty-chain representation is a null hash and sequence `-1`.

### `patch_candidates`

Durable, verified patch-cache candidates. Only candidates that passed the complete current safety gate and replay may be marked `verified`.

`id` UUID; `workspace_id`; `cache_key` digest; `scope` constrained to `exact|convention`; source API/tool/version; source adapter/schema fingerprints; operation signature and operations JSONB; evidence class/summary JSONB; provenance requirements JSONB; state constrained to `verified|invalidated`; `verified_at`; nullable `invalidated_at`; `use_count`; `last_used_at`; created/updated timestamps. Unique `(workspace_id, cache_key)`; indexes on state/scope/use and source API/tool. No raw values, prompts, credentials, or caller payloads.

Schema/adapter/API epoch/credential revision changes invalidate affected candidates. Reuse always re-runs provenance, risk, logical/response validation, identity checks, and replay verification; cache lookup is a hint, never authorization to commit.

### `metric_buckets`

Durable aggregated metrics only, not a source for audit. `(workspace_id, bucket_start, bucket_seconds, api_id, tool_name)` key; non-negative counts for requests, successes, healed, halts, rejects, cache hits, tiers, tokens; duration histogram representation suitable for p50/p95 (mergeable histogram/sketch, not only an average); updated timestamp. Bounded retention and roll-up jobs. Rebuildable from retained `gateway_events`/`invocations` where possible; API must label a bucket unavailable if event retention has expired rather than fabricating zero.

### `service_logs`

Searchable structured service diagnostics in PostgreSQL. This is the database-backed counterpart to the current JSON-lines stdout logger; it complements, but does not replace, invocation events or the immutable audit chain.

`id` BIGINT identity primary key; `occurred_at`; `service` constrained to known service identifiers; `level` constrained to `info|warn|error|fatal`; stable `code`; safe human-readable `message`; nullable `workspace_id`, `call_id`, `run_id`, API/tool snapshots; sanitized `context` JSONB. Index `(occurred_at DESC)`, `(service, occurred_at DESC)`, `(level, occurred_at DESC)`, and correlation IDs. Do not store stack traces by default; if retained for an error, scrub filesystem paths, URLs/query values, credentials, request payloads, and provider output first. Apply a shorter retention window than audit records.

Write startup/shutdown, readiness/dependency transitions, migration/import outcomes, unhandled server errors, database/Redis degradation, and security-relevant configuration outcomes. Do not write every successful request or SSE heartbeat here; those belong in `invocations`/`gateway_events`. Emit to stdout as well for container collection. The logger must be non-recursive and best-effort when Postgres itself is unavailable: stdout remains the emergency fallback, and a logging failure must not recursively call the DB logger or mask the original error. For critical state-changing actions, the corresponding `audit_entries`/`gateway_events` transaction is authoritative and cannot be treated as best-effort.

### `heal_leases` (multi-instance coordination)

`workspace_id`, API/tool key, lease token, monotonically increasing fencing generation, `expires_at`, updated timestamp; composite primary key by target. Atomic claim/renew/release. Adapter commit checks the fencing generation and expected current version inside the commit transaction. This prevents a paused former leader from committing after lease expiry and replacement. It is introduced only when multiple core replicas are supported; current in-process lock remains adequate for the single-process milestone.

### Optional `event_outbox`

If event publication or external integrations are asynchronous, persist an outbox row in the same transaction as its domain mutation: `id`, workspace, aggregate/call ID, event type, safe payload, created/delivered timestamps, attempt count. A relay publishes after commit and marks delivered idempotently. The canonical user-visible event remains `gateway_events`; the outbox is delivery state, not a second competing event history.

## Constraints and transaction rules

### API/tool registration and configuration update

1. Validate URL, tool schema, operation allowlist, and credential references before opening a write transaction.
2. Begin transaction; upsert API config and increment epoch if replacing the full registration; upsert tool rows; insert initial adapter-version rows; set each current pointer; append a redacted registration/config audit decision; insert `config.changed`/registration event rows.
3. Commit once. Publish committed events only after commit. On any constraint/serialization failure, roll back all rows and return a structured error.
4. PATCH settings merges validated known fields; it must not replace unrelated settings or return credentials. Store config and audit/event rows in the same transaction.

### Adapter commit and rollback

1. Construct a draft in memory; validate provenance, risk, schemas, and replay outside the database transaction. Do not hold row locks while making upstream/network/model calls.
2. Begin transaction and lock the tool row (`SELECT ... FOR UPDATE`). Confirm expected current version, API epoch, and fencing generation match the values used to build/verify the draft.
3. Insert exactly one immutable `adapter_versions` row, update the tool pointer, insert audit decision and event rows, and update invocation summary atomically.
4. Commit. Only then report the new version/event as committed. A stale draft loses with a conflict and must be re-evaluated; it cannot overwrite a newer adapter.
5. Rollback inserts a new row whose adapter equals the selected historical adapter and whose `rollback_of` points to it. It never edits or deletes prior versions.

### Invocation, events, and audit timing

- On accepted invocation, insert an `invocations` row before sending to the upstream so a process crash leaves a visible `running` record that a sweeper can mark `failed/unknown` after a bounded timeout.
- Store `call.started` before publishing it. Persist each meaningful lifecycle event (round start, diagnosis result, proposal, replay, commit, cache hit, call success/failure, halt, terminal finish) as a sanitized `gateway_events` row. Keep heartbeats out of the database.
- On call completion, update the invocation summary and write the terminal event plus relevant audit decision in one transaction where they represent the same outcome. Emit to SSE only after the transaction succeeds.
- A rejected write request must never be retried solely because the database was unavailable after the upstream responded. Mark delivery/recording uncertainty clearly and use idempotency only where the upstream contract supports it.
- Request validation errors may be logged as invocation summaries with safe error codes; never store raw invalid values.
- `audit_entries` are the authoritative immutable decision history. `gateway_events` are the detailed timeline. Metrics are derived/aggregated from the latter and must not replace audit.

## Read/write matrix

| Behavior | Read point | Write point | Consistency/notes |
|---|---|---|---|
| API list/detail/config | Postgres on request; optional short Redis cache keyed by workspace/API/config revision | Registration/settings transaction | Never return credential values. Invalidate config cache after commit. |
| Active adapter/tool | Postgres at process boot and when config/version revision changes; local compiled adapter cache per version | Commit/rollback transaction updates pointer | Cache immutable version by `(workspace, api, tool, version, hash)`; pointer/revision invalidated only after transaction commit. |
| Version history/diff | Postgres, ordered by version | Append only on register/heal/rollback/import | Historical rows are immutable; APIs paginate. |
| Invocation detail/timeline | Postgres by call ID; SSE can use DB replay | Invocation insert before upstream; events append before fanout; final summary update | Safe payload allowlist; cursor-based pagination. |
| Service diagnostics | Postgres filters by time/service/level/correlation; stdout remains available to platform collectors | At startup/shutdown, migration/import, dependency-state transition, unexpected error, or security-relevant configuration event | Best-effort DB sink with non-recursive stdout fallback; never put raw request/secret material in either sink. |
| Audit list/verify/export | Postgres ordered by workspace sequence; verify hashes on request/background check | Append transaction on every defined decision | Strong consistency; audit read does not use Redis. |
| Patch candidate lookup | Redis hot candidate first, then Postgres on miss | Insert/update durable candidate only after verified replay; update use stats asynchronously/batched | Cache miss/degraded Redis falls through to Postgres. Invalid candidates cannot be applied. |
| Circuit state | Redis shared state; optionally Postgres events/audit for operator-visible transitions | Redis atomic counters/window and TTL; event/audit row only when transition/decision matters | TTL expiry; Redis outage falls back to conservative local open/closed policy and records degraded mode. No hidden safety bypass. |
| Negative diagnosis cache | Redis first, keyed by full safe input fingerprint | Redis set with bounded TTL after deterministic safe halt | Include API epoch, tool version, schema/adapter fingerprints, policy revision, credential revision; no raw secret in key. Clear/invalidate on relevant config changes. |
| Metrics | Postgres buckets for historical ranges; Redis/local counters for low-latency current view | Aggregate from committed events, batch/transactional consumer | Rebuildable; expose lag and retention. Do not count uncommitted events. |
| SSE cross-replica fanout | Postgres cursor for replay; Redis Pub/Sub notification for live wake-up | Publish only after event transaction commits | Pub/Sub is lossy; reconnect always reconciles from DB cursor. |
| Heal lock | Postgres lease table when horizontal scaling is enabled; process lock may coalesce in one replica | Atomic lease claim/renew/release; fencing generation checked on commit | Redis is not the final commit authority. Never hold a database transaction through diagnosis or upstream calls. |

## Redis key plan

Use `REDIS_URL`, a configured finite connect/command timeout, and a namespace such as `healr:<environment>:<workspace>:`. Key components that could contain user names or secrets are hashed. All keys have documented TTLs or explicit invalidation; use Redis Cluster hash tags if cluster support is later needed.

| Key family | Payload | Initial TTL/policy |
|---|---|---|
| `api:{apiId}:config:{revision}` | Sanitized API config | 60 seconds; invalidated after config commit |
| `tool:{apiId}:{tool}:v{version}:{adapterHash}` | Immutable adapter JSON/compiled-input data | 15 minutes; versioned key means old data cannot masquerade as current |
| `patch:{cacheKey}` | Pointer/compact copy of a verified Postgres candidate | 15 minutes; invalidated on schema, adapter, epoch, policy, or credential revision |
| `negative:{fingerprint}` | Safe halt code/reason only | At most 60 seconds; not for invalid caller arguments or transient upstream failures |
| `circuit:{apiId}:{tool}` / `failures:{apiId}:{tool}` | State and rolling failure counters | Open state 30 seconds; rolling window 60 seconds, updated atomically |
| `event-wakeup:{workspace}` | Notification channel, no durable payload requirement | Pub/Sub only; DB remains replay source |
| `heal-lease:{apiId}:{tool}` | Avoid as sole lock authority | Use Postgres fencing lease for multi-instance correctness |

Do not cache HTTP responses or write results by default. Cache values carry a schema/version envelope and are rejected on mismatch. Use atomic Redis scripts for rolling circuit counters and state transitions. Local Compose deliberately disables Redis persistence and configures `allkeys-lru`; if Redis is evicted/restarted, the application repopulates it from PostgreSQL or safely misses.

Redis outage behavior: timeout quickly; emit a bounded service-degraded signal; continue using Postgres for durable reads and candidate lookup; never trust malformed cache entries. If Redis is configured but circuit state cannot be read reliably, invocation stops before contacting the upstream; if Redis is intentionally unconfigured in single-core mode, the bounded local circuit is used. If no shared lease backend is available in a multi-replica deployment, readiness must fail or healing mutations must be disabled until safe coordination is restored.

## Indexing, retention, backup, and operations

- Add indexes only for documented API query shapes. Start with the indexes specified per table; inspect `EXPLAIN (ANALYZE, BUFFERS)` against representative event volumes before adding broad JSON indexes.
- Partition `gateway_events` and optionally `invocations` by month only when volume warrants it. Keep `audit_entries` unpartitioned initially so chain verification and sequencing remain simple; archival must preserve verifiable segment anchors.
- Retention must be explicit by data class: audit decisions are retained per product/security policy; event/invocation payload summaries have a configurable retention window; metric buckets have short high-resolution plus longer roll-up retention. No silent deletion. Emit retention actions to audit and retain chain checkpoints for archived audit segments.
- Production backup includes PostgreSQL base backups/WAL or managed point-in-time recovery, and periodic restore drills. Redis requires no backup. `docker compose down` preserves the named Postgres volume; `docker compose down -v` destroys local DB data and is a destructive reset.
- Use separate migration/runtime database roles in production. Runtime role gets only needed DML; audit role cannot update/delete audit rows; migration role owns DDL. Enforce TLS, private networking, secret rotation, pool caps/timeouts, statement timeouts, and observable pool saturation.
- Health is split: liveness reports process health; readiness checks Postgres connectivity and applied migrations. Redis is optional for readiness at single-node phase, but report degraded cache; in a multi-replica phase, shared coordination health becomes readiness-critical.

### Implemented local operator commands

The local stack now includes forward migration `0006_runtime_role.sql`. It creates the non-login `healr_runtime` role with table-level DML grants: audit entries are SELECT/INSERT only, adapter versions are SELECT/INSERT only, while the explicit retention and cache tables have only the writes their runtime paths need. Keep `DATABASE_URL` on a migration/owner login for `db:migrate`; production should use a separate login granted membership in `healr_runtime` and an explicit `CONNECT` grant if `PUBLIC` connect has been revoked. Local Compose may continue using its development owner login.

PostgreSQL TLS is configured with `DB_SSL_MODE=disable|require|verify-full`. `require` encrypts without certificate verification for compatibility; production should prefer `verify-full` and set `DB_SSL_CA` to the PEM trust bundle when the provider CA is not in the system trust store. These values are passed to the PG driver and never emitted in readiness/log output.

- `npm run db:seed` previews 1,000 sample calls over 30 days. `npm run db:seed -- --apply --count=1000 --days=30 --dataset=m15-demo-v1` writes deterministic, clearly marked, additive sample invocation/event/audit rows. Rerunning the same dataset resumes missing contiguous call IDs and never replaces application records.
- `npm run db:retention` previews pruning service logs older than 90 days and a prefix of gateway events older than 180 days. Add `-- --apply` to perform bounded, audited batches. Audit entries and invocation summaries are retained; event pruning advances the durable SSE retention floor. Because the wire cursor is global and monotonic, the event window is enforced as a safe ID prefix and can prune some newer rows that precede the first in-window ID.
- `npm run db:backup -- backups/name.dump` creates a custom-format PostgreSQL dump without overwriting an existing file and validates its archive list. `backups/` is gitignored.
- `npm run db:restore:drill -- backups/name.dump healr_restore_name` restores to a newly created, prefix-validated isolated database, verifies migration history, audit chain, active pointers, and event cursor, and retains that database for inspection. It refuses to reuse an existing database name.

The 2026-10-17 local restore drill used `backups/m15-drill-20261017.dump` and retained database `healr_restore_m15_20261017`; it verified six migrations, all 1,137 audit entries, 1 API/tool/version, 1,000 invocations, 2,000 events, zero invalid active pointers, and event cursor 2,000.

## Migration from current file state

Do not run file and database writers in indefinite dual-write mode. Add a one-shot, idempotent importer with a dry-run report and explicit source checksums:

1. Stop the core writer (maintenance mode) and snapshot `registry.json`, `audit.jsonl`, `audit.head.json`, and relevant backups.
2. Parse the registry; validate every tool/current pointer/version order and compute canonical adapter hashes. Do not silently replace an invalid snapshot with an empty registry.
3. Run the source audit verifier. Malformed/unparseable records stop the import. For parseable records with a broken hash/index/anchor chain or unsafe evidence/value material, require explicit `--confirm-audit-redaction-and-rechain`; preserve each source index/hash/previous hash and the file checksum in the import manifest, redact unsafe fields, and write a new sequential canonical hash chain. The original files remain byte-for-byte backups. Report source integrity and imported-chain verification separately; never imply the source chain was valid.
4. Import workspace, APIs, credential source references, tools, every adapter version, current pointers, timestamps, immutable history, and normalized audit records/head in one resumable migration run. Preserve public IDs, versions, timestamps, and every parseable audit entry. Preserve original audit indices/hashes in provenance when rechain is required.
5. Verify row counts, current adapter hashes, API config (redacted), audit head/hash/verification result, and representative history reads against the source files and import manifest. The importer can be rerun safely using source file checksums and an import ledger.
6. Switch repository reads/writes to Postgres. Keep the original files as a read-only backup until a tested restore/export procedure exists; never fall back to them automatically if Postgres fails.
7. After a successful restore drill and a documented retention period, archive/remove runtime file persistence code in a separate reviewed change.

No local state is imported implicitly on production startup. Operator runs the importer explicitly and receives a machine-readable summary.

## Implementation sequence and completion gates

1. **Connection and schema:** add PostgreSQL driver, pool lifecycle, URL validation, migration runner/lock, schema, repositories, readiness endpoint, and isolated integration-test setup. Tests must not use a developer's `.env` DB.
2. **Registry cutover:** move APIs/config, tools, immutable adapter versions, commits, rollback, and settings to transactional repositories. Preserve current REST contracts and prove restart durability.
3. **Audit and invocation log:** move audit chain and anchor into append-only tables; persist invocation/event timeline before SSE; redact all payloads; prove concurrent append has a single unbroken chain.
4. **Service logging:** persist sanitized service warnings/errors and lifecycle/dependency transitions to `service_logs`, retain stdout JSON for host collection, and verify logger fallback while Postgres is unavailable.
5. **Cache and coordination:** add `REDIS_URL` client, TTL/key conventions, candidate mirror, negative cache, circuit state, invalidation, safe degradation, and Postgres fencing leases when multi-instance support is introduced.
6. **Metrics and API-client data:** derive historical metrics/traces from durable records; paginate and filter from SQL; make dashboard counters survive restart and agree with stored events.
7. **Migration and operational proof:** idempotent file importer, backup/restore runbook, retention/partition decisions, load/restart tests, and explicit failure-injection tests.

The milestone does not pass until: no production code path treats in-memory/file snapshots as authoritative; restart preserves API config/history/audit/invocation events; commits and rollback are atomic; audit sequence/hash remains valid under concurrent writers; secrets and raw arguments do not reach DB/Redis/logs; Redis loss safely degrades; migrations and backup restore are demonstrated; and all prior M0/M1 gates still pass.

## Failure policy

- Postgres unavailable at startup: process can expose liveness, but readiness remains false and state-changing routes are not served as if empty. No silent JSON fallback.
- Postgres unavailable during a state-changing operation: return a structured service-unavailable error; do not report a version/audit success.
- Postgres unavailable after a potentially successful upstream write: do not retry that write; return an explicit outcome-recording uncertainty and reconcile if an upstream idempotency/query mechanism exists.
- Redis unavailable: bounded timeout and safe cache miss; continue durable reads. Disable any operation that would otherwise depend on missing distributed coordination.
- Migration failure/checksum mismatch: do not start ready; require an explicit forward migration or restore, never auto-drop/alter data.
