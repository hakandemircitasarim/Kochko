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
 *     pre-tokenizer approximation); the ceiling left ~4 %. Raising it is a §3.3 cost decision,
 *     not a test fix.
 * Re-baselined 2026-10-10 after the FIRST LIVE EVAL (148 fixtures × 5 on gpt-5.6-terra): nine
 * understanding gaps (a report ending in a question written as question_only, two reports in one
 * message with one dropped, "sonuncuyu sil" with two candidates deleted, a retraction left unwritten,
 * "2 dilim lahmacun" as 65 g, a trip starting tomorrow written as a state…) were fixed with rule
 * sentences, doc wording and two few-shots (20 now: iki_aday_sil, bildirim_ve_soru) after trimming
 * what the doc already says. Prefix ≈13.06K → ceiling 13.4K (~2.6 % headroom), few-shots ≈2.98K →
 * 3.2K. The prefix is ~99 % cached (live: cached 10.8K/11K input tokens) and latency follows OUTPUT
 * tokens (≈8.6 ms/token, r² 0.69), not the cached prefix — the owner's 2026-10-10 call is quality
 * first, cost (Stage A → luna, prefix trimming) after, with measurements.
 * 2026-10-11 (prompt v5, teaching-to-the-test review): every few-shot was rewritten in details of its
 * own and the doc/rule examples that copied eval fixtures were replaced; the two guard lines round 1
 * trimmed (rule 6 double count, rule 9 "bayıldım" real vs figurative) and the binge-severity sentence
 * were added back by trimming what the doc already says. Measured: rules ≈1696/1700, few-shots
 * ≈3101 (20) — over the old 3000, so the 3200 ceiling is now needed, not slack — prefix ≈13234/13400.
 * No ceiling moved.
 * 2026-10-11 (prompt v6, tuning round 3 after the first full 5-rep v5 run): a B+ SAFETY miss (a severe
 * allergy declaration held for a "which kind?" clarify in 2/5 reps) and A misses (sleep day, food
 * added to a logged meal, a never-true allergy left unwritten, "dilim" of a whole-cooked food) were
 * fixed with principle sentences (rules 0, 1, 3, 4, 7, 10) and a contrasting "dilim" example that
 * replaced the sliced-food one; the sleep convention went to the registry doc to spare the rules.
 * Measured: rules ≈1875, few-shots ≈3231, prefix ≈13.56K — so the ceilings move by ~1,5 %: rules
 * 1700 → 1900, few-shots 3200 → 3300, prefix 13400 → 13600. This IS the §3.3 cost decision, taken on
 * the owner's 2026-10-10 rule ("önce doğruluk, sonra tasarruf"): the prefix is ~99 % cached, so
 * +~300 cached tokens cost ≈ $0,00006 per turn at terra's cached-input price; trimming comes with the
 * planned cost step (Stage A → luna, prefix trimming), with measurements.
 */
export const PROMPT_BUDGETS = {
  constitution: [2400, 3600],
  understandRules: [900, 1900],
  understandFewShots: [1500, 3300],
  exemplars: [1100, 2400],
  stageAPrefix: [9000, 13600],
} as const satisfies Record<string, readonly [number, number]>;
