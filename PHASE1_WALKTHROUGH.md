# Phase 1 Walkthrough — healr (PS 01: Self-Healing Tool Registry)

This document explains **how Phase 1 works** and gives **step-by-step instructions** to test the full flow end-to-end: the split-screen dashboard (Baseline vs Healed), the live SSE event feeds, the M5 mutation, and the automatic heal.

> Phase 1 goal (from `PS01_BUILD_PLAN.md` §6): the demoable vertical slice on **M5** — one mutation, real UI, break → baseline fails → automatic recovery. If everything after this fails, this is your demo.

---

## 1. What Phase 1 builds (the four apps)

| App | Port | Responsibility |
|-----|------|----------------|
| `api-server` (core healing gateway) | 8000 | Registry, executor + heal loop, classifier, Tier 1 rules, patch engine, SSE event bus, `POST /apis` registration |
| `demo-server` (mock API + mutation engine) | 5001 | V1 contract, data-driven M5 mutation engine, baseline agent (raw HTTP, no healing), SSE events |
| `api-client` (core dashboard) | 3000 | Status page + health links (Phase 2 dashboard lands later) |
| `demo-client` (Drift Control stage UI) | 3001 | Split-screen **Baseline vs Healed**, live feeds, patch chips, truth-check badge |

All four are started with a single command:

```bash
npm run dev   # boots api-server:8000, demo-server:5001, api-client:3000, demo-client:3001
```

Stop with `Ctrl+C` (all child processes are killed on SIGINT/SIGTERM).

---

## 2. Phase 1 architecture (text diagram)

```
 browser (demo-client :3001)
   │  SSE feeds  │
   ├─────────────┼─────────────────────────────────────────┐
   │             │                                         │
   ▼             ▼                                         ▼
+----------+  +----------+  +--------------------------+  +------------------+
| Baseline |  |  Healed  |  |   demo-server :5001      |  |  api-server :8000|
| (raw     |  | (self-   |  |   M5 mutation engine     |  |   healing gateway|
|  agent)  |  |  healing)|  |   • header check first   |  |   • POST /apis   |
|          |  |          |  |   • layered 422s         |  |   • invoke+heal  |
| raw HTTP |  | adapter  |  |   • returns 400/422/200  |  |   • SSE events   |
|  no heal |  | heals via|  |   • /admin/mutate M5     |  |   • registry     |
+----------+  |  4 ops   |  +--------------------------+  +------------------+
              +----------+
                    │
                    │ HTTP calls (register + invoke)
                    └──────────────────────────────────────┘
```

**M5 mutation** (the Phase 1 example): the API contract changes from
`{ "user_id": "123" }` → `{ "target": { "id": 123 } }` plus a mandatory `X-Tenant` header.

The healed side must discover and apply **4 ops** across rounds:
1. `add_header X-Tenant` (credential from env)
2. `move_field user_id → target.user_id`
3. `rename_field target.user_id → target.id`
4. `coerce_type target.id string → integer` (lossless)

Then it **verifies by replay** (200), commits the new immutable version, and returns the correct response.

---

## 3. The heal loop (step by step)

When `POST /apis/demo-users/tools/get_user/invoke` arrives with `args: { user_id: "123" }`:

1. **Validate args** against the logical schema. Bad input → `invalid_arguments`, **never healed**.
2. **Send** request through the current adapter to `demo-server :5001`.
3. **If 200 + response matches logical fields** → success, return data (no heal needed).
4. **Classify the error** (pydantic-v1 / pydantic-v2 / problem-json / mock canonical).
5. **Heal loop** (max 5 rounds, 5 s deadline, single-flight for concurrent calls):
   - Diagnoser runs Tier 1 rules in order: `header` → `wrap` → `rename` → `type`.
   - First confident proposal wins; ambiguous cases return `null` (escalate, not guess).
   - Patch engine builds a **draft** adapter (never touches the live registry).
   - **Replay** the draft against the mock. If 200 + fields match → **commit** new immutable version, emit `patch.committed`, return healed data.
   - If replay still fails, use the new error as evidence for the next round.
6. If no safe fix is found within budget → structured `tool_unavailable` with `retryable: false` and a halt audit record (the agent stops instead of looping).

---

## 4. Prerequisites

- Node.js ≥ 20 (we use Node 24; ESM, built-in `fetch`, `node:test`)
- `npm install` already run (workspaces install express, cors, next, react, ajv)

```bash
# from repo root
npm install          # once
cp .env.example .env # optional; set TENANT_ID=demo-tenant-01 if you want
```

