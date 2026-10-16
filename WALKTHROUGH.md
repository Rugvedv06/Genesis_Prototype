# healr — Application Walkthrough

This file is the team's running guide for exercising the application. The initial section records the current baseline. **Do not rewrite or remove an earlier walkthrough after a milestone changes the app.** Append a dated milestone section at the end with new flows, expected results, test evidence, and known limitations. If an earlier step becomes obsolete, leave it intact and add a superseding note in the later section.

## How to append future walkthroughs

Use this outline for each milestone entry:

```md
## Milestone N walkthrough — YYYY-MM-DD

### What changed
### Setup and reset
### Steps
### Expected result
### Verification evidence
### Known gaps / follow-up
```

For every scenario, state which services and credentials it needs, how to reset it, what a tester should observe, and whether it was actually run. Keep automated test commands alongside the manual steps. A planned flow must be labelled **planned**, not described as a verified feature.

---

## Baseline walkthrough — current implementation

### What the app does

healr sits between an agent and an upstream HTTP API. An API owner registers a base URL and logical tool descriptions. Calls use those stable logical tool arguments. When the upstream rejects a request for a structural contract change, the core can use the observed error to propose typed adapter operations, replay the request, and commit a new adapter version only after the response validates. If it cannot make a safe, verified change, it returns a structured failure. Events, version history, and audit records make the decision inspectable.

The repository currently has four local services:

| Service | Default address | Role |
|---|---:|---|
| Core API (`api-server`) | `http://localhost:8000` | API registry, invoke/heal flow, events, versions, audit, metrics, provider health |
| Demo mock (`demo-server-and-client/server`) | `http://localhost:5001` | Fake upstream API, M5/M9 mutation controls, write ledger, truth endpoint, baseline endpoint |
| API client (`api-client`) | `http://localhost:3000` | Operator dashboard for registry, traffic, drift decisions, audit, playground, settings |
| Demo client (`demo-server-and-client/client`) | `http://localhost:3001` | M5 stage comparison between raw baseline and healr |

### 1. Prepare and start

From the repository root:

```bash
npm install
cp .env.example .env
```

Set a non-empty `TENANT_ID` in `.env`; M5 needs it to supply the mock's required `X-Tenant` header through the registered credential reference. Keep `BASELINE_MODE=scripted` for a deterministic demo that does not require a Gemini key. A real `GEMINI_API_KEY` is not required for the current M5 scripted comparison. Do not put real credentials in walkthrough output or screenshots.

Start all four services:

```bash
npm run dev
```

In a second terminal, check readiness:

```bash
curl -i http://localhost:8000/health
curl -i http://localhost:5001/health
curl -I http://localhost:3000
curl -I http://localhost:3001
```

Expected: the core and mock return JSON with `ok: true`; both Next.js clients return a successful HTTP response. If a port is already in use, stop the existing process before starting this walkthrough. Leave the dev terminal running until the walkthrough ends.

The current repo test command is:

```bash
npm test
```

At the time this baseline was written, it passed 41 tests. The separate acceptance command `npm run verify:p01` is part of Milestone 0 verification; it currently has a port-allocation harness issue and should not be reported as green until that is repaired and rerun.

### 2. Start with a clean demo state

In the demo client (`http://localhost:3001`), select **Reset**. This resets mock mutation/write state and the local comparison panels. It does not erase core audit history. The next **Run comparison** action registers/re-registers the demo API in core, replacing its tool registry with clean version 1.

Alternatively, reset the mock from a terminal:

```bash
curl -sS -X POST http://localhost:5001/admin/reset \
  -H 'content-type: application/json' -d '{}'
```

To inspect the mock before testing:

```bash
curl -sS http://localhost:5001/admin/state
curl -sS http://localhost:5001/admin/mutations
curl -sS http://localhost:5001/admin/truth/users/123
```

Expected clean state: no active mutation, no writes, M5/M9 listed, and a truth record for user `123`.

### 3. Run the primary M5 comparison in Drift Control

1. Open `http://localhost:3001`.
2. Confirm the core and mock connection indicators connect.
3. Click **Mutate API**. The demo client activates M5 on `POST /api/users/get`.
4. Click **Run comparison**. The demo client registers the `demo-users` API with the core, then runs the raw baseline and healed invocation against the same mutated mock.
5. Wait for both panels to finish and inspect the truth result and the healed-side timeline/patch view.

Expected in the current scripted mode:

- The baseline fails after its 10-iteration cap because it calls the mutated endpoint without an adapter.
- The healed call succeeds and matches `/admin/truth/users/123`.
- The core commits exactly four operations, in order: `add_header`, `move_field`, `rename_field`, `coerce_type`.
- M5 reaches the correct result after four diagnosis/replay rounds. A typical local run is under three seconds; record the measured time rather than assuming a specific value.
- The mock's write ledger remains empty for this read-only `get_user` scenario.

The baseline is scripted unless `BASELINE_MODE=gemini` is explicitly configured with a valid key. The scripted baseline is suitable for repeatable M5 UI checks, but is not evidence of a fair same-model benchmark.

Useful API checks after the comparison:

```bash
curl -sS http://localhost:8000/apis
curl -sS http://localhost:8000/apis/demo-users/tools/get_user/versions
curl -sS 'http://localhost:8000/audit?limit=20'
curl -sS http://localhost:8000/audit/verify
curl -sS http://localhost:5001/admin/state
```

Expected: the registered `get_user` has version 2 after the M5 heal; the v2 change contains the four operations; the audit chain verifies; the mock state shows M5 active and no writes.

### 4. Exercise the API client

Open `http://localhost:3000`.

#### Overview

The home page shows registered APIs, recent gateway activity, provider state, and operational counters from the core. It may initially be empty before registration. After the demo comparison, refresh or wait for the store refresh and confirm `demo-users`, recent call events, and counters appear.

#### API registry and tool history

1. Open **APIs** (`/apis`).
2. If the demo API is not present, click **Register demo API**. This submits the local mock URL and the tool definitions to `POST /apis`.
3. Open `get_user` to inspect its tool history and adapter. After M5, inspect v1 and v2 and compare the recorded change operations.
4. Use rollback only when deliberately testing history behavior; it appends a new version and does not erase existing versions.

The API client can also register a custom API from registration JSON. For a safe local test, point it at a test server, provide an accurate logical parameter/response schema, and avoid real write endpoints.

#### Playground

1. Open **Playground** (`/playground`) and select `demo-users` / `get_user`.
2. Keep arguments as a JSON object such as `{ "user_id": "123" }`.
3. In **Demo mock controls**, apply M5, then send the request.
4. Inspect the result classification, adapter version, heal rounds, tier, latency, and run ID.
5. Follow **Open in live traffic** to filter the traffic list to that run.
6. Reset the demo mock when finished.

Expected: the request succeeds with healed data after M5; the traffic stream records the call and the heal events. Tool calls marked as writes ask for confirmation before invocation.

#### Traffic and drift events

- **Live traffic** (`/traffic`) shows calls reconstructed from the core event stream. Filter by API, outcome, or run ID. Select a call to inspect its details and timeline.
- **Drift events** (`/heals`) shows persistent audit decisions such as commits, halts, proposals, and rollbacks. Select a row for its evidence and record details.

These pages can be empty before an invocation. If the event connection is offline, check `/health` on port 8000 and the configured `NEXT_PUBLIC_CORE_URL`.

#### Audit chain

1. Open **Audit chain** (`/audit`).
2. Click **Verify chain**. Confirm the UI reports the result and current head hash.
3. Use **Export NDJSON** to download the records.
4. For an explicit local tamper exercise with dev routes enabled, first ensure there is at least one audit record, then run:

   ```bash
   curl -sS -X POST http://localhost:8000/dev/tamper \
     -H 'content-type: application/json' -d '{"index":0,"mode":"edit"}'
   curl -sS http://localhost:8000/audit/verify
   curl -sS -X POST http://localhost:8000/dev/tamper/restore
   curl -sS http://localhost:8000/audit/verify
   ```

Expected: verification fails at the tampered index, restore returns it to green. This is a development-only action: do not tamper with shared or valuable audit data. Dev routes must be disabled outside local development.

#### Settings and provider status

Open **Settings** (`/settings`). Inspect core/mock/event-stream connections and provider availability. With no valid provider key, Tier 2 should be shown as unavailable; the current M5 deterministic Tier 1 path does not need Tier 2. Select the demo API to inspect or change its healing policy. Save only when deliberately testing config updates, then reload and confirm the selected API's values persisted.

### 5. Exercise the current M9 safe-halt path (API client)

The demo stage page currently focuses on M5. The API-client playground can exercise M9:

1. Ensure `demo-users` is registered with the `update_user_email` tool and its credential configuration contains only the demo `X-Tenant` mapping.
2. In Playground, select `update_user_email`.
3. Apply M9 in Demo mock controls.
4. Invoke with valid logical arguments, for example `{ "user_id": "123", "email": "dev@example.com" }`.
5. Inspect the structured error, `/admin/state`, audit page, and drift events.

Expected: the mock rejects the missing bearer credential; the gateway halts instead of guessing a credential; the response is non-retryable and no write is recorded. M9 also specifies an `approval_code` requirement, but the current missing-Authorization check may be encountered first. Do not claim that the approval-code variant has been independently verified until a test isolates it.

Reset the mock afterward. Re-register the API or use the demo-client **Reset** then **Run comparison** before returning to the M5 flow.

### 6. Reset and stop

- In Drift Control, click **Reset** to clear the mock and its local panel state. This does not clear the core audit chain.
- For API-client playground mutation checks, use its **Reset mock** control or `POST /admin/reset`.
- Stop the four dev services with `Ctrl+C` in the `npm run dev` terminal. Confirm that the processes exit before starting another run.

Avoid manually deleting `api-server/data` during a shared session; it may contain useful registry and audit history. Use isolated `HEALR_DATA_DIR` for destructive or repeatable acceptance runs.

### Current baseline limitations to remember while testing

- Only M5 and M9 are currently in the mock mutation catalogue; M1–M4 and M6–M8/M10 are not complete scenarios yet.
- The stage client is a focused M5 comparison; broader mutation controls and later observability views are planned.
- The core Tier 0 spec discovery, Tier 2 diagnoser, and orchestrator are not complete. A provider-health UI does not mean model-powered healing is available.
- API-client navigation currently includes Overview, Live traffic, Drift events, APIs, Audit chain, Playground, and Settings. Safety, Cache, and Metrics pages are planned and should not be treated as implemented.
- The acceptance harness has not yet been repaired and freshly passed. Mark a walkthrough run verified only after recording the commit, command outputs, service configuration, and any UI observations.

## Milestone walkthrough log

No milestone-specific walkthroughs have been appended yet. Add the first entry after Milestone 0 passes its acceptance gate, then add one for each milestone delivered. Preserve the baseline section above as the reference for behavior before those changes.

## Phase 0/1 acceptance run — 2026-10-16

This is the first appended milestone evidence entry; the earlier “No milestone-specific walkthroughs...” line records the state when the baseline was written and is superseded by this entry.

### What changed

