# Milestones 2–4: Serial Agent Execution Loop

This execution companion applies the dependency order in [NEW_PLAN.md](./NEW_PLAN.md). Work is serial in the shared workspace: one scoped ticket at a time, with a distinct reproduction, implementation, review, verification, and ledger update step. No milestone is complete because its code exists; each exit gate needs command output and behavioral evidence.

## Gate before starting

Milestone 1.5 is a hard prerequisite and was confirmed complete by the user for this execution. M4 work must still use its PostgreSQL/Redis repositories and preserve safe degradation; do not substitute in-memory or file-backed authority.

## Repeatable loop

1. **Coordinator:** choose one observable behavior from the work packages below; record invariant, expected external result, owner files, and acceptance command in `WALKTHROUGH.md` before editing.
2. **Reproducer:** add/adjust the smallest regression check and confirm it fails for the stated reason. For mock behavior, assert response body/status and metadata; for gateway behavior, also assert upstream count, active version, audit, and events.
3. **Implementer:** change one cohesive module boundary. Keep mock fixtures in `demo-server-and-client/server`; keep gateway independent of demo code. Update contracts and UI metadata source in the same slice when wire behavior changes.
4. **Reviewer:** inspect the diff for provenance, ambiguity, replay safety, write side effects, identity/type validation, secret exposure, durability, and M5 compatibility. Record findings and their resolution in the log.
5. **Verifier:** run focused tests, then `npm test`, then `npm run verify:p01`; run browser checks for any user-facing surface changed. Capture exact result, not a remembered claim.
6. **Coordinator:** update the evidence ledger below and `WALKTHROUGH.md`. On failure, return to the same ticket; do not relax the invariant. A milestone status changes to verified only when every row is verified.

## M2 work packages — deterministic mutation coverage

| Ticket | Observable behavior | Main ownership | Required evidence |
|---|---|---|---|
| M2.1 Catalogue | M1–M10 are declarative entries with route, category, recoverability, expected result, exact operations, and fixture/spec variants; demo controls and benchmark read `/admin/mutations` | mock mutation catalogue, demo metadata consumer | catalogue table test; no client-side duplicated mutation list |
| M2.2 Validation and error styles | Shared validator emits pydantic-v1, pydantic-v2, and problem-json forms from canonical errors; mutation-specific data contains no per-mutation formatter branches | mock validator, fixtures/contracts | golden fixtures for every applicable mutation × style; strict first-failure ordering |
| M2.3 Tier 1 deterministic rules | Rename, wrap/move, lossless types, evidence-backed headers/defaults, and safe enum casing work; ambiguous names and semantic enum changes stay unresolved | classifier, Tier 1 rules, patch safety | exact op lists, provenance/no-invention assertions, M5 four-op regression unchanged |
| M2.4 OpenAPI mutation truth | Active mutation changes the mock's OpenAPI document; missing/stale spec toggles are explicit and stable | mock OpenAPI builder/admin config | active-schema fixture tests and Tier 0-ready freshness metadata |
| M2 exit | M1–M8 deterministic recoverable cases heal with exact operations and no model; M9 halts without writes; bad caller values and ambiguous mappings do not heal | integrated | all above plus `npm test`, `npm run verify:p01`, and stage UI smoke |

## M3 work packages — response safety and truth

| Ticket | Observable behavior | Main ownership | Required evidence |
|---|---|---|---|
| M3.1 Drift proposal | Detect missing, mistyped, malformed, or moved required logical fields on HTTP 200; propose only unique evidence-backed response paths | drift detector, response schema contract | tests for missing/type/format/ambiguous fields and identity echoes |
| M3.2 Same-response verification | Re-extract, validate logical types/formats, and verify configured identities against the original payload; never replay a write | executor, patch commit, safety gate | upstream call count stays one for read and write response drift; invalid candidate never commits |
| M3.3 Mock truth | Expose truth for affected entities and return distinct drifted response shapes driven by catalogue metadata | mock routes/catalogue | truth-vs-observed tests with exact differing field paths |
| M3.4 Demo explanation | Demo displays the exact differing fields, evidence, safe halt, and truth comparison from API responses | demo client | browser smoke for M6/M10 and inconclusive identity/type cases |
| M3 exit | M10 and relevant M6 mutations detected on 200; remapped logical data equals truth; no write replay; inconclusive mappings halt without commit | integrated | focused tests, full suite, scripted acceptance, browser walkthrough |

