/**
 * The safety spine through chat — allergies, injuries, conditions, medication, diet
 * (AI_MIMARI_V2 §4.4 (4), §7.1; mem#2, mem#8, mem#15, final2#11).
 *
 * The model reads WHO it is about, WHETHER it is present or absent, and HOW severe; code enforces
 * the invariants on those typed fields:
 *   • whose=other_person never reaches the spine (becomes a coach note) — "kızımın yumurta alerjisi";
 *   • polarity=does_not_have is never an active condition — "süt ve yoğurdu rahat tüketiyorum";
 *   • severity=unknown counts as severe in every filter until answered (FLAG → the coach asks once);
 *   • removing a severe/unknown allergen or a surgery/severe injury is TWO-STEP (pending_writes);
 *   • the note is appended with history, never overwritten (mem#15).
 *   • ADDING protection is never held (§7.4: protection never below v1). A self+has declaration
 *     whose quote is paraphrased, or an injury with no region, is STORED and FLAGged so the coach
 *     confirms once — uncertainty makes the filter stricter, it never leaves the spine without it.
 *   • A self+has declaration of a constraint that is ALREADY ACTIVE (same kind, same canonical
 *     subject — a legacy 'fıstık' row reads as 'peanut', input.ts canonicalConstraintSubject) never
 *     becomes a second row (trial 2026-10-11: "fıstık alerjim var" added 'peanut' beside the active
 *     'fıstık'): derive's `existing` names the stored row; a pure restatement is effect
 *     'already_active' (the row is confirmed), a stated different severity is 'activate' on that row.
 *   • Only a severity INCREASE lands in one step. A restatement that LOWERS a severe/unknown
 *     allergen, a surgery or a severe injury is held like its removal (iki_adimli_siddet_dusurme,
 *     code-owned question naming the row and old → new) — never a silent downgrade.
 * Replaces food_preference(is_allergen)/clear, health_event, health_event_resolve and the regex
 * allergy/retract/injury/heal nets.
 */
import { f, op, rule, type ValidationContext } from '../dsl.ts';
import { evidenceIsVerbatim } from '../rules.ts';
import { ALLERGENS, BODY_PARTS, CONSTRAINT_KINDS, DIETARY_SUBJECTS, FOOD_PREFERENCE, SEVERITY } from '../vocab.ts';
import { isRecord, isVerbatimQuote } from '../util.ts';

const CUSTOM = /^custom:[\p{L}\p{N}_-]{2,40}$/u;
const isAllergenId = (s: string) => Object.prototype.hasOwnProperty.call(ALLERGENS, s) || CUSTOM.test(s);
const isDietaryId = (s: string) => Object.prototype.hasOwnProperty.call(DIETARY_SUBJECTS, s) || CUSTOM.test(s);

/** The stored spine row a self+has declaration restates (derive output `existing`). */
export interface ExistingConstraint {
  /** The c-ref it was rendered as this turn. */
  ref: string;
  /** user_constraints.subject exactly as stored (the writer matches the row by it). */
  subject: string;
  severity: string | null;
  body_parts: string[];
}

/** The user's own ACTIVE constraint with the same kind and canonical subject, if one was rendered. */
function activeSame(a: { whose: string; polarity: string; kind: string; subject_id: string }, ctx: ValidationContext): ExistingConstraint | null {
  if (a.whose !== 'self' || a.polarity !== 'has') return null;
  for (const [ref, r] of Object.entries(ctx.refs)) {
    const c = r.constraint;
    if (r.kind !== 'c' || r.undone || !c || c.kind !== a.kind || c.subject !== a.subject_id) continue;
    return { ref, subject: c.stored_subject ?? c.subject, severity: c.severity ?? null, body_parts: [...(c.body_parts ?? [])] };
  }
  return null;
}

/**
 * The severity a restatement of a stored row writes onto it: the STATED one when it is known and
 * differs from the row's (the answer to "ne kadar ciddi?" must land); never 'unknown' — that would
 * erase a severity the user stated before. null = the row's severity stays.
 */
