# Current App Demo Walkthrough

This guide describes the app as it is implemented today. It focuses on the local demo API and distinguishes deterministic gateway healing from the LLM-backed agent comparison. The UI walkthrough has not been browser-verified; these steps are based on the current routes, controls, mutation catalogue, and automated acceptance checks.

## What the demo shows

healr sits between a logical tool call and an upstream HTTP API. The caller continues to use its registered logical schema. When the upstream request contract changes, healr can use the registered OpenAPI document (Tier 0) or deterministic diagnosis rules (Tier 1) to propose an adapter change. It validates the change, replays the request when safe, and commits a new adapter version only after verification. If it cannot establish a safe fix, it halts. Tier 2 is the Gemini-backed diagnosis path for ambiguous cases and has a bounded timeout.

The repository has two user-facing apps:

- **Drift Control** at `http://localhost:3001`: a focused, two-pane baseline-versus-healed task demo with live event timelines, patch details, wire diff, and mock truth checks.
- **healr API client** at `http://localhost:3000`: the operator console for registering APIs, invoking a tool through the gateway, and inspecting events, adapter history, metrics, and audit records.

## Start and check the local demo

From the repository root:

```sh
npm run dev
```

The launcher starts the core API on port 8000, demo mock on port 5001, API client on port 3000, and Drift Control on port 3001. Check the core and mock before opening either UI:

```sh
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:5001/health
```

The Drift Control header shows core and mock event-stream connectivity. The API client overview shows gateway connectivity and Gemini provider health. Provider health is a configuration/model endpoint check; a green provider indicator does not guarantee that a subsequent `generateContent` request will succeed.

## Primary walkthrough: deterministic M5 recovery

Use the API client Playground for a gateway call that does not depend on Gemini when the active OpenAPI document or Tier 1 rules can resolve the drift.

1. Open **APIs**. If `demo-users` is not registered, choose **Register demo API**. The demo registration points to the local mock, references `TENANT_ID` as a credential source, and declares logical `get_user` and `update_user_email` tools.
2. Open **Playground** and select `demo-users` and `get_user`.
3. In **Demo mock controls**, apply mutation **M5**. The mock expects a tenant header and a request body whose `user_id` is nested, renamed to `id`, and converted from a string to an integer.
4. Keep the mock specification in its default active state. Enter the logical arguments below and select **Send request**:

   ```json
   { "user_id": "123" }
   ```

5. The gateway should preserve the caller's logical input, derive the request adapter from the available evidence, verify the adapted request, and return the user. With the matching active mock spec, Tier 0 may derive the operations together; without a usable spec, Tier 1 resolves the layered M5 errors over four rounds. The plan's regression anchor specifically checks the four operations: add `X-Tenant`, move the field under `target`, rename it to `id`, and coerce it to an integer.
6. Read the result panel before calling the run successful. Check the returned payload, `Healed`, `Rounds`, `Tier`, and adapter version. A transport success and a truth match are separate facts.
7. Follow the run ID link to **Live traffic**. Open the call to inspect the event sequence. Then open **Drift events** to review the decision and adapter version, and **Audit chain** to verify the persisted record.

The M5 repair is request-side. The same logical arguments remain valid for the caller; the adapter translates them for the changed upstream contract. The raw mock mutation controls affect only the local demo service.

## Drift Control comparison walkthrough

Drift Control is intended to compare the same task prompt against the raw-tool baseline and healr's logical-tool agent.

1. Open `http://localhost:3001`. Confirm both connection pills are connected.
2. Select **M5** and leave **Spec** set to **Active** for the standard run.
3. Choose **Mutate API**, then **Run comparison**. The app registers the demo API if needed, supplies the fixture values to the mock, and starts the baseline and healed task with separate run IDs.
4. Compare the panes:
   - The baseline calls raw upstream tools and has no healing adapter. It should not be described as a gateway-healed result.
   - The healed agent calls through the gateway. Its timeline shows drift, diagnosis, verification, and commit or halt events.
   - In the healed pane, use **Timeline**, **Wire Diff**, **Patches**, and **Raw** to inspect the event story, transformed request, committed operations, and sanitized event data.
   - Compare HTTP/outcome, provider/model, latency, tokens, rounds, adapter version, and final data.
5. Wait for the independent mock truth lookup. A successful HTTP result can still be a truth mismatch. For M5, the intended final user data is Asha Rao with the new email used in the demo task.

### Current limitation for this comparison

