/**
 * write-registry/rules.ts — reusable rule factories (AI_MIMARI_V2 §5.1).
 *
 * Every rule reads TYPED fields the strict schema produced (plus derive() output and the
 * caller's context). None reads the user's free text, except `evidenceIsVerbatim`, which is the
 * one sanctioned substring check (§5: "YB kanıt alıntısının alt dize denetimi" and its siblings).
 * A rule only REPORTS; the outcome (COMMIT/FLAG/ASK/REJECT) comes from which list it sits in.
 */
import { rule, type EdTier, type RuleDef, type ValidationContext } from './dsl.ts';
import { isVerbatimQuote } from './util.ts';

/** ED tiers at which any target-tightening write is closed (§7.1). 'unknown' = read failed → closed. */
export const ED_CLOSED_TIERS: readonly EdTier[] = ['amber', 'red', 'unknown'];

export function edClosed(ctx: ValidationContext): boolean {
  return ED_CLOSED_TIERS.includes(ctx.ed_tier);
}

/** `field` must be set when `when(a)` holds — the model can fill it from what it knows. */
export function requireWhen<A, D>(
  code: string,
  doc_tr: string,
  when: (a: A) => boolean,
  present: (a: A) => unknown,
  path?: string,
): RuleDef<A, D> {
  return rule<A, D>(code, doc_tr, (a) => when(a) && (present(a) === null || present(a) === undefined), {
    repairable: true,
    failure_class: 'missing_field',
    path,
  });
}

/**
 * The model's own evidence quote must appear in the user's message (case/space/punctuation
 * folded). Used where a write claims "the user said so": constraints, erase, corrections.
 */
export function evidenceIsVerbatim<A extends { evidence_quote: string | null }, D>(
  code: string,
  doc_tr: string,
  extra?: { repairable?: boolean; question_tr?: string; failure_class?: string },
): RuleDef<A, D> {
  return rule<A, D>(code, doc_tr, (a, _d, ctx) => !isVerbatimQuote(a.evidence_quote, ctx.user_message), {
    path: 'evidence_quote',
    evidence: true,
    ...(extra ?? {}),
  });
}

/** A deficit/tightening write while the ED tier is closed (or unreadable). Never repairable. */
export function edGate<A, D>(isTightening: (a: A, ctx: ValidationContext) => boolean, what_tr: string): RuleDef<A, D> {
  return rule<A, D>(
    'yb_kapisi',
    `YB güvenlik kademesi amber/kırmızı (ya da okunamadı) iken ${what_tr} yazılmaz`,
    (a, _d, ctx) => edClosed(ctx) && isTightening(a, ctx),
    { failure_class: 'ed_gate' },
  );
}
