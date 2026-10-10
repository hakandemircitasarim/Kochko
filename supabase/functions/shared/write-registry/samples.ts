/**
 * write-registry/samples.ts — one valid, realistic write per registry op + a validation context
 * with rendered refs. Used by registry.test.ts ("every op has a golden sample") and meant for the
 * eval harness (§9) and the Stage A few-shot builder, so examples never drift from the schema.
 */
import type { ValidationContext } from './dsl.ts';
import type { RenderedRefs } from './refs.ts';

export const SAMPLE_TODAY = '2026-10-06';

export const SAMPLE_REFS: RenderedRefs = {
  m12: { kind: 'm', target: 'meal', op: 'meal_log', day: '2026-10-02', summary_tr: 'Per 2 Eki akşam · "6 tavuk nugget" → 900 g 1708 kcal' },
  m14: { kind: 'm', target: 'meal', op: 'meal_log', day: '2026-10-06', last_turn: true, summary_tr: 'bugün öğle · mercimek çorbası 180 kcal' },
  d3: { kind: 'd', target: 'water', op: 'water_log', day: '2026-10-06', last_turn: true, summary_tr: 'su +0,20 L (gün 1,60 L)' },
  d4: { kind: 'd', target: 'sleep', op: 'sleep_log', day: '2026-10-06', summary_tr: 'uyku 7 saat' },
  d5: { kind: 'd', target: 'water', op: 'water_log', day: '2026-10-05', undone: true, summary_tr: 'su +1,00 L (geri alındı)' },
  d6: { kind: 'd', target: 'steps', op: 'step_log', day: '2026-10-06', later_write_on_same_field: true, summary_tr: 'adım 4.000' },
  w2: { kind: 'w', target: 'workout', op: 'workout_log', day: '2026-10-05', summary_tr: 'koşu 30 dk' },
  s1: { kind: 's', target: 'supplement', op: 'supplement_log', day: '2026-10-06', summary_tr: 'kreatin 5 g' },
  c1: { kind: 'c', target: 'constraint', constraint: { kind: 'allergen', subject: 'peanut', severity: 'severe' }, summary_tr: 'yer fıstığı alerjisi (ciddi)' },
  c2: { kind: 'c', target: 'constraint', constraint: { kind: 'injury', subject: 'knee', severity: 'moderate', body_parts: ['knee'] }, summary_tr: 'diz sakatlığı (orta)' },
  c3: { kind: 'c', target: 'constraint', constraint: { kind: 'allergen', subject: 'milk', severity: null }, summary_tr: 'süt alerjisi (şiddet bilinmiyor)' },
  p1: { kind: 'p', target: 'pending', pending: { op: 'constraint_retract', expires_at: '2026-10-07T10:00:00Z', replies_since: 1 }, summary_tr: 'fıstık alerjisini kaldırma' },
  p2: { kind: 'p', target: 'pending', pending: { op: 'account_erase_request', expires_at: '2026-10-06T12:20:00Z', replies_since: 1 }, summary_tr: 'hafıza silme' },
  p3: { kind: 'p', target: 'pending', pending: { op: 'goal_set', expires_at: '2026-10-05T10:00:00Z', replies_since: 1 }, summary_tr: 'hedef değişimi (süresi doldu)' },
  k1: { kind: 'k', target: 'commitment', summary_tr: 'akşam 8’den sonra yememe sözü' },
  e1: { kind: 'e', target: 'life_event', op: 'life_event', day: '2026-10-01', summary_tr: 'kardeşinin düğünü (2026-11-14)' },
  l1: { kind: 'l', target: 'lab', op: 'lab_value', day: '2026-10-03', summary_tr: 'D vitamini 12 ng/mL' },
  f1: { kind: 'f', target: 'food_pref', op: 'food_pref', day: '2026-10-04', summary_tr: 'brokoli — sevmiyor' },
  dft1: { kind: 'dft', target: 'plan_draft', summary_tr: 'beslenme planı taslağı v3' },
};