The Phase 0/1 verifier now tracks and cleans up child processes, temporary data, and its retry server even when the run fails. Its test output parser accepts both the Node 22 `ℹ pass` format and the older `# pass` format. A stale AJV validator issue was fixed: re-registering the same API and tool with changed argument or response schemas now uses the new schemas, even though the registry version resets to v1. Regression tests cover both schema changes.

### Setup and reset

Run from the repository root with the local demo services stopped if their standard ports are in use:

```bash
npm run verify:p01
npm test
```

The acceptance script starts isolated core and mock processes on temporary ports, uses a temporary `HEALR_DATA_DIR`, and cleans those resources up when it exits. It requires permission to bind local ports in environments that restrict loopback listeners.

### Verification evidence

On 2026-10-16, `npm run verify:p01` passed **17/17** checks. It verified health, clean invocation, M5 healing and exact operations, persistence after restart, mock restart/re-registration, three parallel invocations, missing credential and non-lossless halts, invalid arguments, read/write retry behavior, `runId`, SSE argument redaction, scripted baseline failure, mock admin/truth endpoints, all 40 contract JSON files, and the unit suite. The run used the scripted baseline and no Gemini key.

`npm test` passed **45/45** tests. The new validator-cache regression passed both logical-argument and response-schema re-registration cases. The isolated audit test also passed secret redaction, valid-chain verification, and edit-tamper detection.

### Known gaps / follow-up

This acceptance run verifies the current Phase 0/1 scripted gates; it does not close every Milestone 1 trust requirement. The read-only trust audit found missing focused coverage for M9's separate authorization and approval-code cases, rollback/watchdog behavior, immutable history and failed-replay isolation, log-mode behavior, broader audit tamper/truncation/restore cases, and exception handling around proposal/patch compilation. M1 remains **in progress** until these gates have implementation evidence and tests. The audit also noted that most existing registry tests use the default data directory; isolate those tests before adding further persistent-state scenarios.

## M1 verification update — 2026-10-16

This entry supersedes the earlier test counts and M9/audit coverage status above. Those notes accurately reflect the earlier run; the following checks were added afterward.

### What changed

- Validator cache entries now include the logical or response schema fingerprint and the cache is capped at 256 compiled validators.
- An isolated M9 integration test independently registers an API with a missing bearer credential and another with a valid bearer credential but no `approval_code`.
- The SSE acceptance check now invokes first and reads the replay buffer by a unique `runId`, removing the intermittent live-stream start-event race while still checking that the raw argument sentinel is absent.
- Audit tests now cover saved-head detection after tail truncation and restore from backup.

### Steps and expected results

The automated M9 scenario is exercised with:

```bash
node --test api-server/test/phase1-m9-safe-halt.test.js
```

It starts isolated core and mock processes and uses a temporary data directory. The missing-Authorization call halts before reaching the mock. The missing-`approval_code` call reaches the mock once and halts; the repeated identical call uses the negative cache. Both cases leave the write ledger empty and preserve the truth email. The mock process and temporary data are cleaned up after the test.

### Verification evidence

On 2026-10-16, `npm test` passed **47/47** tests. `npm run verify:p01` passed **17/17** checks, including the revised SSE correlation check and the nested 47-test suite. The M9 focused test passed independently. `git diff --check` passed.

### Known gaps / follow-up

Milestone 1 remains **in progress**: the rollback/watchdog, immutable-history, log-mode, complete audit route/export/malformed-input, and executor exception/provenance gates still lack full evidence. The clean-start four-service browser smoke has not been performed, so Milestone 0 is not yet marked fully verified either.

## M1 watchdog recovery update — 2026-10-16

### What changed

When the development watchdog rolls back a forced bad adapter and its replay succeeds, the core now emits the terminal `call.succeeded` event. This lets traffic consumers close the call timeline after recovery.

### Verification

Run:

```bash
node --test api-server/test/phase1-watchdog.test.js
```

The isolated test registers a permissive tool with a marker argument, invokes the actual `/dev/force-bad-commit` route handler, and makes the upstream fixture return 400 only when the forced adapter has removed that marker. After automatic rollback, the parent adapter preserves it and replay returns 200. Expected evidence: success on version 3, history `[1, 2, 3]`, automatic rollback event and audit record from v2 to v3, and a `call.succeeded` event with the same call and run IDs after `patch.rolledback`.

On 2026-10-16, the focused watchdog test passed, `npm test` passed **48/48**, and `npm run verify:p01` passed **17/17**.

### Known gaps / follow-up

This verifies the forced-development rollback and recovery event path. General manual rollback and persisted-history invariants, plus enforce/log/off policy behavior, remain open under Milestone 1. Milestone 0's browser-level four-service UI smoke also remains open.

## M1 audit corruption update — 2026-10-16

### What changed

Audit verification now handles malformed JSONL, malformed or invalid-shaped head anchors, and hash-invalid records without treating them as a valid chain. Appending to a malformed or hash-invalid chain fails before changing the log. Restoring an empty valid backup clears the stale head anchor.

### Verification

Run the focused audit checks:

```bash
node --test api-server/test/phase1-audit-malformed.test.js api-server/test/phase1-audit-corruption.test.js api-server/test/phase1-audit-integrity.test.js api-server/test/phase1-trust-audit.test.js
```

Expected results include `malformed_json` / `malformed_head` verification failures, no append to a hash-invalid file, successful tail-truncation recovery from a valid backup, and a clean empty chain after restoring an empty backup. On 2026-10-16, these focused checks passed; `npm test` passed **54/54**, and `npm run verify:p01` passed **17/17**.

### Known gaps / follow-up

Audit delete-tamper, HTTP route/export parity, and malformed-backup behavior still need explicit coverage. Milestone 1 remains in progress, as does the browser-level Milestone 0 smoke.

## M1 audit routes and concurrency update — 2026-10-16

### What changed

Audit route coverage now checks listing, verification, NDJSON export parity, delete tamper detection, and restore. The Phase 0/1 acceptance concurrency check now asserts all three calls return their own IDs, share healed version 2 and its four operations, and create exactly one adapter commit.

### Verification

On 2026-10-16, the audit route regression passed, `npm test` passed **55/55**, and `npm run verify:p01` passed **17/17**. The acceptance output confirmed `singleCommit:true` and `version2:true`; the read/write retry gate confirmed two read attempts and one write attempt.

### Known gaps / follow-up

Audit malformed-backup behavior, credential/provenance leak coverage, settings/policy-mode behavior, general rollback history, and the clean-start browser walkthrough remain open. Milestones 0 and 1 are not complete until their remaining evidence gates pass.

## M1 registry ownership and M9 halt evidence — 2026-10-16

### Registry ownership checks

The registry is versioned state. Registration and commit inputs must not remain live references, and objects returned by `current`, `versions`, `version`, or `diff` must not allow callers to rewrite history. The `current().compiled` result is a facade: replacing one of its exposed methods must not alter future invocation behavior.

Run:

```bash
node --test api-server/test/phase1-registry-immutability.test.js
```

Expected result: all eight mutation attempts leave stored adapters, metadata, change records, and compiled invocation behavior unchanged.

### M9 safe halt checks

The missing-Authorization variant must stop before any upstream request. The missing-`approval_code` variant must reach the mock once, receive a 422, halt without writing, and use the negative cache on an identical repeat. Both variants emit a `halt` event and append an audit decision for every call. Repeats must complete in under 50 ms. Repairing credentials by re-registering the API must allow a new request to proceed; deleting and re-registering an API must clear the negative cache even when the payload is otherwise identical.

Run:

```bash
node --test api-server/test/phase1-m9-safe-halt.test.js
```

On 2026-10-16, the registry ownership and M9 focused tests passed (9/9 combined). The full suite passed **63/63**, `npm run verify:p01` passed **17/17**, and `git diff --check` passed before the final cache lifecycle extension; the focused suite passed again after that extension. Full gates are being rerun.

### Final verification update

The API removal path now clears negative-cache entries. The M9 test deletes and re-registers the same API, then confirms that its next call reaches the mock again. Credential fingerprinting covers every credential-backed request operation, including body fields, and the test clears inherited M9 credential variables for deterministic setup. The SSE check reads until both expected halt events arrive or its bounded timeout expires.

After these updates, `npm test` passed **63/63**, `npm run verify:p01` passed **17/17**, and `git diff --check` passed on 2026-10-16.

## M1 malformed audit-backup checks — 2026-10-16

Use this focused check when validating audit recovery behavior:

```bash
node --test api-server/test/phase1-audit-backup.test.js
```

The test creates a valid current audit chain, then tries restoring (1) malformed JSONL and (2) parseable records with an invalid hash. In both cases restore must return `false`, preserve the live audit and HEAD files byte-for-byte, and leave verification green. The focused test passed **3/3**. Full gates will be rerun with this addition.

## M1 policy, rollback, and audit-shape checks — 2026-10-16

### Policy modes

Run:

```bash
node --test api-server/test/phase1-policy-modes.test.js
```

The isolated M5 fixture verifies that `enforce` commits the adapter, `log` records a proposal without replaying or changing versions, and `off` plus `enabled: false` halt before diagnosis/replay. Disabled modes must emit `halt` with reason `healing_disabled` and write a matching audit record. The test passed.

### Manual rollback

Run:

```bash
node --test api-server/test/phase1-manual-rollback.test.js
```

After v2, rolling back to v1 appends v3 with `rollbackOf: 1`; v1 and v2 remain unchanged. The test checks the route response, event, audit record, adapter hash, and persisted history after a fresh RegistryStore loads the snapshot. The test passed.

### Corrupted JSONL record shapes

Run:

```bash
node --test api-server/test/phase1-audit-record-shape.test.js api-server/test/phase1-audit-backup.test.js
```

Records containing `null`, a scalar, or an incomplete object must make verification return `malformed_record` at the exact index. Listing keeps only the valid prefix, append rejects without changing files, and restore rejects a malformed backup without changing the current log or HEAD. These focused audit checks passed.

After adding these checks, the full suite passed **81/81**, `npm run verify:p01` passed **17/17**, and `git diff --check` passed on 2026-10-16. M0 remains open pending a clean-start four-service browser walkthrough; M1 still has broader provenance/exception and settings persistence gates.

## M1 settings persistence and provenance halt — 2026-10-16

### Settings round-trip

Run:

```bash
node --test api-server/test/phase1-settings-persistence.test.js
```

The test PATCHes mode, thresholds, rounds, tier 2, and nested healing settings; GET confirms fields merge without dropping unrelated options; a fresh RegistryStore reloads the saved values. Credential references remain in server storage but are omitted from GET/PATCH responses and `config.changed` events. The focused test passed.

### Provenance failure

Run:

```bash
node --test api-server/test/phase1-provenance-error.test.js
```

An adapter that attempts to create an outbound value without a permitted source must return HTTP 200 with `tool_unavailable` / `provenance_violation`, emit a non-retryable halt event and audit record, and leave upstream request/write counts and version history unchanged. The focused test passed.

### Policy lifecycle completion

The policy-mode test also checks that log and safety-gate halts produce terminal `heal.finished` events. Missing-credential and cached no-diagnosis halts each close with a terminal `heal.finished` event, including on repeated calls. This is covered by the expanded policy and safe-halt regressions; full gates are pending.

## M0/M1 agent-loop verification — 2026-10-16

