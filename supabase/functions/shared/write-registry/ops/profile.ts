/**
 * profile_set — a list of field changes instead of 60 nullable keys (AI_MIMARI_V2 §4.4 (5)).
 *
 * Why a list: in strict mode every property is required, so a flat 60-key object costs ~300
 * output tokens of nulls per call; and v1's single `profiles.update` let one bad value (175.5 cm
 * into a SMALLINT) drop every co-submitted field while the receipt said ok:true. Here each change
 * is its own atomic write with its own verdict and receipt (`atomic_list`).
 *
 * The model gives the value in the unit it heard ("37 yaş", "1.75 m", "sabah 7" → "07:00"); code
 * converts units, checks ranges, and compares identity fields with what is stored (materiality,
 * §5.1.7) instead of the regex contradiction engine.
 */
import { f, op, rule, type ValidationContext } from '../dsl.ts';
import { LENGTH_CM, UNIT_ML } from '../units.ts';
import {
  ACTIVITY_LEVEL, FREQUENCY, GENDER, LEVEL_3, SLEEP_QUALITY,
} from '../vocab.ts';
import { daysBetween, isHhmm, isIsoDay, isVerbatimQuote, roundTo, trNum } from '../util.ts';

export const PROFILE_UNITS = {
  cm: 'santimetre',
  m: 'metre',
  in: 'inç',
  year: 'yıl (doğum yılı)',
  age_years: 'yaş (kod doğum yılına çevirir)',
  litre: 'litre',
  ml: 'mililitre',
  bardak: 'bardak ≈200 ml',
  percent: 'yüzde',
  days: 'gün',
} as const;
export type ProfileUnit = keyof typeof PROFILE_UNITS;

type PType = 'int' | 'num' | 'text' | 'enum' | 'time' | 'date' | 'bool' | 'list';

export interface ProfileFieldSpec {
  /** Short Turkish label (receipts: "boy", "doğum yılı"). */
  tr: string;
  /** Extra guidance for the model, doc only. */
  hint?: string;
  type: PType;
  values?: Readonly<Record<string, string>>;
  /** Accepted units (the first is canonical). Absent = unitless. */
  units?: readonly ProfileUnit[];
  /** Range in the canonical unit; outside → REJECT. */
  hard?: readonly [number, number];
  /** Range in the canonical unit; outside → ASK. */
  plausible?: (ctx: ValidationContext) => readonly [number, number];
  decimals?: number;
  max?: number;
  date?: { past_days: number; future_days: number };
  /** Stored identity: a material change is held (ASK), and the user's words must back it. */
  identity?: 'birth_year' | 'height_cm' | 'gender';
  /** A user-set target: recalcs (TDEE) must not overwrite it. */
  ownership?: 'user_set';
  invariants?: readonly string[];
}

const year = (ctx: ValidationContext) => Number(ctx.today.slice(0, 4));
const text = (tr: string, max = 300): ProfileFieldSpec => ({ tr, type: 'text', max });
const en = (tr: string, values: Readonly<Record<string, string>>, invariants?: readonly string[]): ProfileFieldSpec =>
  ({ tr, type: 'enum', values, ...(invariants ? { invariants } : {}) });
const time = (tr: string): ProfileFieldSpec => ({ tr, type: 'time' });
const bodyLen = (tr: string): ProfileFieldSpec => ({ tr, type: 'num', units: ['cm', 'in'], hard: [20, 250], decimals: 1 });