function statedSeverityChange(severity: unknown, existing: { severity: unknown } | null): 'mild' | 'moderate' | 'severe' | null {
  if (!existing || (severity !== 'mild' && severity !== 'moderate' && severity !== 'severe')) return null;
  return severity === existing.severity ? null : severity;
}

/** restatedSeverity over a stored verdict row (receipts, adapter): the change to write, or null. */
export function restatedSeverity(row: Record<string, unknown>): 'mild' | 'moderate' | 'severe' | null {
  return statedSeverityChange(row.severity, isRecord(row.existing) ? { severity: row.existing.severity } : null);
}

const SEVERITY_RANK: Readonly<Record<string, number>> = { mild: 1, moderate: 2, severe: 3 };

/**
 * A restated severity that LOWERS protection the removal rule guards (iki_adimli_kaldirma): a
 * severe-or-unknown allergen/intolerance (an unstated severity counts as severe in every filter), a
 * surgery (any decrease; unstated reads as severe), or a severe injury. Such a change is two-step —
 * held for the user's explicit "evet" — exactly like removing the row, because "severe → mild" turns
 * the same protections off (the 112 sentence, the two-step removal). An INCREASE, or a severity the
 * row never had for a kind the rule does not guard (an injury of unknown severity answered "orta"),
 * lands directly. `stored` is the row's severity (null = unstated). Returns the old → new pair, or null.
 */
export function severityDowngrade(kind: string, stated: unknown, stored: unknown): { from: string | null; to: 'mild' | 'moderate' } | null {
  if (stated !== 'mild' && stated !== 'moderate') return null; // 'severe' never lowers; 'unknown' is not a change
  const old = typeof stored === 'string' && SEVERITY_RANK[stored] ? stored : null;
  const oldRank = old ? SEVERITY_RANK[old] : 3;
  const guarded = (kind === 'allergen' || kind === 'intolerance') ? oldRank === 3
    : kind === 'surgery' ? true
    : kind === 'injury' ? old === 'severe'
    : false;
  return guarded && SEVERITY_RANK[stated] < oldRank ? { from: old, to: stated } : null;
}

/** The reason code of the held downgrade — a SAFETY hold (facts.ts SAFETY_HOLD_REASONS). */
export const SEVERITY_DOWNGRADE_CODE = 'iki_adimli_siddet_dusurme';

const SEVERITY_WORD_TR: Readonly<Record<string, string>> = { mild: 'hafif', moderate: 'orta', severe: 'ciddi' };
const KIND_POSSESSIVE_TR: Readonly<Record<string, string>> = { allergen: 'alerjisi', intolerance: 'intoleransı', injury: 'sakatlığı', surgery: 'ameliyatı' };

/** The stored row named for the user: a legacy row keeps its own word ('fıstık'), an id its label. */
function constraintNameTr(kind: string, stored: string): string {
  const custom = stored.startsWith('custom:') ? stored.slice('custom:'.length) : null;
  const allergen = (kind === 'allergen' || kind === 'intolerance') && Object.prototype.hasOwnProperty.call(ALLERGENS, stored)
    ? ALLERGENS[stored as keyof typeof ALLERGENS].split(' (')[0]
    : null;
  const name = custom ?? allergen ?? stored.split('_').join(' ');
  return `${name} ${KIND_POSSESSIVE_TR[kind] ?? 'kısıtı'}`;
}

/** The held downgrade's ONE code-owned question: which row, old → new severity, what it changes. */
export function severityDowngradeQuestion(kind: string, stored: string, from: string | null, to: string): string {
  const name = constraintNameTr(kind, stored);
  const old = from ? SEVERITY_WORD_TR[from] ?? from : 'şiddeti belirsiz (ciddi sayılıyor)';
  return `${name.charAt(0).toLocaleUpperCase('tr')}${name.slice(1)} kaydını ${old} → ${SEVERITY_WORD_TR[to] ?? to} olarak değiştirmemi gerçekten istiyor musun? Güvenlik filtrelerin buna göre gevşeyecek.`;
}

