# Unsafe write retries: production plan

## Problem and impact

A timed-out request, lost response, or transient 5xx does not prove that an upstream write did not complete. Replaying a create or payment can duplicate the side effect. Replay also occurs during verified healing and rollback, not only in the transient-error branch. The previous transient guard read only adapter-level `sideEffects`, so tool metadata could disagree with the retry policy.

## High priority

- Centralize replay classification from HTTP method, registered side-effect risk, and an explicit upstream idempotency contract.
- Default unknown operations to writes and never replay them automatically.
- Mark a write outcome uncertain after an ambiguous transient failure; tell callers not to retry automatically.
- Use a stable key on the first send and all permitted replays when a tool registers an upstream-supported idempotency header; accept a caller `Idempotency-Key` so client retries can reuse that upstream key.
- Apply the same policy to transient retry, healing verification, rollback replay, and heal-lock followers.

## Medium priority

- Persist and validate the optional `idempotencyKeyHeader` in both memory and PostgreSQL registry metadata.
- Keep key values out of events, logs, audit payloads, and response data.
- Add fault-injection evidence proving one attempt for unconfigured writes and stable-key reuse for explicitly idempotent writes.

## Low priority

- Surface the registered retry policy in the API detail and tool configuration UI.
- Add operational metrics for skipped unsafe replays and uncertain outcomes, plus reconciliation guidance for upstreams with lookup APIs.

## Implemented in this change

The executor now permits replay for GET/HEAD or tools explicitly classified `read`/`none`, and for writes with a validated `idempotencyKeyHeader`. Write keys use the invocation ID by default; caller `Idempotency-Key` values are scoped to the API, tool, and arguments, hashed, and reused consistently across client and internal retries. Unsafe transient writes return `outcome_uncertain`; healing, rollback, and follower paths skip unsafe replays. Registration persists the optional header in version metadata.

## Rollout notes

Existing registrations remain compatible and default to write/no-replay. To enable safe retry for a write, register the header only when the upstream documents and enforces idempotency semantics for that header. A future hardening phase should add reconciliation endpoints and expose policy/uncertainty metrics before enabling broader retry behavior.