export function sampleContext(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    today: SAMPLE_TODAY,
    now_iso: '2026-10-06T12:00:00Z',
    user_message: '',
    refs: SAMPLE_REFS,
    day_totals: { '2026-10-06': { water_liters: 1.6, steps: 4000 } },
    profile: { birth_year: 1989, height_cm: 175, weight_kg: 82, gender: 'male', periodic_state: null },
    last_weight: { kg: 82.4, day: '2026-10-02' },
    goal: { goal_type: 'lose_weight', target_weight_kg: 75 },
    ed_tier: 'none',
    reference_rows: {
      tavuk_gogsu: { key: 'tavuk_gogsu', name_tr: 'tavuk göğsü (ızgara)', kcal_per_100g: 165, protein_per_100g: 31, carbs_per_100g: 0, fat_per_100g: 3.6 },
      lahmacun: { key: 'lahmacun', name_tr: 'lahmacun', kcal_per_100g: 240, protein_per_100g: 10, carbs_per_100g: 30, fat_per_100g: 9 },
    },
    ...over,
  };
}

const mealItem = (o: Record<string, unknown>) => ({
  name: 'tavuk nugget', as_stated: '6 adet', grams: 110, kcal: 320, protein_g: 16, carbs_g: 20, fat_g: 19,
  alcohol_g: 0, caffeine_mg: 0, preparation: 'kızartma', allergens: ['gluten'], may_contain: ['egg'],
  reference_key: null, confidence: 0.7, ...o,
});

/** A meal_log write with the given items (defaults: the "6 tavuk nugget" decision). */
export function sampleMeal(items: Array<Record<string, unknown>> = [{}], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: 'meal_log', day: 'today', meal_type: 'dinner', time_local: '19:30', raw: '6 tavuk nugget yedim',
    status: 'new', venue: null, replaces: null, items: items.map(mealItem), ...over,
  };
}

/** User messages that make each sample's evidence/as_stated quotes verbatim. */
export const SAMPLE_MESSAGES: Readonly<Record<string, string>> = {
  profile_set: 'boyum 1.75, 37 yaşındayım',
  constraint_add: 'Fındık alerjim var, ciddi.',
  constraint_retract: 'dizim tamamen iyileşti',
  data_erase_request: 'hafızanı sıfırla, hakkımda bildiklerini sil',
  record_update: 'perşembe akşamki nugget 1700 olmuş, 6 küçük nuggetti 100 gram falan',
};