The settings round-trip test passes and confirms API settings persist across registry reload while credential references stay server-side. The provenance regression now confirms a malformed adapter source produces a structured `provenance_violation` halt, event, and audit record without reaching the mock or changing history. Log mode, policy-gate rejection, cached M9 halts, and disabled healing all close with terminal `heal.finished` events.

Final verification for this loop iteration:

```bash
npm test
npm run verify:p01
git diff --check
```

Results on 2026-10-16: **83/83 tests passed**, **17/17 Phase 0/1 acceptance checks passed**, and `git diff --check` passed. M0 and M1 remain in progress: M0 still needs the clean-start four-service browser walkthrough; M1 still needs broader canonical audit-hash vectors, reset-and-replay rollback evidence, and UI browser acceptance. No browser automation runtime is installed in this workspace/session.

## M0/M1 agent-loop update — 2026-10-16

### Rejected credential behavior

Run:

```bash
node --test api-server/test/phase1-auth-halt.test.js
```

With a configured bearer rejected by the upstream, the call returns a structured `credential_unavailable` halt after one request. It does not retry a write or mutate adapter history. The `call.failed`, `halt`, and `heal.finished` events share one call ID, and the audit record contains no bearer value. An identical repeat is served from the negative cache without another upstream request. The focused test passed.

The concurrent heal-lock follower path now reports a failed replay through the same domain-halt lifecycle, including terminal event and audit handling. A final independent review of these lifecycle changes is in progress.

Final automated verification for this iteration:

```bash
npm test
npm run verify:p01
git diff --check
```

Results: **84/84 tests passed**, **17/17 Phase 0/1 acceptance checks passed**, and `git diff --check` passed. M0 remains open for a clean-start four-service browser walkthrough. M1 remains open for broader canonical audit-hash vectors, rollback after mock reset with a restored-adapter replay, and browser acceptance. No browser automation runtime is available in this workspace/session.

### Follower removal race

Run:

```bash
node --test api-server/test/phase1-follower-delete-halt.test.js
```

If an API is removed while a concurrent call waits for the heal leader, that follower now receives `not_registered` with a correlated `call.failed`, `halt`, and terminal `heal.finished` event plus one audit record. The regression passed.

The final full verification after this lifecycle fix passed: `npm test` **85/85**, `npm run verify:p01` **17/17**, and `git diff --check`. M0/M1 remain open for the browser and remaining trust-layer evidence described above.
# Milestones 2–4 execution log

This section records implementation progress as changes land. A milestone is marked verified only after its exit gate has been run successfully; code presence alone is not completion evidence.

## 2026-10-16 — Starting state and dependency gate

- Read `docs/NEW_PLAN.md`, `docs/MILESTONE_1_5_PLAN.md`, and `docs/DB.md`.
- Confirmed the PostgreSQL/Redis persistence cutover is still in progress in the working tree: `/ready` and migrations exist, but registry/audit remain file-backed, Redis is not connected, and invocations/events/metrics/traces are not durable. Milestones 2–4 are therefore not yet eligible to be marked complete under the documented dependency order.
- Confirmed Milestone 2 catalogue currently contains only M5 and M9; the Tier 1 enum/default rules are absent. Milestone 3 detector is a stub; response validation already detects missing logical fields but has no evidence-backed mapping path. Milestone 4 patch cache is a stub and metrics/traces remain process-local.
- Existing working-tree changes in the database foundation were present before this execution; they are being preserved.
- Next: implement independently useful M2/M3 slices, log each landed change and verification here, and keep M4 completion gated on the durable repositories/cache required by Milestone 1.5.

## M2 implementation loop — evidence-backed header defaults

- **Reproduction/requirement:** the Tier 1 header rule always requested a configured credential, even when a validator explicitly returned exactly one allowed header value. This prevented the documented M4 case (`X-API-Version: 2`) from being repaired using upstream-provided evidence.
- **Implementation:** `api-server/src/features/diagnoser/tier1-rules/header.js` now selects `error_enum` only when the error gives a singleton allowed list; multiple/absent values still require a credential source. The proposal retains the allowed values as evidence. This avoids guessing when the server lists alternatives.
- **Verification:** `node --test api-server/test/tier1.test.js` — 9/9 passed, including singleton allowed-value sourcing and rejection of ambiguous multi-value selection. Existing M5 header proposal shape remains covered.
- **Status:** this focused behavior is verified; Milestone 2 remains in progress.

## M2 implementation loop — conservative enum normalization

- Added enum normalization as its own Tier 1 rule and normalized validator enum errors with their explicit allowed values. It only maps an input to a unique case-only variant in that list; semantic mappings such as `active` → `ENABLED` remain unresolved and cannot be guessed.
- Added focused tests for enum error normalization, safe case mapping, and refusal of semantic guessing.
- Verification: `node --test api-server/test/tier1.test.js` — **10/10 passed**.
- Status: this rule is verified in isolation. Full mutation catalogue, golden error-style matrix, and end-to-end healing remain open for Milestone 2.

## M3 implementation loop — silent response drift

- Replaced the drift-detector stub with a response-only detector. It compares required logical response fields against the observed payload, accepts only a unique name-compatible path with matching type/format, and refuses ambiguous or incompatible mappings.
- Wired the detector into invocation handling after a successful HTTP response. It validates the remapped logical object and configured identity echoes against the same response, commits only the response map, emits `drift.silent`/verification/commit events, and never sends a replay request. Inconclusive 200 responses halt with field evidence.
- Added regression coverage for a unique `name` → `full_name` remap and an inconclusive type mismatch. Both assert exactly one upstream request; the successful case asserts version 2 and correct logical data.
- Added an identity-echo mismatch case. It proves that a plausible field remap does not commit when the returned entity ID differs from the caller's ID. Response drift halts also emit the terminal failure lifecycle events.
- Updated the demo timeline and patch card to display `remap_response_path`, the differing logical fields, and the same-response verification/no-replay outcome from the real events.
- Verification: `node --test api-server/test/response-validation.test.js` — **4/4 passed**; `npm --workspace=@healr/demo-client run build` succeeded; `git diff --check` passed.
- Status: core server path is verified in isolation. Ground-truth comparison and demo-client display of exact differing fields remain open; Milestone 3 is not yet complete.

## Execution loop and current gate ledger

- Added `docs/MILESTONE_2_4_AGENT_LOOP.md` with a serial reproduction → implementation → review → verification loop, scoped M2–M4 work packages, required safety invariants, commands, and an evidence ledger.
- The loop records Milestone 1.5 as a prerequisite for durable cache/metrics/traces. Current M1.5 cutover is not verified, so M4 remains gated; no in-memory substitute is presented as durable completion.
- Current M2/M3 focused items above are in progress; their full milestone gates are still open. M4 is not started pending the database/Redis gate.
- Latest integration verification after the M2/M3 code changes: `npm test` — **90/90 passed**; `npm run verify:p01` — **17/17 passed**; `git diff --check` passed. Acceptance includes M5's exact four operations, restart persistence in the existing store, concurrency, credentials, retry policy, no-raw-args SSE, and baseline failure. This keeps the M5 regression anchor green; it does not close the M1.5 or M2–M4 gates.

## M3 demo mutation fixtures

- Added mock catalogue entries for M6 (nested response name) and M10 (renamed response field), expressed as response path operations. `/admin/mutations` now returns each mutation's expected operations and derives recoverability from its declared expected outcome.
- The mock applies response operations through one shared transformer, leaving the truth record unchanged. The core remains independent of mock implementation details.
- The demo now loads mutation choices from `/admin/mutations`, so M6/M10 can be selected without a duplicated client-side catalogue.
- Focused mock verification: `npm --workspace=@healr/demo-server test` — **8/8 passed**, including response mutation isolation and catalogue metadata. Full M6/M10 gateway and truth UI acceptance remains pending.

## Resume — user confirmed Milestone 1.5 complete

- User confirmed M1.5 is complete and instructed me to proceed with the M2–M4 loop. I’m accepting that as the sequencing decision and continuing without reopening M1.5 work.
- Repository note: `docs/MILESTONE_1_5_PLAN.md` and runtime source still describe unfinished Postgres cutover/Redis wiring. I’ll verify M4 against the actual available interfaces before claiming durable cache behavior.
- Starting M2.1: expand the mock mutation catalogue and shared error-style emission. Existing M5/M6/M9/M10 paths remain the regression anchors.

### M2.1 catalogue expansion

- Added declarative mutation entries M1–M4 and M7–M8, completing catalogue IDs M1–M10 alongside existing M5/M6/M9/M10. Each entry includes category, route, expected outcome, and expected operations; response changes remain shared path operations.
- Added a shared validator error-style emitter for pydantic-v1, pydantic-v2, and problem-json. It translates canonical errors while omitting raw caller input; unknown styles are rejected.
- Added a mock OpenAPI builder that derives request/response schemas from the active mutation, including M7's explicit region default and M8's documented enum aliases. It marks the active mutation in a stable extension field.
- Connected admin error-style selection and spec availability/staleness controls to the mock routes and OpenAPI endpoint. Request validation now emits the selected format without including raw caller input.
- Implemented a bounded, timeout-limited Tier 0 OpenAPI fetch for explicit defaults and declared enum aliases. It rejects stale/unavailable/oversized/invalid specs and does not propose values absent from the current operation schema. Added pydantic-v2 `int_type` normalization.
- Initial syntax and focused regression checks pass: `node --check` for the mock server/catalogue and Tier 0 module; `node --test demo-server-and-client/server/test/validator.test.js api-server/test/tier1.test.js` — **18/18 passed**. Dedicated Tier 0/default and style-matrix assertions are next.
- Added mutation-level canonical error assertions for M1–M4/M7/M8, a three-style translation/no-raw-value check, and active OpenAPI default/enum metadata checks. `node --test demo-server-and-client/server/test/validator.test.js` — **11/11 passed**.
- Tier 0 focused coverage now verifies documented default sourcing, explicit enum aliases, stale-spec rejection, and no default guessing. `node --test api-server/test/tier0-spec.test.js` — **3/3 passed**.
- Extended the stage registration with a status tool and made baseline/healed runs select the tool and safe fixture arguments from mutation route metadata, enabling M8/M9 as well as read mutations through the same run flow.
- Expanded the truth check to compare the affected logical fields (including status) and seed the mock's task-value provenance ledger before a run. The mock truth endpoint now reports status from its write ledger.
- Combined focused verification after these changes: Tier 0, Tier 1, response validation, and mock validator tests passed **28/28**; mock server/OpenAPI syntax checks passed; demo-client production build succeeded.
- Hardened Tier 0 response reading to enforce the 1 MB cap while streaming, including when the upstream omits `Content-Length`.
- Next verification layer: exercise M1–M4/M7/M8 through the gateway invoke loop with deterministic upstream responses, asserting exact operations, version commits, and Tier 0/Tier 1 attribution.
- The first mutation-loop run exposed M1 being misclassified as a wrap because wrap preceded rename. Updated wrap to defer similar missing/extra names to rename; M1 and M3 now both pass exact-operation assertions. Focused mutation + Tier 1 tests pass **16/16**.
- Mutation listing now returns numerically sorted M1–M10 entries for predictable selection in the stage client.
- Preserved M9's distinct 401 auth halt in the shared header validator while keeping missing required body fields as 422.
- Added M9 variant checks across all three error styles: missing bearer auth remains 401, and configured auth followed by missing approval code remains 422. Mock validator suite now passes **12/12**.
- M9's active OpenAPI entry now describes both the required Authorization header and non-derivable `approval_code` variant.
- Added a cross-product assertion that M1–M5 and M7–M9 retain the same classifier outcome across pydantic-v1, pydantic-v2, and problem-json. Mock validator suite now passes **13/13**.
- The gateway mutation matrix then passed after isolating audit/registry data per test file: M1/M2/M3/M4/M7/M8 heal with their exact operation and expected Tier 0/1; response, spec, and mock format checks also pass. Combined focused command passed **26/26**.
- Added M6 same-response remap coverage plus a write-side response-drift case asserting exactly one POST, correct logical data, and one committed adapter version. `node --test api-server/test/response-validation.test.js` passes **6/6**.
- Focused validation and metadata tests are being added before claiming this package verified. M7 still needs a spec-backed default path; M8 semantic aliases need explicit spec evidence and must not be guessed.
- Integrated checks after adding M6/M10 selection: elevated `npm test` — **92/92 passed**; `npm --workspace=@healr/demo-client run build` succeeded; elevated `npm run verify:p01` — **17/17 passed**; `git diff --check` passed. Sandboxed runs intermittently cannot bind test ports (`EPERM` / `could not find free port`); elevated reruns pass.
- Full-suite rerun exposed a repeatable audit hash mismatch in the legacy M5 test (`api-server/test/heal.test.js`); the new focused tests isolate their data, but this legacy test still uses the repository's default `api-server/data` store, which makes it sensitive to persisted/stale test state. I’m isolating that test fixture before taking the M2/M3 full-suite gate again.
- Isolated the legacy M5 golden test in its own temporary data directory before importing the runtime modules. This removes dependence on stale or concurrently-mutated `api-server/data` while preserving the exact four-operation assertions. After the fix, `npm test` passes **108/108**, `npm run verify:p01` passes **17/17**, and `npm --workspace=@healr/demo-client run build` succeeds.
- Updated the evidence ledger: M2 and M3 automated server/mock gates pass, while live stage/browser walkthrough remains open. No browser automation runtime is available in this workspace/session.
- M4 implementation check: the checked-in plan and runtime show no Redis client, `DATABASE_URL` and `REDIS_URL` are unset in this session, and `/metrics`, traces, and patch cache are still process-local/stubs. The available PostgreSQL repositories are not connected to the runtime. These are concrete prerequisite/runtime gaps; I have not represented M4 as implemented or durable.
- M4.1 storage slice started: added the official Redis client package, started the documented local PostgreSQL/Redis Compose services, and applied the existing five migrations to the local development database. I’m implementing the candidate repository and bounded Redis mirror as the first isolated unit; runtime healing integration and durable operational views remain separate gates.