export const constraint_add = op({
  type: 'constraint_add',
  channel: 'writes',
  envelope: (a) => (a.kind === 'allergen' || a.kind === 'intolerance') ? 'food_preference' : a.kind === 'dietary' ? 'profile_update' : 'health_event',
  title_tr: 'Kısıt (alerji, sakatlık, hastalık, ilaç, diyet)',
  when_tr: 'Alerji, intolerans, sakatlık, ameliyat, hastalık, ilaç ya da diyet kısıtı — kendisi ya da başkası için, var ya da yok; her konu ayrı yazma.',
  not_when_tr: 'KISITLAR’daki bir kısıtı kaldırmak (constraint_retract); yalnız sevmemek (food_pref).',
  fields: {
    kind: f.enum(CONSTRAINT_KINDS),
    subject_id: f.text({
      max: 60,
      tr: `alerji ve intoleransta ALERJENLER id’si (laktoz → milk); diyette ${Object.keys(DIETARY_SUBJECTS).join('|')}; diğerlerinde kısa id; listede yoksa custom:<ad>`,
    }),
    display_tr: f.text({ max: 60 }),
    whose: f.enum({ self: 'kullanıcının kendisi', other_person: 'başkası (kızı, annesi, eşi…)' }, { tr: 'other_person → yalnız koç notu olur, omurgaya girmez' }),
    polarity: f.enum({ has: 'var', does_not_have: 'yok' }),
    severity: f.enum(SEVERITY),
    body_parts: f.enumList(BODY_PARTS, { tr: 'sakatlık/ameliyatta BÖLGELER’den' }),
    event_date: f.date({ nullable: true, past_days: 36500, future_days: 0 }),
    note: f.text({ nullable: true, max: 280 }),
    evidence_quote: f.text({ max: 160 }),
  },
  derive: (a, ctx) => {
    const existing = activeSame(a, ctx);
    // A pure restatement changes nothing: 'already_active' (confirm). One that states a different
    // severity still CHANGES protection: 'activate' with `existing` — the stored row is updated, never
    // duplicated (the writer matches it by its stored subject). A LOWER one on a guarded row is held
    // (ask rule iki_adimli_siddet_dusurme below).
    const restated = existing !== null && statedSeverityChange(a.severity, existing) === null;
    return {
      effect: a.whose === 'other_person' ? 'coach_note' : a.polarity === 'has' ? (restated ? 'already_active' : 'activate') : 'record_absence',
      spine: a.whose === 'self' && a.polarity === 'has',
      treat_as_severe: a.severity === 'severe' || a.severity === 'unknown',
      // An injury stored without a region cannot be matched to exercise loads yet; the safety layer
      // treats it strictly (judge every exercise mention) until the coach learns the region. A
      // restatement of a stored injury that HAS a region is not region-unknown.
      region_unknown: a.whose === 'self' && a.polarity === 'has' && a.kind === 'injury' && a.body_parts.length === 0 &&
        !(existing && existing.body_parts.length > 0),
      existing,
    };
  },
  writes: { fn: 'syncConstraint', tables: ['user_constraints', 'health_events', 'food_preferences', 'belief_events', 'turn_writes'], undo: 'deactivate' },
  invariants: ['spine_sync', 'note_append_with_history', 'plan_repair', 'unknown_severity_is_severe', 'region_unknown_is_strict', 'two_step_severe_downgrade'],
}).rules({
  hard: [
    rule('alerjen_kimligi', 'alerji/intoleransta subject_id alerjen listesinden ya da custom:<ad> olmalı', (a) =>
      (a.kind === 'allergen' || a.kind === 'intolerance') && !isAllergenId(a.subject_id),
      { repairable: true, failure_class: 'invalid_value', path: 'subject_id' }),
    rule('diyet_kimligi', 'diyet kısıtında subject_id diyet listesinden ya da custom:<ad> olmalı', (a) =>
      a.kind === 'dietary' && !isDietaryId(a.subject_id),
      { repairable: true, failure_class: 'invalid_value', path: 'subject_id' }),
    rule('kaldirma_ref_ile', 'KAYITLAR’daki bir kısıtı "yok" diye yazmak yerine constraint_retract{c-ref} kullanılır', (a, _d, ctx) =>
      a.whose === 'self' && a.polarity === 'does_not_have' &&
      Object.values(ctx.refs).some((r) => r.kind === 'c' && !r.undone && r.constraint?.kind === a.kind && r.constraint.subject === a.subject_id),
      { repairable: true, failure_class: 'use_retract' }),
    // A protective declaration (self + has) is never REJECTED (or held) for a paraphrased quote —
    // that would drop protection below v1. It is stored and FLAGged (below); other shapes stay hard.
    rule('alinti_dogrulanamadi', 'evidence_quote kullanıcının mesajında aynen geçmeli', (a, _d, ctx) =>
      !(a.whose === 'self' && a.polarity === 'has') && !isVerbatimQuote(a.evidence_quote, ctx.user_message),
      { repairable: true, failure_class: 'evidence', path: 'evidence_quote', evidence: true }),
  ],
  // Restating a stored row with a LOWER severity weakens protection the same way removing it does
  // (review 2026-10-12: "fıstık alerjim var ama hafif" on mem's legacy severe 'fıstık' turned the
  // 112 sentence and the two-step removal off in one step). Same bar as iki_adimli_kaldirma: held,
  // the code asks, the next turn's explicit confirm writes it; an increase is never held.
  ask: [
    rule(SEVERITY_DOWNGRADE_CODE, 'ciddi/bilinmeyen alerjen ya da ameliyat/ciddi sakatlığın şiddetini düşürmek iki adımlıdır', (a, d) => {
      const g = d.existing ? severityDowngrade(a.kind, a.severity, d.existing.severity) : null;
      return g && d.existing ? `şiddet düşürülüyor: ${d.existing.subject} ${g.from ? SEVERITY_WORD_TR[g.from] : 'belirsiz'} → ${SEVERITY_WORD_TR[g.to]}` : false;
    }, {
      question_tr: (a, d) => {
        const g = d.existing ? severityDowngrade(a.kind, a.severity, d.existing.severity) : null;
        return d.existing && g ? severityDowngradeQuestion(a.kind, d.existing.subject, g.from, g.to) : 'Bu kaydın şiddetini düşürmemi gerçekten istiyor musun?';
      },
    }),
  ],
  flag: [
    rule('koruyucu_beyan_teyidi', 'koruyucu beyanın alıntısı mesajda aynen yok — koruma düşmesin diye kaydedildi; koç bir kez teyit eder', (a, _d, ctx) =>
      a.whose === 'self' && a.polarity === 'has' && !isVerbatimQuote(a.evidence_quote, ctx.user_message),
      { evidence: true }),
    rule('bolge_belirsiz', 'sakatlığın bölgesi belirtilmedi — kaydedildi, bölge netleşene kadar sıkı filtrelenir; koç bir kez sorar', (_a, d) =>
      d.region_unknown),
    // A restatement of a row whose severity is stored is not an unknown severity (no re-ask).
    rule('siddet_bilinmiyor', 'şiddet bilinmiyor: netleşene kadar ciddi sayılır, koç bir kez sorar', (a, d) =>
      a.whose === 'self' && a.polarity === 'has' && a.severity === 'unknown' && !(d.existing && d.existing.severity !== null)),
  ],
});

