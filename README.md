# Genesis Prototype — PS 01: Self-Healing Tool Registry

**Status: Phase 0 + Phase 1 complete.** A middleware between an agent and any HTTP API that, when the API contract drifts, notices, works out the diff from evidence, patches only what the diff requires, verifies by replay, logs every patch, never invents values, and stops instead of looping when it cannot prove a fix.

Build plan: `PS01_BUILD_PLAN.md` (frozen contract). Phase exit gates define done.

## Phase 1 progress (complete)

- Track A: classifier (pydantic-v1/v2/problem-json), Tier 1 rules (wrap, rename, type, header), patch engine, registry `compileAdapter` with provenance guard, executor invoke + heal loop (§5.1-5.3).
- Track B: versioned registry store with atomic re-register and real version history, events ring bus + SSE `/events`, `POST /apis` registration, scripted `POST /tasks` runner.
- Track C: data-driven M5 mutation engine (header first, then layered body 422s), write provenance stamping, `/admin/truth`, `/admin/mutations`.
- Track D: Drift Control stage UI with env-driven URLs, drift-aware event filtering, rounds from meta.rounds, token counters, truth check from `/admin/truth`.
- Verified: M5 heals in 4 rounds (add_header → move_field → rename_field → coerce_type), commits exactly 4 ops, succeeds in ~150ms (< 3s target); bad input never healed; missing credential halts safely; non-coercible value halts safely; all 30 unit/golden tests pass; end-to-end over HTTP.

## Stack

| Layer | Tech | Port |
|---|---|---|
| Core healing gateway | Node.js (plain JS, ESM) + Express | 8000 |
| Mock API + mutation engine | Node.js (plain JS, ESM) + Express | 5001 |
| Core dashboard | Next.js (JS) | 3000 |
| Drift Control stage UI | Next.js (JS) | 3001 |

LLM: Gemini via REST `generateContent` through the shared `@healr/llm` package. The core agent and raw-tool baseline share the same provider, system prompt, task prompt, and logical tool declarations. Tests use built-in `node:test`.

## Repo layout (plan §3)

```
root/
├── package.json             # npm workspaces
├ .env                       # created from .env.example (never committed)
├── .env.example             # copy to .env
├── scripts/dev.js           # boots all 4 apps (loads .env, warns if TENANT_ID missing)
├── contracts/               # Phase 0: frozen JSON fixtures (§4 + golden error bodies × styles)
├── api-server/              # CORE (port 8000) — registry, executor, classifier, diagnoser, patch engine, events
├── api-client/              # CORE DASHBOARD, Next.js (port 3000)
└── demo-server-and-client/
    ├── server/              # port 5001 — mock API, mutation engine, baseline agent
    └── client/              # Drift Control stage UI, Next.js (port 3001)
```

## Dev setup

1. **Copy env** (never commit `.env`):
   ```bash
   cp .env.example .env
   # edit .env: set GEMINI_API_KEYS (four comma-separated Gemini keys recommended; one key is also supported),
   # TENANT_ID (required for Phase 1 heal — X-Tenant header value)
   ```

2. **Install deps** (npm workspaces, all four apps):
   ```bash
   npm install
   ```

3. **Boot everything** (`node --watch` for the two Node apps, `next dev` for both Next apps):
   ```bash
   npm run dev
   ```

4. **Health checks** (Phase 0 exit gate: all four green):
   ```bash
   curl http://localhost:8000/health   # api-server
   curl http://localhost:5001/health   # demo-server
   curl http://localhost:3000          # api-client
   curl http://localhost:3001          # demo-client
   ```

5. **Tests** (Phase 0 exit gate: `npm test` runs green):
   ```bash
   npm test
   ```

6. **Stop**: `Ctrl+C` in the `npm run dev` terminal (all child processes are killed on SIGINT/SIGTERM).

## Ports & env (fixed by plan, never re-discussed)

- core 8000, mock 5001, dashboards 3000 and 3001
- Env: `GEMINI_API_KEYS`, legacy `GEMINI_API_KEY`, `AGENT_LLM`, `DIAGNOSER_LLM`, `BASELINE_MODE`, `LLM_MAX_CONCURRENCY`, `TIER2_TIMEOUT_MS`, `TIER2_MAX_CALLS_PER_HEAL`, `AGENT_MAX_STEPS`, `AGENT_RUN_TIMEOUT_MS`, `AGENT_MAX_CONCURRENT_RUNS`, `OPENAPI_IMPORT_TIMEOUT_MS`, `CORE_URL`, `MOCK_URL`, `TENANT_ID`, `ENABLE_DEV_ROUTES`, `NEXT_PUBLIC_CORE_URL`, `NEXT_PUBLIC_MOCK_URL`, `HEALR_DATA_DIR`, `MAX_HEAL_ROUNDS`, `HEAL_TIMEOUT_MS`

## Milestone 5: Gemini, Tier 2, and agent comparison

Configure `GEMINI_API_KEYS` as four comma-separated keys to rotate requests round robin. If it is unset, the legacy `GEMINI_API_KEY` is used. Rotation does not multiply quota: keys belonging to one Google Cloud project share that project's limits. Health and UI surfaces expose only pool size, healthy count, slot index, and slot state. `AGENT_LLM` and `DIAGNOSER_LLM` use the `gemini:model` format. `BASELINE_MODE=llm` is the default; set it to `scripted` only to explicitly compare the no-LLM backup.

Run `npm run verify:m5:live` to execute the real-key checks and write machine-readable and readable results. It exits successfully with a clear skipped message when Gemini credentials are absent. Live results are environment-specific; Milestone 5 remains incomplete until real-key verification and the manual browser checklist are recorded in `docs/M5_EVIDENCE.md`.

## Phase 0 exit gate (from `PS01_BUILD_PLAN.md` §6)

- [x] `npm run dev` starts 4 processes; all 4 health checks green
- [x] `/contracts` committed (registration payload, tool version, patch ops, invoke examples, core endpoints, SSE envelope, audit record, mock admin API, golden error bodies M1–M10 × pydantic-v1/v2/problem-json, silent-200 responses M6/M10)
- [x] `npm test` green (30 tests: paths, classifier goldens × 3 styles, Tier 1 rules, M5 heal loop, mock validator)

## Phase 1 exit gate (from `PS01_BUILD_PLAN.md` §6)

- [x] Healed task < 3s after mutation (M5, ~150ms locally)
- [x] Baseline visibly fails (iteration cap, red)
- [x] Patch ops shown and match true diff exactly (4 ops, none extra)
- [x] Register via `POST /apis` with URL + tool JSON; delete + restart mock + re-register works
- [x] Golden tests for M5 error bodies feeding Tier 1

## Next steps

Phase 2: Trust layer — safety gate, rollback, audit chain, M9 unrecoverable. See `HEALR_PHASE2_TO_FINAL_PLAN.md` (authoritative) and `PS01_BUILD_PLAN.md` for algorithms.
