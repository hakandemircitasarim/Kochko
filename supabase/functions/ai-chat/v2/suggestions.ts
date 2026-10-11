/**
 * ai-chat/v2/suggestions.ts — the T7 suggestion invariant, enforced by the HANDLER (AI_MIMARI_V2 §7.1
 * "Öneri değişmezi", §3.2 T7), whatever the coach port does inside:
 *
 *   (allergens ∪ may_contain ∪ name dictionary) ∩ severe allergens = ∅   for every suggested_foods[]
 *   (loads ∪ exercise dictionary)               ∩ injured regions  = ∅   for every suggested_exercises[]
 *
 * A violation → ONE regen through the coach port that names the excluded items, inside the SAME
 * Stage B deadline → still violating, failed or late → the code-written safe fallback (two wordings
 * that never come back to back), and on a protective turn the canned safety reply instead. The T7
 * code notes (112 / referral, holds, exposures) are appended after this step, so the fallback keeps
 * every other notice. The spine could not be read → suggestions cannot be verified → no suggestion
 * goes out (fail-closed), honestly worded.
 *
 * Reads structured fields only (shared/safety-invariants.ts checkSuggestionInvariants) — never the
 * reply prose, never the user's message. No regex (arch-guards G13). The prose judge (luna, §7.2) is
 * a separate check.
 */
import {
  checkSuggestionInvariants, injuredRegionsFromSpine, severeAllergenSubjects, type SpineRow, type SuggestionViolation,
} from '../../shared/safety-invariants.ts';
import type { DecisionValidation } from '../../shared/write-registry/mod.ts';
import type { CoachInput, CoachReply } from './contracts.ts';
import type { TurnInput } from './input.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export interface SuggestionSafety {
  severeAllergens: string[];
  injuredRegions: string[];
  /** The constraints section failed to load: an empty list would read as "no allergy". */
  unknown: boolean;
}

/**
 * The sets the invariant runs against: the spine as loaded + the user's OWN protective declarations
 * of this very turn (constraint_add, effect activate — "fıstık alerjim var, ne yiyeyim?" must already
 * be protected in this reply, written or not).
 */
export function suggestionSafetyOf(ti: TurnInput, validation: DecisionValidation | null): SuggestionSafety {
  const rows: SpineRow[] = ti.constraints.map((c) => ({ kind: c.kind, subject: c.subject, severity: c.severity, body_parts: c.body_parts }));
  for (const v of validation?.verdicts ?? []) {
    if (v.op !== 'constraint_add') continue;
    const r = isRec(v.row) ? v.row : null;
    if (!r || r.effect !== 'activate') continue;
    const kind = typeof r.kind === 'string' ? r.kind : null;
    const severity = typeof r.severity === 'string' ? r.severity : null;
    const body = strs(r.body_parts);
    for (const subject of [r.subject_id, r.display_tr]) {
      if (typeof subject === 'string' && subject.trim()) rows.push({ kind, subject, severity, body_parts: body });
    }
  }
  return {
    severeAllergens: severeAllergenSubjects(rows),
    injuredRegions: injuredRegionsFromSpine(rows),
    unknown: ti.load_errors.some((e) => e.section === 'constraints'),
  };
}

export function hasSuggestions(reply: CoachReply | null): boolean {
  return !!reply && ((reply.suggested_foods?.length ?? 0) > 0 || (reply.suggested_exercises?.length ?? 0) > 0);
}

export function suggestionViolations(reply: CoachReply | null, safety: SuggestionSafety): SuggestionViolation[] {
  if (!reply) return [];
  return checkSuggestionInvariants({ foods: reply.suggested_foods ?? [], exercises: reply.suggested_exercises ?? [] }, safety);
}

