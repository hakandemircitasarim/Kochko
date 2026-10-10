/**
 * write-registry/envelope.ts — the non-write parts of the understanding envelope (§3.2 T4) and
 * the coach reply fields (§3.2 T6), declared with the same DSL so ONE generator emits the strict
 * schema and ONE validator checks a json_object fallback.
 *
 * Order is decision-first: what the message IS (intent, safety), then what to write, then routing
 * and the self-check. In the fused single-call variant (§3.1 escape hatch) the reply fields come
 * LAST, with suggested_foods/exercises before the prose so their safety tags are produced first
 * (§7.1 öneri değişmezi).
 */
import { f, type Fields } from './dsl.ts';
import { ALLERGENS, BODY_PARTS } from './vocab.ts';

export const INTENT_PRIMARY = {
  report: 'bir şey bildiriyor (yedim, içtim, yaptım, tartıldım, bir bilgi verdi)',
  question: 'soru soruyor',
  hypothetical: 'varsayım/plan ("yesem?", "yarın koşsam")',
  correction: 'bir kaydı düzeltiyor/geri alıyor',
  confirmation: 'bekleyen bir şeyi onaylıyor/reddediyor',
  plan: 'plan istiyor/plan üzerine konuşuyor',
  chat: 'sohbet, duygu, selam',
  other: 'diğer',
} as const;

export const ED_CATEGORIES = {
  restriction: 'aşırı kısıtlama, aç kalma',
  purging: 'kusma/çıkarma, müshil',
  binge: 'tıkınma, kontrol kaybı',
  compensatory_exercise: 'yediğini yakmak için zorlayıcı spor',
  body_image: 'ağır beden algısı sıkıntısı',
  illness_vomiting: 'hastalık/zehirlenme kaynaklı kusma (YB değil)',
} as const;

export const PLAN_OPS = {
  none: 'plan işlemi yok (taslak açık olsa bile alakasız tur)',
  generate: 'yeni plan üret',
  revise: 'açık taslağı değiştir',
  explain: 'taslağı açıkla',
  approve: 'kullanıcı taslağı onaylıyor',
  discard: 'taslağı iptal et',
} as const;

/**
 * Stage A's reading of ONE ambiguous tripwire hit — the vocabulary of shared/safety-tripwires.ts
 * TripwireReading ({hit_id, reading, reason}); resolveTripwires matches readings to hits by hit_id.
 */
export const TRIPWIRE_READINGS = {
  positive: 'gerçek durum ya da emin değil (koruma)',
  benign: 'açıkça başka anlam, gerekçeli',
} as const;

/** More hits than this in one message is not a reading, it is a list to repair (envelope issue). */
export const TRIPWIRE_READINGS_MAX = 12;

/**
 * Why a fact the user reported was consciously NOT written (§5.1.10). A CLOSED list: only these
 * turn "reported but nothing written" from a missed write into a decision (validate.ts) — free
 * text could excuse any omission, an enum id can be counted and reviewed in the shadow.
 */
export const NOT_WRITTEN_REASONS = {
  emergency_turn: 'acil/kriz turu',
  illness_not_food: 'hastalık bildirimi',
  question_only: 'yalnız soru',
  hypothetical: 'varsayım/niyet',
  about_other_person: 'başkasına ait',
  already_recorded: 'zaten kayıtlı',
  needs_clarification: 'bilgi eksik',
} as const;

export const REPLY_CONTRACTS = {
  coach: 'normal koçluk',
  plan: 'plan sözleşmesi',
  onboarding: 'tanışma kartı',
  crisis: 'kriz (kendine zarar, YB)',
  emergency: 'acil tıbbi durum (112)',
} as const;

/**
 * Head of the understanding envelope: before the write arrays. Field notes (`tr`) here are only
 * what the Stage A rules (ai-chat/v2/understand-prompt.ts: intent, safety reading, self-check,
 * routing) do not already say — the understand schema carries no descriptions.
 */