/** Every chat-writable profile column, with its contract. Order = schema enum order. */
export const PROFILE_FIELD_SPECS: Readonly<Record<string, ProfileFieldSpec>> = {
  display_name: text('hitap edilecek ad', 60),
  birth_year: {
    tr: 'doğum yılı', hint: 'yaş söylendiyse unit=age_years', type: 'int', units: ['year', 'age_years'], hard: [1900, 2100],
    plausible: (ctx) => [1920, year(ctx) - 13], identity: 'birth_year', invariants: ['tdee_recalc'],
  },
  height_cm: { tr: 'boy', type: 'num', units: ['cm', 'm', 'in'], hard: [100, 250], decimals: 0, identity: 'height_cm', invariants: ['tdee_recalc'] },
  gender: { tr: 'cinsiyet', type: 'enum', values: GENDER, identity: 'gender', invariants: ['tdee_recalc', 'clinical_floor'] },
  occupation: text('meslek', 120),
  work_start: time('iş başlangıç saati'),
  work_end: time('iş bitiş saati'),
  sleep_time: time('genelde yattığı saat'),
  wake_time: time('genelde kalktığı saat'),
  activity_level: en('günlük aktivite düzeyi', ACTIVITY_LEVEL, ['tdee_recalc']),
  meal_count_preference: { tr: 'günde kaç öğün', type: 'int', hard: [1, 12] },
  meal_times: text('alışkın öğün saatleri'),
  sleep_problems: text('uyku sorunları', 500),
  cooking_skill: en('yemek yapma becerisi', { none: 'yok', basic: 'temel', good: 'iyi' }),
  budget_level: en('bütçe', { low: 'düşük', medium: 'orta', high: 'yüksek' }),
  diet_mode: en('beslenme modu', { standard: 'standart', low_carb: 'düşük karbonhidrat', keto: 'ketojenik', high_protein: 'yüksek protein' }),
  eating_out_frequency: en('dışarıda yeme sıklığı', FREQUENCY),
  fastfood_frequency: en('fast food sıklığı', FREQUENCY),
  alcohol_frequency: en('alkol sıklığı', FREQUENCY),
  caffeine_intake: en('kafein tüketimi', { none: 'yok', low: 'az', moderate: 'orta', high: 'çok' }),
  skipped_meals: text('atladığı öğünler'),
  night_eating_habit: text('gece yeme alışkanlığı'),
  emotional_eating: text('duygusal yeme'),
  snacking_habit: text('atıştırma alışkanlığı'),
  meal_prep_time: en('yemek hazırlamaya ayırabildiği süre', { short: 'kısa', medium: 'orta', long: 'uzun' }),
  kitchen_equipment: { tr: 'mutfak ekipmanı', type: 'list', max: 300 },
  household_cooking: en('evde yemeği kim yapar', { self: 'kendisi', partner: 'eşi/partneri', parent: 'annesi/babası', shared: 'ortak' }),
  household_diet_challenge: text('evdeki beslenme zorluğu'),
  household_size: { tr: 'evdeki kişi sayısı', type: 'int', hard: [1, 12] },
  training_experience: en('antrenman deneyimi', { none: 'yok', beginner: 'başlangıç', intermediate: 'orta', advanced: 'ileri' }),
  training_style: en('antrenman tarzı', { cardio: 'kardiyo', strength: 'kuvvet', mixed: 'karışık' }),
  equipment_access: en('ekipman erişimi', { home: 'ev', gym: 'spor salonu', both: 'ikisi de' }),
  exercise_history: text('egzersiz geçmişi', 500),
  preferred_exercises: { tr: 'sevdiği egzersizler', type: 'list', max: 300 },
  disliked_exercises: { tr: 'sevmediği/yapamadığı egzersizler', type: 'list', max: 300 },
  available_training_times: text('antrenmana uygun zamanlar', 200),
  stress_level: en('stres düzeyi', LEVEL_3),
  stress_sources: text('stres kaynakları'),
  sleep_quality: en('genel uyku kalitesi', SLEEP_QUALITY),
  previous_diets: text('daha önce denediği diyetler'),
  motivation_source: text('motivasyon kaynağı'),
  biggest_challenge: text('en büyük zorluğu'),
  coach_tone: en('koçtan istediği ton', { strict: 'sert', balanced: 'dengeli', gentle: 'yumuşak' }),
  portion_language: en('porsiyon dili', { grams: 'gram', household: 'ev ölçüsü' }),
  water_target_liters: { tr: 'günlük su hedefi', type: 'num', units: ['litre', 'ml', 'bardak'], hard: [0.5, 8], decimals: 1, ownership: 'user_set' },
  step_target: { tr: 'günlük adım hedefi', type: 'int', hard: [1000, 50000], ownership: 'user_set' },
  if_active: { tr: 'aralıklı oruç yapıyor mu', type: 'bool' },
  if_window: { tr: 'aralıklı oruç düzeni', hint: '"16:8" gibi', type: 'text', max: 20 },
  if_eating_start: time('yeme penceresi başlangıcı'),
  if_eating_end: time('yeme penceresi bitişi'),
  menstrual_tracking: { tr: 'regl takibi istiyor mu', type: 'bool' },
  menstrual_last_period_start: { tr: 'son regl başlangıcı', type: 'date', date: { past_days: 90, future_days: 0 } },
  menstrual_cycle_length: { tr: 'döngü uzunluğu', type: 'int', units: ['days'], hard: [20, 45] },
  body_fat_pct: { tr: 'vücut yağ oranı', type: 'num', units: ['percent'], hard: [3, 70], decimals: 1 },
  muscle_mass_pct: { tr: 'kas oranı', type: 'num', units: ['percent'], hard: [10, 70], decimals: 1 },
  waist_cm: bodyLen('bel çevresi'),
  hip_cm: bodyLen('kalça çevresi'),
  chest_cm: bodyLen('göğüs çevresi'),
  thigh_cm: bodyLen('bacak çevresi'),
};