## 2026-10-17 — M4.1 exact candidate repository facade

### Loop ticket and invariant

- **Observable behavior:** patch-candidate learning, lookup, invalidation, and inspection have one feature boundary backed by PostgreSQL; Redis is only a bounded hint. A Redis hit cannot authorize reuse without a current PostgreSQL match and later safety/provenance/replay checks.
- **Owner files:** `api-server/src/features/patch-cache/index.js`, `api-server/src/features/executor/invoke.js`, `api-server/src/db/registry-service.js`, and `api-server/src/db/patch-candidate-repository.js`.
- **Acceptance command:** `node --test api-server/test/patch-candidate-repository.test.js`; local prerequisite probe for the PostgreSQL candidate table and Redis readiness; `git diff --check`.

### What changed

- Replaced the unused patch-cache feature stubs with `learn`, `find`, `invalidate`, and bounded `candidates` operations. The executor now consumes the feature boundary; its existing candidate path still requires exact-scope identity, matching API epoch/config/credential revisions, permitted read-only replay, current safety checks, successful logical response validation, and identity echoes before commit.
- Updated the repository test fixture to match the persisted record contract: a SHA-256 operation signature, replay-verified evidence, and explicit GET/epoch/config provenance. Fixed its SQL-call index assertion to account for the workspace lookup performed by invalidation.
- **Reproduction:** the pre-existing repository test fixture did not satisfy the repository's current validation contract and the invalidation assertion pointed at the workspace query. After aligning the fixture and assertion, all focused checks pass.

### Setup and verification evidence

- `.env` provides local `DATABASE_URL` and `REDIS_URL`. The earlier M4 check above saying they were unset is superseded; it recorded the environment before the local stack configuration was loaded.
- `docker compose ps` reported PostgreSQL and Redis **healthy**. A read-only Node probe confirmed `public.patch_candidates` exists and the Redis mirror reports `{ configured: true, ready: true, degraded: false }`. The first sandboxed socket probe returned `EPERM`; the same read-only probe passed when rerun with local-service access.
- `node --test api-server/test/patch-candidate-repository.test.js` — **3/3 passed**. `git diff --check` passed.

### Known gaps / next loop step

- The candidate-store unit test uses a queryable stub; the real PostgreSQL insert/find/use-count/list/invalidate and stale Redis mirror-repair behavior are covered by the integration probe below. Manual Redis outage simulation is also covered below; an automated outage regression and cache reuse through the gateway remain unverified. M4.1/M4.2 remain open. Next: add executor-level candidate reuse evidence before moving on to durable metrics/traces.

### Review correction — credential revision fence

- The independent M4.1 review found that `credential_revision` is tracked separately by PostgreSQL but was absent from exact candidate identity and provenance. Added it to the DB-backed registry snapshot/current tool, candidate cache key, persisted provenance requirements, and replay-time check. A candidate without this revision is now rejected by repository validation. This revision tracks credential mapping changes; secret values themselves are never stored in the candidate.
- Focused repository verification after the correction: `node --test api-server/test/patch-candidate-repository.test.js` — **3/3 passed**; `node --check` for the executor and registry repository passed; `git diff --check` passed. The test asserts that missing credential revision is rejected.
- A real-service integration probe then inserted a uniquely keyed candidate, found it through PostgreSQL, checked `use_count = 1`, listed it, invalidated it, and confirmed the Redis mirror was removed. Before lookup, the Redis value was deliberately given a stale operation signature/source version; lookup still returned the PostgreSQL operations and repaired the mirror from the durable row. Probe output: `postgresInsertFindUseCountListInvalidate: passed`, `staleMirrorCouldNotOverridePostgres: true`. Its temporary row and mirror key were cleaned up.
- Redis outage simulation used an unused local port. Candidate learning and lookup still succeeded through PostgreSQL, while mirror status reported `ready: false` and `degraded: true`; the uniquely keyed row was removed afterward. Probe output: `redisUnavailable: true`, `postgresqlLookupSucceeded: true`, `mirrorDegraded: true`.
- The first form of this probe asserted `use_count` on the returned candidate object, which does not expose that column; the assertion was corrected to query the counter directly. The rerun passed. The independent review finding is resolved and exercised for the candidate repository path.
- Combined focused regression command `DATABASE_URL= REDIS_URL= node --test api-server/test/heal.test.js api-server/test/mutation-healing.test.js api-server/test/patch-candidate-repository.test.js api-server/test/response-validation.test.js` passed **17/17**.

### Loop review and remaining gaps

- Read-only reviewer verdict: Redis remains a hint, outages degrade to misses, and the executor still reapplies safety, compiles, replays safe reads, validates the logical response/identity, and version-fences the commit. The `credential_revision` omission was fixed as above.
- Follow-up review found the existing exact candidate is not a steady-state reuse path: its key includes the source API/tool, pre-heal adapter fingerprint, epoch/config/credential revisions, and original error signature. A successful heal changes the adapter; ordinary later calls then succeed before cache lookup. Exact scope therefore cannot enable a second endpoint to reuse it. Preserve exact lookup for compatible exact identity, but add a separate narrow convention candidate for the intended cross-endpoint case.
- Full-suite status: `DATABASE_URL= REDIS_URL= npm test` passed **108/111**. The three failures are the M9 safe-halt, policy-mode, and provenance integration tests; each starts `api-server/src/server.js` without `DATABASE_URL`, and the M1.5 runtime now intentionally refuses to start without PostgreSQL. The other 108 tests passed. Running `npm test` with `.env` values enabled also selects DB-authoritative registry behavior in legacy file-mode unit tests, so that is not a valid mixed-mode invocation. `npm run verify:p01` was not run against the shared local DB: its harness isolates only `HEALR_DATA_DIR`, not PostgreSQL, and could leave registered test data behind. The acceptance harness needs the M1.5 isolated-DB update before that gate is safe and meaningful.
- Convention-scope lookup, automated Redis outage regression coverage, gateway-level cross-endpoint reuse, and failed-replay fallback remain open. M4.1/M4.2 are not complete. Next loop ticket: define a narrow canonical failure/schema/mapping signature for compatible GET/read endpoints; validate destination epoch/config/credential revisions; and require destination safety checks plus replay, response, and identity validation before commit. Reproduce with two equivalent registered GET endpoints and assert the second diagnosis is skipped, only one safe replay occurs, the source remains unchanged, and stale/ambiguous/unsafe cases miss. Run the full M2–M4 integration gates after the M1.5 acceptance harness has isolated PostgreSQL state.

## M4.2 loop ticket — convention candidate reuse

### Observable behavior and safety invariant

- Two distinct registered GET/read endpoints with compatible logical schemas and a canonical matching validator failure can reuse a replay-verified repair. The second endpoint emits `cache.hit`, skips diagnosis, performs one safe replay, validates logical response and identity, and commits its own adapter version.
- Candidate operations apply to the destination's current adapter only after destination epoch, config revision, credential revision, logical schema, and compatibility checks. The safety gate and replay remain mandatory. Writes, ambiguous matches, failed replay, stale fingerprints, or incompatible identity must miss and continue ordinary diagnosis or halt without a cache commit.

### Coordinator plan

- **Owner files:** `api-server/src/features/executor/invoke.js`, `api-server/src/features/patch-cache/index.js`, `api-server/src/db/patch-candidate-repository.js`, `api-server/src/db/registry-service.js`, plus focused cache and gateway integration tests.
- **Reproducer:** add the smallest two-endpoint gateway case. First endpoint diagnoses, replay-verifies, commits, and stores a convention candidate; the second returns the same canonical failure and must currently diagnose again (reproduction failure), with request counts and adapter versions recorded.
- **Acceptance:** exact cache event, zero diagnosis rounds for endpoint two, one destination replay, durable target commit, unchanged source truth, and safe misses for mismatched schema/config and failed identity replay. Keep the convention key restricted to structural validation failures and safe read methods. Run the focused isolated-database test, full `npm test`, and `npm run verify:p01` once the acceptance harness uses isolated PostgreSQL state.
- No implementation changes for M4.2 have been made yet. Independent read-only design and test-harness reviews are in progress.

### Independent review findings — convention key safety

