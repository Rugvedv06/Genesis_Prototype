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
