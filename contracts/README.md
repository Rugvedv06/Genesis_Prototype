# /contracts — Phase 0 deliverable (PS01_BUILD_PLAN.md section 4)

JSON fixtures frozen in Phase 0 so all four tracks can code in parallel.
Reviewed by tracks A, B, C and D. Never hand-edit without re-review.

| File | Source | Contents |
|---|---|---|
| `registration.payload.json` | §4.1 | API registration payload (apiId, baseUrl, specUrl, credentials, healing, tools) |
| `tool.version.object.json` | §4.2 | Immutable registry version object (adapter + typed request ops + response map) |
| `patch.ops.json` | §4.3 | Complete set of typed patch ops with provenance rules |
| `invoke.examples.json` | §4.4 | Core invoke success / failure responses and error codes |
| `core.endpoints.json` | §4.5 | All core HTTP endpoints |
| `sse.event.envelope.json` | §4.6 | SSE event envelope + event types |
| `audit.record.json` | §4.7 | Hash-chained audit record |
| `mock.admin.api.json` | §4.8 | Mock admin API + domain endpoints |
| `errors/README.md` | §4.8 / §11 | Golden error bodies per mutation (M1–M10) × error style |
| `responses/` | §8 | Silent-200 drift response fixtures (M6, M10) |

Error styles: `pydantic-v1`, `pydantic-v2`, `problem-json` (RFC 9457).
Silent drift mutations (M6, M10) return HTTP 200 with a changed shape — see `responses/`.