- The implementation review identified two fail-open cases before M4.2 can be accepted: an empty identity contract makes identity comparison vacuously pass, and the convention key collapses distinct validator requirements that share only `kind` and `path`.
- **Invariant / expected result:** convention candidates are learned and reused only when a non-empty, well-formed identity mapping exists. Their key includes bounded validator subtype plus normalized expected/allowed contract values, and refuses unsupported or unbounded metadata. Different expected types or enum/allowed contracts must miss. Exact-scope lookup remains unchanged.
- **Owner files:** `api-server/src/features/executor/invoke.js`, `api-server/test/m4-cache-reuse.integration.test.js`.
- **Reproducer/acceptance:** add isolated PostgreSQL cases for missing identity and same-path/same-kind failures with different validator subtype. The former must not learn/reuse convention candidates; the latter must diagnose rather than hit. Preserve positive reuse, schema mismatch, disabled mode, and failed-identity replay assertions.
- **Reviewer follow-up:** independently inspect these guards and their tests, then run the isolated M4.2 integration and focused executor/cache tests. GET path-placeholder and destination revision-race coverage remain follow-up gaps and must stay listed as open evidence.
- **Follow-up review finding:** a syntactically valid but optional identity mapping can still compare equal when both caller and extracted values are absent, because the shared comparator stringifies `undefined`. The validator error list also needs a count bound before normalization.
- **Invariant / expected result:** configured identity comparisons require present, non-null scalar values on both sides; missing values fail verification and cannot commit. Convention normalization safe-misses when the validator supplies more than 16 structural errors.
- **Acceptance:** add isolated regressions for the optional identity omission (no candidate hit or commit) and bounded error count; rerun isolated integration and focused regression suite, then request independent review again.
- **Final review coverage note:** the first optional-identity test changed the logical schema, so it safe-missed by fingerprint before exercising candidate replay. Strengthen it with a same-schema source that learns the candidate while the optional identity is present, then a destination that omits that value; assert replay rejection, ordinary diagnosis, and no commit.
- **Final review proof requirement:** absence of `cache.hit` alone cannot distinguish replay rejection from lookup miss. Assert the destination's three upstream calls (original failure, candidate replay, ordinary diagnosis replay), proving the cached candidate was actually attempted before the halt.

### M4.2 implementation and verification result

- Convention fingerprints now include bounded validator subtype, expected/allowed values, structural kind/path, adapter and logical/response contracts. Unsupported values and error lists over 16 items safe-miss. Convention learning/use requires a nonempty well-formed identity map, and shared identity verification rejects absent, null, or nonscalar values before comparison.
- The PostgreSQL-isolated integration passes **1/1**. It verifies matching cross-endpoint reuse (`cache.hit`, zero diagnosis rounds, one corrected destination replay, durable target commit), schema and validator subtype mismatch misses, empty-identity miss, optional identity omission after a proven candidate replay (three destination requests, no commit), disabled healing, failed identity replay fallback, and persisted cache-hit event. The isolated DB and Redis namespace are cleaned up by the test.
- Focused Tier 1, mutation-healing, and candidate repository regressions pass **21/21**. The independent reviewer found no remaining blocker and confirmed the three-request assertion proves the optional identity candidate replay was attempted before ordinary diagnosis. `git diff --check` passes for the M4.2-owned files; a repository-wide check still reports one pre-existing trailing space in `docs/PHASE1_WALKTHROUGH.md:301`, outside this slice.
- Full verification remains blocked by existing harness requirements: elevated `DATABASE_URL= REDIS_URL= npm test` completed with **110 passed, 3 failed, 1 skipped**. The three M9 safe-halt, policy-mode, and provenance tests launch server subprocesses that exit before health because M1.5 now requires PostgreSQL; the focused DB-backed M4.2 test is intentionally skipped by this blank-DB suite and passed separately above. Running without blank DB variables mixes `.env` PostgreSQL mode into file-mode unit tests and produces unrelated registry-transaction failures.
- `DATABASE_URL= REDIS_URL= npm run verify:p01` was attempted with localhost access and stopped at the same documented M1.5 guard: `api-server/src/server.js` requires `DATABASE_URL`. It did not connect to or modify the shared database. The verifier must provision an isolated PostgreSQL database before this gate can run safely.
- Remaining M4.2 evidence: GET path-placeholder regression, destination epoch/config/credential race fencing, automated Redis outage regression, and full-suite/Phase 0/1 acceptance through an isolated-PostgreSQL harness. M4 remains in progress; no deployment or installation is claimed.

## M2 exit audit — catalogue HTTP contract regression

### Coordinator ticket and invariant

- **Observable behavior:** `GET /admin/mutations` exposes the complete ordered M1–M10 catalogue with each entry's id, label, route, category, recoverability, expected result, and exact expected operation metadata. Recoverability agrees with the declared expected outcome, M9 stays the only halt entry, and response mutations retain their structured response-path operation details.
- **Reason for ticket:** independent loop audit found the catalogue table itself was not tested through its public admin route. M2 exit remains open until this contract is exercised alongside remaining M2 coverage and UI gates.
- **Owner file:** `demo-server-and-client/server/test/` catalogue/admin route integration test, plus `WALKTHROUGH.md`.
- **Reproducer acceptance:** the test starts an isolated mock server on a temporary port and asserts exact IDs, required metadata, operation shapes, recoverability semantics, and response-mutation operation payloads from the HTTP response. First run must fail for the missing test before implementation changes.
- **Verification after this ticket:** focused mock-server tests; then proceed serially to the style-matrix/first-failure ticket, active-spec-toggle ticket, and full M2 gates. Do not mark M2 verified until full automated gates and stage UI smoke have fresh evidence.

### M2.1 review follow-up — declarative fixtures and spec variants

- **Invariant:** each M1–M10 catalogue record exposes bounded demo fixture args and active/stale/unavailable OpenAPI variant descriptors through `/admin/mutations`; the demo client selects invocation args from that metadata rather than inferring them from a route. The mock still generates the OpenAPI document from server-side mutation state.
- **Owner files:** mock mutation catalogue and `/admin/mutations` projection, demo client mutation selection, catalogue route integration test.
- **Reproducer acceptance:** extend the isolated HTTP test to assert every fixture and spec-variant descriptor, including M9's `update-email` args and M7/M8 active spec notes; build the demo client.
- **Implementation:** M1–M10 declare bounded `fixture.args` and generic active/stale/unavailable `specVariants`. `/admin/mutations` returns both fields, and the demo client reads selected invocation args from `activeMutation.fixture.args`; OpenAPI generation remains in the mock server and is the source of M7/M8 schema truth.
- **Verification:** the catalogue route and validator tests passed **14/14**; the demo-client production build completed successfully. The refined route-state assertions passed **1/1**. One test attempt hit a transient `EPERM` during ephemeral port allocation; immediate rerun passed. `git diff --check` passed.
- **Independent review:** fixture arguments have one production source in the catalogue; M7/M8 spec truth remains in `buildOpenApi`; exact toggle states and fixture values are checked through HTTP. Review found no blocker.

## M2.2 loop ticket — golden error-style matrix and validation order

### Coordinator invariant and acceptance

- **Observable behavior:** each applicable request mutation emits the same canonical validation result in pydantic-v1, pydantic-v2, and problem-json styles, while only documented wire fields/types differ. Required headers are reported before body validation; M5 body validation reports only its first failing layer; M9 authentication is reported before approval-code validation.
- **Owner files:** `demo-server-and-client/server/test/validator.test.js`; only change the shared validator if the table exposes a real discrepancy.
- **Reproducer:** add a table-driven golden covering M1–M5, M7–M9 and each applicable error stage across all three styles. Assert exact status/title/type/path/context/order, and canonical normalization equality across styles. Include privacy assertion that caller values never appear in errors.
- **Acceptance command:** `node --test demo-server-and-client/server/test/validator.test.js`; then continue serially to M2.4 missing/stale OpenAPI HTTP behavior. Keep M6/M10 out of request-error cases because they are successful response mutations; their active schema behavior is covered in M3.
- **Review correction:** treat `specVariants` as toggle-state descriptors (`active`, `stale`, `unavailable`), not duplicated active OpenAPI content. The generated OpenAPI remains the source of truth for M7's default and M8's enum aliases. Assert exact state booleans: active `(specAvailable:true, specStale:false)`, stale `(true,true)`, unavailable `(false,false)`; remove active descriptions that repeat generated spec facts.
- **Acceptance:** the catalogue route test checks exact variant state and order for every row, while existing OpenAPI tests continue asserting M7 default/M8 aliases. Then rerun focused route/mock tests and the client build.

### M2.2 reproduction and resolution

- Added a table-driven golden over M1–M5, M7, and both M9 stages across pydantic-v1, pydantic-v2, and problem-json. It checks exact status/body, parsed canonical equality, M5 header-before-body and first-failing-layer order, M9 authorization-before-approval behavior, and caller-value privacy.
- The first run failed on M9 authentication: pydantic-v2 returned only `detail: []` and problem-json returned an empty validation error list, losing the declared `missing_auth`, `Bearer`, and `Authorization` semantics. Updated the shared mock validator to emit explicit authentication-shaped bodies per style while preserving those fields and status 401.
- Missing-header styles carry equivalent meanings with wire-specific shapes. The test canonicalizes the parser's known header representation differences (header case/path and allowed-vs-expected slot) before comparing all three styles.
- **Verification:** `node --test demo-server-and-client/server/test/validator.test.js` passed **14/14**, including the new full style/stage golden.
- **Review follow-up:** auth-specific serialization is gated only by the canonical `error: "missing_auth"` marker, so unrelated 401 required-header errors retain their declared missing-header payload. Added a synthetic 401 missing-header regression and credential-header sentinel redaction assertions for X-Tenant and Authorization. `node --test demo-server-and-client/server/test/validator.test.js` passed **15/15**; `git diff --check` passed.
- **Independent review follow-up:** the golden also needs to prove header values are never echoed, and styling must recognize authentication by the canonical `missing_auth` code rather than broad status 401. Add a non-auth 401 regression to ensure no error meaning is invented for unrelated unauthorized responses.
- **Invariant / acceptance:** caller body/header secrets remain absent from every style; only explicit `missing_auth` receives authentication-specific shaping. A synthetic required-header failure with status 401 and declared `missing_header` semantics remains a header error in all styles. Re-run the focused validator test before M2.2 review closes.

## M2.4 loop ticket — OpenAPI mutation state over HTTP

### Coordinator invariant and acceptance

- **Observable behavior:** mock admin mutation and spec controls deterministically switch `/openapi.json` between a selected mutation's active contract, a baseline document marked stale, and an explicit unavailable 404. Repeated config changes and reset restore exact state.
- **Owner files:** `demo-server-and-client/server/test/mutation-catalogue-route.test.js`; change the server only if the HTTP behavior fails.
- **Reproducer:** use the isolated mock process, select M7 and M8, assert active defaults/enum aliases, toggle stale and unavailable settings, and verify baseline marker/404 behavior and reset. Request the OpenAPI document from HTTP, not only `buildOpenApi()`.
- **Acceptance command:** `node --test demo-server-and-client/server/test/mutation-catalogue-route.test.js demo-server-and-client/server/test/validator.test.js`; then run the stage UI smoke after all M2 code tickets close.
- **Verification:** the isolated HTTP regression now covers reset baseline, active M7 `region` default, active M8 enum/aliases, stale baseline marker with mutation details disabled, unavailable 404, config toggles preserving stale state, and reset restoring the baseline. `node --test demo-server-and-client/server/test/mutation-catalogue-route.test.js demo-server-and-client/server/test/validator.test.js` passed **16/16**; `git diff --check` passed. No server change was needed.