const FIELD_LABELS = Object.fromEntries(Object.entries(PROFILE_FIELD_SPECS).map(([k, s]) => [k, s.tr])) as Readonly<Record<string, string>>;

/** Turkish label of a profile field (receipts: "boy", never "height_cm"). */
export function profileFieldLabel(field: string): string {
  return PROFILE_FIELD_SPECS[field]?.tr ?? field;
}

type Problem =
  | 'unknown_field' | 'not_number' | 'bad_enum' | 'bad_bool' | 'bad_unit' | 'bad_date' | 'not_clearable' | 'needs_list_op'
  | null;

export interface ProfileDerived {
  field: string;
  /** Canonical value to store (null = clear the field). */
  value: number | string | boolean | null;
  unit: ProfileUnit | null;
  list_op: 'add' | 'remove' | 'set' | null;
  ownership: 'user_set' | null;
  problem: Problem;
  bad_time: boolean;
  out_of_hard: boolean;
  out_of_plausible: boolean;
}

interface Change {
  field: string;
  value: string | null;
  unit: ProfileUnit | null;
  list_op: 'add' | 'remove' | 'set' | null;
  as_stated: string;
}

/** Unit arithmetic only — the value is the MODEL's structured field, never the user's text. */
export function convertProfileChange(c: Change, ctx: ValidationContext): ProfileDerived {
  const spec = PROFILE_FIELD_SPECS[c.field];
  const base: ProfileDerived = {
    field: c.field, value: null, unit: c.unit, list_op: c.list_op, ownership: spec?.ownership ?? null,
    problem: null, bad_time: false, out_of_hard: false, out_of_plausible: false,
  };
  if (!spec) return { ...base, problem: 'unknown_field' };
  if (c.unit !== null && !(spec.units ?? []).includes(c.unit)) return { ...base, problem: 'bad_unit' };
  if (c.value === null) {
    return spec.identity ? { ...base, problem: 'not_clearable' } : base;
  }
  const raw = c.value.trim();
  switch (spec.type) {
    case 'int':
    case 'num': {
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n)) return { ...base, problem: 'not_number' };
      let v = n;
      if (c.field === 'birth_year' && c.unit === 'age_years') v = year(ctx) - n;
      else if (c.unit === 'm' || c.unit === 'in') v = n * LENGTH_CM[c.unit];
      else if (c.unit === 'ml') v = n / 1000;
      else if (c.unit === 'bardak') v = (n * UNIT_ML.bardak) / 1000;
      v = roundTo(v, spec.type === 'int' ? 0 : spec.decimals ?? 2);
      const [hlo, hhi] = spec.hard ?? [-Infinity, Infinity];
      const [plo, phi] = spec.plausible?.(ctx) ?? [-Infinity, Infinity];
      return { ...base, value: v, out_of_hard: v < hlo || v > hhi, out_of_plausible: v < plo || v > phi };
    }
    case 'enum':
      return spec.values && Object.prototype.hasOwnProperty.call(spec.values, raw) ? { ...base, value: raw } : { ...base, problem: 'bad_enum' };
    case 'bool':
      return raw === 'true' || raw === 'false' ? { ...base, value: raw === 'true' } : { ...base, problem: 'bad_bool' };
    case 'time':
      return isHhmm(raw) ? { ...base, value: raw } : { ...base, value: raw, bad_time: true };
    case 'date': {
      if (!isIsoDay(raw) || !spec.date) return { ...base, problem: 'bad_date' };
      const ago = daysBetween(raw, ctx.today);
      return ago > spec.date.past_days || -ago > spec.date.future_days ? { ...base, problem: 'bad_date' } : { ...base, value: raw };
    }
    case 'list':
      return c.list_op === null ? { ...base, problem: 'needs_list_op' } : { ...base, value: raw };
    default:
      return { ...base, value: raw };
  }
}

