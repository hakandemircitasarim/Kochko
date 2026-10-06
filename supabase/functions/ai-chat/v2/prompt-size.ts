/**
 * v2 prompt size — one shared, deliberately rough token estimate for the v2 brain prompts.
 *
 * WHY: the design (docs/AI_MIMARI_V2.md §8.2/§8.3) budgets the coach constitution at ~3K tokens and
 * the understanding rules at ~1.2K. Those budgets are what keep Stage A cheap enough to cache
 * globally and Stage B small enough to think. A size test only works if every v2 prompt is measured
 * the same way, so the estimate lives here once.
 *
 * The ratio is conservative for Turkish with full diacritics (ş/ğ/ı/İ cost extra bytes and split
 * tokens): 3.2 chars/token over-counts slightly, so a prompt that passes its ceiling here is not
 * bigger in production. It is an estimate, not a tokenizer; live usage is measured in ai_turn_log.
 */

export const TR_CHARS_PER_TOKEN = 3.2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TR_CHARS_PER_TOKEN);
}

/** Budgets from §8 — [floor, ceiling] in estimated tokens. The floor catches a prompt gutted by accident. */
export const PROMPT_BUDGETS = {
  constitution: [2400, 3600],
  understandRules: [900, 1700],
  understandFewShots: [900, 2400],
  exemplars: [1100, 2400],
} as const satisfies Record<string, readonly [number, number]>;
