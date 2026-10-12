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
 * 2026-10-11 (prompt v7, review of tuning round 3): writes + clarify in one example, the water day
 * total by what the sentence covers, three examples moved off the stronger overlap guard — fitted
 * inside the v6 ceilings by tightening few-shot "why" lines. Measured: rules ≈1881, few-shots ≈3220,
 * doc ≈3341, prefix ≈13585. No ceiling moved.
 * 2026-10-11 (SCHEMA_VERSION v5, live-trial write fixes): stageAPrefix 13600 → 13610. The strict
 * schema's strength_sets sets/reps became `["number","null"]` (+18 chars, unavoidable — the required
 * number is what made the model invent "1 × 1 × 0 kg") and the doc says "söylenmeyen sayı null"
 * (+23 chars). Measured prefix ≈13607.
 * 2026-10-11 (prompt v8, the FIRST LIVE TRIAL on the test accounts): Stage A left real statements
 * unwritten or over-read them — "yumurta alerjisi yanlış, alerjim yok", "süte karşı hassasiyetim yok
 * aslında" (no retraction, so the code could not ask), "14 litre su" minutes after 2 L (routed to 112),
 * "motivasyonum düşük" (an invented mood score), "salataya tuz" (a salt-only dinner), "fıstık alerjim
 * var" next to a stored fıstık row (a duplicate). Fixed at principle level: a retraction is a write the
 * code must see (rule 10), an implausible amount with no symptom is not acute (rule 9), no unstated
 * score/set/rep (rule 4), an addition carries its dish (rule 7), a stored constraint is not re-added
 * but a two-reading name on it is still asked, a narrowed constraint is not removed (rule 10) — plus
 * ONE new few-shot (kisit_yanlis: no example had ever shown a retraction). Trimmed first (the intro's
 * "the coach will ask" excuse, rule 2/11/13 wording, the doc pointer, rule 6, four few-shot "why"
 * lines); live probes then showed each remaining clause pulling its weight (removing the salad's
 * "clarify" or the typo's "clarify" regressed them). Measured: rules ≈2047, few-shots ≈3314, prefix
 * ≈13844 (+249 over v7). The ceilings move by the owner's "quality first" allowance — +250 on the
 * prefix (the binding, cost-relevant number), split +150 rules / +50 few-shots; the prefix is ~99 %
 * cached, so this is ≈ $0,00005 per turn at terra's cached-input price. The registry doc (another
 * lane) is NOT inside this headroom: a doc change has to be measured against the merged bytes.
 * 2026-10-11 (integration of the live-trial lanes): lane B's +12 schema/doc chars and lane C's
 * +249 prompt-v8 chars were each measured on their own bytes; together they land at the measured
 * merged prefix: measured ≈13856 (rules ≈2047, few-shots ≈3314, schema ≈5147), so stageAPrefix
 * 13850 → 13860 (lane B's +10 on top of lane C's +250). No other ceiling moved.
 * 2026-10-12 (prompt v9, pre-retrial review): rule 4 points a spice added to a dish at rule 7 (its old
 * "bir tutam baharat" example contradicted it), rule 7 says a small addition is never a meal of its
 * own, and rule 4's score clause became one unambiguous sentence (no score written or asked, the
 * reason only when nothing else is written). Measured: rules ≈2079, prefix ≈13888 (+32; SCHEMA v6
 * adds no tokens). Ceilings: understandRules 2050 → 2085, stageAPrefix 13860 → 13895 (+35 each, within
 * the brief's +60 allowance); few-shots unchanged.
 * 2026-10-12 (prompt v10 + SCHEMA v7, the re-trial): "bugün 14 litre su içtim" went to the emergency
 * contract, the first "hafif aslında" came back clarify-only, "öğlen yedim" at 09:23 became today's
 * lunch. Fixed at principle level: rule 9 untangled (the reading rule vs the acute claim, which now
 * carries the user's verbatim words — the schema's new acute_evidence_quote, +23 tokens), rule 10 (a
 * restated severity is written), rule 3 (a meal time after the clock is not today) + the tetik_gercek
 * quote and one ŞİMDİ line on aday_ayni_degil (live probes: the rule sentence alone moved 0/3 → 1/3;
 * with the example's time 3/3). Trimmed first: the intro, rule 4/5/6/11 examples, rule 7's "soru
 * hiçbir kaydı silmez" (duzeltme_sorusu teaches it), rule 9/10/13 wording. Measured: rules ≈2113,
 * few-shots ≈3339, schema ≈5170, prefix ≈13971. Unavoidable raise inside the brief's +80: rules
 * 2085 → 2115 (+30), stageAPrefix 13895 → 13975 (+80); few-shots unchanged.
 */
export const PROMPT_BUDGETS = {
  constitution: [2400, 3600],
  understandRules: [900, 2115],
  understandFewShots: [1500, 3350],
  exemplars: [1100, 2400],
  stageAPrefix: [9000, 13975],
} as const satisfies Record<string, readonly [number, number]>;