/** The regen's extra fact line: the excluded items BY NAME with what they hit (§7.1 "dışlananları adıyla"). */
export function regenFactLine(violations: readonly SuggestionViolation[]): string {
  const items = violations.map((v) => {
    const why = v.kind === 'food' ? v.allergens.map((a) => a.allergen) : v.injuries.map((i) => i.region);
    return `${v.name || (v.kind === 'food' ? 'bir yiyecek' : 'bir egzersiz')} (${[...new Set(why)].join(', ')})`;
  });
  return `ÖNERİ DENETİMİ: önceki taslağındaki şu öneriler kullanıcının ciddi alerjisi ya da sakatlığıyla çakışıyor: ${items.join('; ')}. `
    + 'Bunları ve aynı alerjeni ya da aynı bölgeye yükü taşıyan hiçbir şeyi önerme; cevabını baştan yaz.';
}

/** Two wordings, never the same one twice in a row (§7.1 "yedek arka arkaya iki kez çıkmaz"). */
export const SUGGESTION_FALLBACK_LINES: readonly [string, string] = [
  'Aklımdaki önerilerden biri kayıtlı alerjin ya da sakatlığınla çakışıyordu, o yüzden paylaşmıyorum. İstersen kısıtlarına uyan seçeneklere birlikte bakalım.',
  'Önermek istediğim seçenek kısıtlarından birine takıldı, bu yüzden onu önermiyorum. Sana uygun bir alternatif bulmamı ister misin?',
];
/** The spine could not be read: say THAT, not a clash nobody checked. */
export const SUGGESTION_UNVERIFIED_LINE = 'Önerilerimi şu an kayıtlı kısıtlarına göre kontrol edemediğim için paylaşmıyorum; birkaç dakika sonra tekrar sorarsan bakarım.';

export function suggestionFallbackLine(lastAssistant: string | null | undefined): string {
  const last = lastAssistant ?? '';
  return last.includes(SUGGESTION_FALLBACK_LINES[0]) ? SUGGESTION_FALLBACK_LINES[1] : SUGGESTION_FALLBACK_LINES[0];
}

export type SuggestionGateResult =
  | { kind: 'pass'; reply: CoachReply | null; issues: string[] }
  | { kind: 'fallback'; reason: 'violation' | 'unverified'; issues: string[] };

/** Smallest regen budget worth spending; below it the fallback goes out at once. */
export const MIN_REGEN_MS = 1_000;

/**
 * The gate. `regen` is ONE more coach call with the extra fact line, bounded by `remainingMs()` (the
 * turn's single Stage B deadline). Never throws: a failed or late regen is a fallback.
 */
export async function enforceSuggestionInvariant(p: {
  reply: CoachReply | null;
  input: CoachInput;
  safety: SuggestionSafety;
  remainingMs: () => number;
  regen: (input: CoachInput, timeoutMs: number) => Promise<CoachReply | null>;
}): Promise<SuggestionGateResult> {
  if (!hasSuggestions(p.reply)) return { kind: 'pass', reply: p.reply, issues: [] };
  if (p.safety.unknown) return { kind: 'fallback', reason: 'unverified', issues: ['suggestion_unverified'] };
  const first = suggestionViolations(p.reply, p.safety);
  if (first.length === 0) return { kind: 'pass', reply: p.reply, issues: [] };
  const issues = [`suggestion_violation:${first.length}`];
  const budget = p.remainingMs();
  if (budget < MIN_REGEN_MS) return { kind: 'fallback', reason: 'violation', issues: [...issues, 'suggestion_regen_skipped'] };
  issues.push('suggestion_regen');
  let second: CoachReply | null = null;
  try {
    second = await p.regen({ ...p.input, userState: [...p.input.userState, regenFactLine(first)] }, budget);
  } catch {
    second = null;
  }
  if (!second || typeof second.reply !== 'string' || second.reply.trim() === '') {
    return { kind: 'fallback', reason: 'violation', issues: [...issues, 'suggestion_regen_failed'] };
  }
  const again = suggestionViolations(second, p.safety);
  if (again.length > 0) return { kind: 'fallback', reason: 'violation', issues: [...issues, `suggestion_violation_after_regen:${again.length}`] };
  return { kind: 'pass', reply: second, issues };
}
