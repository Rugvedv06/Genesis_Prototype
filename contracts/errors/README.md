# Golden error bodies per mutation × error style

Each file is the body the mock (demo-server:5001) would return for that mutation in that error style. Track A uses these for Tier 1 golden tests before the mock exists (§6 Phase 0 exit gate).

Conventions per file: the object IS the HTTP response body; where headers matter (M4/M5 header check, M9 auth), a `headers` key is included. HTTP status is in the file name comment at top of each file.

Mutation catalogue (§11) and expected healing:
- M1: user_id renamed userId → rename_field (T1)
- M2: user_id must be integer → coerce_type lossless (T1)
- M3: body nested under target → move_field then rename (T1, layered)
- M4: header X-API-Version required → add_header from error_enum (T1)
- M5: target nesting + rename + coerce + X-Tenant header → 4 ops (T1)
- M6: response result.data.profile.* (silent 200) → remap_response_path via drift detector (no error body)
- M7: required region with spec default "IN" → add_field spec_default (T0 only; halts without spec)
- M8: set-status enum active/inactive → ENABLED/DISABLED → set_enum_map (T1 case / T2 semantic)
- M9: required Authorization with no provider, or required approval_code with no source → safe halt (no ops)
- M10: response name moved/renamed full_name (silent 200) → remap_response_path (no error body)

Error styles:
- pydantic-v1: { detail: [{ loc, msg, type }] }
- pydantic-v2: { detail: [{ type, loc, msg, input, ctx }] }
- problem-json: RFC 9457 { type, title, status, detail, errors[] }

Header mutations (M4, M5) in the mock canonically return its own shape {"error":"missing_header","header":...,"allowed":[...]} — see contracts/mock.admin.api.json; style variants below translate the same semantic error.
