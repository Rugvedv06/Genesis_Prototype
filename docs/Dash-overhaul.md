# healr api-client: dashboard redesign plan (agent handoff)

Audience: AI agents implementing the `api-client` (Next.js, port 3000) redesign. Humans: read sections 0 and 8 only.
Repo root: `Genesis_Prototype-phase2/`. Everything below was checked against the real running code (41/41 tests pass, core and mock booted, M5 heal, M9 halt, bad-input halt, audit verify, versions, diff all exercised with curl).

---

## 0. Read this first (humans)

**Verdict on "phase 2 is complete".** Partly true. Verified by running it: heal loop, versions, diff, rollback, audit hash chain, verify, metrics, traces, SSE replay all work. Not done, and they are in your must-have list: `drift-detector` (4 lines), `patch-cache` (7 lines), `/cache` returns 404, `tier0-spec` and `tier2-llm` are stubs, and no Gemini key is set in `.env.example`. I did not read the demo-client or run the baseline agent, so I cannot vouch for those. Do not let the dashboard hide this: pages for unfinished features stay out of the nav (section 3).

**Time budget (7 h left).** The judges watch the demo-client on stage, not this dashboard. Cap this redesign at about 3.5 to 4 h with parallel agents. Spend the rest on silent-200 detection, patch cache, and rehearsal. If the dashboard is at risk of eating that time, cut in this order: command palette, theme toggle, flow diagram, Playground, then Settings.

**What was wrong with the current page** (`api-client/app/page.js`, 87 lines, one route, 6 nav links that are all `#anchors`):
1. One page pretends to be six. "Live traffic", "Heals", "Audit chain", "Settings" in the nav do nothing.
2. The six metric tiles mislead. "Successful" already includes healed calls (backend: `ok` counts healed), "Success rate" therefore hides the product's whole point, and "Cache hits" is permanently 0.
3. The event feed shows raw machine strings (`patch.proposed`) with no meaning, no grouping by call, no way to open a call.
4. "Registered APIs" shows nothing about tools, versions, or health, and there is no way to register or inspect anything.
5. A static "Live" timestamp that never updates, provider health (a settings concern) on the main page, an orange-on-white admin-template look.
6. No empty-state guidance, no loading state, no error state.

**Design stance.** Dark-first developer console (Vercel/Linear/Cloudflare density), 13 px text, 1 px borders, no shadows or gradients, monospace for ids, hashes, paths and ops. Each page answers exactly one question. A new developer should understand the product from the Overview in 10 seconds: *"Agent calls go through healr. When an API changes, healr fixes the call, proves the fix, and logs it."*

---

## 1. Ground truth: what the backend really returns

Base: `CORE = http://localhost:8000` (`NEXT_PUBLIC_CORE_URL`). CORS is open. Mock admin: `MOCK = http://localhost:5001`.

| Endpoint | Real shape (captured) |
|---|---|
| `GET /state` | `{ lastEventId, apis:[{apiId, baseUrl, mode, tools:[{name, version, status, risk, sideEffects}]}], metrics:{calls, ok, healed, halted, rejected, cacheHits, tokensIn, tokensOut, buckets[]}, audit:{count, headHash, verified}, cache:{entries, hits}, circuit:[] }` |
| `GET /metrics/timeseries?window=300&step=5` | `{ series:[{t(unix sec), calls, ok, healed, halted, rejected, cacheHits}] }`. **Sparse: empty buckets are missing.** |
| `GET /apis/:id` | `{ apiId, config:{baseUrl, credentials, healing:{enabled, confidenceThreshold, maxRounds, tier2, mode?}}, tools:[{tool, version, risk, epoch}] }` |
| `GET /apis/:id/tools/:tool/versions` | `{ apiId, tool, versions:[{version, parent, rollbackOf, createdAt, origin:'register'\|'heal'\|'rollback'\|'dev', change:null\|{ops, tier, confidence, evidence, rounds, latencyMs}, adapterHash, meta:{path, method, logicalSchema, responseSchema, risk, sideEffects, identity}, adapter?}] }` |
| `GET /apis/:id/tools/:tool/diff?from=1&to=2` | `{ added:[op], removed:[op], requestBefore, requestAfter }` |
| `POST .../rollback` | body `{ "toVersion": 1 }` → `{ ok, version, rollbackOf }` (appends a NEW version) |
| `POST .../invoke` | body `{ args, runId }` → `{ ok:true, data, meta:{version, healed, rounds, tier, cacheHit, latencyMs, healMs, tokens, ops} }` or `{ ok:false, error:{code, message, retryable, details:{reason,...}} }`. HTTP is 200 for most failures. |
| `GET /audit?limit&offset&decision&apiId&tool` | `{ records:[{index, ts(ISO), prevHash, decision:'commit'\|'rollback', apiId, tool, versionBefore, versionAfter, tier, ops, confidence, evidence, callId, latencyMs, hash}], count, headHash, verified }` |
| `GET /audit/verify` | `{ ok, count, headHash, brokenAt?, reason?:'hash_mismatch'\|'tail_truncated', anchor }` |
| `POST /dev/tamper` | needs `ENABLE_DEV_ROUTES=1`, body `{ index, mode:'edit'\|'delete' }`; `POST /dev/tamper/restore` undoes it |
| `GET /traces/:callId` | `{ callId, spans:[{type, round?, tier?, status?, ms?, startOffsetMs}], startedAt, updatedAt }` |
| `GET /provider/health` | HTTP 503 `{ ok:false, provider, model, code:'missing_api_key' }` when no key |
| `GET /events?since=<id>` | SSE, flat JSON in `data:`, no `event:` names, replays the last 500 events. Optional `apiId`, `types` filters. |
| `POST /apis` | register. `DELETE /apis/:id` removes. `PATCH /apis/:id/config` allowed keys: `mode, confidenceThreshold, maxRounds, tier2, healing` |
| Mock: `GET /admin/mutations`, `POST /admin/mutate {id}`, `POST /admin/reset` | mutations today: `M5` (heals) and `M9` (halts, credential unavailable) |

Event types seen live: `api.registered, call.started, upstream.request{phase,status,ok,ms}, call.failed{code:'drift',kind}, diagnosis.started{round,kind}, patch.proposed{round,tier,ops,confidence,evidence}, patch.committed{version,ops}, patch.verified{round,status}, call.succeeded{version,healed,rounds,data}, heal.finished{outcome,rounds,ms,tier,tokens}, halt{reason,retryable}`. The contract also lists `cache.hit, drift.silent, circuit.*, audit.appended, registry.rollback, config.changed`; I did not see those fire, so handle them defensively.

### Gotchas the UI must handle (verified, do not skip)