export const ENVELOPE_HEAD = {
  intent: f.obj({
    primary: f.enum(INTENT_PRIMARY),
    is_hypothetical: f.bool(),
    about_other_person: f.bool(),
  }),
  safety: f.obj({
    acute_medical: f.bool(),
    self_harm: f.bool(),
    ed_signal: f.obj({
      category: f.enum(ED_CATEGORIES, { tr: 'illness_vomiting = hastalık/zehirlenme kusması, YB sinyali değil' }),
      severity: f.enum({ low: 'düşük', medium: 'orta', high: 'yüksek' }),
      evidence_quote: f.text({ max: 160 }),
    }, { nullable: true }),
    tripwire_readings: f.list({ min: 0, max: TRIPWIRE_READINGS_MAX, tr: 'belirsiz tetik (tw#) başına bir okuma; GÜVENLİK TETİKLERİ yoksa boş' }, {
      hit_id: f.text({ max: 12 }),
      reading: f.enum(TRIPWIRE_READINGS),
      reason: f.text({ max: 200 }),
    }),
  }),
} as const satisfies Fields;

/** Tail of the understanding envelope: after the write arrays. */
export const ENVELOPE_TAIL = {
  plan_action: f.obj({
    op: f.enum(PLAN_OPS, { tr: 'plan işlemi yoksa none (taslak açıkken alakasız tur da none)' }),
    plan_type: f.enum({ diet: 'beslenme', workout: 'antrenman' }, { nullable: true }),
    draft_ref: f.ref(['dft'], { nullable: true }),
  }),
  simulation: f.obj({
    food: f.text({ max: 80 }),
    kcal_estimate: f.num({ unit: 'kcal', hard: [0, 5000] }),
    target_day: f.date({ past_days: 0, future_days: 7 }),
  }, { nullable: true, tr: '"yesem ne olur?" varsayımı (kod bütçe sayısını hesaplar); yoksa null' }),
  clarify: f.obj({
    topic: f.text({ max: 160 }),
    candidate_refs: f.textList({ max: 5 }),
  }, { nullable: true }),
  reply_route: f.obj({
    contract: f.enum(REPLY_CONTRACTS),
    effort_hint: f.enum({ low: 'kısa/sade', medium: 'düşünmeyi gerektiren' }),
  }),
  self_check: f.obj({
    reported_new_facts: f.bool(),
    not_written_reason: f.enum(NOT_WRITTEN_REASONS, { nullable: true, explain: true }),
  }),
} as const satisfies Fields;

/** Coach reply fields (Stage B, and the tail of the fused envelope). memory[] is inserted by schema.ts. */
export const REPLY_HEAD = {
  suggested_foods: f.list({ min: 0, max: 12, tr: 'cevapta ÖNERDİĞİN her yiyecek, alerjen etiketleriyle (cevaptan ÖNCE)' }, {
    name: f.text({ max: 80 }),
    allergens: f.enumList(ALLERGENS),
    may_contain: f.enumList(ALLERGENS),
  }),
  suggested_exercises: f.list({ min: 0, max: 12, tr: 'cevapta ÖNERDİĞİN her egzersiz ve yüklediği bölgeler' }, {
    name: f.text({ max: 80 }),
    loads: f.enumList(BODY_PARTS),
  }),
  reply: f.text({ max: 4000, tr: 'kullanıcıya cevap' }),
  why: f.text({ nullable: true, max: 600, tr: 'kısa gerekçe (istemci "neden?" altında gösterir)' }),
} as const satisfies Fields;

export const REPLY_TAIL = {
  ui: f.obj({
    navigate_to: f.text({ nullable: true, max: 80, tr: 'yönlendirilecek uygulama ekranı, gerekiyorsa' }),
    task_completion_summary: f.text({ nullable: true, max: 300 }),
  }),
  referral_included: f.bool({ tr: 'cevapta uzman/112 yönlendirmesi var mı' }),
} as const satisfies Fields;