## M4 work packages — durable cache, metrics, and traces

Start only after M1.5 repository/cache infrastructure passes.

| Ticket | Observable behavior | Main ownership | Required evidence |
|---|---|---|---|
| M4.1 Candidate repository and Redis mirror | Verified patch candidates are stored durably in PostgreSQL; Redis is a bounded version-aware mirror; exact-op and safe convention lookups validate epoch/schema/config/credential fingerprints | repository interfaces, Postgres candidate repo, Redis cache | Redis eviction/outage misses safely; stale candidate falls through; no cache entry bypasses safety, provenance, response validation, identity |
| M4.2 Reuse in executor | Second endpoint with matching convention heals with zero diagnosis rounds and `cache.hit`; candidate is inserted only after replay verification | executor/cache feature | endpoint-level reuse, stale fingerprints, failed replay and no-commit assertions |
| M4.3 Durable metrics | Derive bounded request/outcome, rounds/duration, tier, cache, halt, token counters and time buckets from persisted committed events | metrics repo/service/routes | restart-stable totals, range/limit validation, aggregation truth checked against event rows |
| M4.4 Durable traces | Reconstruct ordered, explicitly incomplete traces from invocation/event rows with cursor and retention semantics | events/trace repository/routes | restart retrieval, missing-stage incompleteness, bounded pagination, retention boundary tests |
| M4 exit | Cache inspection/clear, `/metrics`, time series, and displayed traces are documented, bounded, durable, and consistent with server event truth | API + integration | repository integration tests, cache failover/eviction, API contract tests, dashboard comparison |

## Evidence ledger

| Gate | Status | Evidence / blocker |
|---|---|---|
| M1.5 prerequisite | User-confirmed complete | Proceeding on user's explicit sequencing confirmation. |
| M2.1–2.4 catalogue, styles, rules, active OpenAPI | Implementation and automated gates pass; UI gate open | M1–M10 catalogue, three error styles, active OpenAPI, Tier 0 defaults/aliases, M1–M4/M7/M8 exact invocation tests, M5 four-op regression, and M9 no-write halt are covered. The client builds; live stage UI smoke remains open. |
| M3.1–3.2 detector and no-replay safety | Implementation and automated gates pass; UI gate open | Unique compatible `name` → `full_name` remap, nested M6, M10 write response remap, inconclusive type mismatch, and identity mismatch are covered. Drift tests assert one upstream request; invalid mappings do not commit. |
| M3.3–3.4 mock truth and demo UI | Implementation and automated gates pass; UI gate open | Mock truth retains canonical M6/M10 data and the stage client compares affected fields and reports remaps. Production build passes; live browser acceptance remains open. |
| M4.1–4.4 durable cache/metrics/traces | Not started | User confirmed M1.5 sequencing, but runtime prerequisites are absent in this checkout: no Redis client, `DATABASE_URL`/`REDIS_URL` are unset, and candidate/metrics/event routes are still stubs or process-local. M4 cannot be safely verified until these repository/cache interfaces are wired and services are available. |
| M2 exit | Automated gates pass; stage smoke open | `npm test` 108/108, `npm run verify:p01` 17/17, and demo-client production build pass. Need live stage UI smoke. |
| M3 exit | Automated server gates pass; browser smoke open | Response drift and mock truth regressions pass; need M6/M10 and safe-halt walkthrough in the stage UI. |
| M4 exit | Not started | Requires persistent stores, Redis degradation, API contracts, and durability verification. |