## M2 exit verifier ticket — isolated PostgreSQL runtime tests

### Coordinator invariant and acceptance

- **Observable behavior:** the three server-process integration tests for M9 halt, policy modes, and provenance start against disposable PostgreSQL databases with migrations applied. Their writes/audits/events cannot reach the shared development database; ordinary in-process unit tests remain in file-mode and do not inherit `DATABASE_URL`.
- **Reason for ticket:** current `npm test` in blank-DB mode reports three failures because those integration children start the M1.5 gateway without its required `DATABASE_URL`; using `.env` globally instead incorrectly switches file-mode unit tests to PostgreSQL state.
- **Owner files:** one reusable `api-server/test/helpers/isolated-database.js` helper and only the three affected server-process tests.
- **Acceptance:** run `npm test` with `DATABASE_URL=''`, `REDIS_URL=''`, and `HEALR_TEST_DATABASE_URL` pointing at the local PG owner connection; the helper creates/migrates/drops a unique DB for each runtime test. Confirm exact full-suite counts and no leaked databases. Then run `npm run verify:p01` with its own disposable database through a wrapper (until the acceptance script itself is updated), and run the stage UI smoke against disposable state.

## M2 exit verifier follow-up — Phase 0/1 runner isolation and concurrency assertion

### Coordinator ticket and invariant

- **Observable behavior:** the Phase 0/1 acceptance script passes its 17 checks against a disposable PostgreSQL database; its nested unit suite runs in file mode and provisions separate temporary databases only for DB-backed integration tests. The concurrency check proves one additional heal commit relative to the current API epoch and preserves each caller's result.
- **Reason for ticket:** the first isolated `npm run verify:p01` completed 15/17. The concurrency assertion assumed the version history contained exactly two rows and version 2, although the DB-backed acceptance path includes prior registration history. The nested `npm test` inherited the outer disposable `DATABASE_URL`, switched ordinary unit tests into DB mode, and timed out at its 30-second limit.
- **Owner files:** `scripts/verify-phase01.mjs`, `WALKTHROUGH.md`.
- **Reproducer:** run `npm run verify:p01` with its child server pointed at a fresh migrated PostgreSQL database and `HEALR_TEST_DATABASE_URL` set to the owner connection. The reported concurrency details were `ids:111,222,333`, `healed4:true`, `version2:false`, `singleCommit:false`; final nested suite timed out.
- **Acceptance:** run the acceptance script again against a fresh disposable DB. Require all 17/17 checks, including one newly added heal-origin version and a passing isolated nested suite; confirm the outer DB is force-dropped and absent.

## M4.1 loop ticket — bounded candidate cache inspection and invalidation API

### Coordinator invariant and acceptance

- **Observable behavior:** operators can inspect a bounded, cursor-paginated view of verified and invalidated candidate metadata, inspect PostgreSQL/Redis mirror readiness, invalidate one SHA-256 candidate, or clear all candidates. PostgreSQL remains authoritative; clearing updates durable state and removes Redis mirror keys when Redis is available. A stale Redis value cannot restore an invalidated candidate.
- **Owner files:** `api-server/src/db/patch-candidate-repository.js`, `api-server/src/db/registry-service.js`, patch-cache feature facade, `api-server/src/server.js`, and HTTP/integration tests.
- **Reproducer:** add HTTP checks for default and maximum page limits, UUID cursor validation, invalid fingerprint rejection, one-candidate invalidation, clear-all, mirror status, and post-clear lookup miss. First run should fail because `/cache` is not implemented.
- **Acceptance:** isolated PostgreSQL route integration plus repository unit tests; focused API test must prove the invalidated candidate cannot be returned even if Redis temporarily retains a stale payload. Then run the M4 focused suite and record exact results.

## M3.2 review follow-up — identity checks on already-valid responses

### Coordinator invariant and acceptance

- **Observable behavior:** every successful HTTP 200 response is checked against configured identity echoes before it is returned, including responses whose fields already pass logical type/format validation. A mismatch returns the documented safe halt, leaves the adapter/version unchanged, and performs no replay.
- **Reason for ticket:** independent M3 code audit found that `invokeCore` returns immediately from its schema-valid HTTP 200 branch before calling `matchesIdentity`; identity was checked only after proposing response drift.
- **Owner files:** `api-server/src/features/executor/invoke.js`, `api-server/test/response-validation.test.js`.
- **Reproducer:** register a response contract whose required fields have valid types/formats but whose configured identity field maps to a different value than the original request. Assert the current code returns success and the test fails.
- **Reproduction evidence:** the new test returns `ok: true` for requested id `123` and schema-valid response id `999`; `DATABASE_URL='' REDIS_URL='' node --test api-server/test/response-validation.test.js` reports **6 passed, 1 failed** at the expected assertion.
- **Acceptance:** the reproducer returns a safe halt with exactly one upstream request, no committed version, and unchanged adapter; then rerun the response-drift suite and M3 gateway tests.
- **Implementation:** the schema-valid HTTP 200 path now verifies configured identity before returning success. Identity mismatch emits the safe halt lifecycle (`drift.silent`, `call.failed`, `halt`, `heal.finished`), appends a halt audit, and does not replay or change the adapter.
- **Verification:** `DATABASE_URL='' REDIS_URL='' node --test api-server/test/response-validation.test.js` passed **7/7**. The new assertion checks `response_identity_mismatch`, `retryable:false`, one fetch, unchanged adapter/version, the per-API terminal event sequence, and one halt audit.
- **Independent review:** no blocker; the branch’s terminal gateway event and invocation persistence use the existing durable `invoke()` wrapper, while the regression verifies the specific halt audit and no-replay behavior in isolated file mode.

## M3.1 review follow-up — malformed response-format drift

### Coordinator ticket and invariant

- **Observable behavior:** an HTTP 200 with a malformed required format (such as an invalid email) may remap only to one uniquely name-compatible field that itself satisfies the declared format. If no such field exists, Healr halts without replay or commit.
- **Reason for ticket:** independent M3 code audit found the detector implements format checks, but the response regression suite does not exercise malformed-format drift.
- **Owner files:** `api-server/test/response-validation.test.js`; update the drift detector only if the reproducer exposes incorrect behavior.
- **Reproducer:** invoke a read endpoint whose current required `email` path contains malformed text and whose response also has one valid `contact_email` field; assert an exact remap and a single upstream call. Add a no-compatible-candidate case proving a malformed email is not returned as valid and is not guessed.
- **Acceptance:** focused response tests assert either the exact response-path op or the non-retryable safe halt, one upstream call, and expected version behavior. Equal-ranked compatible paths must retain the distinct `response_mapping_ambiguous` reason; then rerun M3 response and gateway tests.
- **Review correction:** the detector currently labels zero compatible candidates as `response_mapping_ambiguous`, conflating no evidence with multiple equally ranked candidates. Use `response_mapping_unresolved` for zero candidates and reserve `response_mapping_ambiguous` for ties; assert the reason in the malformed-format no-alternate case.
- **Verification:** the current detector correctly remaps one valid `contact_email` from the same HTTP 200, halts without a compatible alternate, and separately halts on equal-ranked aliases. `DATABASE_URL='' REDIS_URL='' node --test api-server/test/response-validation.test.js` passed **10/10**. No detector bug was found in the format behavior; the review correction only made unresolved-versus-ambiguous reasons precise. Independent review found no blocker.

### Reproducer-discovered prerequisite — header evidence versus durable adapter shape

- **Invariant:** evidence stays in the Tier 1 proposal's provenance field; request adapter operations contain only executable operation fields accepted by the durable registry schema.
- **Reproducer:** the isolated PostgreSQL policy-mode test fails on the enforce M5 commit with `TypeError: adapter request operation fields are invalid`; `headerRule` currently duplicates `evidence` inside its `add_header` operation, which durable adapter validation rejects.
- **Owner files:** `api-server/src/features/diagnoser/tier1-rules/header.js`, `api-server/test/tier1.test.js`, and the M5 DB runtime assertion in `api-server/test/phase1-policy-modes.test.js`.
- **Acceptance:** Tier 1 asserts evidence remains on the proposal but not its operation; the DB policy integration commits v2, stores an evidence-free adapter op, and retains proposal evidence in the audit record.
- **Reproduction:** the new isolated M5 enforce integration failed at the DB commit with `TypeError: adapter request operation fields are invalid`. A Tier 1 shape regression also failed because `add_header` included duplicate `evidence` inside the operation.
- **Implementation:** `headerRule` now returns the executable `add_header` operation without an `evidence` property; its raw error remains in `proposal.evidence`. The Tier 1 tests assert that split, and the DB policy test confirms the persisted operation is evidence-free while the commit audit records a positive `evidenceCount`.
- **Verification:** Tier 1 focused tests passed **11/11**. The three runtime integrations, each using a distinct migrated disposable DB, passed **3/3** after the fix. Cleanup assertions confirmed each database was dropped with `WITH (FORCE)` and no database with that unique name remained. M9 now counts `decision: "halt"` records separately from registration and terminal invocation audit rows, which are both present in PostgreSQL mode.

### Isolated PostgreSQL test helper and runtime wiring

- Added `api-server/test/helpers/isolated-database.js`. It requires `HEALR_TEST_DATABASE_URL`, generates a unique `healr_test_*` database name, creates that database, runs all current migrations through the production migration function, returns the child `DATABASE_URL`, then drops the DB with `DROP DATABASE ... WITH (FORCE)` and verifies it no longer exists.
- M9 safe-halt, policy-mode, and provenance runtime tests are skipped with a clear reason when no test DB owner URL is set. When enabled, their server children receive the unique database URL and `REDIS_URL=''`; parent unit tests keep `DATABASE_URL=''` and remain in file mode.
- **Focused acceptance command:** `HEALR_TEST_DATABASE_URL=<local PostgreSQL owner URL> DATABASE_URL='' REDIS_URL='' node --test api-server/test/phase1-m9-safe-halt.test.js api-server/test/phase1-policy-modes.test.js api-server/test/phase1-provenance-error.test.js` passed **3/3**, duration **6.17s**. All three teardown assertions verified the database rows were absent after forced drop.
- A pre-change attempt without the test DB URL was unable to reproduce server startup because this sandbox denied localhost port binding (`EPERM`) before the child reached the PostgreSQL guard. The focused tests were rerun with approved local PostgreSQL access and passed. The full suite, `verify:p01`, and browser gates were not run in this ticket.

### Reproducer-discovered prerequisite — adapted GET query arguments

