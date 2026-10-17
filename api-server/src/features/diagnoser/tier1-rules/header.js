// Phase 1 Track A: header rule (§6 Phase 1). add_header from a missing_header error.
// Value must come from a configured credential provider (never a literal).
export function headerRule({ errors, request, resolveCredential }) {
  const headerErrs = errors.filter((e) => e.kind === 'missing_header');
  if (!headerErrs.length) return null;

  const err = headerErrs[0];
  const name = err.header;
  if (!name) return null;

  const allowed = Array.isArray(err.allowed) ? err.allowed : null;
  // A validator's explicit singleton allowed value is evidence-backed. Never
  // choose arbitrarily from a multi-value set; use a configured credential.
  const source = allowed?.length === 1
    ? { type: 'error_enum', value: allowed[0] }
    : { type: 'credential', ref: name };

  // If an error_enum is present we could validate the credential value against it,
  // but the value itself is resolved at call time via resolveCredential.
  return {
    tier: 1,
    confidence: 0.95,
    ops: [{
      op: 'add_header', name, source,
<<<<<<< HEAD
=======
      evidence: { kind: 'error', ref: `header ${name} required`, ...(allowed ? { allowed } : {}) },
>>>>>>> origin/main
    }],
    evidence: [err.raw],
  };
}
