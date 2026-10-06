/**
 * write-registry/tokens.ts — the ONE token estimate for every v2 prompt (AI_MIMARI_V2 §3.3).
 *
 * WHY one constant: Stage A's cached prefix is built from two owners' text — the brain's rules and
 * few-shots (ai-chat/v2) and the registry's generated doc and schema (here) — and its budget is a
 * single number. Two estimators (3.2 for the brain, 3.6 for the registry) let the same 9.8K-char
 * doc be "2.7K" in one test and "3.1K" in the other, so a ceiling could be met by picking the
 * friendlier ratio. ai-chat/v2/prompt-size.ts re-exports this; nothing else defines a ratio.
 *
 * The ratio is the conservative one for the Stage A prefix. An o200k pre-tokenizer approximation
 * (scratch measurement 2026-10-07, no real tokenizer in CI) gives ~3.4–3.5 chars/token for the
 * Turkish prose (rules, doc, few-shots, constitution) and ~4.4 for the compact JSON schema, so 3.2
 * over-counts the prose by ~7–10 % and the schema by ~35 %: a prefix that passes its ceiling here
 * is not bigger live. (The short-word coach exemplars run ~3.1, i.e. ~5 % under — Stage B only.)
 * It is an estimate, not a tokenizer: the live numbers (input / cached tokens per stage) are
 * written to ai_turn_log and replace it as soon as the Faz 2 shadow runs.
 *
 * No imports: the registry stays loadable anywhere (ai-chat, ai-plan, eval, later the client).
 */

export const TR_CHARS_PER_TOKEN = 3.2;

/** Estimated tokens of `text` (rounded up; '' → 0). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TR_CHARS_PER_TOKEN);
}
