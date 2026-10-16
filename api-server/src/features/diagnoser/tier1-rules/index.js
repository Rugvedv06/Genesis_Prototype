// Phase 1 Track A: Tier 1 rules ordered (§6 Phase 1): wrap, rename, type, header.
// Tier 0 (spec diff) lands in Phase 4; Tier 2 (LLM) in Phase 4.
export { wrapRule } from './wrap.js';
export { renameRule, nameScore } from './rename.js';
export { typeRule } from './type.js';
export { headerRule } from './header.js';
export { enumRule } from './enum.js';

export const RULE_ORDER = ['wrap', 'rename', 'type', 'header', 'enum'];