- **Observable behavior:** a safe GET request must encode the adapter-built logical-to-upstream argument mapping in its query string, so a verified rename replay can succeed before its candidate is learned.
- **Invariant:** only the already compiled adapter output supplies query parameters; path placeholders and URL encoding remain bounded by the existing request builder. The original caller object is not mutated.
- **Owner files:** `api-server/src/features/executor/invoke.js` and `api-server/test/mutation-healing.test.js`.
- **Acceptance command:** `DATABASE_URL= REDIS_URL= node --test api-server/test/mutation-healing.test.js` with an assertion that one corrected GET replay sends the renamed query key and returns validated logical data. Then run M5 mutation regression and `git diff --check`.
- **Reproducer:** the current `send()` ignores the transformed `body` for GET and rebuilds query parameters from caller `args`; the focused case should fail response validation because the upstream receives the pre-adapter key.
- **Reproduction evidence:** the new regression failed as expected with `response_mapping_ambiguous`; the fake upstream received no `user_id` query value and returned `id: null`.
- **Implementation:** GET query parameters and path placeholders now use the adapter-built request object. The caller's logical args remain untouched.
- **Verification:** `DATABASE_URL= REDIS_URL= node --test api-server/test/mutation-healing.test.js` passed **7/7**, including the existing M1/M2/M3/M4/M7/M8 operation checks and M5-adjacent request handling; `git diff --check` passed.

### Reproducer-discovered prerequisite — root rename persistence shape

- The isolated M4.2 gateway reproducer reaches Tier 1 and then fails at durable adapter validation because `renameRule` emits `path: ""` for root-level renames. The DB adapter contract requires an omitted `path` for root operations; the in-memory golden path did not expose this mismatch.
- **Invariant / expected result:** root rename proposals omit `path`, while nested rename proposals retain their non-empty parent. This preserves identical patch semantics and lets PostgreSQL validate and persist the adapter.
- **Owner files:** `api-server/src/features/diagnoser/tier1-rules/rename.js` and `api-server/test/tier1.test.js`.
- **Acceptance:** focused Tier 1 tests assert both root and nested operation shapes; rerun the M4.2 isolated reproducer through durable commit.
- **Reproduction/fix evidence:** the new root-shape test failed with actual `path: ""` versus expected omission. `renameRule` now includes `path` only for non-root operations. `DATABASE_URL= REDIS_URL= node --test api-server/test/tier1.test.js` passed **11/11**. The isolated M4.2 test now reaches and commits the source repair; it then fails at the intended assertion because the destination reports `cacheHit: false` instead of reusing a convention candidate.

## M3.3 loop ticket — M6/M10 HTTP truth versus observed response

### Coordinator invariant and acceptance

- **Observable behavior:** with M6 or M10 selected, `POST /api/users/get` returns the mutation-specific response shape while `GET /admin/truth/users/123` retains canonical user truth. The regression names the exact differing paths and confirms truth is unchanged.
- **Owner files:** `demo-server-and-client/server/test/mutation-catalogue-route.test.js`; change the mock only if the HTTP reproducer finds a contract defect.
- **Reproducer:** run an isolated mock process, reset, select each mutation, request the observed response and truth over HTTP, then assert M6 relocates `result.name` to `result.data.profile.name` and M10 relocates it to `result.full_name`.
- **Acceptance:** focused mock route test passes and an independent review confirms assertions compare both HTTP payloads and exact paths. No browser smoke is required for this server-only ticket; the overall stage walkthrough remains deferred at user direction.
- **Reproduction/implementation result:** HTTP behavior already matched the catalogue, so no production change was needed. The isolated regression checks the exact full M6/M10 response bodies and canonical truth after each selection.
- **Verification and review:** `node --test demo-server-and-client/server/test/mutation-catalogue-route.test.js` passed **2/2**; `git diff --check` passed. Independent review found no blocker and confirmed exact-path, truth, and child cleanup assertions.
- **Implementation:** added bounded `GET /cache` inspection (maximum 200 rows, UUID cursor, Redis readiness metadata), `DELETE /cache/:cacheKey`, and `DELETE /cache`. PostgreSQL invalidates verified rows first; clear-all returns the affected keys and deletes their Redis mirrors. Repository lookup remains PostgreSQL-authoritative if a stale mirror remains or Redis is unavailable.
- **Verification:** the first isolated HTTP run was blocked by sandbox `EPERM` to local PostgreSQL. After approved local service access, `api-server/test/m4-cache-routes.integration.test.js` passed **1/1**, including pagination, max/invalid query values, per-key and clear-all invalidation, mirror-disabled metadata, stale-mirror authorization miss, and disposable DB teardown. `api-server/test/patch-candidate-repository.test.js` passed **3/3**; syntax checks and `git diff --check` passed. Independent implementation review is in progress.

## M4.1 loop ticket — automated Redis outage safe degradation

### Coordinator invariant and acceptance

- **Observable behavior:** with PostgreSQL available and Redis configured to an unused local port, candidate save, lookup, and invalidation complete from PostgreSQL; Redis is reported unavailable/degraded and cannot authorize stale candidate use.
- **Owner files:** `api-server/test/m4-cache-failover.integration.test.js`; modify mirror/service code only if this isolated reproducer exposes unsafe behavior.
- **Reproducer:** create a migrated isolated DB, set a unique cache namespace and unreachable Redis URL, persist a verified candidate, find it by PostgreSQL fingerprints, invalidate it, then prove lookup misses. Assert service calls do not fail because of Redis.
- **Acceptance:** focused test passes and cleanup closes Redis/PG pools and force-drops the disposable DB. Keep outage behavior as safe misses and preserve PostgreSQL authority.
- **Independent review:** no blocker in route correctness, bounds, PostgreSQL authority, or invalidation ordering. Review noted that the post-clear assertion directly queries the PostgreSQL repository, so it proves durable state is non-authoritative after invalidation rather than exercising an extant Redis payload through the service. This boundary is explicit; the next failover regression exercises repository-service save/find/invalidate with Redis unavailable. Redis mirror cleanup is best-effort and any undeleted hint expires by TTL, while every lookup still revalidates PostgreSQL.
- **Reproducer result / discovered defect:** the first local PostgreSQL run reached a pending-promise timeout after candidate operations against unreachable Redis; teardown stalled because mirror shutdown attempted `QUIT` on an open but never-ready Redis client. This exposes an unbounded shutdown wait in the outage path. The reproducer is being tightened around this lifecycle defect before acceptance.
- **Implementation follow-up:** the outage reproducer exposed shutdown calling Redis `QUIT` while the client was open but had never completed its handshake. `closeRedisMirror()` now sends `QUIT` only to a ready client and destroys an open unready client, preventing an outage from leaving shutdown pending. The first completed test run then exposed a test expectation mismatch (invalidation returns the affected-row count); the assertion now checks `1`.
- **Verification:** with local PostgreSQL access, `api-server/test/m4-cache-failover.integration.test.js` passed **1/1** in 319 ms, including Redis `ready:false/degraded:true`, successful PostgreSQL save/find/invalidate, lookup miss after invalidation, and forced database cleanup. Independent review is in progress.
- **Review resolution:** independent review found `degraded` could leak from the outage test into later tests in the same process after client shutdown. `closeRedisMirror()` now resets that process-local flag, and the outage integration asserts the reset during teardown. The refreshed focused test passed **1/1** (319 ms); `git diff --check` passed. Awaiting review of this final follow-up.
- **Review follow-up:** review found the bounded command timeout (50 ms) was shorter than Redis connect timeout (100 ms), allowing a late connection rejection to re-mark the mirror degraded after shutdown. Redis listeners and connect completion now carry a generation guard; shutdown advances the generation before resetting state. The integration waits beyond connect timeout before asserting the flag remains clear. Rerun and final review required.
- **Final outage race resolution:** review found a pending `getClient()` call could resume after shutdown cleared the global client, and a late bounded-operation catch could set `degraded` after close. `getClient()` now retains its client reference across await, while bounded operations mutate status only for their captured current generation. The delayed post-close assertion remains in place. Focused outage integration passed **1/1** (453 ms), syntax check and `git diff --check` passed; awaiting final independent review.

## M4.3 loop ticket — strict durable metrics time-range validation

### Coordinator invariant and acceptance

- **Observable behavior:** `GET /metrics/timeseries` rejects malformed, unsafe, zero, negative, and out-of-range `window`/`step` values with HTTP 400; valid values at documented boundaries return a series response. Defaults apply only when a parameter is omitted.
- **Owner files:** `api-server/src/server.js`, `api-server/src/db/metrics-repository.js`, and a PostgreSQL-isolated route integration test.
- **Reproducer:** exercise the HTTP route with omitted/default values, valid min/max bounds, malformed strings, fractions, zero, and values above caps. Confirm current repository behavior silently clamps invalid values instead of returning 400.
- **Acceptance:** exact status/body checks against a migrated disposable database; all test databases are force-dropped and confirmed absent. Keep aggregation semantics unchanged in this ticket; add tier/round/token aggregation as a subsequent M4.3 slice.
- **Reproduction evidence:** the isolated HTTP test failed at `?window=nope` with actual status 200 versus expected 400, confirming silent fallback.
- **Implementation:** `/metrics/timeseries` now accepts only omitted defaults or decimal integer strings within `window=1..2592000` and `step=1..86400`; malformed, repeated/array, fractional, zero, negative, and over-bound values return `{ok:false,error:'invalid_arguments'}` with HTTP 400 before querying metrics.
- **Verification:** after the change, `api-server/test/m4-metrics-range.integration.test.js` passed **1/1** (5.39 s), covering omitted defaults, min/max bounds, and invalid cases for each parameter. Disposable PostgreSQL cleanup passed. Independent review is in progress.

## M4.3 loop ticket — persisted tier, round, and token aggregates

### Coordinator invariant and acceptance

- **Observable behavior:** durable `/metrics` and `/metrics/timeseries` report rounds, duration, tier counts, cache hits, and input/output token totals from PostgreSQL invocation rows. Snapshot and time buckets agree with the inserted persisted rows and survive API process restart.
- **Owner files:** `api-server/src/db/metrics-repository.js` and an isolated PostgreSQL HTTP integration test.
- **Reproducer:** insert a small deterministic set of terminal invocations spanning tiers, outcomes, rounds, duration, cache, and tokens; compare both metric endpoints against exact SQL truth. Current API omits rounds/tier from metrics and omits token totals from time buckets.
- **Acceptance:** exact snapshot/time-bucket values for a fixed aligned time window, including null/unknown tier handling; disposable DB cleanup verified. Preserve M4.3 range validation behavior.
- **Review follow-up:** independent review confirmed strict parsing, safe-integer bounds, duplicate-query rejection, and exact 400 response. It noted duplicate/unsafe values were claimed but initially absent; added both for `window` and `step`, then reran the isolated test successfully. The test now also enters cleanup before port allocation/process spawn so a setup exception still drops the disposable DB. Final review found no blocker.
- **Reproduction evidence:** the integration test failed at `snapshot.rounds` (`undefined` vs persisted total `3`) before any implementation changes.
- **Implementation:** durable snapshot and time buckets now include total and average rounds, average duration, fixed T0/T1/T2/unknown/other tier counts, and input/output token totals. Existing p50/p95 and outcomes remain derived from the same persisted invocation rows.
- **Verification:** `api-server/test/m4-metrics-aggregates.integration.test.js` passed **1/1** (5.39 s). It compares snapshot and aligned current/previous buckets to exact seeded PostgreSQL truth, including tier counts, rounds, averages, durations, cache and token totals; disposable DB cleanup passed. Independent review is in progress.
- **Review follow-up before closure:** independent review found the acceptance text claimed restart stability without restarting the API, time series included future-dated rows, and valid window/step combinations could create up to 2.6 million buckets. Extend this slice to prove values survive an API process restart, exclude future timestamps, and reject pairings above 10,000 buckets. Add an upper timestamp bound and exact regressions; rerun both metrics integrations before review closes.
- **Review resolution:** metrics queries now exclude `started_at > now()`. The HTTP route rejects ranges whose epoch-aligned rolling window can intersect more than 10,000 buckets (`ceil(window/step)+1`), with invalid wide/one-second regressions. The aggregate integration now stops and restarts the API before comparing the same persisted snapshot and inserts a future-dated invocation that must not appear in the recent series. Both metrics integrations passed **2/2** (5.62 s total); isolated DB cleanup passed. Final review is in progress.
- **Bucket-bound correction:** final review identified epoch-aligned buckets can intersect one extra partial bucket beyond `ceil(window/step)` because the query uses a rolling window. Tighten the cap calculation to reserve that boundary bucket and add a 10,000-second/one-second rejection case; rerun both metrics integrations and final review.
- **Final review:** independent review confirmed restart stability, future timestamp exclusion, tier/round/token/duration aggregation, strict input bounds, and the epoch-aligned bucket cap. The cap follow-up accounts for the additional partial bucket and its exact boundary regression passes. No blocker remains for these M4.3 slices.