> `.env` is gitignored — never commit it. `TENANT_ID` is read at call time, never cached into versions or logs.

---

## 5. End-to-end test walkthrough

There are two ways to test: **(A) terminal-only** (fastest, verifies every gate) and **(B) the dashboard** (the visual demo). Do A first to confirm the plumbing, then B for the split-screen experience.

### Step 0 — Start all four apps

```bash
npm run dev
```

Wait until you see all four "listening / Ready" lines. Then open four health checks in separate terminals or one after another:

```bash
curl http://localhost:8000/health      # api-server  -> {"ok":true,...}
curl http://localhost:5001/health      # demo-server -> {"ok":true,...}
curl http://localhost:3000             # api-client  -> HTML
curl http://localhost:3001             # demo-client -> HTML (Drift Control)
```

All must return `200`. This is the **Phase 0 exit gate**.

---

### Part A — Terminal-only flow (recommended first)

**A1. Register the API on core** (the registration payload from `/contracts/registration.payload.json`):

```bash
curl -s -X POST http://localhost:8000/apis \
  -H 'Content-Type: application/json' \
  -d @contracts/registration.payload.json
```

Expected: `{"ok":true,"apiId":"demo-users","tools":["get_user","update_user_email"]}`

**A2. Clean call — both sides succeed (before mutation):**

```bash
curl -s -X POST http://localhost:8000/apis/demo-users/tools/get_user/invoke \
  -H 'Content-Type: application/json' \
  -d '{"args":{"user_id":"123"}}'
```

Expected: `{"ok":true,"data":{"id":"123","name":"Asha Rao","email":"asha@example.com"},"meta":{"healed":false,...}}`

**A3. Activate the M5 mutation on the mock:**

```bash
curl -s -X POST http://localhost:5001/admin/mutate \
  -H 'Content-Type: application/json' \
  -d '{"id":"M5"}'
```

Expected: `{"ok":true,"mutation":"M5"}`

Verify mock state:

```bash
curl -s http://localhost:5001/admin/state
```

Expected: `{"mutation":"M5","errorStyle":"pydantic-v1","specAvailable":true,"writes":[]}`

**A4. Baseline visibly fails** (raw agent, no healing, `max_iterations=10`):

```bash
curl -s -X POST http://localhost:5001/demo/run \
  -H 'Content-Type: application/json' \
  -d '{"apiId":"demo-users","tool":{"name":"get_user","path":"/api/users/get","method":"POST"},"args":{"user_id":"123"},"baseUrl":"http://localhost:5001"}'
```

Expected: `{"ok":false,"outcome":"fail","iterations":10,"error":{"status":400,...},"maxIterations":10}` — the baseline hits the 400 header error 10 times and stops. **This is the "baseline visibly fails" gate.**

**A5. Healed side self-recovers** (the core of Phase 1):

```bash
curl -s -X POST http://localhost:8000/apis/demo-users/tools/get_user/invoke \
  -H 'Content-Type: application/json' \
  -d '{"args":{"user_id":"123"}}'
```

Expected (the important fields):

```json
{
  "ok": true,
  "data": { "id": "123", "name": "Asha Rao", "email": "asha@example.com" },
  "meta": {
    "version": 2,
    "healed": true,
    "rounds": 4,
    "tier": 1,
    "cacheHit": false,
    "latencyMs": <under 3000>
  }
}
```

This is the **Phase 1 exit gate**: healed in < 3 s, exactly 4 rounds, tier 1, data matches ground truth.

**A6. Inspect the committed patch** (registry now has version 2 with the 4 ops in `change.ops`):

```bash
curl -s http://localhost:8000/apis/demo-users/tools/get_user/versions
```

Expected: version history including version 2 whose `change.ops` holds, in order:
1. `add_header X-Tenant` (source: credential X-Tenant)
2. `move_field user_id → target.user_id`
3. `rename_field target.user_id → target.id` (path: target)
4. `coerce_type target.id string → integer`

**A7. Bad input is never healed** (safety gate):

```bash
curl -s -X POST http://localhost:8000/apis/demo-users/tools/get_user/invoke \
  -H 'Content-Type: application/json' \
  -d '{"args":{}}'
```

Expected: `{"ok":false,"error":{"code":"invalid_arguments","retryable":false,...}}` — `retryable: false` stops the agent from looping.

**A8. Reset to a clean contract:**

```bash
curl -s -X POST http://localhost:5001/admin/reset
curl -s -X DELETE http://localhost:8000/apis/demo-users
```

