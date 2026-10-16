// Phase 1 Track A: header rule (§6 Phase 1). add_header from a missing_header error.
// Value must come from a configured credential provider (never a literal).
export function headerRule({ errors, request, resolveCredential }) {
  const headerErrs = errors.filter((e) => e.kind === 'missing_header');
  if (!headerErrs.length) return null;

  const err = headerErrs[0];
  const name = err.header;
  if (!name) return null;

  const allowed = err.allowed;
  const source = { type: 'credential', ref: name };

  // If an error_enum is present we could validate the credential value against it,
  // but the value itself is resolved at call time via resolveCredential.
  return {
    tier: 1,
    confidence: 0.95,
    ops: [{ op: 'add_header', name, source, evidence: { kind: 'error', ref: `header ${name} required` } }],
    evidence: [err.raw],
  };
}