The comparison is LLM-backed: both task agents need a working configured Gemini model. The current local `.env` selects `gemini-2.5-flash`; the latest live check found that this project’s GenerateContent API rejects that model as unavailable. A temporary run with the API-recommended `gemini-3.8-flash` completed the healed M5 task, but Tier 2 requests exceeded the plan’s 2.5-second budget, the baseline process still used the `.env` model, and M10 truth checks failed. Until the configured model and both app processes are aligned and the live gate passes, present this screen as an instrumented comparison workflow, not as a verified live success. See [M5 evidence](./M5_EVIDENCE.md) and `artifacts/m5-live-results.json` for the recorded run.

The live provider-health endpoint reports model metadata and may show a model as available even when generation is rejected. Verify the task run itself before claiming the LLM path is healthy.

## Other scenarios to demonstrate

In Drift Control, selecting a mutation only chooses it in the UI. Press **Mutate API** to apply it to the mock. The mock mutation catalogue is loaded from `/admin/mutations`; the UI does not hard-code the full list.

| Scenario | What it demonstrates | Notes |
|---|---|---|
| M1–M4, M7 | Deterministic request adaptation: rename, type, nesting, header, or documented default | Active matching OpenAPI can resolve these through Tier 0; otherwise eligible Tier 1 rules apply. |
| M5 | Several request changes applied in the required order | Best end-to-end explanation of logical input versus wire adapter. |
| M8 | Status enum mapping | The default Drift Control task does not call `set_user_status`, so selecting M8 there does not exercise it. To demo M8, use **APIs → Register API → Import OpenAPI**, preview `http://localhost:5001/openapi.json`, include `set_user_status`, register the mock base URL, then invoke that tool directly in Playground. Active spec advertises Tier 0; with stale/unavailable spec it becomes a Tier 2 case, which depends on a working Gemini call and can safely time out. |
| M9 | Safe halt when the upstream requires unavailable bearer authorization and an approval code | Choose `update_user_email` in Playground; confirm its write warning. The request must halt without sending an unsafe write. |
| M6, M10 | Silent response drift despite HTTP 200 | Use `get_user`. The app checks response schema/identity and can remap an evidence-backed response path without replaying a write. M10 renames `name` to `full_name`. |
| M11 | Ambiguous request-field rename that escalates to Tier 2 | Choose `update_user_email`; the mock wire names are `subscriber_ref` and `contact_address`. This scenario requires the configured diagnoser to answer within budget. |

For M9 or M11 in Drift Control, set **Spec** to **Unavailable** or **Stale** as appropriate before running. Changing Spec updates the mock spec mode; it does not itself apply the selected mutation. M8 with unavailable/stale spec and M11 are labeled **Tier 2 scenario** in the UI, but the current task prompt only exercises M11; M8 requires a direct `set_user_status` invocation.

## API client operator tour

After producing a gateway call, use the sidebar to inspect the corresponding operational record:

- **Overview**: persisted call/heal/halt counts, registered APIs, recent events, gateway connection, and provider health.
- **APIs**: registration list, tool risk/side-effect metadata, adapter version, observed call status, and API detail/version history. **Register API** supports manual JSON or an OpenAPI 3.0/3.1 preview. Previewed operations can be selected, reviewed, assigned risk and side effects, and registered. Unsupported operations are listed as skipped. Credentials are configured by environment-variable reference, not entered as secret values.
- **Playground**: direct invocation against a registered tool. Write/external tools show an argument confirmation. For the local demo API, mock mutation controls can apply or reset a mutation. The reset confirmation says it clears mock mutation and write history; it is not an audit-chain reset.
- **Live traffic**: persisted calls, live event updates, search and outcome/API filters, and a call drawer. Playground results link here by run ID.
- **Drift events**: proposed, committed, halted, and rollback decisions with filters and record detail. When history permits, an older adapter can be restored by creating a new rollback version; existing history remains.
- **Metrics & traces**: persisted call outcomes, latency percentiles, token totals by role/tier, Tier 2 outcomes, bounded durable traces, and verified patch candidates. Cache invalidation controls operate on candidates; PostgreSQL is authoritative and Redis is a mirror.
- **Audit chain**: inspect decisions and hashes, run chain verification, and export NDJSON.
- **Settings**: view connection/provider status and key-pool slot states without revealing key material; configure per-API healing mode, confidence threshold, round cap, and Tier 2 allowance.

## Presenter guardrails

- Say **committed** only when the result shows a verified adapter version and the audit record agrees.
- Say **recovered** only when the returned data also matches the independent mock truth. HTTP 200 alone is not enough.
- Explain a halt as a safety result when proof, credentials, policy, or budget is insufficient; do not present it as a successful patch.
- A Tier 2 proposal is evidence-checked and replay-verified before commit. High-risk changes are flagged for operator review rather than auto-applied.
- The four Gemini keys rotate credentials; keys from one Google Cloud project do not multiply that project's quota.
- The browser walkthrough itself remains unverified in the current evidence ledger. Automated tests and production builds passed, but they do not replace a manual UI review.