- **G1 `/state` tool `status` is hardcoded `"healthy"`** and `cache.hits` is hardcoded 0. Derive tool health from events (section 5).
- **G2 `metrics.ok` includes healed calls.** Passthrough = `ok - healed`. Never show "Successful" next to "Healed" as if disjoint.
- **G3 timeseries is sparse.** Fill missing buckets with zeros (`fillSeries` below).
- **G4 SSE ring is in memory (500).** After a core restart the Traffic page is empty. Persistent history lives only in `/audit`. Open SSE with `since=0` on first connect so a page refresh rebuilds recent calls (the old plan's `since=lastEventId` would show an empty Traffic page after reload).
- **G5 `PATCH /apis/:id/config` replaced the whole `healing` object** when I sent `{healing:{mode:'observe'}}` (it dropped `enabled`, `confidenceThreshold`, `maxRounds`). Always read the current config, merge, send the full `healing` object. Whether `mode: 'observe'` is actually honoured by `invoke.js` is **unverified**: check `grep -n mode api-server/src/features/executor/invoke.js` before exposing the toggle; if it is not honoured, hide it.
- **G6 `call.succeeded.data` contains the raw response payload.** Show it only inside the call drawer, never in the table.
- **G7 Traces have only `startOffsetMs`, no durations for diagnosis.** Build the waterfall from events by `callId` (they carry `ts`), not from `/traces`.
- **G8 `rejected` and `failed` outcomes were not captured live.** Step 0 below captures fixtures so the derive logic is checked against reality.
- **G9 Bad input is not healed:** `user_id:"abc"` under M5 returns `error.code:'tool_unavailable'`, `details.reason:'not_lossless'`. This is a feature. Render halts with their `reason` in plain language (map in `lib/labels.js`).

---

## 2. Agent rules (paste at the top of every agent prompt)

1. Plain JS, ESM, Next.js 15 App Router. No TypeScript. Do not touch `api-server/`, `contracts/`, or `demo-server-and-client/`.
2. Only new dependency allowed: `lucide-react` (icons). I believe current releases support React 19, but verify the install resolves without peer errors; fallback is inline SVG. No Tailwind, no chart library, no UI kit, no state library.
3. **No fake data in the UI.** Every number comes from the backend. Every list has loading (skeleton), empty (guidance + action), and error (what failed, retry) states.
4. No external network at runtime: system font stacks only (no `next/font/google`, no CDN). The demo may run on bad venue wifi.
5. Never use em dashes anywhere (code, comments, UI copy, docs). Use periods, commas, colons, parentheses.
6. UI copy: short, plain, concrete. No emojis. Sentence case. Say what happened and what to do next.
7. Colour is never the only signal: every status uses icon + label + colour.
8. Before finishing: `npm run build -w api-client` passes, no console errors on any page, `node scripts/seed-dashboard.mjs` output renders correctly on every page you own.
9. Stay inside your owned files (section 9). If you need a change in a foundation file, make the smallest additive change and say so in the PR note.

### Anti-slop checklist (reject your own output if any is true)

Gradients or glass blur; card inside card; more than two font sizes inside a table; centered hero text; icon-in-a-circle decoration; random pastel colours; a tile with no decision value; any control that does nothing; hover-only critical info; raw event names shown to users; layouts that jump when data loads (reserve heights).

---

## 3. Information architecture

One page = one question. Every page has a one-sentence purpose line under the title (visible, not a tooltip).

| Route | Nav label | Question it answers | Primary data |
|---|---|---|---|
| `/` | Overview | Is healr protecting my agents right now? | store, `/metrics/timeseries` |
| `/traffic` | Live traffic | What exactly happened to each call? | store (SSE) |
| `/heals` | Drift events | When did APIs change and what did healr do? | `/audit` + halt events |
| `/apis` | APIs | What is connected and how healthy is each tool? | `/state`, `/apis/:id` |
| `/apis/[apiId]/[tool]` | (child of APIs) | What changed in this tool, and can I undo it? | versions, diff, rollback |
| `/audit` | Audit chain | Can I prove nothing was altered? | `/audit`, `/audit/verify` |
| `/playground` | Playground | Let me call a tool and break the API to watch it heal | invoke, mock admin |
| `/settings` | Settings | What is configured and is Tier 2 (LLM) available? | `/provider/health`, `/apis/:id` |

Nav groups in the sidebar: **Monitor** (Overview, Live traffic, Drift events), **Registry** (APIs), **Trust** (Audit chain), **Develop** (Playground), **System** (Settings).

**Feature flags** in `lib/features.js`. Pages for unfinished backend features are not built or shown. Flip a flag only after the endpoint exists:

```js
export const FEATURES = {
  cache: false,      // needs GET /cache (404 today) and a real patch-cache
  silentDrift: false, // needs drift-detector (stub today); enables the "silent" filter and badge
  safety: false,     // folded into Drift events (halts). Standalone page only if time remains
  metrics: false,    // benchmark page, Phase 5
};
```

**Cut from the old UI:** six-tile metrics row, "Successful" and "Success rate" tiles, static clock, provider card on the main page (moved to Settings), raw event feed (replaced by Traffic).

---

## 4. Design system

Create `api-client/app/tokens.css`, `components.css`, and import both in `layout.js`. Dark default, `[data-theme='light']` override (toggle is stretch).

### 4.1 `app/tokens.css`

```css
:root,
[data-theme='dark'] {
  color-scheme: dark;
  --bg: #09090b;
  --surface: #0f0f12;
  --surface-2: #16161a;
  --surface-3: #1d1d22;
  --border: #232329;
  --border-strong: #32323a;
  --text: #ececef;
  --text-dim: #a1a1aa;
  --text-faint: #71717a;

  --accent: #f6821f;
  --link: #6ea8ff;

  /* semantic outcome colours (use ONLY these for call/tool state) */
  --ok: #30a46c;        /* passed through untouched */
  --healed: #f6821f;    /* drift fixed by healr */
  --rejected: #4c8dff;  /* upstream rejected real bad input, not healable */
  --halted: #a371f7;    /* healr stopped safely, cannot prove a fix */
  --drift: #f5a524;     /* drift detected, in progress */
  --cache: #14b8a6;     /* served from patch cache */
  --bad: #e5484d;       /* errors, broken chain */

  --radius: 6px;
  --mono: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  --sans: ui-sans-serif, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --t-fast: 120ms;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}

[data-theme='light'] {
  color-scheme: light;
  --bg: #ffffff;
  --surface: #fafafa;
  --surface-2: #f4f4f5;
  --surface-3: #ececee;
  --border: #e4e4e7;
  --border-strong: #d4d4d8;
  --text: #18181b;
  --text-dim: #52525b;
  --text-faint: #8a8a93;
  --link: #0051c3;
}
```

### 4.2 `app/components.css` (complete, copy as is)

```css
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; border-radius: 4px; }
.mono { font-family: var(--mono); }
.num { font-variant-numeric: tabular-nums; }
.dim { color: var(--text-dim); }
.faint { color: var(--text-faint); }
.row { display: flex; align-items: center; gap: 8px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.grow { flex: 1; min-width: 0; }
.trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* shell */
.shell { display: grid; grid-template-columns: 224px 1fr; min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; padding: 12px 8px; }
.brand { display: flex; align-items: center; gap: 8px; padding: 4px 8px 16px; font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }
.brand-mark { width: 22px; height: 22px; border-radius: 5px; background: var(--accent); color: #111; display: grid; place-items: center; font-weight: 800; font-size: 13px; }
.nav-group { margin: 14px 0 4px; padding: 0 8px; color: var(--text-faint); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius); color: var(--text-dim); }
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item[aria-current='page'] { background: var(--surface-3); color: var(--text); }
.nav-badge { margin-left: auto; font-size: 11px; padding: 0 6px; border-radius: 10px; background: color-mix(in srgb, var(--halted) 18%, transparent); color: var(--halted); }
.sidebar-foot { margin-top: auto; padding: 8px; color: var(--text-faint); font-size: 11px; }
.main { min-width: 0; display: flex; flex-direction: column; }
.topbar { height: 48px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; padding: 0 24px; position: sticky; top: 0; background: color-mix(in srgb, var(--bg) 92%, transparent); z-index: 5; }
.crumbs { color: var(--text-dim); }
.crumbs b { color: var(--text); font-weight: 500; }
.page { padding: 24px; max-width: 1280px; width: 100%; margin: 0 auto; }
.page-head { margin-bottom: 20px; display: flex; align-items: flex-start; gap: 16px; }
.page-head h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.015em; }
.page-head p { margin: 4px 0 0; color: var(--text-dim); max-width: 70ch; }

/* primitives */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.card-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.card-head h2 { margin: 0; font-size: 13px; font-weight: 600; }
.card-body { padding: 14px; }
.grid { display: grid; gap: 16px; }
.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.cols-2-1 { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
@media (max-width: 1100px) { .cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .cols-2-1 { grid-template-columns: 1fr; } }
@media (max-width: 860px) { .shell { grid-template-columns: 60px 1fr; } .nav-item span, .brand span:last-child, .nav-group, .sidebar-foot { display: none; } }

.tile { padding: 14px; }
.tile-label { color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
.tile-value { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
.tile-hint { color: var(--text-faint); margin-top: 2px; font-size: 12px; }

.btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface-2); cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--surface-3); }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #111; font-weight: 600; }
.btn-primary:hover { background: color-mix(in srgb, var(--accent) 88%, white); }
.btn-danger { border-color: color-mix(in srgb, var(--bad) 50%, var(--border)); color: var(--bad); }
.btn-ghost { background: transparent; border-color: transparent; }

.pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 10px; font-size: 11px; font-weight: 500; --c: var(--text-dim); color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); border: 1px solid color-mix(in srgb, var(--c) 28%, transparent); }
.pill[data-tone='ok'] { --c: var(--ok); } .pill[data-tone='healed'] { --c: var(--healed); } .pill[data-tone='rejected'] { --c: var(--rejected); }
.pill[data-tone='halted'] { --c: var(--halted); } .pill[data-tone='drift'] { --c: var(--drift); } .pill[data-tone='cache'] { --c: var(--cache); }
.pill[data-tone='bad'] { --c: var(--bad); } .pill[data-tone='live'] { --c: var(--ok); }

.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 4px; font: 11px var(--mono); background: var(--surface-3); border: 1px solid var(--border); color: var(--text-dim); }
.chip[data-op='add_header'] { color: var(--cache); } .chip[data-op='move_field'], .chip[data-op='rename_field'] { color: var(--healed); } .chip[data-op='coerce_type'] { color: var(--rejected); }

.table { width: 100%; border-collapse: collapse; }
.table th { position: sticky; top: 48px; background: var(--surface); text-align: left; font-weight: 500; color: var(--text-faint); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 14px; border-bottom: 1px solid var(--border); }
.table td { padding: 9px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.table tr[data-click] { cursor: pointer; }
.table tr[data-click]:hover td { background: var(--surface-2); }
.table tr:last-child td { border-bottom: 0; }

.empty { padding: 40px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-dim); }
.empty h3 { margin: 0; color: var(--text); font-size: 14px; font-weight: 600; }
.empty p { margin: 0; max-width: 52ch; }
.empty .row { margin-top: 8px; }
.skeleton { background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; border-radius: 4px; min-height: 14px; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } * { transition: none !important; } }

.drawer-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 20; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); background: var(--surface); border-left: 1px solid var(--border-strong); z-index: 21; display: flex; flex-direction: column; }
.drawer-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.drawer-body { overflow: auto; padding: 16px; }
.modal { position: fixed; top: 20vh; left: 50%; transform: translateX(-50%); width: min(440px, 92vw); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; z-index: 31; padding: 16px; }
.code { margin: 0; padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); font: 12px/1.6 var(--mono); overflow: auto; max-height: 360px; }
.input, .select { height: 28px; padding: 0 8px; background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--text); font: inherit; }
.input.mono { font-family: var(--mono); }
textarea.input { height: auto; padding: 8px; }
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); }
.tab { padding: 8px 12px; border: 0; background: none; color: var(--text-dim); cursor: pointer; border-bottom: 2px solid transparent; }
.tab[aria-selected='true'] { color: var(--text); border-bottom-color: var(--accent); }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; }
.kv dt { color: var(--text-faint); } .kv dd { margin: 0; min-width: 0; }
.toast-wrap { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 40; }
.toast { padding: 10px 14px; background: var(--surface-3); border: 1px solid var(--border-strong); border-radius: var(--radius); min-width: 240px; }
.toast[data-kind='error'] { border-color: var(--bad); }
.timeline { position: relative; margin: 0; padding: 0 0 0 18px; list-style: none; }
.timeline::before { content: ''; position: absolute; left: 4px; top: 6px; bottom: 6px; width: 1px; background: var(--border-strong); }
.timeline li { position: relative; padding: 0 0 14px; }
.timeline li::before { content: ''; position: absolute; left: -18px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--dot, var(--text-faint)); border: 2px solid var(--surface); }
.chain { display: flex; gap: 0; overflow-x: auto; padding: 12px 4px 16px; }
.block { flex: none; width: 188px; padding: 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); }
.block[data-broken='true'] { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, var(--surface-2)); }
.link { flex: none; width: 20px; align-self: center; height: 1px; background: var(--border-strong); }
```

### 4.3 Status semantics (single source: `lib/labels.js`)

```js
export const OUTCOME = {
  inflight:    { tone: 'drift',    label: 'In flight',  hint: 'Call is still running' },
  passthrough: { tone: 'ok',       label: 'Passed',     hint: 'API accepted the call unchanged' },
  healed:      { tone: 'healed',   label: 'Healed',     hint: 'API changed. healr fixed the call and proved it with a replay' },
  cache:       { tone: 'cache',    label: 'Cache hit',  hint: 'A previously proven fix was reused' },
  rejected:    { tone: 'rejected', label: 'Rejected',   hint: 'The API refused the input itself. Nothing to heal' },
  halted:      { tone: 'halted',   label: 'Halted',     hint: 'healr could not prove a safe fix and stopped on purpose' },
  failed:      { tone: 'bad',      label: 'Failed',     hint: 'Unexpected error' },
};

export const HALT_REASON = {
  credential_unavailable: 'A required credential is not configured, so healr will not guess it.',
  not_lossless: 'The fix would change the value (for example "abc" to a number). healr only applies lossless fixes.',
  provenance_violation: 'The fix would send a value that did not come from the caller, the spec, or a credential.',
  low_confidence: 'The proposed fix was below the confidence threshold.',
  max_rounds: 'The heal budget ran out before the call succeeded.',
  circuit_open: 'Too many failed heals. healr paused this tool.',
};
export const haltReason = (r) => HALT_REASON[r] ?? `Stopped: ${r}`;

export const EVENT_LABEL = {
  'call.started': 'Call started', 'upstream.request': 'Sent to API', 'call.failed': 'API rejected the call',
  'diagnosis.started': 'Diagnosing', 'patch.proposed': 'Fix proposed', 'patch.verified': 'Fix verified by replay',
  'patch.committed': 'Fix committed', 'call.succeeded': 'Call succeeded', 'heal.started': 'Heal started',
  'heal.finished': 'Heal finished', halt: 'Halted safely', 'cache.hit': 'Cache hit', 'drift.silent': 'Silent drift detected',
  'registry.rollback': 'Rolled back', 'api.registered': 'API registered', 'api.removed': 'API removed',
};

// Human sentence for a typed patch op. Used by OpChip, call drawer, version timeline.
export function describeOp(op) {
  switch (op.op) {
    case 'add_header':    return `Add header ${op.name}`;
    case 'move_field':    return `Move ${op.from} to ${op.to}`;
    case 'rename_field':  return `Rename ${op.from} to ${op.to}${op.path ? ` (inside ${op.path})` : ''}`;
    case 'coerce_type':   return `Convert ${op.path} from ${op.from} to ${op.to}`;
    case 'add_field':     return `Add field ${op.path}`;
    case 'set_enum_map':  return `Map enum values at ${op.path}`;
    case 'remap_response_path': return `Read ${op.logical} from ${op.to}`;
    default:              return op.op;
  }
}
export const opSource = (op) => op.source ? `${op.source.type}:${op.source.ref ?? ''}` : null;
```

---

## 5. Data layer (build first, everything depends on it)

One store, one SSE connection, shared by all pages. Files under `api-client/lib/`.

### 5.1 `lib/core.js`

```js
export const CORE = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000';
export const MOCK = process.env.NEXT_PUBLIC_MOCK_URL || 'http://localhost:5001';

export class CoreError extends Error {
  constructor(message, status, body) { super(message); this.name = 'CoreError'; this.status = status; this.body = body; }
}

// Never throws on HTTP status. Throws CoreError only on network failure or timeout.
async function raw(base, path, { method = 'GET', body, timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    throw new CoreError(err.name === 'AbortError' ? `Timed out after ${timeout} ms` : 'Cannot reach healr core', 0, null);
  } finally {
    clearTimeout(timer);
  }
}

// Throws CoreError on non-2xx.
async function strict(base, path, opts) {
  const r = await raw(base, path, opts);
  if (!r.ok) throw new CoreError(r.data?.message ?? r.data?.error ?? `HTTP ${r.status}`, r.status, r.data);
  return r.data;
}

const e = encodeURIComponent;
export const api = {
  state: () => strict(CORE, '/state'),
  series: (windowSec = 300, step = 5) => strict(CORE, `/metrics/timeseries?window=${windowSec}&step=${step}`),
  apiDetail: (id) => strict(CORE, `/apis/${e(id)}`),
  versions: (id, tool) => strict(CORE, `/apis/${e(id)}/tools/${e(tool)}/versions`),
  diff: (id, tool, from, to) => strict(CORE, `/apis/${e(id)}/tools/${e(tool)}/diff?from=${from}&to=${to}`),
  rollback: (id, tool, toVersion) => strict(CORE, `/apis/${e(id)}/tools/${e(tool)}/rollback`, { method: 'POST', body: { toVersion } }),
  patchConfig: (id, patch) => strict(CORE, `/apis/${e(id)}/config`, { method: 'PATCH', body: patch }),
  register: (payload) => strict(CORE, '/apis', { method: 'POST', body: payload }),
  remove: (id) => strict(CORE, `/apis/${e(id)}`, { method: 'DELETE' }),
  // invoke returns the body even when ok:false (HTTP 200 or 400). Only network errors throw.
  invoke: async (id, tool, args, runId) => (await raw(CORE, `/apis/${e(id)}/tools/${e(tool)}/invoke`, { method: 'POST', body: { args, runId }, timeout: 15000 })).data,
  audit: ({ limit = 100, offset = 0, decision, apiId, tool } = {}) => {
    const q = new URLSearchParams({ limit, offset, ...(decision && { decision }), ...(apiId && { apiId }), ...(tool && { tool }) });
    return strict(CORE, `/audit?${q}`);
  },
  auditVerify: () => strict(CORE, '/audit/verify'),
  auditExportUrl: `${CORE}/audit/export`,
  trace: (callId) => strict(CORE, `/traces/${e(callId)}`),
  providerHealth: async () => (await raw(CORE, '/provider/health')).data,
  tamper: (index, mode) => strict(CORE, '/dev/tamper', { method: 'POST', body: { index, mode } }),
  tamperRestore: () => strict(CORE, '/dev/tamper/restore', { method: 'POST' }),
};

export const mock = {
  mutations: () => strict(MOCK, '/admin/mutations', { timeout: 3000 }),
  mutate: (id) => strict(MOCK, '/admin/mutate', { method: 'POST', body: { id } }),
  reset: () => strict(MOCK, '/admin/reset', { method: 'POST' }),
};
```

### 5.2 `lib/sse.js`

```js
// Reconnects with backoff and resumes from the last seen id. Server sends only `id:` and `data:` lines.
export function connectSSE({ url, getLastId, onOpen, onEvent, onError }) {
  let es = null;
  let closed = false;
  let retry = 0;
  let timer = null;
  const open = () => {
    if (closed) return;
    es = new EventSource(`${url}?since=${getLastId()}`);
    es.onopen = () => { retry = 0; onOpen(); };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore malformed frame */ } };
    es.onerror = () => {
      onError();
      es.close();
      timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 8000));
    };
  };
  open();
  return () => { closed = true; clearTimeout(timer); es?.close(); };
}
```

### 5.3 `lib/derive.js` (event → call model, selectors, series fill)

```js
// A "call" is every event sharing a callId, folded into one record.
export function newCall(e) {
  return {
    callId: e.callId, runId: e.runId ?? null, apiId: e.apiId, tool: e.tool,
    startedAt: e.ts, endedAt: null, outcome: 'inflight',
    drift: false, driftKind: null, silent: false, rounds: 0, tier: null,
    proposals: [], ops: [], version: null, cacheHit: false, reason: null, code: null,
    healMs: null, upstream: [], data: null, events: [],
  };
}

export function foldEvent(call, e) {
  const c = { ...call, events: [...call.events, e] };
  switch (e.type) {
    case 'upstream.request': c.upstream = [...c.upstream, { phase: e.phase, status: e.status, ms: e.ms, ts: e.ts }]; break;
    case 'call.failed':
      if (e.code === 'drift') { c.drift = true; c.driftKind = e.kind ?? null; }
      else { c.outcome = e.code === 'upstream_rejected' ? 'rejected' : 'failed'; c.code = e.code; c.endedAt = e.ts; }
      break;
    case 'drift.silent': c.drift = true; c.silent = true; break;
    case 'diagnosis.started': c.rounds = Math.max(c.rounds, e.round ?? 0); break;
    case 'patch.proposed': c.tier = e.tier ?? c.tier; c.proposals = [...c.proposals, { round: e.round, tier: e.tier, ops: e.ops ?? [], confidence: e.confidence, evidence: e.evidence ?? [] }]; break;
    case 'patch.committed': c.version = e.version ?? c.version; c.ops = e.ops ?? c.ops; break;
    case 'cache.hit': c.cacheHit = true; break;
    case 'heal.finished': c.healMs = e.ms ?? c.healMs; c.tier = e.tier ?? c.tier; c.rounds = e.rounds ?? c.rounds; break;
    case 'call.succeeded':
      c.outcome = c.cacheHit ? 'cache' : e.healed ? 'healed' : 'passthrough';
      c.version = e.version ?? c.version; c.rounds = e.rounds ?? c.rounds; c.data = e.data ?? null; c.endedAt = e.ts; break;
    case 'halt': c.outcome = 'halted'; c.reason = e.reason; c.endedAt = e.ts; break;
    default: break;
  }
  return c;
}

export const durationMs = (c) => (c.endedAt ? c.endedAt - c.startedAt : null);

// Tool health from calls + registry. /state.status is hardcoded "healthy" (G1), so ignore it.
export function toolHealth(apis, calls) {
  const out = [];
  for (const a of apis) {
    for (const t of a.tools) {
      const mine = calls.filter((c) => c.apiId === a.apiId && c.tool === t.name);
      const last = mine.find((c) => c.outcome !== 'inflight');
      const lastDrift = mine.find((c) => c.drift || c.outcome === 'halted');
      let status = 'healthy';
      if (last?.outcome === 'halted') status = 'halted';
      else if (t.version > 1) status = 'healed';
      out.push({ apiId: a.apiId, tool: t.name, version: t.version, risk: t.risk, sideEffects: t.sideEffects, status, lastDriftAt: lastDrift?.startedAt ?? null, calls: mine.length });
    }
  }
  return out;
}

// /metrics/timeseries is sparse (G3) and ok includes healed (G2).
export function fillSeries(series, windowSec, stepSec, nowSec = Math.floor(Date.now() / 1000)) {
  const end = Math.floor(nowSec / stepSec) * stepSec;
  const byT = new Map(series.map((p) => [Math.floor(p.t / stepSec) * stepSec, p]));
  const out = [];
  for (let t = end - windowSec + stepSec; t <= end; t += stepSec) {
    const p = byT.get(t);
    const healed = p?.healed ?? 0;
    out.push({ t, passthrough: Math.max(0, (p?.ok ?? 0) - healed), healed, rejected: p?.rejected ?? 0, halted: p?.halted ?? 0, calls: p?.calls ?? 0 });
  }
  return out;
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function timeAgo(ts, now = Date.now()) {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
```

### 5.4 `lib/store.js` (singleton, `useSyncExternalStore`)

```js
'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { api, CORE } from './core';
import { connectSSE } from './sse';
import { newCall, foldEvent } from './derive';

const MAX_EVENTS = 2000;
const MAX_CALLS = 1000;
const REFRESH_ON = new Set(['api.registered', 'api.removed', 'patch.committed', 'registry.rollback', 'config.changed', 'audit.appended']);

const s = {
  conn: 'connecting',          // connecting | live | reconnecting | offline
  bootstrapped: false,
  error: null,
  lastId: 0,
  events: [],                  // newest first
  calls: new Map(),            // callId -> call
  order: [],                   // callIds, newest first
  apis: [], metrics: null, audit: null, cache: null, circuit: [],
};
let snapshot = { ...s };
const listeners = new Set();
let pending = [];
let flushTimer = null;
let refreshTimer = null;
let started = false;

const publish = () => { snapshot = { ...s }; listeners.forEach((l) => l()); };

function flush() {
  flushTimer = null;
  if (!pending.length) return;
  const batch = pending; pending = [];
  let needRefresh = false;
  for (const e of batch) {
    s.lastId = Math.max(s.lastId, e.id ?? 0);
    if (REFRESH_ON.has(e.type)) needRefresh = true;
    if (e.callId) {
      const prev = s.calls.get(e.callId);
      if (!prev) { s.order.unshift(e.callId); if (s.order.length > MAX_CALLS) s.calls.delete(s.order.pop()); }
      s.calls.set(e.callId, foldEvent(prev ?? newCall(e), e));
    }
  }
  s.events = [...batch.reverse(), ...s.events].slice(0, MAX_EVENTS);
  publish();
  if (needRefresh) scheduleRefresh(400);
}

async function refresh() {
  try {
    const st = await api.state();
    Object.assign(s, { apis: st.apis ?? [], metrics: st.metrics ?? null, audit: st.audit ?? null, cache: st.cache ?? null, circuit: st.circuit ?? [], bootstrapped: true, error: null });
    if (s.conn === 'offline') s.conn = 'reconnecting';
  } catch (err) {
    s.error = err.message; s.conn = 'offline'; s.bootstrapped = true;
  }
  publish();
}
function scheduleRefresh(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, ms); }

export function startStore() {
  if (started || typeof window === 'undefined') return;
  started = true;
  refresh();
  setInterval(refresh, 5000);
  connectSSE({
    url: `${CORE}/events`,
    getLastId: () => s.lastId,                 // 0 on first connect: replay the ring buffer (G4)
    onOpen: () => { s.conn = 'live'; publish(); },
    onError: () => { if (s.conn !== 'offline') s.conn = 'reconnecting'; publish(); },
    onEvent: (e) => { pending.push(e); if (!flushTimer) flushTimer = setTimeout(flush, 120); },
  });
}

export function useStore() {
  useEffect(() => { startStore(); }, []);
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => snapshot,
    () => snapshot,
  );
}
export const refreshState = () => refresh();
```

### 5.5 `lib/hooks.js`

```js
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync(fn, deps = []) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn); fnRef.current = fn;
  useEffect(() => {
    let live = true;
    setSt((p) => ({ ...p, loading: true }));
    fnRef.current().then((data) => live && setSt({ data, error: null, loading: false }))
      .catch((error) => live && setSt({ data: null, error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...st, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function usePolling(fn, ms, deps = []) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn); fnRef.current = fn;
  useEffect(() => {
    let live = true; let timer;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try { const data = await fnRef.current(); if (live) setSt({ data, error: null, loading: false }); }
        catch (error) { if (live) setSt((p) => ({ ...p, error, loading: false })); }
      }
      if (live) timer = setTimeout(tick, ms);
    };
    tick();
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

// Re-render every second so "5s ago" labels stay honest.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
```

### 5.6 `lib/toast.js` and `lib/demo-registration.js`

```js
// lib/toast.js
'use client';
import { useSyncExternalStore } from 'react';
let items = []; const ls = new Set();
const emit = () => ls.forEach((l) => l());
export function toast(message, kind = 'info') {
  const id = Math.random().toString(36).slice(2);
  items = [...items, { id, message, kind }]; emit();
  setTimeout(() => { items = items.filter((t) => t.id !== id); emit(); }, 4000);
}
export const useToasts = () => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => items, () => items);
```

```js
// lib/demo-registration.js  (one-click first run; matches contracts/registration.payload.json)
import { MOCK } from './core';
export const demoRegistration = () => ({
  apiId: 'demo-users',
  baseUrl: MOCK,
  specUrl: `${MOCK}/openapi.json`,
  credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
  healing: { enabled: true, confidenceThreshold: 0.85, maxRounds: 5, tier2: true },
  tools: [
    { name: 'get_user', description: 'Fetch a user by id', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, name: { path: 'result.name', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true } } } },
    { name: 'update_user_email', description: "Update a user's email", method: 'POST', path: '/api/users/update-email', risk: 'medium', sideEffects: 'write', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true }, updated_at: { path: 'result.updated_at', type: 'string', required: true } } } },
  ],
});
```

---

## 6. Shared components (`api-client/components/`)

Foundation agent builds all of these before page agents start. Small, plain, props documented by the code itself.

```jsx
// components/ui.jsx
'use client';
import { useState } from 'react';
import { Check, Copy, CircleDot, ShieldAlert, Wrench, ArrowRightLeft, Zap, X, CircleAlert } from 'lucide-react';
import { OUTCOME, describeOp, opSource } from '../lib/labels';

const ICON = { inflight: CircleDot, passthrough: Check, healed: Wrench, cache: Zap, rejected: ArrowRightLeft, halted: ShieldAlert, failed: CircleAlert };

export function OutcomePill({ outcome }) {
  const o = OUTCOME[outcome] ?? OUTCOME.failed; const Icon = ICON[outcome] ?? CircleAlert;
  return <span className="pill" data-tone={o.tone} title={o.hint}><Icon size={12} aria-hidden />{o.label}</span>;
}

export function Pill({ tone, children, icon: Icon }) {
  return <span className="pill" data-tone={tone}>{Icon && <Icon size={12} aria-hidden />}{children}</span>;
}

export function PageHeader({ title, purpose, actions }) {
  return (
    <header className="page-head">
      <div className="grow"><h1>{title}</h1>{purpose && <p>{purpose}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Card({ title, right, children, flush }) {
  return (
    <section className="card">
      {(title || right) && <div className="card-head"><h2 className="grow">{title}</h2>{right}</div>}
      {flush ? children : <div className="card-body">{children}</div>}
    </section>
  );
}

export function StatTile({ label, value, hint, tone, icon: Icon }) {
  return (
    <div className="card tile">
      <div className="tile-label">{Icon && <Icon size={14} aria-hidden style={{ color: tone ? `var(--${tone})` : undefined }} />}{label}</div>
      <div className="tile-value" style={{ color: tone ? `var(--${tone})` : undefined }}>{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={22} aria-hidden style={{ color: 'var(--text-faint)' }} />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="row">{action}</div>}
    </div>
  );
}

export const Skeleton = ({ h = 14, w = '100%' }) => <div className="skeleton" style={{ height: h, width: w }} />;

export function ErrorState({ error, onRetry, what = 'data' }) {
  return (
    <EmptyState icon={CircleAlert} title={`Could not load ${what}`} action={onRetry && <button className="btn" onClick={onRetry}>Retry</button>}>
      {error?.message ?? 'Unknown error'}. Check that healr core is running at the URL shown in Settings.
    </EmptyState>
  );
}

export function OpChip({ op }) {
  const src = opSource(op);
  return <span className="chip" data-op={op.op} title={`${describeOp(op)}${src ? ` (source: ${src})` : ''}`}>{op.op}</span>;
}

export function HashChip({ hash, n = 8 }) {
  const [done, setDone] = useState(false);
  if (!hash) return <span className="faint mono">none</span>;
  return (
    <button className="chip" title={hash} onClick={() => { navigator.clipboard?.writeText(hash); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {hash.slice(0, n)}{done ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

export function Drawer({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-head"><h2 className="grow" style={{ margin: 0, fontSize: 14 }}>{title}</h2><button className="btn btn-ghost" onClick={onClose} aria-label="Close"><X size={14} /></button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ open, onClose, title, children, actions }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 30 }} />
      <div className="modal" role="dialog" aria-label={title}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>{title}</h2>
        <div className="dim">{children}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>{actions}</div>
      </div>
    </>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} className="tab" onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}
```

```jsx
// components/charts.jsx
export function StackedBars({ data, height = 140 }) {
  const w = 600;
  const keys = ['passthrough', 'healed', 'rejected', 'halted'];
  const color = { passthrough: 'var(--ok)', healed: 'var(--healed)', rejected: 'var(--rejected)', halted: 'var(--halted)' };
  const max = Math.max(1, ...data.map((d) => keys.reduce((n, k) => n + d[k], 0)));
  const bw = w / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label="Call outcomes over time">
      <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} stroke="var(--border-strong)" />
      {data.map((d, i) => {
        let y = height;
        return keys.map((k) => {
          const h = (d[k] / max) * (height - 6);
          y -= h;
          return h > 0 ? <rect key={`${i}-${k}`} x={i * bw + 1} y={y} width={Math.max(1, bw - 2)} height={h} rx="1" fill={color[k]} /> : null;
        });
      })}
    </svg>
  );
}

export function Legend() {
  const items = [['ok', 'Passed'], ['healed', 'Healed'], ['rejected', 'Rejected'], ['halted', 'Halted']];
  return <div className="row dim" style={{ gap: 14 }}>{items.map(([c, l]) => <span key={c} className="row" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: `var(--${c})` }} />{l}</span>)}</div>;
}
```

### 6.1 Shell

```js
// lib/nav.js
import { LayoutDashboard, Activity, GitPullRequestArrow, Boxes, ShieldCheck, FlaskConical, Settings } from 'lucide-react';
export const NAV = [
  { group: 'Monitor', items: [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/traffic', label: 'Live traffic', icon: Activity },
    { href: '/heals', label: 'Drift events', icon: GitPullRequestArrow },
  ] },
  { group: 'Registry', items: [{ href: '/apis', label: 'APIs', icon: Boxes }] },
  { group: 'Trust', items: [{ href: '/audit', label: 'Audit chain', icon: ShieldCheck }] },
  { group: 'Develop', items: [{ href: '/playground', label: 'Playground', icon: FlaskConical }] },
  { group: 'System', items: [{ href: '/settings', label: 'Settings', icon: Settings }] },
];
```

```jsx
// components/Shell.jsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '../lib/nav';
import { useStore } from '../lib/store';
import { useToasts } from '../lib/toast';
import { Pill, HashChip } from './ui';

function Connection({ conn }) {
  const map = { live: ['live', 'Live'], connecting: ['drift', 'Connecting'], reconnecting: ['drift', 'Reconnecting'], offline: ['bad', 'Core offline'] };
  const [tone, label] = map[conn] ?? map.offline;
  return <Pill tone={tone}>{label}</Pill>;
}

export default function Shell({ children }) {
  const path = usePathname();
  const { conn, audit, apis } = useStore();
  const toasts = useToasts();
  const active = (href) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">h</span><span>healr</span></div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="nav-item" aria-current={active(href) ? 'page' : undefined}><Icon size={15} aria-hidden /><span>{label}</span></Link>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">{apis.length} API{apis.length === 1 ? '' : 's'} connected</div>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="crumbs"><b>{NAV.flatMap((g) => g.items).find((i) => active(i.href) && (i.href !== '/' || path === '/'))?.label ?? 'healr'}</b></span>
          <span className="grow" />
          {audit?.headHash && <span className="row dim" title="Head of the hash chained audit log">chain head <HashChip hash={audit.headHash} /></span>}
          <Connection conn={conn} />
        </div>
        <main className="page">{children}</main>
      </div>
      <div className="toast-wrap">{toasts.map((t) => <div key={t.id} className="toast" data-kind={t.kind}>{t.message}</div>)}</div>
    </div>
  );
}
```

```jsx
// app/layout.js
import './tokens.css';
import './components.css';
import Shell from '../components/Shell';

export const metadata = { title: 'healr', description: 'Self-healing tool registry for AI agents' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
```

Delete the old `app/globals.css` and the old `app/page.js` when the new Overview lands.

---

## 7. Page specs

Each spec: **purpose line (exact copy)**, layout, data binding, empty / loading / error states, interactions, done checks. Every table row that has detail opens a drawer or navigates; nothing is decorative.

### 7.1 Overview `/` (reference implementation, complete)

Purpose: "Agent calls pass through healr. When an API changes, healr fixes the call, proves the fix by replay, and logs it."

```
┌ Calls handled ─┐ ┌ Auto healed ───┐ ┌ Halted safely ─┐ ┌ Median heal time ┐
│ 128            │ │ 14             │ │ 2              │ │ 138 ms           │
│ since start    │ │ would have     │ │ unsafe, stopped│ │ over 14 heals    │
│                │ │ failed         │ │ on purpose     │ │                  │
└────────────────┘ └────────────────┘ └────────────────┘ └──────────────────┘
┌ Outcomes, last 5 min ───────────────────────────┐ ┌ Tool health ──────────┐
│ stacked bars + legend                           │ │ api.tool  v3  Healed  │
│                                                 │ │ api.tool  v1  Healthy │
└─────────────────────────────────────────────────┘ └───────────────────────┘
┌ Recent drift activity (healed, halted, rejected; last 8) ── View all ─────┐
```

- Tiles: Calls handled = `metrics.calls`; Auto healed = `metrics.healed` with hint "calls that would have failed without healr"; Halted safely = `metrics.halted`; Median heal time = `median` of `healMs ?? durationMs` over healed calls in the store (hint shows the sample count, `n/a` when 0).
- Chart: `usePolling(api.series(300, 5), 2000)` → `fillSeries(series, 300, 5)` → `StackedBars`. Passthrough = ok minus healed.
- Tool health list: `toolHealth(apis, calls)`; each row links to `/apis/<apiId>/<tool>`.
- Recent activity: from store `calls` filtered to outcome in `healed|halted|rejected|cache`, newest 8, row click goes to `/traffic?call=<callId>`.
- **Empty (no APIs):** big "How healr works" 3-step strip (Agent calls a tool → healr checks the response and, on drift, diagnoses and patches → every fix is verified, versioned and written to a tamper-evident log) plus primary button **Register demo API** (POST `demoRegistration()`, toast, `refreshState()`) and secondary link "Register your own API" to `/apis`.
- **Empty (APIs but zero calls):** tiles show 0, chart card shows EmptyState "No traffic yet" with hint "Send a call from the Playground or run an agent" and a button to `/playground`.
- **Offline:** `ErrorState` replacing the whole page body, with Retry calling `refreshState`.

```jsx
// app/page.js
'use client';
import Link from 'next/link';
import { Activity, Wrench, ShieldAlert, Timer, Boxes, Rocket } from 'lucide-react';
import { useStore, refreshState } from '../lib/store';
import { usePolling, useNow } from '../lib/hooks';
import { api } from '../lib/core';
import { demoRegistration } from '../lib/demo-registration';
import { toast } from '../lib/toast';
import { fillSeries, toolHealth, median, durationMs, timeAgo } from '../lib/derive';
import { PageHeader, StatTile, Card, EmptyState, ErrorState, OutcomePill, OpChip, Pill, Skeleton } from '../components/ui';
import { StackedBars, Legend } from '../components/charts';

const HEALTH_TONE = { healthy: 'ok', healed: 'healed', halted: 'halted' };

function HowItWorks({ onRegister }) {
  const steps = [
    ['1', 'Your agent calls a tool', 'Calls go to healr instead of straight to the API.'],
    ['2', 'The API changes under it', 'healr sees the failure, reads the evidence, and proposes the smallest typed fix.'],
    ['3', 'Fix is proven and logged', 'The fix is replayed, versioned, and written to a hash chained audit log. If it cannot be proven, healr stops.'],
  ];
  return (
    <Card>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {steps.map(([n, t, d]) => <div key={n}><div className="faint mono">{n}</div><b>{t}</b><p className="dim" style={{ margin: '4px 0 0' }}>{d}</p></div>)}
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn btn-primary" onClick={onRegister}><Rocket size={14} />Register demo API</button>
        <Link className="btn" href="/apis">Register your own API</Link>
      </div>
    </Card>
  );
}

export default function Overview() {
  const { bootstrapped, error, apis, metrics, calls, order } = useStore();
  const now = useNow(5000);
  const series = usePolling(() => api.series(300, 5), 2000, []);

  if (!bootstrapped) return <div className="stack"><Skeleton h={28} w={240} /><Skeleton h={90} /><Skeleton h={200} /></div>;
  if (error && !apis.length) return <ErrorState error={{ message: error }} onRetry={refreshState} what="overview" />;

  const register = async () => {
    try { await api.register(demoRegistration()); toast('Demo API registered'); refreshState(); }
    catch (e) { toast(`Registration failed: ${e.message}`, 'error'); }
  };

  const all = order.map((id) => calls.get(id));
  const healedCalls = all.filter((c) => c.outcome === 'healed');
  const med = median(healedCalls.map((c) => c.healMs ?? durationMs(c)).filter((n) => n != null));
  const recent = all.filter((c) => ['healed', 'halted', 'rejected', 'cache'].includes(c.outcome)).slice(0, 8);
  const health = toolHealth(apis, all);
  const m = metrics ?? {};

  return (
    <div className="stack" style={{ gap: 16 }}>
      <PageHeader title="Overview" purpose="Agent calls pass through healr. When an API changes, healr fixes the call, proves the fix by replay, and logs it." />
      {!apis.length ? <HowItWorks onRegister={register} /> : (
        <>
          <div className="grid cols-4">
            <StatTile icon={Activity} label="Calls handled" value={m.calls ?? 0} hint="since core started" />
            <StatTile icon={Wrench} tone="healed" label="Auto healed" value={m.healed ?? 0} hint="would have failed without healr" />
            <StatTile icon={ShieldAlert} tone="halted" label="Halted safely" value={m.halted ?? 0} hint="unsafe to fix, stopped on purpose" />
            <StatTile icon={Timer} label="Median heal time" value={med == null ? 'n/a' : `${med} ms`} hint={`over ${healedCalls.length} heal${healedCalls.length === 1 ? '' : 's'} this session`} />
          </div>
          <div className="grid cols-2-1">
            <Card title="Outcomes, last 5 minutes" right={<Legend />}>
              {series.loading ? <Skeleton h={140} /> : series.error && !series.data ? <ErrorState error={series.error} what="chart" /> :
                (m.calls ?? 0) === 0 ? <EmptyState icon={Activity} title="No traffic yet" action={<Link className="btn" href="/playground">Open Playground</Link>}>Send a call from the Playground or point an agent at healr.</EmptyState> :
                <StackedBars data={fillSeries(series.data?.series ?? [], 300, 5)} />}
            </Card>
            <Card title="Tool health" flush>
              <table className="table"><tbody>
                {health.map((h) => (
                  <tr key={`${h.apiId}.${h.tool}`} data-click onClick={() => (location.href = `/apis/${h.apiId}/${h.tool}`)}>
                    <td><div className="mono trunc">{h.apiId}.{h.tool}</div></td>
                    <td className="mono dim">v{h.version}</td>
                    <td><Pill tone={HEALTH_TONE[h.status]}>{h.status === 'healed' ? 'Healed' : h.status === 'halted' ? 'Halted' : 'Healthy'}</Pill></td>
                  </tr>
                ))}
              </tbody></table>
            </Card>
          </div>
          <Card title="Recent drift activity" right={<Link className="btn btn-ghost" href="/traffic">View all traffic</Link>} flush>
            {!recent.length ? <EmptyState title="No drift seen yet">When an API changes shape, healed and halted calls show up here.</EmptyState> : (
              <table className="table"><tbody>
                {recent.map((c) => (
                  <tr key={c.callId} data-click onClick={() => (location.href = `/traffic?call=${c.callId}`)}>
                    <td className="dim num" style={{ width: 90 }}>{timeAgo(c.startedAt, now)}</td>
                    <td className="mono">{c.apiId}.{c.tool}</td>
                    <td><OutcomePill outcome={c.outcome} /></td>
                    <td><span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{c.ops.map((o, i) => <OpChip key={i} op={o} />)}</span></td>
                    <td className="dim num" style={{ textAlign: 'right' }}>{c.rounds ? `${c.rounds} round${c.rounds === 1 ? '' : 's'}` : ''}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
```

Note: use `useRouter().push` instead of `location.href` if you want soft navigation; the snippet keeps it dependency free. Agents may upgrade it.

### 7.2 Live traffic `/traffic`

Purpose: "Every call that went through healr, with what happened to it. Click a call to see the full story."

- Layout: filter bar (outcome segmented: All / Healed / Halted / Rejected / Passed; API select; tool select; free text on callId or runId), then table, newest first. Rows: time, `api.tool`, `OutcomePill`, version (`v2`), rounds, tier chip (`T1`), duration, runId (mono, dim).
- Live behaviour: new rows appear at top; do not auto-scroll the user. A "Pause" toggle freezes the list (snapshot ref) and shows "N new calls" button.
- **Call drawer** (`?call=<id>` in the URL so it is linkable, open on row click) has three sections:
  1. Summary `dl.kv`: outcome, version change, tier, rounds, total time, runId, and for halts the `haltReason(reason)` sentence.
  2. **Timeline** (`ul.timeline`) built from `call.events`, labels from `EVENT_LABEL`, offset `+Nms` from `startedAt`, dot colour by event (`call.failed` drift = `--drift`, `patch.verified` = `--ok`, `halt` = `--halted`). `patch.proposed` rows list ops via `describeOp`, confidence, and evidence (first 2 items, mono).
  3. **Waterfall**: one horizontal bar per phase from event offsets (live request, each diagnosis round, verify), widths proportional to total duration, with total label "MTTR 135 ms".
  4. Response payload `CodeBlock` (`call.data`, JSON, collapsed by default because of G6).
- **Empty (no calls):** EmptyState "No traffic yet. Calls appear here live." + button to Playground. **Empty (filters hide all):** "No calls match these filters" + Clear filters.
- Stretch (only after everything else is done): `FlowDiagram` strip above the table (Agent → healr v3 → API with CSS packet dots per `call.started` and `upstream.request`, violet STOP glyph on `halt`). Keep under 150 lines. Skip if behind schedule.

### 7.3 Drift events `/heals`

Purpose: "The moments an API changed under your agents, what healr did about it, and when it chose to stop."

- Source: `api.audit({limit:200})` (persistent commits and rollbacks) merged with store `halt` events (live), sorted newest first. Poll audit every 5 s and on `audit.appended`/`patch.committed` via store `audit.count` change.
- Columns: time (`timeAgo`, absolute in title), decision pill (Healed = commit, Rolled back, Halted), `api.tool`, version `v1 → v2`, tier chip, ops chips (max 3, `+N`), confidence (`0.95`), latency, call link.
- Filters: decision (All / Healed / Rolled back / Halted), API. A `Silent` filter appears only when `FEATURES.silentDrift`.
- Drawer on row click: ops as full sentences (`describeOp`), evidence list, confidence, tier, link to the tool's version page, link to the call in Traffic (if still in the ring), audit record hash chip and index.
- **Empty:** "No drift yet. Break the demo API from the Playground to see healr react." Button: Open Playground.
- Halted rows show the `haltReason` sentence in the drawer in a violet-bordered callout titled "Why healr stopped".

### 7.4 APIs `/apis` and Tool detail `/apis/[apiId]/[tool]`

APIs purpose: "The upstream APIs healr protects, and the health of each tool."

- Page: one card per API: name, base URL (mono), healing mode pill, tool count, and a compact table of tools (name, method + path, risk pill, `sideEffects`, current version, health pill from `toolHealth`, last drift time). Row click goes to tool detail. Card actions: Remove API (confirm modal; `api.remove`), "Healing settings" link to Settings.
- Header action: **Register API** opens a Modal with a JSON textarea (prefilled with `demoRegistration()` formatted), Validate JSON on submit, `api.register`, toast with core's error message on failure.
- **Empty:** EmptyState "No APIs registered" with **Register demo API** and **Register your own API**.

Tool detail purpose: "Every version of this tool's adapter, what changed, and a one-click way back."

- Header: `api.tool`, current version pill, health pill, risk, `METHOD /path` in mono, sideEffects.
- Left (wide): **Version timeline** from `api.versions`, newest first. Each item: `v3`, origin pill (`register`, `heal`, `rollback`, `dev`), time, tier chip, confidence, rounds, latency, ops as `OpChip` + sentence list (`describeOp`), "Rolled back to v1" text when `rollbackOf` is set. Buttons: **View diff** (expands inline: `api.diff(from=parent, to=version)` → added ops list with `+` in green, removed with `-` in red) and **Roll back to this version** (not shown on the current version). Rollback uses a `Modal`: "This creates a new version that restores v1's adapter. History is kept." Confirm calls `api.rollback`, toast "Rolled back. Now at v4", reload.
- Right: Tabs `Request adapter | Response map | Logical schema` showing JSON from the selected version (`adapter.request`, `adapter.response`, `meta.logicalSchema`) in `.code`.
- **Empty:** a tool that never healed shows only v1 plus a note "No drift has touched this tool."
- Stretch: replayable animated "schema morph" for the selected diff (ops appear one by one, under 1.2 s). Only if time remains.

### 7.5 Audit chain `/audit`

Purpose: "Every fix is appended to a hash chained log. If anyone edits or removes a record, verification fails at the exact block."

- Top strip: chain length, head hash (`HashChip`, 12 chars), status pill (Verified green / Broken red / Not checked), **Verify chain** button (`api.auditVerify`; show a 600 ms left-to-right highlight sweep over the blocks, then result), **Export NDJSON** (link to `api.auditExportUrl`).
- `ChainView`: horizontal `.chain` of `.block`s joined by `.link`: `#index`, decision pill, `api.tool`, `v1 → v2`, `prev` and `hash` as `HashChip`. A block with `index === verify.brokenAt` gets `data-broken="true"`, and a callout above reads "Chain broken at block #N (hash mismatch)". `tail_truncated` shows "Records were removed from the end of the chain".
- Below the chain: the same records as a table (index, time, decision, tool, ops count, hash) for scanning.
- **Tamper demo (dev tools)**: shown only when Settings "Show dev tools" is on. Buttons: "Edit block #N" (`api.tamper(N,'edit')`), "Delete block #N" (`'delete'`), "Restore" (`api.tamperRestore()`); after tamper auto-run verify. Label the section "Demo only. Requires ENABLE_DEV_ROUTES=1".
- **Empty:** "The audit log is empty. The first committed fix creates block #0." + link to Playground.

### 7.6 Playground `/playground`

Purpose: "Call a tool through healr, break the demo API on purpose, and watch it heal."

- Left card **Call**: API select, tool select, args textarea (JSON, prefilled from the tool's logical schema properties with example strings; default `{ "user_id": "111" }` for `get_user`), **Send** button. Result panel: outcome pill from `meta`, `data` JSON, `meta` (version, healed, rounds, tier, latencyMs), and for errors the `error.code`, `haltReason(error.details.reason)`, details JSON. Each send uses `runId = "pg_" + short id`. Link "Open in Live traffic".
- Right card **Simulate drift (demo mock only)**: `mock.mutations()` as rows (id, label, expected: heal or halt pill) with an **Apply** button each, and **Reset mock**. If the mock is unreachable (3 s timeout): EmptyState "Mock API not reachable at <MOCK>. Start it with `npm run dev`." The card must say plainly it controls the demo mock, not your real API.
- **Empty (no APIs):** EmptyState with Register demo API.

### 7.7 Settings `/settings`

Purpose: "Connection details, healing policy, and whether the LLM tier is available."

Sections as stacked cards (no tabs):
1. **Connection**: core URL, mock URL, SSE status, last event id, events buffered.
2. **Healing policy** (per API select): `enabled`, `confidenceThreshold` (number), `maxRounds` (number), `tier2` toggle, `mode` select only if G5 check proves it is honoured. Save does read-merge-send of the full `healing` object (G5), toast on success.
3. **LLM provider (Tier 2)**: `api.providerHealth()`. When `code === 'missing_api_key'`: pill "Not configured", text "Tier 2 is off. Deterministic Tier 1 healing is unaffected. Set GEMINI_API_KEY in .env and restart core to enable it." When ok: pill "Connected" with model name.
4. **Dev tools**: checkbox "Show dev tools" stored in `localStorage` key `healr.devtools`, reads must be wrapped in try/catch. Controls the Audit tamper section.
5. Theme toggle (stretch): sets `data-theme` on `<html>` and `localStorage`.

---

## 8. Seed script for development and demos (complete)

Agents must test every page against real data. Save as `scripts/seed-dashboard.mjs`, run with core and mock up: `node scripts/seed-dashboard.mjs`.

```js
// Registers the demo API, then produces a healed call, a halt, a bad-input halt, parallel calls, and a passthrough.
const CORE = process.env.CORE_URL ?? 'http://localhost:8000';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:5001';
const J = { 'content-type': 'application/json' };
const post = async (base, path, body) => (await fetch(`${base}${path}`, { method: 'POST', headers: J, body: JSON.stringify(body ?? {}) })).json();
const invoke = (tool, args, runId) => post(CORE, `/apis/demo-users/tools/${tool}/invoke`, { args, runId });

const registration = {
  apiId: 'demo-users', baseUrl: MOCK, specUrl: `${MOCK}/openapi.json`,
  credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
  healing: { enabled: true, confidenceThreshold: 0.85, maxRounds: 5, tier2: true },
  tools: [
    { name: 'get_user', description: 'Fetch a user by id', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, name: { path: 'result.name', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true } } } },
    { name: 'update_user_email', description: "Update a user's email", method: 'POST', path: '/api/users/update-email', risk: 'medium', sideEffects: 'write', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true }, updated_at: { path: 'result.updated_at', type: 'string', required: true } } } },
  ],
};

const show = (label, r) => console.log(label.padEnd(34), r.ok ? `ok healed=${r.meta?.healed} v${r.meta?.version} rounds=${r.meta?.rounds}` : `FAIL ${r.error?.code} ${r.error?.details?.reason ?? ''}`);

await post(MOCK, '/admin/reset');
console.log('register'.padEnd(34), JSON.stringify(await post(CORE, '/apis', registration)));
show('1 passthrough (no drift)', await invoke('get_user', { user_id: '1' }, 'seed_1'));
await post(MOCK, '/admin/mutate', { id: 'M5' });
show('2 M5 drift, expect healed', await invoke('get_user', { user_id: '2' }, 'seed_2'));
show('3 healed version reused', await invoke('get_user', { user_id: '3' }, 'seed_3'));
show('4 bad input "abc", expect halt', await invoke('get_user', { user_id: 'abc' }, 'seed_4'));
await post(MOCK, '/admin/mutate', { id: 'M9' });
show('5 M9 drift, expect halt', await invoke('update_user_email', { user_id: '1', email: 'a@b.co' }, 'seed_5'));
const par = await Promise.all(['11', '22', '33'].map((id, i) => invoke('get_user', { user_id: id }, `seed_p${i}`)));
console.log('6 parallel ids returned'.padEnd(34), par.map((r) => r.data?.id ?? 'none').join(', '), '(expect 11, 22, 33)');
console.log('audit verify'.padEnd(34), JSON.stringify(await (await fetch(`${CORE}/audit/verify`)).json()));
```

Step 0 for the foundation agent: run it, then `curl -s "localhost:8000/events?since=0" -m 2 | grep '^data' > api-client/fixtures/events.ndjson` and check `foldEvent` against it. In particular confirm what the bad-input and rejected paths emit (G8) and adjust the `rejected` rule in `derive.js` to match reality. Note: step 6 may print `33, 33, 33` if the single-flight bug (D1 in the phase 2 plan) is not fixed. That is a backend correctness issue, tell the humans.

---

## 9. Work packages, ownership, and schedule

Four agents, no file overlap. Foundation must finish first, everything else runs in parallel against it.

| Agent | Owns (create/edit only these) | Depends on | Target |
|---|---|---|---|
| **A0 Foundation** | `app/layout.js`, `app/tokens.css`, `app/components.css`, `lib/*`, `components/ui.jsx`, `components/charts.jsx`, `components/Shell.jsx`, `scripts/seed-dashboard.mjs`, `package.json` (lucide-react), delete `app/globals.css` | none | 60 to 75 min |
| **A1 Overview + Traffic** | `app/page.js`, `app/traffic/page.js`, `components/CallDrawer.jsx`, `components/Waterfall.jsx`, optional `components/FlowDiagram.jsx` | A0 | 90 min |
| **A2 APIs + Tool detail** | `app/apis/page.js`, `app/apis/[apiId]/[tool]/page.js`, `components/VersionTimeline.jsx`, `components/RegisterModal.jsx` | A0 | 90 min |
| **A3 Heals + Audit** | `app/heals/page.js`, `app/audit/page.js`, `components/ChainView.jsx`, `components/HealDrawer.jsx` | A0 | 90 min |
| **A4 Playground + Settings** | `app/playground/page.js`, `app/settings/page.js` | A0 | 75 min |

Schedule (hours from now, 7 h left in total):

| Hour | What |
|---|---|
| 0.0 to 1.25 | A0 foundation. Humans in parallel: start silent-200 drift detector and patch cache (backend, not this plan) |
| 1.25 to 3.0 | A1 to A4 in parallel |
| 3.0 to 3.75 | Integration pass (section 10), fix, build |
| 3.75 to 7.0 | **Not for this dashboard.** Backend must-haves, demo-client polish, rehearsal, offline backup recording |

Stretch order if everything is green early: Waterfall polish, FlowDiagram, version diff morph, theme toggle, command palette (Cmd+K to jump to any page or tool).

---

## 10. Acceptance checklist (integration agent runs all of it)

Setup: `npm install`, `cp .env.example .env`, run core and mock on ports 8000 and 5001 (run them separately; the shared `PORT=8000` in `.env` makes both bind 8000 if exported into both, use `PORT=5001` for the mock), `npm run dev -w api-client`, `node scripts/seed-dashboard.mjs`.

- [ ] Fresh start, no APIs: Overview shows "How healr works" and a working **Register demo API** button. All other pages show their own empty state, none are blank.
- [ ] After seed: Overview tiles show Calls handled ≥ 7, Auto healed ≥ 2, Halted safely ≥ 2, a median heal time, chart bars in orange, violet, and green.
- [ ] Live traffic: new calls appear without reload; open a healed call and see: drift rejection, 4 rounds with op sentences, verified replay, committed `v2`, total time. Open the M9 call and see the plain-language halt reason.
- [ ] Reload the browser on `/traffic`: recent calls are still there (SSE replay, G4).
- [ ] Drift events lists the commit with ops chips and the halts; drawer opens; filters work.
- [ ] Tool detail for `demo-users.get_user`: v1 register, v2 heal with 4 op chips; diff shows 4 added ops; rollback creates v3 labelled rollback, toast shown, audit gets a `rollback` block.
- [ ] Audit: Verify returns green. With dev tools on, "Edit block #0" then Verify turns exactly block #0 red with the reason; Restore returns green.
- [ ] Playground: send `{ "user_id": "abc" }` while M5 is active, see a Halted result with the not-lossless explanation. Apply M5, send `111`, see Healed. Reset mock works.
- [ ] Settings: provider card shows "Not configured" with the correct explanation when no key is set; saving healing policy does not wipe other healing keys (G5).
- [ ] Stop the core: the pill turns "Core offline", pages show ErrorState with Retry, nothing crashes. Start it again: pill returns to Live without a reload.
- [ ] Keyboard: Tab reaches nav, table rows' actions, drawer close, modal buttons; Escape closes drawers and modals (add a keydown listener in `Drawer` and `Modal` if missing).
- [ ] 1280x720 and 1920x1080: no horizontal page scroll, no layout shift when data loads.
- [ ] `npm run build -w api-client` passes. Browser console clean on every route. `grep -rn "—" api-client` returns nothing.
- [ ] No page shows a number that is not backed by an endpoint or by the event store (spot check three).

---

## 11. Open risks to settle with the humans now

1. **Backend must-haves are still stubs** (silent-200 detector, patch cache, Tier 2). The dashboard is built so those pages light up through `FEATURES` flags once the endpoints exist. Decide who owns them this hour.
2. **D1 single-flight bug** (parallel calls returning the wrong user) was flagged as P0 in your phase 2 plan. The seed script's step 6 checks it. If it prints the same id three times, that is a live data-corruption bug on the healed path and judges can hit it.
3. **`mode: 'observe'` and the config PATCH merge** (G5) are unverified or buggy. Do not demo a mode toggle until checked.
4. **Port clash:** `.env` sets `PORT=8000`, and both servers read `PORT`. Starting them from one shell with that exported makes the mock bind 8000. `scripts/dev.js` may set per-process ports; I did not read it. Confirm before the demo.
5. **lucide-react and React 19:** verify the install is clean. Fallback is inline SVG icons, a 20 minute swap.