/** One valid write per registry op type (wire `op` included). */
export const SAMPLE_WRITES: Readonly<Record<string, Record<string, unknown>>> = {
  meal_log: sampleMeal(),
  water_log: { op: 'water_log', day: 'today', as_stated: '1 bardak', quantity: 1, unit: 'bardak', other_ml_each: null, mode: 'add', replaces: null },
  body_weight: { op: 'body_weight', day: 'today', kg: 82.25, as_stated: '82,25', replaces: null },
  sleep_log: { op: 'sleep_log', day: 'today', hours: 6.5, quality: 'bad', bed_time: '00:30', wake_time: '07:00', as_stated: '6-7 saat', replaces: null },
  mood_log: { op: 'mood_log', day: 'today', value: 8, scale: 'ten', note: 'enerjik', as_stated: '8/10', replaces: null },
  step_log: { op: 'step_log', day: 'today', steps: 12000, as_stated: '12 bin', replaces: null },
  workout_log: {
    op: 'workout_log', day: 'yesterday', raw: 'dün 45.5 dk ağırlık çalıştım', workout_type: 'strength', duration_min: 45.5, intensity: 'moderate',
    calories_burned: 280, rpe: 7, time_local: '18:00',
    strength_sets: [{ exercise: 'bench_press', as_stated: '3x8 60 kilo', sets: 3, reps: 8, weight_kg: 60 }], replaces: null,
  },
  supplement_log: {
    op: 'supplement_log', day: 'today', name: 'whey protein', as_stated: '1 ölçek', kcal: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5,
    allergens: ['milk'], may_contain: [], replaces: null,
  },
  profile_set: {
    op: 'profile_set', subject: 'self',
    changes: [{ field: 'height_cm', value: '1.75', unit: 'm', list_op: null, as_stated: 'boyum 1.75' }],
  },
  goal_set: { op: 'goal_set', goal_type: 'lose_weight', target_weight_kg: 77, target_weeks: 13, target_date: null, reason: 'düğün', as_stated: '3 ayda 77 kilo' },
  constraint_add: {
    op: 'constraint_add', kind: 'allergen', subject_id: 'hazelnut', display_tr: 'fındık', whose: 'self', polarity: 'has', severity: 'severe',
    body_parts: [], event_date: null, note: null, evidence_quote: 'Fındık alerjim var',
  },
  constraint_retract: { op: 'constraint_retract', target: 'c2', evidence_quote: 'dizim tamamen iyileşti', note: null },
  constraint_confirm: { op: 'constraint_confirm', target: 'c2' },
  food_pref: { op: 'food_pref', food: 'brokoli', preference: 'dislike', whose: 'self', note: null, replaces: null },
  life_event: { op: 'life_event', title: 'mezuniyet', event_type: 'graduation', event_date: '2026-11-15', note: null, replaces: null },
  lab_value: {
    op: 'lab_value', measured_at: '2026-10-01',
    items: [{ parameter: 'd_vitamini', value: 12, unit: 'ng/mL', status: 'low', reference_min: 30, reference_max: 100, reference_source: 'report', note: null }],
  },
  recipe_save: {
    op: 'recipe_save', title: 'Yulaf lapası', category: 'breakfast', ingredients: [{ name: 'yulaf', as_stated: '4 yemek kaşığı' }],
    instructions: 'Sütle 5 dakika pişir.', kcal: 310.4, protein_g: 14.6, prep_time_min: 10, servings: 1,
  },
  periodic_state: { op: 'periodic_state', state: 'exam', end_date: '2026-10-20', note: null },
  target_change: { op: 'target_change', program: 'mvd', strategy_id: null, weeks: null, excess_kcal: null, reason: 'çok yoğun gün' },
  data_erase_request: { op: 'data_erase_request', scope: 'memory', evidence_quote: 'hafızanı sıfırla' },
  record_delete: { op: 'delete', ref: 'd3', reason: 'yanlış kayıt' },
  record_update: {
    op: 'update', ref: 'm12', basis: 'user_correction', reason: '6 küçük nugget ~100 g', evidence_quote: '6 küçük nuggetti 100 gram falan',
    patch: sampleMeal([{ name: 'tavuk nugget', as_stated: '6 küçük', grams: 100, kcal: 290, protein_g: 15, carbs_g: 18, fat_g: 17 }], { day: '2026-10-02', raw: '6 küçük nugget, 100 gram' }),
  },
  record_restore_metric: { op: 'restore_metric', ref: 'd4', reason: 'eski değere dön' },
  pending_confirm: { op: 'confirm', ref: 'p1' },
  pending_discard: { op: 'discard', ref: 'p1' },
  commitment_add: { op: 'add', text: 'akşam 8’den sonra yemeyeceğim', follow_up_days: 2 },
  commitment_resolve: { op: 'resolve', ref: 'k1', outcome: 'kept', note: null },
  memory_note: { op: 'memory_note', kind: 'person_note', text: 'Kısa ve net cevapları seviyor.', food: null, grams: null, confidence: 0.8 },
};

/** A full understanding envelope around the given channel items (defaults: nothing). */
export function sampleDecision(parts: Partial<Record<'writes' | 'record_ops' | 'pending_ops' | 'commitment_ops', unknown[]>> & Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: { primary: 'report', is_hypothetical: false, about_other_person: false },
    safety: { acute_medical: false, self_harm: false, ed_signal: null, tripwire_readings: [] },
    writes: [],
    record_ops: [],
    pending_ops: [],
    commitment_ops: [],
    plan_action: { op: 'none', plan_type: null, draft_ref: null },
    simulation: null,
    clarify: null,
    reply_route: { contract: 'coach', effort_hint: 'low' },
    self_check: { reported_new_facts: false, not_written_reason: null },
    ...parts,
  };
}
