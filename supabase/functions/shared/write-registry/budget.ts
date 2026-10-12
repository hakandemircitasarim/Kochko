/**
 * write-registry/budget.ts — the share of Stage A's prompt the registry generates (AI_MIMARI_V2
 * §3.3, §4.1): the Turkish "YAZILABİLİR KAYITLAR" doc and the strict understand schema. Both sit in
 * the globally cached prefix next to the understanding rules and the few-shots, and both are paid
 * for on every Stage A call — so their size is a contract, checked by registry.test.ts. The whole
 * prefix (rules + doc + few-shots + schema) is checked by ai-chat/v2/understand-prompt.test.ts
 * against PROMPT_BUDGETS.stageAPrefix.
 *
 * Measured with THE shared estimate (tokens.ts, chars/3.2 — the same function the brain prompts
 * use). Until 2026-10-07 this file used chars/3.6, under which the doc looked like 2.7K and met a
 * 2.8K ceiling with 2.7 % headroom; under the shared ratio the same bytes are 3.1K. The ceilings
 * below are re-baselined to the one ratio (the bytes did not shrink): live usage (input / cached
 * tokens per stage, ai_turn_log) replaces the estimate once the Faz 2 shadow runs.
 */
import { buildWriteDoc } from './doc.ts';
import { buildUnderstandSchema, schemaBytes } from './schema.ts';
import { estimateTokens } from './tokens.ts';

/**
 * Ceilings in estimated tokens (chars/3.2). doc: ~3.1K measured (§4.1's "~2.5K" was the chars/3.6
 * figure of a ~9K-char doc); the ceiling leaves ~7 %. schema: what the strict shape itself costs
 * once descriptions are gone (every object closed, every property listed in `required` — the
 * strict-mode floor for 28 ops + the envelope); JSON tokenizes denser than prose, so this
 * over-counts it most. The floor on the doc catches a doc gutted by accident (§2 rule 3: the model
 * must see what it may write).
 * 2026-10-11 (tuning round 3): doc 3300 → 3350, total 8600 → 8650. Two safety/understanding facts
 * moved into the doc instead of the rules — the sleep day ("dün" of a night's sleep is the night
 * one went to bed) and the allergen hint that a bare "fıstık" is mostly peanut (a peanut-allergic
 * user's "fıstık alerjim var" was once written as tree_nut, which does not cover peanuts) — under
 * the owner's 2026-10-10 rule "önce doğruluk, sonra tasarruf" (the prefix is ~99 % cached).
 * 2026-10-12 (SCHEMA v7, re-trial lane U): doc 3350 → 3365. record_delete's not_when line names the one
 * constraint it may undo (a just-added one, behind a safety confirmation) — measured doc ≈3360 (+12);
 * the schema share (+19, evidence_quote) stays inside its own ceiling and the total's.
 */
export const STAGE_A_REGISTRY_BUDGET = {
  doc: { floor: 2000, ceiling: 3365 },
  schema: { ceiling: 5300 },
  total: { ceiling: 8650 },
} as const;

export interface RegistryPromptSize {
  doc_chars: number;
  schema_chars: number;
  doc_tokens: number;
  schema_tokens: number;
  total_tokens: number;
}

/** Size of the registry-generated Stage A prefix (doc + compact understand schema bytes). */
export function stageARegistrySize(): RegistryPromptSize {
  const doc = buildWriteDoc();
  const schema = schemaBytes(buildUnderstandSchema());
  const doc_tokens = estimateTokens(doc);
  const schema_tokens = estimateTokens(schema);
  return { doc_chars: doc.length, schema_chars: schema.length, doc_tokens, schema_tokens, total_tokens: doc_tokens + schema_tokens };
}
