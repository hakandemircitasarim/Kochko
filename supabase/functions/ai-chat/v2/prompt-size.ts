/**
 * v2 prompt size — budgets for the v2 brain prompts, measured with THE shared token estimate.
 *
 * WHY: the design (docs/AI_MIMARI_V2.md §3.3, §8.2/§8.3) budgets the coach constitution at ~3K
 * tokens, the understanding rules at ~1.3K, and Stage A's whole cached prefix (rules + registry
 * doc + few-shots + strict schema) as one number. Those budgets are what keep Stage A cheap enough
 * to cache globally and Stage B small enough to think. A size test only works if every v2 prompt
 * is measured the same way, so the estimate is not defined here: it is the registry's one constant
 * (shared/write-registry/tokens.ts, chars/3.2, conservative for Turkish), re-exported. The
 * registry's own share (doc + schema) is checked against STAGE_A_REGISTRY_BUDGET with the same
 * function.
 */

export { estimateTokens, TR_CHARS_PER_TOKEN } from '../../shared/write-registry/tokens.ts';

/**
 * Budgets from §3.3/§8 — [floor, ceiling] in estimated tokens. The floor catches a prompt gutted
 * by accident. Re-baselined 2026-10-07 when the two estimators became one (chars/3.2):
 *   understandFewShots — 18 few-shots (§8.3 list + the review's undo / pending-confirm / approve /
 *     illness / suspicious-record cases), every one a complete-able strict-schema decision;
 *   stageAPrefix — rules + registry doc + few-shots + the compact understand schema, i.e. the
 *     globally cached part of every Stage A call. Measured ≈12.3K at chars/3.2 (≈10.3K by the o200k
 *     pre-tokenizer approximation); the ceiling leaves ~4 %. Raising it is a §3.3 cost decision,
 *     not a test fix.
 */
export const PROMPT_BUDGETS = {
  constitution: [2400, 3600],
  understandRules: [900, 1700],
  understandFewShots: [1500, 3000],
  exemplars: [1100, 2400],
  stageAPrefix: [9000, 12800],
} as const satisfies Record<string, readonly [number, number]>;
