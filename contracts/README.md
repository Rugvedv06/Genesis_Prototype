# /contracts — Phase 0 deliverable (PS01_BUILD_PLAN.md section 4)

JSON fixtures frozen in Phase 0 so all four tracks can code in parallel.
Reviewed by tracks A, B, C and D. Never hand-edit without re-review.

| File | Source | Contents |
|---|---|---|
| `registration.payload.json` | §4.1 | API registration payload (apiId, baseUrl, specUrl, credentials, healing, tools) |
| OpenAPI preview | M5 §5.5 | `POST /apis/import/openapi/preview` accepts a JSON `url` or inline `spec`; it returns a bounded review preview and never registers state |
| `tool.version.object.json` | §4.2 | Immutable registry version object (adapter + typed request ops + response map) |
| `patch.ops.json` | §4.3 | Complete set of typed patch ops with provenance rules |
| `invoke.examples.json` | §4.4 | Core invoke success / failure responses and error codes |
| `core.endpoints.json` | §4.5 | Core HTTP endpoints, including prompt agent task start, status and cancellation |
| `sse.event.envelope.json` | §4.6 | SSE event envelope + event types |
| `audit.record.json` | §4.7 | Hash-chained audit record |
| `mock.admin.api.json` | §4.8 | Mock admin API + domain endpoints |
| `errors/README.md` | §4.8 / §11 | Golden error bodies per mutation (M1–M11) × error style |
| `responses/` | §8 | Silent-200 drift response fixtures (M6, M10) |

Tier 2 evidence records include typed operations, source quotes, provider/model, key slot index, normalized token usage and call latency. High-risk proposals are recorded as read-only `proposed` audit entries and flagged halt details may include `needsOperator` plus the proposed ops. Agent events include token usage and tool argument keys only. API key values, raw prompts and raw tool arguments are never persisted or exposed on the public stream.

`GET /metrics` and `/metrics/timeseries` expose persisted tokens by role and tier, plus Tier 2 outcomes (`accepted`, `rejectedQuote`, `rejectedSchema`, `timeout`, `unavailable`, `noProposal`). The provider health endpoint returns both roles and Gemini key-pool slot state, without key material.

Error styles: `pydantic-v1`, `pydantic-v2`, `problem-json` (RFC 9457).
Silent drift mutations (M6, M10) return HTTP 200 with a changed shape — see `responses/`.
