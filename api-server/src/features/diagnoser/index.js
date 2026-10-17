// Phase 1 Track A: diagnoser runs tiers in order T0 -> T1 -> T2 (§5.3, §6 Phase 1).
// T0 (spec diff) lands Phase 4; T2 (LLM) lands Phase 4. Here T1 rules run first.
// Returns { tier, confidence, ops, evidence } or null when no diagnosis.
import { parseErrors } from '../classifier/index.js';
import { wrapRule, renameRule, typeRule, headerRule, enumRule, RULE_ORDER } from './tier1-rules/index.js';
<<<<<<< HEAD
import { discover as discoverFromSpec } from './tier0-spec/index.js';
import { propose as proposeWithLlm } from './tier2-llm/index.js';
=======
<<<<<<< HEAD
import { discover as discoverFromSpec } from './tier0-spec/index.js';
import { propose as proposeWithLlm } from './tier2-llm/index.js';
=======
>>>>>>> origin/main
>>>>>>> origin/main

const RULES = { wrap: wrapRule, rename: renameRule, type: typeRule, header: headerRule, enum: enumRule };

export async function run({ tool, args, failure, kind, apiConfig = {}, signal, tier2Provider, tier2CallsRemaining = 1, skipTiers = [] }) {
  const errors = failure.errors ?? parseErrors(failure?.json ?? failure?.text, failure?.status);
  const request = failure.request ?? args;

  let specExcerpt = '';
  const t0 = await runTier0({ tool, args, failure, kind, errors, apiConfig, skipTiers, onSpecExcerpt: (value) => { specExcerpt = value; } });
  if (t0) return t0;

  // T1: run each rule in order; first confident proposal wins.
  for (const name of RULE_ORDER) {
    const rule = RULES[name];
    const proposal = rule({ errors, request, tool });
    if (proposal) return { ...proposal, tier: 1 };
  }

  // T2 stub: LLM diagnosis lands Phase 4.
  const t2 = await runTier2({ tool, args, failure, kind, apiConfig, signal, provider: tier2Provider, callsRemaining: tier2CallsRemaining, specExcerpt });
  if (t2) return t2;

  return null;
}

async function runTier0({ tool, args, failure, kind, errors, apiConfig, skipTiers = [], onSpecExcerpt }) {
  if (kind === 'response_drift') return null;
  return discoverFromSpec({ tool, args, errors, failure, apiConfig, skipTiers, onSpecExcerpt });
}

async function runTier2({ tool, args, failure, kind, apiConfig, signal, provider, callsRemaining = 1, specExcerpt = '' }) {
  if (apiConfig.healing?.tier2 !== true) return null;
  if (callsRemaining <= 0) return { diagnosisFailure: true, reason: 'tier2_unavailable' };
  const result = await proposeWithLlm({ tool, args, failure, kind, budgetMs: Number(process.env.TIER2_TIMEOUT_MS ?? 2500), signal, provider, specExcerpt });
  if (result.failure) {
    const reason = result.failure === 'no_proposal' ? 'tier2_no_proposal'
      : result.failure === 'tier2_timeout' ? 'tier2_timeout'
        : result.failure === 'tier2_unavailable' ? 'tier2_unavailable' : 'tier2_invalid_output';
    return { diagnosisFailure: true, reason, detailReason: result.failure, usage: result.usage, provider: result.provider, model: result.model, keySlot: result.keySlot, latencyMs: result.latencyMs };
  }
  return result;
}