## M4.2 loop ticket — destination revision fence and GET path reuse

### Coordinator invariant and acceptance

- **Observable behavior:** convention candidate replay for a GET endpoint with a path placeholder uses adapter-built path/query values and commits only if destination epoch/config/credential revisions remain the same as the candidate replay's starting snapshot.
- **Owner files:** `api-server/src/features/executor/invoke.js` and `api-server/test/m4-cache-reuse.integration.test.js`.
- **Reproducer:** prove a learned candidate replays successfully through `/users/{userId}` while adapting a separate query field; separately change destination configuration during the candidate replay and assert the in-flight invocation does not commit against stale revisions or report a cache hit.
- **Acceptance:** isolated PostgreSQL assertions cover encoded path placeholder, corrected query key, safe revision-race miss/no version advance, source integrity, request counts, and persisted commit/event truth. Preserve existing M4.2 reuse and safety cases.
- **Reproducer-discovered implementation defect:** the path-placeholder replay reaches the correct `/users/c%2Fd` path, but the adapter-built GET query namespace is serialized as `query=[object Object]`; expected `region_code=east` is missing. Keep the same observable contract and flatten the compiled `query` object into URL search parameters, preserving scalar values and path substitution.
- **Reproducer evidence:** initial path case halted with `provenance_violation` because the new test modeled an unregistered root `region` instead of the tool's nested `query` contract. After modeling the declared query object, it exposed `query=[object Object]` and no `region_code` on the adapted GET replay. The revision-race reproducer showed re-registration during candidate replay advanced a new v1 tool to v2 with a stale cached commit.
- **Implementation:** GET request building now flattens scalar fields from the adapter-built `query` object into URL search params and still substitutes/encodes path placeholders. Candidate replay checks destination epoch/config/credential revisions before use and after response validation, plus active tool epoch/version. Revision changes produce a structured `stale_cache_candidate` halt; the durable commit's existing DB revision fence also maps a stale commit race to the same halt.
- **Verification:** `api-server/test/m4-cache-reuse.integration.test.js` passed **1/1** (0.85 s) with isolated DB cleanup. It covers successful path `/users/c%2Fd`, adapted `region_code=east` (no old field), and destination re-registration during replay with exactly two upstream calls, no cache-hit/patch-commit, and no version appended beyond replacement registration. Independent review is in progress.

## M4.4 loop ticket — bounded durable trace pages and retention incompleteness

### Coordinator invariant and acceptance

- **Observable behavior:** durable `GET /traces/:callId` returns at most 100 ordered spans per request with a sequence cursor, next cursor, and explicit incomplete reason when the trace is paginated or its prefix was pruned. A terminal trace is complete only if the requested page contains the full call from sequence zero through terminal without gaps.
- **Owner files:** `api-server/src/db/event-repository.js`, `api-server/src/features/events/trace-store.js`, `api-server/src/server.js`, and an isolated PostgreSQL route integration test.
- **Reproducer:** seed a call with more than one page of ordered events, read successive pages, and separately delete a call prefix while advancing workspace retention floor. Assert bounded order, page cursors, explicit `retention_boundary`, and incomplete status after pruning. Also cover missing-stage incompleteness and malformed limit/cursor 400 responses.
- **Acceptance:** restart-independent HTTP reads over PostgreSQL, each page bounded to 100 spans, no sensitive payload expansion, accurate terminal/completeness semantics, and disposable DB cleanup verified.
- **Reproduction evidence:** the first HTTP run failed because the test expected 100 rendered spans while the first 100 event rows included the non-rendered `call.started` marker. Pagination now includes that marker in addition to the 100-span budget. The next run exposed reason precedence (`event_sequence_gap`, then `start_event_missing`) on continuation pages; sequence checks are page-relative and explicit incompleteness precedence now distinguishes pagination and retention from missing-stage evidence.
- **Implementation:** durable event lookup now uses bounded `sequence_in_call >= cursor` pages (maximum 100 rendered spans, plus a start marker when applicable), lookahead, and a next sequence cursor. `/traces/:callId` validates limit/cursor and returns pagination metadata, retention floor, and trace reconstruction. It marks later pages `page_continues`, truncated first pages `page_truncated`, pruned prefixes `retention_boundary`, and missing start/terminal or internal gaps explicitly. A later page remains incomplete by itself; only the complete first page can be marked complete.
- **Verification:** `api-server/test/m4-trace-pages.integration.test.js` passed **1/1** (5.44 s) before adding process restart coverage; it validates two pages, retention pruning, missing stages, invalid inputs, and disposable DB cleanup. Added an API restart between pages to verify PostgreSQL-backed continuity; rerun and independent review are pending.
- **Review resolution:** review found a missing continuation prefix could be mislabeled `page_continues`, and all-pruned events yielded 404 despite a durable invocation. Cursor-relative first-sequence gaps now report `retention_boundary`; when no event rows remain but invocation truth persists, the route returns an empty incomplete trace shell with retention/start reason. The integration now exercises both conditions and API restart between pages; refreshed `m4-trace-pages.integration.test.js` passed **1/1** (5.67 s), plus syntax checks and `git diff --check`. Final independent review is in progress.

## M4.1 loop ticket — Redis mirror expiry/eviction rehydration

### Coordinator invariant and acceptance

- **Observable behavior:** after a verified PostgreSQL candidate is saved and its Redis mirror is expired or evicted, lookup still succeeds from PostgreSQL and recreates a bounded mirror hint. A stale or corrupt mirror never authorizes a hit without the durable row.
- **Owner files:** `api-server/test/m4-cache-eviction.integration.test.js`; production mirror/service changes only if the isolated test exposes a defect.
- **Reproducer:** run isolated PostgreSQL and Redis namespace, save a candidate, delete its Redis key (or wait for one-second TTL), then lookup through `registry-service`; assert durable candidate is returned and mirror is rehydrated. Invalidate PostgreSQL while injecting stale Redis payload and assert lookup misses.
- **Acceptance:** Redis-backed integration passes with both stores, disposable DB and namespace cleanup verified. Skip clearly when no test Redis URL is configured; outage behavior remains covered separately.

## M4.1–4.4 and M2 acceptance checkpoint

- **M4.1 Redis eviction ticket:** added `api-server/test/m4-cache-eviction.integration.test.js`. With an isolated PostgreSQL database and a test URL pointed at the configured local Redis service, it saves a verified candidate, deletes its randomly namespaced Redis key, verifies lookup succeeds from PostgreSQL and repopulates the mirror, then invalidates the durable row, injects a stale Redis payload, and verifies lookup misses and removes the hint. Focused integration passed **1/1**; full-suite run passed with it enabled.
- **M4.2 independent final review:** typed `StaleAdapterError` resolves the earlier brittle-message concern for API/tool deletion at commit. Review found no functional blocker. Direct deletion in the narrow precheck/commit window lacks a separate assertion; reviewer considers this a non-blocking coverage gap because the locked transaction checks missing/deleted rows and replay maps the typed error to `stale_cache_candidate`.
- **Focused combined slice:** cache reuse, cache routes, Redis outage, metrics ranges/aggregates, trace pages, M3 response validation, and M3.3 route truth passed **18/18** (5.81 s).
- **Full repository suite:** with `DATABASE_URL`/`REDIS_URL` blank, `HEALR_TEST_DATABASE_URL` set to the PostgreSQL owner connection, and `HEALR_TEST_REDIS_URL` set to the configured local Redis service, `npm test` passed **128/128** with no skips. Redis keys use a random namespace; PostgreSQL runtime tests create/drop unique databases. A sandboxed attempt without local-service access failed on `EPERM` at PostgreSQL and loopback; the approved local-service rerun passed.
- **Phase 0/1 acceptance:** ran against a fresh, uniquely named disposable PostgreSQL database, force-dropped it during cleanup, and passed **17/17**, including its nested suite (**128 passed, 0 failed**). No configured development database was used as the verifier's application database.
- **M4.4 final review:** independent review confirms the missing continuation prefix is reported as `retention_boundary`, and durable invocations with all events pruned return an incomplete trace shell. No blocker remains for this slice.
- **Remaining milestone evidence at this checkpoint:** browser walkthrough remains deferred at the user's instruction. M4 dashboard browser evidence remains open; dashboard code/build is recorded in its ticket below. No install or deployment is claimed.

## M4 dashboard loop ticket — durable metrics and paginated trace completeness

### Coordinator invariant and acceptance

- **Observable behavior:** a dashboard page reads bounded `/metrics` and `/metrics/timeseries` results, lets an operator fetch and continue through durable call traces while showing completeness/reason, and inspect or invalidate verified patch candidates using the bounded cache APIs.
- **Owner files:** `api-client/app/metrics/page.js`, `api-client/lib/core.js`, and `api-client/lib/nav.js`.
- **Reproducer:** inspect current dashboard navigation and API methods; confirm there is no durable metrics view, page-aware trace completeness display, or cache inspection action even though the server endpoints exist.
- **Acceptance:** production client build succeeds; implementation uses bounded existing endpoints, exposes trace completion/incomplete reason and cursor, and lets an operator invalidate one or all verified candidates. No browser verification in this ticket.
- **Implementation:** added a Metrics & traces page and nav entry. It fetches the persisted `/metrics` snapshot and one-hour, one-minute `/metrics/timeseries` buckets, displays outcome bars and durable rounds/tier/latency/token counters, and fetches `/traces/:callId` by bounded cursor. The trace panel labels complete/incomplete state, shows the API's reason and retention floor, renders spans, and offers continuation when a next cursor exists. The same page lists candidate metadata in 100-row pages, shows Redis readiness, and provides single and confirmed clear-all invalidation actions. API helpers accept bounded cache and trace parameters; existing overview panels were left alone.
- **Verification:** `api-client` `npm run build` passed after adding metrics, trace, and cache management UI and generated the `/metrics` route; `git diff --check` passed. Per the user's instruction, no browser verification was run; M4 dashboard interaction evidence remains open until the instructed walkthrough.
