/**
 * validate.test.ts — golden verdicts for validateDecision (AI_MIMARI_V2 §5, §9.4 paket A/A′/D).
 * Each case is a model decision as the strict schema would produce it; the expectation is the
 * code's verdict. The live defects that motivated v2 are the first cases.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { collectRefs, validateChannelItems, validateConfirmedHold, validateDecision, type WriteVerdict } from './validate.ts';
import { SAMPLE_WRITES, sampleContext, sampleDecision, sampleMeal } from './samples.ts';
import type { ValidationContext } from './dsl.ts';

const w = (op: string, over: Record<string, unknown> = {}) => ({ ...structuredClone(SAMPLE_WRITES[op]), ...over });
const water = (over: Record<string, unknown> = {}) => w('water_log', over);

function one(channel: 'writes' | 'record_ops' | 'pending_ops' | 'commitment_ops' | 'memory', item: unknown, ctx: ValidationContext = sampleContext()): WriteVerdict {
  const vs = validateChannelItems(channel, [item], ctx);
  assertEquals(vs.length, 1);
  return vs[0];
}
const codes = (v: WriteVerdict) => v.issues.map((i) => i.code);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

// ─── final2#3: "1 bardak su daha içtim" → +0,20 L ────────────────────────────

Deno.test('final2#3: "1 bardak su daha" → COMMIT +0.20 L (never 1 L)', () => {
  const v = one('writes', water(), sampleContext({ user_message: '1 bardak su daha içtim' }));
  assertEquals(v.verdict, 'COMMIT');
  assertEquals(v.derived.liters, 0.2);
  assertEquals(v.row?.liters, 0.2);
  assertEquals(v.row?.quantity, 1, 'the model\'s quantity is stored as-is');
  assertEquals(v.row?.as_stated, '1 bardak');
  assertEquals(v.envelope, 'water_log');
});

Deno.test('water units come from the one table: su bardağı 0.20, çay bardağı 0.10, kupa 0.25, 500 ml şişe yarım 0.25', () => {
  assertEquals(one('writes', water({ unit: 'su_bardagi' })).derived.liters, 0.2);
  assertEquals(one('writes', water({ unit: 'cay_bardagi' })).derived.liters, 0.1);
  assertEquals(one('writes', water({ unit: 'kupa' })).derived.liters, 0.25);
  assertEquals(one('writes', water({ unit: 'sise_500', quantity: 0.5 })).derived.liters, 0.25);
  assertEquals(one('writes', water({ unit: 'other', other_ml_each: 330 })).derived.liters, 0.33);
});

Deno.test('water: set_day_total LOWER than already logged today → ASK with one question (never a silent SET)', () => {
  const v = one('writes', water({ quantity: 1, unit: 'litre', mode: 'set_day_total', as_stated: 'bugün toplam 1 litre' }));
  assertEquals(v.verdict, 'ASK');
  assert(codes(v).includes('toplam_kayittan_az'));
  assert(v.question_tr && v.question_tr.length > 5);
  assertEquals(v.hold_op, 'water_log');
  assertEquals(v.row, null, 'a held write produces no row');
});

Deno.test('water: set_day_total above the logged total commits; "bugün toplam 2 litre" → 2.0', () => {
  const v = one('writes', water({ quantity: 2, unit: 'litre', mode: 'set_day_total', as_stated: 'toplam 2 litre' }));
  assertEquals(v.verdict, 'COMMIT');
  assertEquals(v.derived.liters, 2);
});

Deno.test('water: > 1.5 L in one drink → ASK; 250 L → REJECT out_of_range (not repairable)', () => {
  assertEquals(one('writes', water({ quantity: 2, unit: 'litre' })).verdict, 'ASK');
  const big = one('writes', water({ quantity: 250, unit: 'litre' }));
  assertEquals(big.verdict, 'REJECT');
  assertEquals(big.issues[0].failure_class, 'out_of_range');
  assertEquals(big.repairable, false);
});

Deno.test('water: unit=other without its ml → REJECT, repairable (one repair call), and the decision asks for repair', () => {
  const d = validateDecision(sampleDecision({ writes: [water({ unit: 'other', other_ml_each: null })] }), sampleContext());
  const v = d.verdicts[0];
  assertEquals(v.verdict, 'REJECT');
  assert(codes(v).includes('other_ml_eksik'));
  assertEquals(v.repairable, true);
  assertEquals(d.repair.needed, true);
  assertEquals(d.repair.items[0].op, 'water_log');
});

// ─── final2#4: "6 tavuk nugget" → the model's numbers are kept ───────────────

Deno.test('final2#4: "6 tavuk nugget" → the MODEL\'s ~320 kcal is stored, the tavuk göğsü candidate is not imposed', () => {
  const ctx = sampleContext({ user_message: '6 tavuk nugget yedim' });
  assert(ctx.reference_rows?.tavuk_gogsu, 'the misleading candidate IS on the table');
  const v = one('writes', sampleMeal(), ctx);
  assertEquals(v.verdict, 'COMMIT');
  const item = (v.row?.items as Array<Record<string, unknown>>)[0];
  assertEquals(item.kcal, 320);
  assertEquals(item.grams, 110);
  assertEquals(item.data_source, 'ai_estimate');
  assertEquals(v.derived.total_kcal, 320);
  assert(!JSON.stringify(v.row).includes('1708') && !JSON.stringify(v.row).includes('900'));
});

Deno.test('meal: a reference the MODEL picked is used for grams × per-100 g, and its own kcal is kept as model_kcal', () => {
  const v = one('writes', sampleMeal([{ name: 'lahmacun', as_stated: '2 adet', grams: 260, kcal: 620, protein_g: 26, carbs_g: 78, fat_g: 23, reference_key: 'lahmacun', allergens: ['gluten'], may_contain: [] }]));
  assertEquals(v.verdict, 'COMMIT');
  const item = (v.row?.items as Array<Record<string, unknown>>)[0];
  assertEquals(item.data_source, 'reference');
  assertEquals(item.kcal, 624);
  assertEquals(item.model_kcal, 620);
});

Deno.test('meal: picking a reference that is clearly another food (nugget ↔ tavuk göğsü) → ASK, not a silent 182 kcal', () => {
  const v = one('writes', sampleMeal([{ reference_key: 'tavuk_gogsu' }]));
  assertEquals(v.verdict, 'ASK');
  assert(codes(v).includes('referans_sapmasi'));
});

Deno.test('meal: a reference_key that was not shown this turn → REJECT, repairable', () => {
  const v = one('writes', sampleMeal([{ reference_key: 'nugget_tablosu' }]));
  assertEquals(v.verdict, 'REJECT');
  assertEquals(v.repairable, true);
});

// ─── final2#8: "2 çimdik tuz" is always accepted ─────────────────────────────

Deno.test('final2#8: "yumurtaya 2 çimdik tuz" → COMMIT with as_stated kept, 0.7 g, 0 kcal (never rejected, never flagged)', () => {
  const v = one('writes', sampleMeal([
    { name: 'haşlanmış yumurta', as_stated: '2 adet', grams: 100, kcal: 155, protein_g: 13, carbs_g: 1, fat_g: 11, allergens: ['egg'], may_contain: [], preparation: 'haşlama', confidence: 0.8 },
    { name: 'tuz', as_stated: '2 çimdik', grams: 0.7, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, allergens: [], may_contain: [], preparation: null, confidence: 0.6 },
  ], { raw: 'yumurtaya 2 çimdik tuz attım', meal_type: 'breakfast' }));
  assertEquals(v.verdict, 'COMMIT', JSON.stringify(v.issues));
  const salt = (v.row?.items as Array<Record<string, unknown>>)[1];
  assertEquals(salt.as_stated, '2 çimdik');
  assertEquals(salt.grams, 0.7);
  assertEquals(salt.kcal, 0);
});

Deno.test('meal: macro/kcal mismatch and low confidence FLAG (stored as-is, kcal NOT recomputed)', () => {
  const v = one('writes', sampleMeal([{ name: 'bira', as_stated: '1 şişe', grams: 500, kcal: 215, protein_g: 2, carbs_g: 18, fat_g: 0, alcohol_g: 20, confidence: 0.4, allergens: ['gluten'], may_contain: [] }]));
  assertEquals(v.verdict, 'FLAG');
  assert(codes(v).includes('dusuk_guven'));
  assert(!codes(v).includes('makro_kcal_uyumsuz'), 'alcohol counts 7 kcal/g — beer is consistent');
  assertEquals((v.row?.items as Array<Record<string, unknown>>)[0].kcal, 215);
  const off = one('writes', sampleMeal([{ kcal: 900 }]));
  assertEquals(off.verdict, 'FLAG');
  assert(codes(off).includes('makro_kcal_uyumsuz'));
  assertEquals((off.row?.items as Array<Record<string, unknown>>)[0].kcal, 900);
});

Deno.test('meal: one meal > 2500 kcal → ASK; restatement → valid no-op (no row, nothing written)', () => {
  assertEquals(one('writes', sampleMeal([{ kcal: 2800, fat_g: 150, protein_g: 120, carbs_g: 220, grams: 1500 }])).verdict, 'ASK');
  const r = one('writes', sampleMeal([{}], { status: 'restatement' }));
  assertEquals(r.verdict, 'COMMIT');
  assert(r.noop);
  assertEquals(r.row, null);
});

Deno.test('meal: "1 muz daha" 10 minutes after a banana is a NEW write — no name dedupe', () => {
  const d = validateDecision(sampleDecision({ writes: [
    sampleMeal([{ name: 'muz', as_stated: '1 adet', grams: 120, kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4, preparation: null, allergens: [], may_contain: [], confidence: 0.9 }], { meal_type: 'snack', raw: '1 muz daha' }),
  ] }), sampleContext());
  assertEquals(d.verdicts[0].verdict, 'COMMIT');
});

// ─── refs: only what was rendered this turn ──────────────────────────────────

Deno.test('ref not in the rendered set → REJECT (never guessed): delete m99, replaces d9, retract c9', () => {
  const del = one('record_ops', { op: 'delete', ref: 'm99', reason: 'sil' });
  assertEquals(del.verdict, 'REJECT');
  assertEquals(del.issues[0].code, 'ref_listede_yok');
  assertEquals(del.issues[0].failure_class, 'invalid_ref');
  assertEquals(del.repairable, false);
  assertEquals(one('writes', water({ replaces: 'd9' })).verdict, 'REJECT');
  assertEquals(one('writes', w('constraint_retract', { target: 'c9' }), sampleContext({ user_message: 'dizim tamamen iyileşti' })).verdict, 'REJECT');
});

Deno.test('refs: wrong kind / wrong record type / already undone / later write on the same field → REJECT', () => {
  assertEquals(one('writes', water({ replaces: 'm12' })).issues[0].code, 'ref_turu');
  assertEquals(one('writes', water({ replaces: 'd4' })).issues[0].code, 'ref_hedefi', 'd4 is sleep, not water');
  assertEquals(one('record_ops', { op: 'delete', ref: 'd5', reason: 'x' }).issues[0].code, 'zaten_geri_alindi');
  const later = one('record_ops', { op: 'delete', ref: 'd6', reason: 'x' });
  assertEquals(later.verdict, 'REJECT');
  assert(codes(later).includes('sonraki_yazma_var'));
  assertEquals(one('record_ops', { op: 'delete', ref: 'c1', reason: 'x' }).issues[0].code, 'ref_turu', 'safety rows are not deletable');
});

Deno.test('final2#2: "geri al" after a water log deletes exactly d3 — the dinner is untouched', () => {
  const d = validateDecision(sampleDecision({ intent: { primary: 'correction', is_hypothetical: false, about_other_person: false }, record_ops: [{ op: 'delete', ref: 'd3', reason: 'yanlış' }] }), sampleContext({ user_message: 'yok o yanlış geri al' }));
  assertEquals(d.verdicts.length, 1);
  assertEquals(d.verdicts[0].verdict, 'COMMIT');
  assertEquals(d.verdicts[0].target_ref, 'd3');
  assertEquals(d.verdicts[0].envelope, 'undo');
});

// ─── suspicious past record (owner decision 2026-10-06) ──────────────────────

Deno.test('suspicious past record: coach-noticed update{basis:suspicious} → ASK "bu kayıt yanlış görünüyor, düzelteyim mi?"', () => {
  const v = one('record_ops', w('record_update', { basis: 'suspicious', evidence_quote: null, reason: '6 nugget için 1708 kcal çok yüksek' }),
    sampleContext({ user_message: 'bugün ne yesem?' }));
  assertEquals(v.verdict, 'ASK');
  assertEquals(v.question_tr, 'Bu kayıt yanlış görünüyor, düzelteyim mi?');
  assertEquals(v.hold_op, 'record_update');
  assertEquals(v.target_ref, 'm12');
  assertEquals(v.row, null);
});

Deno.test('final2#6: user-stated correction with a verbatim quote → COMMIT, the patch is validated as a meal and supersedes m12', () => {
  const v = one('record_ops', w('record_update'), sampleContext({ user_message: 'perşembe akşamki nugget 1700 olmuş, 6 küçük nuggetti 100 gram falan' }));
  assertEquals(v.verdict, 'COMMIT', JSON.stringify(v.issues));
  assertEquals(v.envelope, 'meal_log', 'badge follows the corrected record type');
  const patch = v.row?.patch as Record<string, unknown>;
  assertEquals((patch.items as Array<Record<string, unknown>>)[0].kcal, 290);
  assertEquals(patch.date, '2026-10-02');
});

Deno.test('correction claimed without the user\'s words → ASK; patch of another type → REJECT repairable; bad patch number → REJECT', () => {
  const noQuote = one('record_ops', w('record_update'), sampleContext({ user_message: 'şunu düzelt' }));
  assertEquals(noQuote.verdict, 'ASK');
  assert(codes(noQuote).includes('duzeltme_teyidi'));
  const wrongType = one('record_ops', w('record_update', { patch: water() }), sampleContext({ user_message: '6 küçük nuggetti 100 gram falan' }));
  assertEquals(wrongType.verdict, 'REJECT');
  assert(codes(wrongType).includes('yama_turu'));
  const badPatch = one('record_ops', w('record_update', { patch: sampleMeal([{ kcal: 9000 }], { day: '2026-10-02' }) }), sampleContext({ user_message: '6 küçük nuggetti 100 gram falan' }));
  assertEquals(badPatch.verdict, 'REJECT');
  assert(badPatch.issues.some((i) => i.path?.startsWith('patch.items[0].kcal')));
});

// ─── nothing is silently rewritten ───────────────────────────────────────────

Deno.test('nothing silently rewritten: the decision is never mutated and args === what the model sent', () => {
  const writes = [water(), sampleMeal(), w('workout_log'), w('profile_set'), w('mood_log'), w('recipe_save')];
  const decision = deepFreeze(sampleDecision({ writes }));
  const before = JSON.stringify(decision);
  const d = validateDecision(decision, sampleContext({ user_message: 'boyum 1.75' }));
  assertEquals(JSON.stringify(decision), before);
  d.verdicts.forEach((v) => {
    const { ...sent } = writes[v.index] as Record<string, unknown>;
    if (v.part === null) assertEquals(v.args, sent);
  });
});

Deno.test('lossless column fits are listed, never hidden: 45.5 dk → 46 in the row, 45.5 kept in args', () => {
  const v = one('writes', w('workout_log'));
  assertEquals(v.args.duration_min, 45.5);
  assertEquals(v.row?.duration_min, 46);
  assertEquals(v.normalized, [{ path: 'duration_min', from: 45.5, to: 46, why_tr: 'tam sayı sütunu' }]);
});

Deno.test('mood: 8/10 → 4/5 by declared scaling (no clamp); 7 on a 1–5 scale → REJECT repairable', () => {
  assertEquals(one('writes', w('mood_log')).row?.score, 4);
  const bad = one('writes', w('mood_log', { value: 7, scale: 'five' }));
  assertEquals(bad.verdict, 'REJECT');
  assertEquals(bad.repairable, true);
});

// ─── dates ───────────────────────────────────────────────────────────────────

Deno.test('dates: yesterday resolves; future → REJECT future_date; 10 days back → REJECT too_old', () => {
  assertEquals(one('writes', water({ day: 'yesterday' })).derived.date, '2026-10-05');
  const fut = one('writes', water({ day: '2026-10-07' }));
  assertEquals(fut.issues[0].failure_class, 'future_date');
  assertEquals(one('writes', water({ day: '2026-09-26' })).issues[0].failure_class, 'too_old');
  assertEquals(one('writes', water({ day: 'dün' })).repairable, true);
});

// ─── profile_set: per-field atomic, identity materiality ─────────────────────

Deno.test('profile_set: each change is its own verdict — one bad field never drops the others', () => {
  const vs = validateChannelItems('writes', [{
    op: 'profile_set', subject: 'self', changes: [
      { field: 'height_cm', value: '1.75', unit: 'm', list_op: null, as_stated: 'boyum 1.75' },
      { field: 'wake_time', value: 'sabah 7 gibi', unit: null, list_op: null, as_stated: 'sabah 7 gibi' },
      { field: 'activity_level', value: 'couch', unit: null, list_op: null, as_stated: 'hiç hareket etmem' },
      { field: 'occupation', value: 'öğretmen', unit: null, list_op: null, as_stated: 'öğretmenim' },
    ],
  }], sampleContext({ user_message: 'boyum 1.75' }));
  assertEquals(vs.map((v) => v.verdict), ['COMMIT', 'ASK', 'REJECT', 'COMMIT']);
  assertEquals(vs.map((v) => v.part), [0, 1, 2, 3]);
  assertEquals(vs[0].row?.value, 175);
  assert(codes(vs[1]).includes('saat_bicimi'), 'an unparsed time is ASKed, never dropped');
  assertEquals(vs[2].repairable, true);
});

Deno.test('profile_set: "12 yaşındayım" vs stored 1989 → ASK (materiality + plausibility), age converts to birth year', () => {
  const v = one('writes', { op: 'profile_set', subject: 'self', changes: [{ field: 'birth_year', value: '12', unit: 'age_years', list_op: null, as_stated: '12 yaşındayım' }] },
    sampleContext({ user_message: '12 yaşındayım' }));
  assertEquals(v.verdict, 'ASK');
  assertEquals(v.derived.value, 2014);
  assert(codes(v).includes('kimlik_degisimi'));
});

Deno.test('profile_set: gender change vs stored → ASK; first-time gender → COMMIT; not in the user\'s words → ASK', () => {
  const ch = (over: Record<string, unknown>) => ({ op: 'profile_set', subject: 'self', changes: [{ field: 'gender', value: 'female', unit: null, list_op: null, as_stated: 'kadınım', ...over }] });
  assertEquals(one('writes', ch({}), sampleContext({ user_message: 'ben kadınım' })).verdict, 'ASK');
  assertEquals(one('writes', ch({}), sampleContext({ user_message: 'ben kadınım', profile: { gender: null } })).verdict, 'COMMIT');
  const notSaid = one('writes', ch({ as_stated: 'kadın' }), sampleContext({ user_message: 'eşimle yemeğe gittim', profile: { gender: null } }));
  assertEquals(notSaid.verdict, 'ASK');
  assert(codes(notSaid).includes('kimlik_kaniti'));
});

Deno.test('profile_set: a user-set water target is marked user_set (TDEE recalcs must not overwrite it); ml converts', () => {
  const v = one('writes', { op: 'profile_set', subject: 'self', changes: [{ field: 'water_target_liters', value: '2500', unit: 'ml', list_op: null, as_stated: 'günde 2500 ml' }] });
  assertEquals(v.verdict, 'COMMIT');
  assertEquals(v.derived.value, 2.5);
  assertEquals(v.derived.ownership, 'user_set');
});

// ─── safety spine ────────────────────────────────────────────────────────────

Deno.test('mem#8: "fıstık alerjim yok ama fındık alerjim var" → two writes: absence recorded, hazelnut activated', () => {
  const msg = 'Fıstık alerjim yok ama fındık alerjim var, ciddi.';
  const d = validateDecision(sampleDecision({ writes: [
    w('constraint_add', { subject_id: 'peanut', display_tr: 'fıstık', polarity: 'does_not_have', severity: 'unknown', evidence_quote: 'Fıstık alerjim yok' }),
    w('constraint_add', { evidence_quote: 'fındık alerjim var' }),
  ] }), sampleContext({ user_message: msg, refs: {} }));
  assertEquals(d.verdicts.map((v) => v.verdict), ['COMMIT', 'COMMIT']);
  assertEquals(d.verdicts.map((v) => v.derived.effect), ['record_absence', 'activate']);
  assertEquals(d.verdicts[0].derived.spine, false);
});

Deno.test('constraint_add: "yok" for an allergen already on the spine must go through constraint_retract (REJECT repairable)', () => {
  const v = one('writes', w('constraint_add', { subject_id: 'peanut', polarity: 'does_not_have', evidence_quote: 'fıstık alerjim yok' }),
    sampleContext({ user_message: 'fıstık alerjim yok artık' }));
  assertEquals(v.verdict, 'REJECT');
  assert(codes(v).includes('kaldirma_ref_ile'));
  assertEquals(v.repairable, true);
});

Deno.test('constraint_add: other person → coach note only; unknown severity → FLAG (treated as severe); paraphrased protective quote → ASK not REJECT', () => {
  const kid = one('writes', w('constraint_add', { subject_id: 'egg', display_tr: 'yumurta', whose: 'other_person', evidence_quote: 'kızımın yumurta alerjisi var' }),
    sampleContext({ user_message: 'kızımın yumurta alerjisi var' }));
  assertEquals(kid.verdict, 'COMMIT');
  assertEquals(kid.derived.effect, 'coach_note');
  assertEquals(kid.derived.spine, false);
  const unk = one('writes', w('constraint_add', { severity: 'unknown' }), sampleContext({ user_message: 'Fındık alerjim var' }));
  assertEquals(unk.verdict, 'FLAG');
  assertEquals(unk.derived.treat_as_severe, true);
  const para = one('writes', w('constraint_add', { evidence_quote: 'fındığa alerjim olduğunu söyledi' }), sampleContext({ user_message: 'Fındık alerjim var' }));
  assertEquals(para.verdict, 'ASK', 'protection is never dropped for a paraphrase');
});

Deno.test('mem#2: removing a severe (or unknown-severity) allergen is two-step → ASK; a moderate knee injury is retracted', () => {
  const sev = one('writes', w('constraint_retract', { target: 'c1', evidence_quote: 'fıstık alerjim geçti' }), sampleContext({ user_message: 'fıstık alerjim geçti' }));
  assertEquals(sev.verdict, 'ASK');
  assertEquals(sev.hold_op, 'constraint_retract');
  assertEquals(one('writes', w('constraint_retract', { target: 'c3', evidence_quote: 'süt alerjim geçti' }), sampleContext({ user_message: 'süt alerjim geçti' })).verdict, 'ASK');
  assertEquals(one('writes', w('constraint_retract'), sampleContext({ user_message: 'dizim tamamen iyileşti' })).verdict, 'COMMIT');
  const notSaid = one('writes', w('constraint_retract'), sampleContext({ user_message: 'dizim eskisi gibi ağrıyor' }));
  assertEquals(notSaid.verdict, 'REJECT', 'a retraction needs the user\'s own words');
});

// ─── ED gate (assertTargetAllowed, fail-closed) ──────────────────────────────

Deno.test('ED gate: lose_weight tightening at amber / red / unreadable tier → REJECT ed_gate; maintenance at amber → ASK', () => {
  for (const tier of ['amber', 'red', 'unknown'] as const) {
    const v = one('writes', w('goal_set', { target_weight_kg: 70 }), sampleContext({ ed_tier: tier }));
    assertEquals(v.verdict, 'REJECT', tier);
    assertEquals(v.issues.find((i) => i.code === 'yb_kapisi')?.failure_class, 'ed_gate');
    assertEquals(v.repairable, false);
  }
  assertEquals(one('writes', w('goal_set', { target_weight_kg: 70 }), sampleContext({ ed_tier: 'watch' })).verdict, 'COMMIT');
  assertEquals(one('writes', w('target_change', { program: 'maintenance_start' }), sampleContext({ ed_tier: 'amber' })).verdict, 'ASK');
  assertEquals(one('writes', w('target_change', { program: 'mini_cut', weeks: 3 }), sampleContext({ ed_tier: 'red' })).verdict, 'REJECT');
});

Deno.test('goal_set: too fast → ASK; changing the goal type → ASK; weeks AND date → REJECT repairable', () => {
  const fast = one('writes', w('goal_set', { target_weight_kg: 70, target_weeks: 4 }));
  assertEquals(fast.verdict, 'ASK');
  assert(codes(fast).includes('hiz_yuksek'));
  assert(codes(one('writes', w('goal_set', { goal_type: 'gain_muscle', target_weight_kg: null }))).includes('hedef_degisiyor'));
  assertEquals(one('writes', w('goal_set', { target_date: '2026-12-31' })).repairable, true);
});

// ─── KVKK erase + holds ──────────────────────────────────────────────────────

Deno.test('KVKK: data_erase_request is ALWAYS held (ASK) and confirmable only in the very next turn', () => {
  const req = one('writes', w('data_erase_request'), sampleContext({ user_message: 'hafızanı sıfırla' }));
  assertEquals(req.verdict, 'ASK');
  assertEquals(req.hold_op, 'account_erase_request');
  assertEquals(one('pending_ops', { op: 'confirm', ref: 'p2' }).verdict, 'COMMIT');
  const late = one('pending_ops', { op: 'confirm', ref: 'p2' }, sampleContext({ refs: { p2: { kind: 'p', target: 'pending', pending: { op: 'account_erase_request', expires_at: '2026-10-06T12:20:00Z', replies_since: 2 } } } }));
  assertEquals(late.issues[0].failure_class, 'not_next_turn');
  const same = one('pending_ops', { op: 'confirm', ref: 'p1' }, sampleContext({ refs: { p1: { kind: 'p', target: 'pending', pending: { op: 'goal_set', expires_at: '2026-10-07T10:00:00Z', replies_since: 0 } } } }));
  assertEquals(same.issues[0].failure_class, 'same_turn');
  assertEquals(one('pending_ops', { op: 'confirm', ref: 'p3' }).issues[0].failure_class, 'expired');
  assertEquals(one('writes', w('data_erase_request', { evidence_quote: 'hesabımı sil' }), sampleContext({ user_message: 'kalori hesabını sil' })).verdict, 'REJECT');
});

Deno.test('confirmed hold: the suspicious correction commits after the user\'s yes (asks become notes), hard rules still apply', () => {
  const held = one('record_ops', w('record_update', { basis: 'suspicious', evidence_quote: null }), sampleContext({ user_message: 'bugün ne yesem?' }));
  assertEquals(held.verdict, 'ASK');
  const ok = validateConfirmedHold(held.hold_op!, held.args, sampleContext({ user_message: 'evet düzelt' }))!;
  assertEquals(ok.verdict, 'FLAG');
  assert(ok.row, 'a confirmed hold produces the row to write');
  assert(ok.issues.every((i) => i.level !== 'ask'));
  assert(ok.issues.some((i) => i.code === 'supheli_kayit' && i.tr.startsWith('kullanıcı onayladı')));
  // A goal held at tier none must not commit after the user's yes if the tier went amber meanwhile.
  const goal = one('writes', w('goal_set', { goal_type: 'lose_weight', target_weight_kg: 70 }), sampleContext({ goal: { goal_type: 'maintain', target_weight_kg: null } }));
  assertEquals(goal.verdict, 'ASK');
  assertEquals(validateConfirmedHold(goal.hold_op!, goal.args, sampleContext({ ed_tier: 'amber' }))!.verdict, 'REJECT');
  assertEquals(validateConfirmedHold('account_erase_request', {}, sampleContext()), null, 'the KVKK hold runs through erase-hold.ts');
  // A held profile change is one field; a payload with two would let the rules see only the first.
  const two = validateConfirmedHold('profile_set', { op: 'profile_set', subject: 'self', changes: [
    { field: 'occupation', value: 'öğretmen', unit: null, list_op: null, as_stated: 'öğretmenim' },
    { field: 'gender', value: 'female', unit: null, list_op: null, as_stated: 'kadınım' },
  ] }, sampleContext())!;
  assertEquals(two.verdict, 'REJECT');
  assert(two.issues.some((i) => i.code === 'tek_oge_bekleniyor'));
});

Deno.test('collectRefs: every turn-scoped ref in a write (incl. inside a patch) — the caller resolves them before holding', () => {
  assertEquals(collectRefs('record_update', w('record_update', { patch: sampleMeal([{}], { replaces: 'm12' }) })), [
    { path: 'ref', ref: 'm12' },
    { path: 'patch.replaces', ref: 'm12' },
  ]);
  assertEquals(collectRefs('constraint_retract', w('constraint_retract')), [{ path: 'target', ref: 'c2' }]);
  assertEquals(collectRefs('water_log', water()), []);
});

// ─── unknown ops, plan, safety, self-check ───────────────────────────────────

Deno.test('unknown op is REJECTED (repairable), never a silent ok:true', () => {
  const d = validateDecision(sampleDecision({ writes: [{ op: 'meal_update', ref: 'm12' }] }), sampleContext());
  assertEquals(d.verdicts[0].verdict, 'REJECT');
  assertEquals(d.verdicts[0].op, 'unknown');
  assertEquals(d.verdicts[0].issues[0].failure_class, 'unknown_op');
  assertEquals(d.repair.needed, true);
});

Deno.test('plan_action: approve needs the rendered draft ref; generate needs plan_type', () => {
  const ok = validateDecision(sampleDecision({ plan_action: { op: 'approve', plan_type: 'diet', draft_ref: 'dft1' } }), sampleContext());
  assertEquals(ok.plan?.verdict, 'COMMIT');
  assertEquals(validateDecision(sampleDecision({ plan_action: { op: 'approve', plan_type: null, draft_ref: null } }), sampleContext()).plan?.verdict, 'REJECT');
  assertEquals(validateDecision(sampleDecision({ plan_action: { op: 'approve', plan_type: null, draft_ref: 'dft9' } }), sampleContext()).plan?.verdict, 'REJECT');
  assertEquals(validateDecision(sampleDecision({ plan_action: { op: 'generate', plan_type: null, draft_ref: null } }), sampleContext()).plan?.verdict, 'REJECT');
});

Deno.test('final2#9: an ED signal counts only with a verbatim USER quote; illness vomiting never escalates', () => {
  const sig = (q: string, category = 'purging', severity = 'high') => sampleDecision({ safety: { acute_medical: false, self_harm: false, ed_signal: { category, severity, evidence_quote: q }, tripwire_reading: null } });
  const msg = 'yemekten sonra parmağımı boğazıma sokuyorum';
  assertEquals(validateDecision(sig('parmağımı boğazıma sokuyorum'), sampleContext({ user_message: msg })).safety.ed_signal?.escalate, 'high');
  const coach = validateDecision(sig('aç kalma'), sampleContext({ user_message: msg })).safety.ed_signal;
  assertEquals(coach?.accepted, false);
  assertEquals(coach?.escalate, null);
  assertEquals(validateDecision(sig('dün gece kustum', 'illness_vomiting', 'medium'), sampleContext({ user_message: 'dün gece kustum, zehirlendim galiba' })).safety.ed_signal?.escalate, null);
});

Deno.test('§5.1.10: reported a fact but wrote nothing and did not clarify → missed_write (the coach asks; code never injects)', () => {
  const sc = { reported_new_facts: true, not_written_reason: null };
  assertEquals(validateDecision(sampleDecision({ self_check: sc }), sampleContext()).missed_write, true);
  assertEquals(validateDecision(sampleDecision({ self_check: sc, clarify: { topic: 'hangi öğün', candidate_refs: ['m14'] } }), sampleContext()).missed_write, false);
  assertEquals(validateDecision(sampleDecision({ self_check: sc, writes: [water()] }), sampleContext()).missed_write, false);
});

Deno.test('A′: "bunu nasıl düzeltebilirim?" (no record_ops) deletes nothing; a clarify ref that was not shown is flagged', () => {
  const d = validateDecision(sampleDecision({ intent: { primary: 'question', is_hypothetical: false, about_other_person: false }, clarify: { topic: 'hangi kayıt', candidate_refs: ['m14', 'm77'] } }), sampleContext({ user_message: 'bunu nasıl düzeltebilirim?' }));
  assertEquals(d.verdicts.length, 0);
  assert(d.decision_issues.some((i) => i.code === 'clarify_ref_listede_yok'));
});

Deno.test('json_object fallback: a malformed envelope is reported, not guessed', () => {
  const d = validateDecision({ writes: 'su' }, sampleContext());
  assert(d.decision_issues.some((i) => i.code === 'alan_eksik' && i.path === 'intent'));
  assert(d.decision_issues.some((i) => i.code === 'tip_hatasi' && i.path === 'writes'));
  assertEquals(d.verdicts.length, 0);
  const notObj = validateDecision('hello', sampleContext());
  assert(notObj.decision_issues.some((i) => i.code === 'karar_nesne_degil'));
  const missingField = one('writes', (({ mode: _m, ...rest }) => rest)(water()));
  assertEquals(missingField.verdict, 'REJECT');
  assertEquals(missingField.issues[0].code, 'alan_eksik');
});

Deno.test('counts and schema_version are reported for the turn ledger', () => {
  const d = validateDecision(sampleDecision({ writes: [water(), water({ quantity: 2, unit: 'litre' }), water({ quantity: 250, unit: 'litre' })] }), sampleContext());
  assertEquals(d.counts, { COMMIT: 1, FLAG: 0, ASK: 1, REJECT: 1 });
  assertEquals(d.schema_version, 'v1');
});