export const constraint_retract = op({
  type: 'constraint_retract',
  channel: 'writes',
  envelope: 'profile_update',
  title_tr: 'Kısıt kaldırma',
  when_tr: 'KISITLAR’daki bir kısıtın artık geçerli olmadığı ("dizim tamamen iyileşti", "artık glutensiz beslenmiyorum"); yalnız adı geçen kısıt.',
  not_when_tr: 'ağrı ya da şikâyet hâlâ sürüyorsa.',
  fields: {
    target: f.ref(['c']),
    evidence_quote: f.text({ max: 160 }),
    note: f.text({ nullable: true, max: 200 }),
  },
  hold_tr: 'yazma bu turda yapılır; ciddi/bilinmeyen alerjen, ameliyat ya da ciddi sakatlığı kod bekletir, SONRAKİ turdaki açık onayla (pending_ops confirm) kalkar.',
  writes: { fn: 'deactivateConstraint', tables: ['user_constraints', 'health_events', 'food_preferences', 'profiles', 'belief_events', 'turn_writes'], undo: 'restore_previous', hold_op: 'constraint_retract' },
  invariants: ['spine_sync', 'two_step_severe_removal', 'only_named_constraint'],
}).rules({
  hard: [evidenceIsVerbatim('alinti_dogrulanamadi', 'evidence_quote kullanıcının mesajında aynen geçmeli', { repairable: true, failure_class: 'evidence' })],
  ask: [
    rule('iki_adimli_kaldirma', 'ciddi/bilinmeyen alerjen ya da ameliyat/ciddi sakatlık kaldırma iki adımlıdır', (a, _d, ctx) => {
      const c = ctx.refs[a.target]?.constraint;
      if (!c) return false;
      const sev = c.severity ?? 'unknown';
      if ((c.kind === 'allergen' || c.kind === 'intolerance') && (sev === 'severe' || sev === 'unknown')) return `ciddi kısıt: ${c.subject}`;
      if (c.kind === 'surgery' || (c.kind === 'injury' && sev === 'severe')) return `ameliyat/ciddi sakatlık: ${c.subject}`;
      return false;
    }, { question_tr: 'Bu kaydı gerçekten kaldırmamı istiyor musun? Güvenlik filtrelerin buna göre değişecek.' }),
  ],
});