Then re-register (A1) and re-run (A2) to confirm a fresh start works — this is the "delete and restart the mock on another port and re-register works" gate.

---

### Part B — Dashboard flow (the visual demo)

Open **http://localhost:3001** (Drift Control / demo-client). You should see:

- Header: **healr · Drift Control**, mode indicator, and action buttons
- Two panes side by side:
  - **BASELINE (raw agent)** — red accent
  - **HEALED (self-healing)** — teal accent
- Each pane shows: status, iterations, elapsed ms, live event feed, result + truth-check badge
- Below: **Committed patch ops** section (appears after a heal)

**B1. Clean run:**
1. Click **Run both**.
2. Both panes should go to **OK** with `data` matching `{ id: "123", name: "Asha Rao", email: "asha@example.com" }` and truth-check **MATCH ✓**.
3. Baseline iterations: small (clean contract). Healed rounds: 0 (no drift).

**B2. Mutate:**
1. Click **Mutate API (M5)**. The mutation badge shows `M5`.
2. Mock state now has the drifted contract.

**B3. Run both again (the wow moment):**
1. Click **Run both**.
2. **Baseline pane:** status goes to **FAIL**, iterations climb to 10, event feed shows repeated `call.failed · 400`, final error is the missing `X-Tenant` header. Truth check stays absent/mismatch.
3. **Healed pane:** status goes **running → OK**, rounds = 4, event feed shows `patch.proposed` × 4 then `patch.committed`, data matches truth, truth-check **MATCH ✓**.
4. Below the panes, the **Committed patch ops** chips appear: `add_header`, `move_field`, `rename_field`, `coerce_type` — exactly 4 ops, none extra.

**B4. Reset and repeat:**
1. Click **Reset** → clears mutation, resets mock writes, returns both panes to idle.
2. Repeat B1–B3 to confirm determinism.

> Tip: keep the browser's dev-console open; SSE feeds use `EventSource` to `:8000/events` (core) and `:5001/demo/events` (mock). If a pane stays "Waiting to run…", check the console for SSE connection errors (CORS is enabled on both servers).

---

## 6. Expected results checklist (Phase 1 exit gate)

| Gate | How to verify |
|------|---------------|
| 4 health checks green | `curl :8000/health`, `:5001/health`, `:3000`, `:3001` → all `200` |
| Clean call succeeds | `POST /invoke` → `ok:true`, `healed:false`, correct data |
| Baseline visibly fails | `POST /demo/run` → `outcome:fail`, `iterations:10` |
| Healed side finishes | `POST /invoke` → `ok:true`, `healed:true`, `rounds:4`, `tier:1`, `< 3 s` |
| Patch ops match true diff | registry versions show exactly the 4 M5 ops, none extra |
| Bad input not healed | `args:{}` → `invalid_arguments`, `retryable:false` |
| Reset + re-register works | `POST /admin/reset`, `DELETE /apis/:id`, then re-register and call |
| `npm test` green | 30/30 tests pass (`node --test`) |

---

## 7. Troubleshooting

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| `npm run dev` fails to spawn `next` | stale `node_modules` hoisting | re-run `npm install` at root |
| demo-client :3001 returns 500 | missing `"use client"` in `app/page.js` | already added; restart `npm run dev` |
| Heal returns `tool_unavailable / no_diagnosis` | mock not on M5, or stale registry `data/registry.json` | `POST /admin/mutate M5`; delete `api-server/data/registry.json` and restart core |
| Baseline doesn't fail (returns 200) | M5 not active | check `GET http://localhost:5001/admin/state` shows `mutation: "M5"` |
| SSE feeds empty in dashboard | EventSource CORS or wrong URL | both servers use `cors()`; confirm `:8000/events` and `:5001/demo/events` return `200` |
| `data:{}` on clean call | stale registry from previous run | delete `api-server/data/registry.json`, restart core, re-register |

---

## 8. Where to go next

Phase 1 is the vertical slice. The build plan continues:
- **Phase 2 (Trust layer):** safety/confidence gate, hash-chained audit log, rollback, single-flight + loop breaker hardening.
- **Phase 3:** remaining mutations M1–M4, M6–M10, silent-200 drift detector, patch cache.
- **Phase 4:** Tier 0 (OpenAPI spec diff), Tier 2 (LLM diagnosis), Gemini orchestrator, OpenAPI importer.

See `PS01_BUILD_PLAN.md` §6 for per-phase exit gates and `README.md` for the full dev setup.
