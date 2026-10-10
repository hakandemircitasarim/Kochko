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
 * Replaces food_preference(is_allergen)/clear, health_event, health_event_resolve and the regex
 * allergy/retract/injury/heal nets.
 */
import { f, op, rule } from '../dsl.ts';
import { evidenceIsVerbatim } from '../rules.ts';
import { ALLERGENS, BODY_PARTS, CONSTRAINT_KINDS, DIETARY_SUBJECTS, FOOD_PREFERENCE, SEVERITY } from '../vocab.ts';
import { isVerbatimQuote } from '../util.ts';

const CUSTOM = /^custom:[\p{L}\p{N}_-]{2,40}$/u;
const isAllergenId = (s: string) => Object.prototype.hasOwnProperty.call(ALLERGENS, s) || CUSTOM.test(s);
const isDietaryId = (s: string) => Object.prototype.hasOwnProperty.call(DIETARY_SUBJECTS, s) || CUSTOM.test(s);

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
  derive: (a) => ({
    effect: a.whose === 'other_person' ? 'coach_note' : a.polarity === 'has' ? 'activate' : 'record_absence',
    spine: a.whose === 'self' && a.polarity === 'has',
    treat_as_severe: a.severity === 'severe' || a.severity === 'unknown',
    // An injury stored without a region cannot be matched to exercise loads yet; the safety layer
    // treats it strictly (judge every exercise mention) until the coach learns the region.
    region_unknown: a.whose === 'self' && a.polarity === 'has' && a.kind === 'injury' && a.body_parts.length === 0,
  }),
  writes: { fn: 'syncConstraint', tables: ['user_constraints', 'health_events', 'food_preferences', 'belief_events', 'turn_writes'], undo: 'deactivate' },
  invariants: ['spine_sync', 'note_append_with_history', 'plan_repair', 'unknown_severity_is_severe', 'region_unknown_is_strict'],
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
  flag: [
    rule('koruyucu_beyan_teyidi', 'koruyucu beyanın alıntısı mesajda aynen yok — koruma düşmesin diye kaydedildi; koç bir kez teyit eder', (a, _d, ctx) =>
      a.whose === 'self' && a.polarity === 'has' && !isVerbatimQuote(a.evidence_quote, ctx.user_message),
      { evidence: true }),
    rule('bolge_belirsiz', 'sakatlığın bölgesi belirtilmedi — kaydedildi, bölge netleşene kadar sıkı filtrelenir; koç bir kez sorar', (_a, d) =>
      d.region_unknown),
    rule('siddet_bilinmiyor', 'şiddet bilinmiyor: netleşene kadar ciddi sayılır, koç bir kez sorar', (a) =>
      a.whose === 'self' && a.polarity === 'has' && a.severity === 'unknown'),
  ],
});

export const constraint_retract = op({
  type: 'constraint_retract',
  channel: 'writes',
  envelope: 'profile_update',
  title_tr: 'Kısıt kaldırma',
  when_tr: 'KISITLAR’daki bir kısıtın artık geçerli olmadığı ("dizim tamamen iyileşti", "artık vegan değilim"); yalnız adı geçen kısıt.',
  not_when_tr: 'ağrı sürüyorsa ("dizim eskisi gibi ağrıyor").',
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