export const constraint_confirm = op({
  type: 'constraint_confirm',
  channel: 'writes',
  envelope: 'constraint_confirm',
  title_tr: 'Kısıt doğrulama',
  when_tr: 'Koç kısıtın sürüp sürmediğini sordu, kullanıcı EVET dedi.',
  not_when_tr: '"artık geçti" (constraint_retract).',
  fields: { target: f.ref(['c']) },
  writes: { fn: 'confirmConstraint', tables: ['user_constraints', 'turn_writes'], undo: 'restore_previous' },
  tier: 'rare',
});

export const food_pref = op({
  type: 'food_pref',
  channel: 'writes',
  envelope: 'food_preference',
  title_tr: 'Yemek tercihi',
  when_tr: 'Bir yiyeceği sevdiği, sevmediği ya da asla yemediği.',
  not_when_tr: 'alerji ve intolerans (constraint_add, güvenlik).',
  fields: {
    food: f.text({ max: 60, tr: 'yalın ad, çekim eki olmadan ("fıstık")' }),
    preference: f.enum(FOOD_PREFERENCE, { tr: 'can_cook = yapabildiği yemek; never = asla yemez (alerji değil)' }),
    whose: f.enum({ self: 'kullanıcının kendisi', other_person: 'başkası' }),
    note: f.text({ nullable: true, max: 200 }),
    replaces: f.ref(['f'], { nullable: true }),
  },
  derive: (a) => ({ effect: a.whose === 'self' ? 'preference' : 'coach_note' }),
  writes: { fn: 'upsertFoodPreference', tables: ['food_preferences', 'profiles', 'belief_events', 'turn_writes'], undo: 'restore_previous' },
  invariants: ['positive_preference_prunes_dislike', 'plan_repair'],
});
