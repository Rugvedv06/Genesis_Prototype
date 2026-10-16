// Phase 1 Track A: diagnoser runs tiers in order T0 -> T1 -> T2 (§5.3, §6 Phase 1).
// T0 (spec diff) lands Phase 4; T2 (LLM) lands Phase 4. Here T1 rules run first.
// Returns { tier, confidence, ops, evidence } or null when no diagnosis.
import { parseErrors } from '../classifier/index.js';
import { wrapRule, renameRule, typeRule, headerRule, enumRule, RULE_ORDER } from './tier1-rules/index.js';

const RULES = { wrap: wrapRule, rename: renameRule, type: typeRule, header: headerRule, enum: enumRule };

export async function run({ tool, args, failure, kind }) {
  const errors = failure.errors ?? parseErrors(failure?.json ?? failure?.text, failure?.status);
  const request = failure.request ?? args;

  // T0 stub: no spec available yet (Phase 4). Returns null -> fall through to T1.
  const t0 = await runTier0({ tool, args, failure, kind });
  if (t0) return t0;

  // T1: run each rule in order; first confident proposal wins.
  for (const name of RULE_ORDER) {
    const rule = RULES[name];
    const proposal = rule({ errors, request, tool });
    if (proposal) return { ...proposal, tier: 1 };
  }

  // T2 stub: LLM diagnosis lands Phase 4.
  const t2 = await runTier2({ tool, args, failure, kind });
  if (t2) return t2;

  return null;
}

async function runTier0() {
  return null; // Phase 4
}

async function runTier2() {
  return null; // Phase 4
}