const PROBLEM_TR: Record<Exclude<Problem, null>, string> = {
  unknown_field: 'bilinmeyen profil alanı',
  not_number: 'sayı bekleniyordu',
  bad_enum: 'bu alan için geçerli bir seçenek değil',
  bad_bool: '"true" ya da "false" bekleniyordu',
  bad_unit: 'bu alan bu birimi kabul etmiyor',
  bad_date: 'tarih YYYY-MM-DD ve izin verilen aralıkta olmalı',
  not_clearable: 'bu kimlik alanı boşaltılamaz',
  needs_list_op: 'liste alanında list_op (add/remove/set) gerekli',
};

const first = (a: { changes: Change[] }) => a.changes[0];

/**
 * The per-field contract table the model reads under profile_set (generated, never hand-copied).
 * Compact on purpose (Stage A budget, §4.1): field ids are self-explanatory English column names,
 * so the table says only what the model cannot guess — accepted units, enum ids, value formats.
 * Enum fields sharing one vocabulary are listed together. Free-text fields are not listed (the
 * schema's field enum names them); only their format hints are.
 */
function profileDocLines(): string[] {
  const entries = Object.entries(PROFILE_FIELD_SPECS);
  const of = (...types: PType[]) => entries.filter(([, s]) => types.includes(s.type));
  const nums = of('int', 'num').map(([k, s]) => (s.units ? `${k} (${s.units.join('|')})` : k));
  const byVocab = new Map<string, string[]>();
  for (const [k, s] of of('enum')) {
    const ids = Object.keys(s.values ?? {}).join('|');
    byVocab.set(ids, [...(byVocab.get(ids) ?? []), k]);
  }
  const enums = [...byVocab].map(([ids, ks]) => `${ks.join(', ')}: ${ids}`);
  const hinted = of('text').filter(([, s]) => s.hint).map(([k, s]) => `${k} ${s.hint}`);
  return [
    'Profil alanları (value bu türde):',
    `- Sayı (birim): ${nums.join(' · ')}`,
    `- Seçenek id’si: ${enums.join(' · ')}`,
    `- Saat HH:MM: ${of('time').map(([k]) => k).join(' · ')}`,
    `- "true"/"false": ${of('bool').map(([k]) => k).join(' · ')}`,
    `- Tarih: ${of('date').map(([k]) => k).join(' · ')}`,
    `- Liste (list_op add|remove|set, tek öğe): ${of('list').map(([k]) => k).join(' · ')}`,
    `- Diğerleri serbest metin${hinted.length ? ` (${hinted.join(' · ')})` : ''}.`,
  ];
}

