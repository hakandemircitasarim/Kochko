/**
 * write-registry/budget.ts — the share of Stage A's prompt the registry generates (AI_MIMARI_V2
 * §3.3, §4.1): the Turkish "YAZILABİLİR KAYITLAR" doc and the strict understand schema. Both sit in
 * the globally cached prefix next to the understanding rules and the few-shots, and both are paid
 * for on every Stage A call — so their size is a contract, checked by registry.test.ts.
 *
 * The estimate is deliberately rough and conservative: characters / 3.6, the ratio used for
 * Turkish with full diacritics. Applied to the compact JSON schema it over-counts (JSON keys and
 * punctuation tokenize denser), which is the safe side for a ceiling. Live usage (input/cached
 * tokens per stage) is measured in ai_turn_log; this only stops the generated prefix from creeping.
 */
import { buildWriteDoc } from './doc.ts';
import { buildUnderstandSchema, schemaBytes } from './schema.ts';

export const REGISTRY_CHARS_PER_TOKEN = 3.6;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / REGISTRY_CHARS_PER_TOKEN);
}

/**
 * Ceilings in estimated tokens. doc: §4.1 targets ~2.5K for the doc; the ceiling leaves ~10 % for
 * the estimator. schema: what the strict shape itself costs once descriptions are gone (every
 * object closed, every property listed in `required` — the strict-mode floor for 28 ops + the
 * envelope). The floor on the doc catches a doc gutted by accident (§2 rule 3: the model must
 * see what it may write).
 */
export const STAGE_A_REGISTRY_BUDGET = {
  doc: { floor: 1800, ceiling: 2800 },
  schema: { ceiling: 4700 },
  total: { ceiling: 7400 },
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
  const doc_tokens = approxTokens(doc);
  const schema_tokens = approxTokens(schema);
  return { doc_chars: doc.length, schema_chars: schema.length, doc_tokens, schema_tokens, total_tokens: doc_tokens + schema_tokens };
}