export const profile_set = op({
  type: 'profile_set',
  channel: 'writes',
  envelope: 'profile_update',
  title_tr: 'Profil',
  when_tr: 'KENDİSİ hakkında kalıcı bilgi (yaş, boy, meslek, saatler, antrenman geçmişi, su/adım hedefi…); her alan ayrı denetlenir.',
  not_when_tr: 'kilo → body_weight, hedef → goal_set, alerji/sakatlık/hastalık/ilaç/diyet → constraint_add.',
  fields: {
    subject: f.enum({ self: 'yalnızca kullanıcının kendisi' }),
    changes: f.list({ min: 1, max: 12 }, {
      field: f.enum(FIELD_LABELS),
      value: f.text({ nullable: true, max: 300, tr: 'sayıda yalnız sayı ("1.75"), seçenekte id; null = alanı temizle' }),
      unit: f.enum(PROFILE_UNITS, { nullable: true }),
      list_op: f.enum({ add: 'listeye ekle', remove: 'listeden çıkar', set: 'listeyi baştan yaz' }, { nullable: true }),
      as_stated: f.text({ max: 120 }),
    }),
  },
  atomic_list: 'changes',
  derive: (a, ctx) => convertProfileChange(first(a), ctx),
  derive_tr: 'yaş → doğum yılı, m/inç → cm, ml/bardak → litre.',
  doc_appendix_tr: profileDocLines(),
  writes: { rpc: 'w_profile_field_apply', tables: ['profiles', 'belief_events', 'turn_writes'], undo: 'restore_previous', hold_op: 'profile_set' },
  invariants: ['per_field_atomic', 'tdee_recalc_on_identity_or_activity', 'user_set_targets_not_overwritten'],
  examples_tr: ['"37 yaşındayım" → field birth_year, value "37", unit age_years'],
}).rules({
  hard: [
    rule('profil_deger_gecersiz', 'değer alanın tipine/birimine uymuyor', (a, d) =>
      d.problem !== null && `${profileFieldLabel(first(a).field)}: ${PROBLEM_TR[d.problem]}`,
      { repairable: true, failure_class: 'invalid_value', path: 'changes[0].value' }),
    rule('profil_aralik_disi', 'değer fiziksel aralığın dışında', (a, d) =>
      d.out_of_hard && `${profileFieldLabel(first(a).field)}: ${String(d.value)} mümkün değil`,
      { failure_class: 'out_of_range', path: 'changes[0].value' }),
  ],
  ask: [
    rule('saat_bicimi', 'saat 24 saatlik HH:MM olmalı; anlaşılmayan saat asla sessizce düşürülmez', (a, d) =>
      d.bad_time && `${profileFieldLabel(first(a).field)}: "${String(d.value)}" saat olarak anlaşılmadı`,
      { question_tr: 'Saati tam olarak söyler misin (ör. 07:30)?' }),
    rule('profil_alisilmadik', 'değer olası ama alışılmadık', (a, d) =>
      d.out_of_plausible && `${profileFieldLabel(first(a).field)}: ${String(d.value)} alışılmadık`,
      { question_tr: 'Bu değeri doğru anladım mı?' }),
    rule('kimlik_degisimi', 'kayıtlı kimlik değerinden önemli fark: yaş ≥2, boy ≥3 cm, cinsiyetin her değişimi', (a, d, ctx) => {
      const spec = PROFILE_FIELD_SPECS[first(a).field];
      const p = ctx.profile ?? null;
      if (!spec?.identity || d.value === null) return false;
      if (spec.identity === 'gender') return !!p?.gender && p.gender !== d.value && `kayıtlı cinsiyet "${p.gender}", yeni "${String(d.value)}"`;
      const stored = spec.identity === 'birth_year' ? p?.birth_year : p?.height_cm;
      const limit = spec.identity === 'birth_year' ? 2 : 3;
      return typeof stored === 'number' && typeof d.value === 'number' && Math.abs(d.value - stored) >= limit &&
        `kayıtlı ${profileFieldLabel(first(a).field)} ${trNum(stored)}, yeni ${trNum(d.value)}`;
    }, { question_tr: 'Kayıtlarımda farklı bir değer var; hangisi doğru?' }),
    // A sanctioned verbatim check (AI_MIMARI_V2 §5): an identity value must come from the user's own
    // words this turn, not from someone else's ("kadın arkadaşım"). Substring, never a regex.
    rule('kimlik_kaniti', 'kimlik alanının as_stated’i kullanıcının mesajında aynen geçmeli', (a, _d, ctx) =>
      !!PROFILE_FIELD_SPECS[first(a).field]?.identity && !isVerbatimQuote(first(a).as_stated, ctx.user_message),
      { question_tr: 'Bu bilgiyi profiline yazmamı ister misin?', evidence: true }),
  ],
  flag: [
    rule('metin_uzun_profil', 'serbest metin alanın önerilen uzunluğunu aşıyor (kısaltılmadan saklanır)', (a) => {
      const spec = PROFILE_FIELD_SPECS[first(a).field];
      const v = first(a).value;
      return !!spec?.max && typeof v === 'string' && v.length > spec.max;
    }),
  ],
});
