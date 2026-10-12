/**
 * validate.test.ts — golden verdicts for validateDecision (AI_MIMARI_V2 §5, §9.4 paket A/A′/D).
 * Each case is a model decision as the strict schema would produce it; the expectation is the
 * code's verdict. The live defects that motivated v2 are the first cases.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { ACUTE_EVIDENCE_CODE, collectRefs, freezeForHold, validateChannelItems, validateConfirmedHold, validateDecision, type WriteVerdict } from './validate.ts';
import { SAMPLE_REFS, SAMPLE_TODAY, SAMPLE_WRITES, sampleContext, sampleDecision, sampleMeal } from './samples.ts';
import type { RenderedRef } from './refs.ts';
import { undoQuestionTr } from './ops/records.ts';
import type { ValidationContext } from './dsl.ts';
import { SCHEMA_VERSION } from './registry.ts';
import { NOT_WRITTEN_REASONS } from './envelope.ts';

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

Deno.test('water in ml: "500 ml su içtim" → COMMIT 0,50 L; 1500 ml → 1,50 L; 2000 ml → ASK; 250 000 ml (250 L) → REJECT (the litre rule is the physical check)', () => {
  const ml500 = one('writes', water({ quantity: 500, unit: 'ml', as_stated: '500 ml' }));
  assertEquals(ml500.verdict, 'COMMIT', JSON.stringify(ml500.issues));
  assertEquals(ml500.row?.liters, 0.5);
  assertEquals(ml500.row?.quantity, 500, 'the model\'s number in the user\'s unit is stored as-is');
  assertEquals(one('writes', water({ quantity: 1500, unit: 'ml' })).verdict, 'COMMIT');
  assertEquals(one('writes', water({ quantity: 2000, unit: 'ml' })).verdict, 'ASK');
  const huge = one('writes', water({ quantity: 250000, unit: 'ml' }));
  assertEquals(huge.verdict, 'REJECT');
  assertEquals(huge.issues.filter((i) => i.level === 'hard').map((i) => i.code), ['litre_araligi']);
  assertEquals(huge.repairable, false);
  assertEquals(one('writes', water({ quantity: -1, unit: 'litre' })).verdict, 'REJECT', 'a negative amount is still impossible');
});

Deno.test('trial 2026-10-11: "bugün 14 litre su içtim" (2 L logged) → ASK with a neutral, code-owned typo question — not a hard reject', () => {
  const ctx = sampleContext({ user_message: 'bugün 14 litre su içtim', day_totals: { '2026-10-06': { water_liters: 2 } } });
  const v = one('writes', water({ quantity: 14, unit: 'litre', mode: 'set_day_total', as_stated: '14 litre' }), ctx);
  assertEquals(v.verdict, 'ASK', JSON.stringify(v.issues));
  assertEquals(codes(v)[0], 'litre_yazim_suphesi');
  assertEquals(v.question_tr, '14 L mi, yoksa 1,4 L mi?');
  assertEquals(v.hold_op, 'water_log');
  assertEquals(v.row, null);
  assert(!/112|acil|tehlike|zehir/u.test(`${v.question_tr} ${v.issues.map((i) => i.tr).join(' ')}`), 'neutral wording, no alarm');
  // An "add" in the band: the typo question is THE question (first ask), not the single-drink one.
  const add = one('writes', water({ quantity: 25, unit: 'litre', as_stated: '25 litre' }), ctx);
  assertEquals(add.verdict, 'ASK');
  assertEquals(add.question_tr, '25 L mi, yoksa 2,5 L mi?');
  assertEquals(one('writes', water({ quantity: 8500, unit: 'ml' }), ctx).question_tr, '8,5 L mi, yoksa 0,85 L mi?');
});

Deno.test('water band edges: 8 L stores, 30 L asks, above 30 L is still physically impossible (REJECT)', () => {
  const total = (l: number) => one('writes', water({ quantity: l, unit: 'litre', mode: 'set_day_total', as_stated: `${l} litre` }), sampleContext({ day_totals: {} }));
  assertEquals(total(8).verdict, 'COMMIT');
  assertEquals(total(8.01).verdict, 'ASK');
  assertEquals(total(30).verdict, 'ASK');
  const over = total(31);
  assertEquals(over.verdict, 'REJECT');
  assertEquals(codes(over), ['litre_araligi']);
  assertEquals(over.issues[0].failure_class, 'out_of_range');
});

Deno.test('water typo hold: a bare "evet" cannot store 14 L (beyond the 8 L per-write bound) — REJECT with the reason, never a FLAGged write', () => {
  const ctx = sampleContext({ user_message: 'evet', day_totals: {} });
  const held = freezeForHold('water_log', water({ quantity: 14, unit: 'litre', mode: 'set_day_total', as_stated: '14 litre' }), ctx.today);
  const v = validateConfirmedHold('water_log', held, ctx)!;
  assertEquals(v.verdict, 'REJECT');
  const h = v.issues.find((i) => i.level === 'hard')!;
  assertEquals(h.code, 'litre_yazim_suphesi');
  assertEquals(h.failure_class, 'out_of_range');
  assert(h.tr.includes('en fazla 8 L'), h.tr);
  assertEquals(v.row, null);
  // A confirmed ordinary hold still writes (its question became a FLAG note).
  const ok = validateConfirmedHold('water_log', freezeForHold('water_log', water({ quantity: 2, unit: 'litre', as_stated: '2 litre' }), ctx.today), ctx)!;
  assertEquals(ok.verdict, 'FLAG');
});

Deno.test('workout: strength set numbers are nullable — "dün squat yaptım" commits with sets/reps/weight null (no placeholder 1 × 1)', () => {
  const v = one('writes', w('workout_log', {
    raw: 'dün squat yaptım', duration_min: null, intensity: null, calories_burned: null, rpe: null, time_local: null,
    strength_sets: [{ exercise: 'squat', as_stated: 'squat', sets: null, reps: null, weight_kg: null }],
  }));
  assertEquals(v.verdict, 'COMMIT', JSON.stringify(v.issues));
  assertEquals((v.row?.strength_sets as Array<Record<string, unknown>>)[0], { exercise: 'squat', as_stated: 'squat', sets: null, reps: null, weight_kg: null });
  assertEquals(one('writes', w('workout_log', { strength_sets: [{ exercise: 'squat', as_stated: '0 tekrar', sets: 3, reps: 0, weight_kg: null }] })).verdict, 'REJECT', 'a stated number is still range-checked');
});

Deno.test('constraint_add: does_not_have finds a LEGACY row through its canonical id; self+has on an active row is a restatement', () => {
  // The loader renders a legacy 'yumurta' row with the canonical id (input.ts canonicalConstraintSubject).
  const refs = { ...sampleContext().refs, c7: { kind: 'c' as const, target: 'constraint' as const, constraint: { kind: 'allergen', subject: 'egg', severity: 'severe', stored_subject: 'yumurta' } } };
  const msg = 'yumurta alerjim yok';
  const ctx = sampleContext({ user_message: msg, refs });
  const no = one('writes', w('constraint_add', { subject_id: 'egg', display_tr: 'yumurta', polarity: 'does_not_have', severity: 'unknown', evidence_quote: msg }), ctx);
  assertEquals(no.verdict, 'REJECT');
  assertEquals(codes(no), ['kaldirma_ref_ile'], 'never a "yok" note beside the active severe allergy — retract the row');
  const has = one('writes', w('constraint_add', { subject_id: 'egg', display_tr: 'yumurta', severity: 'unknown', evidence_quote: 'yumurta alerjim var' }), sampleContext({ user_message: 'yumurta alerjim var', refs }));
  assertEquals(has.row?.effect, 'already_active');
  assertEquals(has.row?.existing, { ref: 'c7', subject: 'yumurta', severity: 'severe', body_parts: [] }, 'the writer matches the row by its STORED subject');
  // A different allergen beside it is a new protective row.
  assertEquals(one('writes', w('constraint_add'), sampleContext({ user_message: 'Fındık alerjim var, ciddi.', refs })).row?.effect, 'activate');
});

Deno.test('constraint_add: a LOWER restated severity on a legacy SEVERE row is held (two-step, code-owned old → new question); confirm writes it', () => {
  // review 2026-10-12: "fıstık alerjim var ama hafif" on mem's legacy severe 'fıstık' downgraded it in
  // one step — the 112 sentence and the two-step removal went with it.
  const { c1: _v2Peanut, ...others } = sampleContext().refs;
  const refs = { ...others, c7: { kind: 'c' as const, target: 'constraint' as const, constraint: { kind: 'allergen', subject: 'peanut', severity: 'severe', stored_subject: 'fıstık' } } };
  const msg = 'fıstık alerjim var ama hafif';
  const v = one('writes', w('constraint_add', { subject_id: 'peanut', display_tr: 'fıstık', severity: 'mild', evidence_quote: msg }), sampleContext({ user_message: msg, refs }));
  assertEquals(v.verdict, 'ASK');
  assertEquals(codes(v), ['iki_adimli_siddet_dusurme']);
  assertEquals(v.row, null, 'nothing is written this turn — the severe row stands');
  assertEquals(v.hold_op, 'constraint_add');
  assertEquals(v.question_tr, 'Fıstık alerjisi kaydını ciddi → hafif olarak değiştirmemi gerçekten istiyor musun? Güvenlik filtrelerin buna göre gevşeyecek.');
  // The next turn's explicit confirm: the question is answered (FLAG note), the row takes the new severity.
  const ok = validateConfirmedHold('constraint_add', v.hold_args!, sampleContext({ user_message: 'evet', refs }))!;
  assertEquals(ok.verdict, 'FLAG', JSON.stringify(ok.issues));
  assertEquals(ok.row?.severity, 'mild');
  assertEquals((ok.row?.existing as Record<string, unknown>).subject, 'fıstık', 'still the stored row, never a second one');
  assert(ok.issues.some((i) => i.code === 'iki_adimli_siddet_dusurme' && i.level === 'flag' && i.tr.startsWith('kullanıcı onayladı')));
});

Deno.test('constraint_add: duplicate same-canonical rows (legacy \'fıstık\' + v2 \'peanut\') — the MOST protective is `existing`, a downgrade is held whichever comes first, the rest ride along as duplicates', () => {
  // retrial 2026-10-12 (mem): 'fıstık' severe (c3) and trial 1's 'peanut' of unstated severity (c6) were both active.
  const { c1: _v2Peanut, ...others } = sampleContext().refs;
  const row = (subject: string, severity: string | null, stored?: string) =>
    ({ kind: 'c' as const, target: 'constraint' as const, constraint: { kind: 'allergen', subject: 'peanut', severity, ...(stored ? { stored_subject: stored } : {}) } });
  const msg = 'fıstık alerjim var ama hafif aslında';
  const decl = w('constraint_add', { subject_id: 'peanut', display_tr: 'fıstık', severity: 'mild', evidence_quote: 'fıstık alerjim var ama hafif' });
  // A MODERATE duplicate rendered first used to be `existing` (no hold: moderate → mild is not guarded);
  // the unstated-severity row (counts as severe) now wins and the downgrade is held.
  const modFirst = { ...others, c3: row('peanut', 'moderate'), c6: row('peanut', null, 'fıstık') };
  const held = one('writes', decl, sampleContext({ user_message: msg, refs: modFirst }));
  assertEquals([held.verdict, codes(held)], ['ASK', ['iki_adimli_siddet_dusurme']]);
  assertStringIncludes(held.question_tr ?? '', 'şiddeti belirsiz (ciddi sayılıyor) → hafif');
  // A stated severe row outranks an unstated one; every other same-subject row is a duplicate.
  const mem = { ...others, c3: row('peanut', 'severe', 'fıstık'), c6: row('peanut', null) };
  const confirmed = validateConfirmedHold('constraint_add', one('writes', decl, sampleContext({ user_message: msg, refs: mem })).hold_args!, sampleContext({ user_message: 'evet', refs: mem }))!;
  assertEquals(confirmed.verdict, 'FLAG');
  assertEquals(confirmed.row?.existing, { ref: 'c3', subject: 'fıstık', severity: 'severe', body_parts: [], duplicates: [{ ref: 'c6', subject: 'peanut', severity: null }] });
  // A single row keeps the old shape (no duplicates key).
  const single = one('writes', w('constraint_add', { subject_id: 'peanut', display_tr: 'fıstık', severity: 'unknown', evidence_quote: 'fıstık alerjim var' }), sampleContext({ user_message: 'fıstık alerjim var', refs: { ...others, c3: row('peanut', 'severe', 'fıstık') } }));
  assertEquals(single.row?.existing, { ref: 'c3', subject: 'fıstık', severity: 'severe', body_parts: [] });
  assertEquals(single.row?.effect, 'already_active');
});

Deno.test('constraint_add severity: only an INCREASE lands directly — unknown/severe allergen, surgery and severe injury downgrades are held', () => {
  const ref = (kind: string, subject: string, severity: string | null, body_parts: string[] = []) =>
    ({ ...sampleContext().refs, c9: { kind: 'c' as const, target: 'constraint' as const, constraint: { kind, subject, severity, body_parts } } });
  const restate = (kind: string, subject: string, stored: string | null, stated: string, body_parts: string[] = []) => {
    const msg = `${subject} durumum ${stated}`;
    return one('writes', { op: 'constraint_add', kind, subject_id: subject, display_tr: subject, whose: 'self', polarity: 'has', severity: stated, body_parts, event_date: null, note: null, evidence_quote: msg },
      sampleContext({ user_message: msg, refs: ref(kind, subject, stored, body_parts) }));
  };
  // Increases land in one step (protection only grows).
  assertEquals(restate('allergen', 'sesame', 'mild', 'severe').row?.severity, 'severe');
  assertEquals(restate('allergen', 'sesame', null, 'severe').verdict, 'COMMIT');
  assertEquals(restate('injury', 'sol_diz', 'mild', 'severe', ['knee']).verdict, 'COMMIT');
  // Held: unknown (= severe in every filter) and severe allergen/intolerance going down, surgery, severe injury.
  const unknown = restate('allergen', 'sesame', null, 'moderate');
  assertEquals(unknown.verdict, 'ASK');
  assertEquals(unknown.question_tr, 'Susam alerjisi kaydını şiddeti belirsiz (ciddi sayılıyor) → orta olarak değiştirmemi gerçekten istiyor musun? Güvenlik filtrelerin buna göre gevşeyecek.');
  assertEquals(restate('intolerance', 'milk', 'severe', 'mild').verdict, 'ASK');
  assertEquals(restate('surgery', 'menisküs', 'moderate', 'mild', ['knee']).verdict, 'ASK');
  assertEquals(restate('injury', 'sol_diz', 'severe', 'moderate', ['knee']).verdict, 'ASK');
  // Not guarded by the removal rule either: a moderate allergen going mild, an unknown-severity injury answered "orta".
  assertEquals(restate('allergen', 'sesame', 'moderate', 'mild').verdict, 'COMMIT');
  assertEquals(restate('injury', 'sol_diz', null, 'moderate', ['knee']).verdict, 'COMMIT');
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
  const del = one('record_ops', { op: 'delete', ref: 'm99', reason: 'sil', evidence_quote: null });
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
  assertEquals(one('record_ops', { op: 'delete', ref: 'd5', reason: 'x', evidence_quote: null }).issues[0].code, 'zaten_geri_alindi');
  const later = one('record_ops', { op: 'delete', ref: 'd6', reason: 'x', evidence_quote: null });
  assertEquals(later.verdict, 'REJECT');
  assert(codes(later).includes('sonraki_yazma_var'));
  // A stored constraint is not undone by record_delete: only the user's newest constraint_add is
  // (RenderedRef.undo_add) — an older one stays constraint_retract's, with its own two-step bar.
  const spine = one('record_ops', { op: 'delete', ref: 'c1', reason: 'x', evidence_quote: null });
  assertEquals(spine.verdict, 'REJECT');
  assertEquals(spine.issues[0].code, 'kisit_yalniz_son_ekleme', 'an older safety row is not deletable here');
  assertEquals(spine.issues[0].failure_class, 'not_deletable');
  assertEquals(spine.repairable, true, 'one repair call may turn it into constraint_retract');
});

Deno.test('final2#2: "geri al" after a water log deletes exactly d3 — the dinner is untouched', () => {
  const d = validateDecision(sampleDecision({ intent: { primary: 'correction', is_hypothetical: false, about_other_person: false }, record_ops: [{ op: 'delete', ref: 'd3', reason: 'yanlış', evidence_quote: null }] }), sampleContext({ user_message: 'yok o yanlış geri al' }));
  assertEquals(d.verdicts.length, 1);
  assertEquals(d.verdicts[0].verdict, 'COMMIT');
  assertEquals(d.verdicts[0].target_ref, 'd3');
  assertEquals(d.verdicts[0].envelope, 'undo');
});

// ─── re-trial 2026-10-12: record_delete evidence + the remote-delete question (lane U) ───────

const YESTERDAY_W: RenderedRef = { kind: 'd', target: 'weight', op: 'body_weight', day: '2026-10-05', summary_tr: 'tartı: 81,6 kg', snapshot: { value: 81.6 } };
const TODAY_W = (extra: Partial<RenderedRef> = {}): RenderedRef =>
  ({ kind: 'd', target: 'weight', op: 'body_weight', day: SAMPLE_TODAY, summary_tr: 'tartı: 88 kg', snapshot: { value: 88 }, ...extra });
const del = (ref: string, evidence_quote: string | null = null) => ({ op: 'delete', ref, reason: 'geri al', evidence_quote });
const delCtx = (msg: string, refs: Record<string, RenderedRef>) => sampleContext({ user_message: msg, refs: { ...SAMPLE_REFS, ...refs } });

Deno.test('record_delete: a message about "bu sabah" deleting YESTERDAY\'s weigh-in is held with a question naming it (final2 collateral)', () => {
  const v = one('record_ops', del('d9', 'düzeltmeyi geri al'), delCtx('ama ben düzeltmeyi geri al dedim, bu sabah 82 kiloydum', { d9: YESTERDAY_W }));
  assertEquals(v.verdict, 'ASK', JSON.stringify(v.issues));
  assertEquals(v.issues.map((i) => i.code), ['uzak_kayit_silme']);
  assertEquals(v.question_tr, 'Dünkü 81,6 kg tartını silmemi istiyor musun?');
  assertEquals(v.hold_op, 'record_delete');
  assertEquals(v.row, null, 'nothing is deleted on this turn');
});

Deno.test('record_delete: the last turn\'s own write of today is the one-step undo; any other record is asked first', () => {
  const msg = 'vazgeçtim geri al';
  assertEquals(one('record_ops', del('d9'), delCtx(msg, { d9: TODAY_W({ last_turn: true }) })).verdict, 'COMMIT', 'last turn + today = one step');
  assertEquals(one('record_ops', del('d9', 'geri al'), delCtx(msg, { d9: TODAY_W({ last_turn: true }) })).verdict, 'COMMIT', 'a verbatim quote');
  const older = one('record_ops', del('d9'), delCtx(msg, { d9: TODAY_W() }));
  assertEquals([older.verdict, older.issues[0]?.code], ['ASK', 'uzak_kayit_silme'], 'today but an older turn');
  assertEquals(older.question_tr, 'Bugünkü 88 kg tartını silmemi istiyor musun?');
  // A record the user had confirmed through a hold is asked even right after (and a correction says what comes back).
  const held = one('record_ops', del('d9'), delCtx(msg, { d9: TODAY_W({ last_turn: true, confirmed_hold: true, correction: true }) }));
  assertEquals(held.verdict, 'ASK');
  assertStringIncludes(held.issues[0].tr, 'onayıyla yazılmış');
  assertEquals(held.question_tr, 'Bugünkü tartı düzeltmesini (88 kg) geri almamı istiyor musun? Düzeltmeden önceki kayıt geri gelir.');
  // A quote the user never wrote is not a deletion request: asked, never committed.
  const fake = one('record_ops', del('d9', 'dünkü kaydı da sil'), delCtx(msg, { d9: TODAY_W({ last_turn: true }) }));
  assertEquals([fake.verdict, fake.issues[0]?.code], ['ASK', 'silme_alintisi']);
});

Deno.test('record_restore_metric takes a write back through the same writer: the same remote-record bar', () => {
  const v = one('record_ops', { op: 'restore_metric', ref: 'd9', reason: 'eski değer' }, delCtx('eski değerine döndür', { d9: YESTERDAY_W }));
  assertEquals([v.verdict, v.hold_op, v.issues[0]?.code], ['ASK', 'record_restore_metric', 'uzak_kayit_silme']);
  assertEquals(one('record_ops', { op: 'restore_metric', ref: 'd9', reason: 'x' }, delCtx('geri al', { d9: TODAY_W({ last_turn: true }) })).verdict, 'COMMIT');
});

Deno.test('record_delete: a confirmed hold commits (its question was answered) — the asks become notes', () => {
  const ctx = delCtx('evet', { d9: YESTERDAY_W });
  const v = validateConfirmedHold('record_delete', del('d9', 'düzeltmeyi geri al'), ctx);
  assert(v);
  assertEquals(v.verdict, 'FLAG', JSON.stringify(v.issues));
  assert(v.row, 'a confirmed delete is written');
  assert(v.issues.every((i) => i.level === 'flag' && i.tr.startsWith('kullanıcı onayladı — ')), JSON.stringify(v.issues));
});

Deno.test('record_delete on a c#: only the just-added constraint, always behind one safety question naming it', () => {
  const fresh: RenderedRef = {
    kind: 'c', target: 'constraint', undo_add: true, user_summary_tr: 'susam alerjisi',
    constraint: { kind: 'allergen', subject: 'sesame', severity: null },
  };
  const v = one('record_ops', del('c7', 'geri al'), delCtx('geri al', { c7: fresh }));
  assertEquals(v.verdict, 'ASK', JSON.stringify(v.issues));
  assertEquals(v.issues.map((i) => i.code), ['son_eklenen_kisit']);
  assertEquals(v.question_tr, 'Az önce eklenen susam alerjisi kaydını geri almamı istiyor musun? Güvenlik filtrelerin buna göre değişecek.');
  const confirmed = validateConfirmedHold('record_delete', del('c7'), delCtx('evet', { c7: fresh }));
  assertEquals(confirmed?.verdict, 'FLAG', 'the confirmation turn writes it');
  // Something was written after the add (it is no longer the newest write): constraint_retract's job.
  const stale = validateConfirmedHold('record_delete', del('c7'), delCtx('evet', { c7: { ...fresh, undo_add: false } }));
  assertEquals(stale?.verdict, 'REJECT');
});

Deno.test('undoQuestionTr words each record kind for the user (no ids, Turkish numbers)', () => {
  const t = SAMPLE_TODAY;
  assertEquals(undoQuestionTr({ kind: 'd', target: 'water', day: t, snapshot: { value: 1.4 } }, t), 'Bugünkü son su kaydını geri almamı istiyor musun? (gün toplamı şu an 1,4 L)');
  assertEquals(undoQuestionTr({ kind: 'd', target: 'sleep', day: '2026-10-02', snapshot: { value: 7 } }, t), '2 Eki tarihli uyku kaydını (7 saat) silmemi istiyor musun?');
  assertEquals(undoQuestionTr({ kind: 'd', target: 'steps', day: t, snapshot: { value: 12000 } }, t), 'Bugünkü adım kaydını (12.000 adım) silmemi istiyor musun?');
  assertEquals(undoQuestionTr({ kind: 'm', target: 'meal', day: '2026-10-05', summary_tr: 'x [model]', user_summary_tr: 'lahmacun 2 dilim · toplam 500 kcal' }, t),
    'Dünkü öğün kaydını (lahmacun 2 dilim · toplam 500 kcal) silmemi istiyor musun?');
  assertEquals(undoQuestionTr({ kind: 'l', target: 'lab', summary_tr: 'D vitamini 12 ng/mL' }, t), 'Tahlil kaydını (D vitamini 12 ng/mL) silmemi istiyor musun?');
  assertEquals(undoQuestionTr(undefined, t), 'Bu kaydı silmemi istiyor musun?');
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

Deno.test('column fits survive derive(): meal kcal 312.5 → 313 and protein 16.37 → 16.4 in the ROW, totals summed from the stored values', () => {
  const v = one('writes', sampleMeal([{ kcal: 312.5, protein_g: 16.37, fat_g: 19.04, carbs_g: 20 }]));
  assertEquals((v.args.items as Array<Record<string, unknown>>)[0].kcal, 312.5, 'args keep the model\'s raw numbers');
  const norm = Object.fromEntries(v.normalized.map((n) => [n.path, n.to]));
  assertEquals(norm['items[0].kcal'], 313);
  assertEquals(norm['items[0].protein_g'], 16.4);
  const item = (v.row?.items as Array<Record<string, unknown>>)[0];
  assertEquals(item.kcal, 313, 'the row must carry the normalised value (integer column), never the raw 312.5');
  assertEquals(item.protein_g, 16.4);
  assertEquals(item.fat_g, 19);
  assertEquals(v.row?.total_kcal, 313);
  // A reference the model picked still overrides kcal by declared arithmetic; model_kcal is the stored (integer) model value.
  const r = one('writes', sampleMeal([{ name: 'lahmacun', as_stated: '2 adet', grams: 260, kcal: 620.4, protein_g: 26, carbs_g: 78, fat_g: 23, reference_key: 'lahmacun', allergens: ['gluten'], may_contain: [] }]));
  const ri = (r.row?.items as Array<Record<string, unknown>>)[0];
  assertEquals(ri.kcal, 624);
  assertEquals(ri.model_kcal, 620);
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
});

Deno.test('§7.4: uncertainty in a PROTECTIVE declaration stores it (FLAG), never holds it — paraphrased quote, injury without a region', () => {
  const para = one('writes', w('constraint_add', { evidence_quote: 'fındığa alerjim olduğunu söyledi' }), sampleContext({ user_message: 'Fındık alerjim var' }));
  assertEquals(para.verdict, 'FLAG', 'protection is never dropped (or postponed) for a paraphrase');
  assert(para.row, 'the allergy reaches the spine this turn, as in v1');
  assertEquals(para.derived.spine, true);
  assert(codes(para).includes('koruyucu_beyan_teyidi'));
  const knee = one('writes', w('constraint_add', {
    kind: 'injury', subject_id: 'injury', display_tr: 'sakatlık', severity: 'moderate', body_parts: [], evidence_quote: 'sakatlandım',
  }), sampleContext({ user_message: 'antrenmanda sakatlandım' }));
  assertEquals(knee.verdict, 'FLAG');
  assert(knee.row);
  assertEquals(knee.derived.region_unknown, true, 'the filters can treat an unplaced injury strictly until the coach asks');
  assert(codes(knee).includes('bolge_belirsiz'));
  // A non-protective shape with a paraphrase is still a (repairable) REJECT: nothing protective is lost.
  const kid = one('writes', w('constraint_add', { whose: 'other_person', evidence_quote: 'kızının alerjisi' }), sampleContext({ user_message: 'kızımın yumurta alerjisi var' }));
  assertEquals(kid.verdict, 'REJECT');
  assertEquals(kid.repairable, true);
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

Deno.test('mem#2 two-step removal COMPLETES: retract c3 → ASK → user\'s yes next turn → FLAG with a row (the quote was checked when the hold was made)', () => {
  for (const [target, quote] of [['c3', 'süt alerjim geçti'], ['c1', 'fıstık alerjim geçti']] as const) {
    const held = one('writes', w('constraint_retract', { target, evidence_quote: quote }), sampleContext({ user_message: quote }));
    assertEquals(held.verdict, 'ASK', target);
    const ok = validateConfirmedHold(held.hold_op!, held.hold_args!, sampleContext({ user_message: 'evet eminim kaldır', today: '2026-10-07', now_iso: '2026-10-07T09:00:00Z' }))!;
    assertEquals(ok.verdict, 'FLAG', `${target}: ${JSON.stringify(ok.issues)}`);
    assert(ok.row, `${target}: a confirmed removal produces the row to write`);
    assert(ok.issues.some((i) => i.code === 'iki_adimli_kaldirma' && i.tr.startsWith('kullanıcı onayladı')));
    assert(!ok.issues.some((i) => i.code === 'alinti_dogrulanamadi'), 'the evidence quote is not re-read against "evet"');
  }
  // State rules are still re-checked: a removal target that is no longer shown → REJECT.
  const held = one('writes', w('constraint_retract', { target: 'c3', evidence_quote: 'süt alerjim geçti' }), sampleContext({ user_message: 'süt alerjim geçti' }));
  assertEquals(validateConfirmedHold(held.hold_op!, held.hold_args!, sampleContext({ refs: {} }))!.verdict, 'REJECT');
  // An identity change held for materiality commits on yes (as_stated is not re-read against "evet").
  const id = one('writes', { op: 'profile_set', subject: 'self', changes: [{ field: 'height_cm', value: '168', unit: 'cm', list_op: null, as_stated: 'boyum 168' }] },
    sampleContext({ user_message: 'boyum 168' }));
  assertEquals(id.verdict, 'ASK');
  assertEquals(validateConfirmedHold(id.hold_op!, id.hold_args!, sampleContext({ user_message: 'evet' }))!.verdict, 'FLAG');
});

Deno.test('holds freeze their day: 2 L water held on 10-06 and confirmed on 10-07 is written to 10-06 (hold_args carry the resolved date)', () => {
  const held = one('writes', water({ quantity: 2, unit: 'litre', as_stated: '2 litre' }));
  assertEquals(held.verdict, 'ASK');
  assertEquals(held.args.day, 'today', 'args stay exactly what the model sent');
  assertEquals(held.hold_args?.day, '2026-10-06');
  const next = sampleContext({ today: '2026-10-07', now_iso: '2026-10-07T00:30:00Z', user_message: 'evet tek seferde' });
  const ok = validateConfirmedHold(held.hold_op!, held.hold_args!, next)!;
  assertEquals(ok.verdict, 'FLAG');
  assertEquals(ok.row?.date, '2026-10-06');
  // Nested day tokens (a suspicious correction's patch) are frozen too.
  const sus = one('record_ops', w('record_update', { basis: 'suspicious', evidence_quote: null, patch: sampleMeal([{}], { day: 'yesterday' }) }), sampleContext({ user_message: 'bugün ne yesem?' }));
  assertEquals(sus.verdict, 'ASK');
  assertEquals((sus.hold_args?.patch as Record<string, unknown>).day, '2026-10-05');
  assertEquals(freezeForHold('water_log', water(), '2026-10-06').day, '2026-10-06');
  // A hold persisted with a relative day can no longer land on the wrong day: it is refused, loudly.
  const raw = validateConfirmedHold('water_log', water({ quantity: 2, unit: 'litre' }), next)!;
  assertEquals(raw.verdict, 'REJECT');
  assert(raw.issues.some((i) => i.code === 'bekletme_gunu_goreli'));
  assertEquals(raw.repairable, false);
  // Non-held verdicts carry no hold payload.
  assertEquals(one('writes', water()).hold_args, null);
});

Deno.test('suspicious record is asked ONCE: a declined suspicion on the same ref → REJECT (no new question); a user correction still commits', () => {
  const refs = { ...sampleContext().refs, m12: { ...sampleContext().refs.m12, suspicion_declined: true } };
  const again = one('record_ops', w('record_update', { basis: 'suspicious', evidence_quote: null }), sampleContext({ refs, user_message: 'bugün ne yesem?' }));
  assertEquals(again.verdict, 'REJECT');
  assert(codes(again).includes('supheli_zaten_soruldu'));
  assertEquals(again.repairable, false);
  const user = one('record_ops', w('record_update'), sampleContext({ refs, user_message: 'perşembe akşamki nugget 1700 olmuş, 6 küçük nuggetti 100 gram falan' }));
  assertEquals(user.verdict, 'COMMIT');
});

Deno.test('§4.4(3) no later write on the same field: update{d6} and step_log{replaces:d6} → REJECT conflict', () => {
  const upd = one('record_ops', { op: 'update', ref: 'd6', basis: 'user_correction', reason: 'adım yanlış', evidence_quote: '5 bin adım', patch: w('step_log', { steps: 5000, as_stated: '5 bin', replaces: null }) },
    sampleContext({ user_message: 'yok 5 bin adım attım' }));
  assertEquals(upd.verdict, 'REJECT');
  assert(codes(upd).includes('sonraki_yazma_var'));
  const rep = one('writes', w('step_log', { steps: 5000, as_stated: '5 bin', replaces: 'd6' }));
  assertEquals(rep.verdict, 'REJECT');
  assert(codes(rep).includes('sonraki_yazma_var'));
  assertEquals(rep.issues.find((i) => i.code === 'sonraki_yazma_var')?.failure_class, 'conflict');
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

Deno.test('json_object fallback: plan_action null (not an object) is reported as a type error and asks for repair, never passes silently', () => {
  const d = validateDecision(sampleDecision({ plan_action: null }), sampleContext());
  assertEquals(d.plan?.verdict, 'REJECT');
  assert(d.plan?.issues.some((i) => i.code === 'tip_hatasi'));
  assertEquals(d.repair.needed, true);
  // Absent is "missing", reported once at envelope level.
  const { plan_action: _p, ...rest } = sampleDecision();
  const absent = validateDecision(rest, sampleContext());
  assert(absent.decision_issues.some((i) => i.code === 'alan_eksik' && i.path === 'plan_action'));
});

Deno.test('final2#9: an ED signal counts only with a verbatim USER quote; illness vomiting never escalates', () => {
  const sig = (q: string, category = 'purging', severity = 'high') => sampleDecision({ safety: { acute_medical: false, self_harm: false, ed_signal: { category, severity, evidence_quote: q }, tripwire_readings: [] } });
  const msg = 'yemekten sonra parmağımı boğazıma sokuyorum';
  assertEquals(validateDecision(sig('parmağımı boğazıma sokuyorum'), sampleContext({ user_message: msg })).safety.ed_signal?.escalate, 'high');
  const coach = validateDecision(sig('aç kalma'), sampleContext({ user_message: msg })).safety.ed_signal;
  assertEquals(coach?.accepted, false);
  assertEquals(coach?.escalate, null);
  assertEquals(validateDecision(sig('dün gece kustum', 'illness_vomiting', 'medium'), sampleContext({ user_message: 'dün gece kustum, zehirlendim galiba' })).safety.ed_signal?.escalate, null);
});

Deno.test('retrial 2026-10-12 (SCHEMA v7): acute_medical counts only with the USER\'s own symptom words; an unevidenced claim is a repairable envelope defect unless a reading already protects', () => {
  const acute = (quote: string | null, readings: unknown[] = []) =>
    sampleDecision({ safety: { acute_medical: true, acute_evidence_quote: quote, tripwire_readings: readings }, reply_route: { contract: 'emergency', effort_hint: 'medium' } });
  // "bugün 14 litre su içtim": no symptom, no trigger — the live re-trial's emergency.
  const water = sampleContext({ user_message: 'bugün 14 litre su içtim' });
  const bare = validateDecision(acute(null), water);
  assertEquals(bare.safety.acute?.accepted, false);
  const issue = bare.decision_issues.find((i) => i.code === ACUTE_EVIDENCE_CODE);
  assertEquals([issue?.level, issue?.path, issue?.repairable], ['hard', 'safety.acute_evidence_quote', true]);
  assertEquals(bare.repair.needed, true, 'the ONE repair call gets the line (quote the symptom or write the report)');
  assertStringIncludes(issue!.tr, 'Bir sayı ya da miktar belirti değildir');
  // A paraphrase is not the user's words either; the whole message as "evidence" passes the code (meaning is the model's).
  assertEquals(validateDecision(acute('çok fazla su içmiş, zehirlenme riski'), water).safety.acute?.accepted, false);
  // A verbatim symptom quote: accepted, no issue.
  const faint = sampleContext({ user_message: 'koşarken başım döndü, göğsüm sıkışıyor' });
  const ok = validateDecision(acute('göğsüm sıkışıyor'), faint);
  assertEquals([ok.safety.acute?.accepted, ok.decision_issues.filter((i) => i.code === ACUTE_EVIDENCE_CODE).length], [true, 0]);
  // A positive tripwire reading already protects the turn: a FLAG only — no repair delays a real emergency.
  const read = validateDecision(acute(null, [{ hit_id: 'tw1', reading: 'positive', reason: 'gerçek bayılma' }]), faint);
  assertEquals(read.decision_issues.find((i) => i.code === ACUTE_EVIDENCE_CODE)?.level, 'flag');
  assertEquals([read.safety.acute?.accepted, read.repair.needed], [false, false]);
  // No claim → nothing to evidence (a stray quote with acute_medical false is ignored).
  assertEquals(validateDecision(sampleDecision({ safety: { acute_medical: false, acute_evidence_quote: 'x' } }), water).safety.acute, null);
  // The field is part of the strict envelope: a json_object answer without it is a missing field.
  const noKey = sampleDecision();
  delete (noKey.safety as Record<string, unknown>).acute_evidence_quote;
  assert(validateDecision(noKey, water).decision_issues.some((i) => i.code === 'alan_eksik' && i.path === 'safety.acute_evidence_quote'));
});

Deno.test('§5.1.10: reported a fact but wrote nothing and did not clarify → missed_write (the coach asks; code never injects)', () => {
  const sc = { reported_new_facts: true, not_written_reason: null };
  assertEquals(validateDecision(sampleDecision({ self_check: sc }), sampleContext()).missed_write, true);
  assertEquals(validateDecision(sampleDecision({ self_check: sc, clarify: { topic: 'hangi öğün', candidate_refs: ['m14'] } }), sampleContext()).missed_write, false);
  assertEquals(validateDecision(sampleDecision({ self_check: sc, writes: [water()] }), sampleContext()).missed_write, false);
  assertEquals(validateDecision(sampleDecision({ self_check: sc }), sampleContext()).not_written_reason, null);
});

Deno.test('§5.1.10: a DECLARED not_written_reason is a decision, not a miss (emergency / illness turns never become a data-entry question)', () => {
  const emergency = sampleDecision({
    safety: { acute_medical: true, acute_evidence_quote: 'hâlâ başım dönüyor', self_harm: false, ed_signal: null, tripwire_readings: [] },
    reply_route: { contract: 'emergency', effort_hint: 'medium' },
    self_check: { reported_new_facts: true, not_written_reason: 'emergency_turn' },
  });
  const e = validateDecision(emergency, sampleContext({ user_message: 'antrenmanda bayıldım, hâlâ başım dönüyor' }));
  assertEquals([e.missed_write, e.not_written_reason], [false, 'emergency_turn']);
  assertEquals(e.decision_issues, []);
  assertEquals(e.safety.acute?.accepted, true);
  const illness = validateDecision(sampleDecision({
    self_check: { reported_new_facts: true, not_written_reason: 'illness_not_food' },
  }), sampleContext({ user_message: 'dün gece kustum, zehirlendim galiba' }));
  assertEquals([illness.missed_write, illness.not_written_reason], [false, 'illness_not_food']);
  // Every declared id explains the omission.
  for (const id of Object.keys(NOT_WRITTEN_REASONS)) {
    const v = validateDecision(sampleDecision({ self_check: { reported_new_facts: true, not_written_reason: id } }), sampleContext());
    assertEquals([v.missed_write, v.not_written_reason], [false, id], id);
  }
  // The reason is only surfaced for an UNWRITTEN report: written / clarified / nothing reported → null.
  const reason = { reported_new_facts: true, not_written_reason: 'needs_clarification' };
  assertEquals(validateDecision(sampleDecision({ self_check: reason, writes: [water()] }), sampleContext()).not_written_reason, null);
  assertEquals(validateDecision(sampleDecision({ self_check: reason, clarify: { topic: 'hangi öğün', candidate_refs: ['m14'] } }), sampleContext()).not_written_reason, null);
  assertEquals(validateDecision(sampleDecision({ self_check: { reported_new_facts: false, not_written_reason: 'needs_clarification' } }), sampleContext()).not_written_reason, null);
});

Deno.test('safety.tripwire_readings: one {hit_id, reading, reason} per hit; an unknown reading or the v3 single-object shape is an envelope issue', () => {
  const safety = (tripwire_readings: unknown) => sampleDecision({ safety: { acute_medical: false, self_harm: false, ed_signal: null, tripwire_readings } });
  const ok = validateDecision(safety([{ hit_id: 'tw1', reading: 'benign', reason: '"bayıldım" çok beğenmek' }, { hit_id: 'tw2', reading: 'positive', reason: 'emin değilim' }]), sampleContext());
  assertEquals(ok.decision_issues, []);
  const unknown = validateDecision(safety([{ hit_id: 'tw1', reading: 'maybe', reason: 'x' }]), sampleContext());
  assert(unknown.decision_issues.some((i) => i.path === 'safety.tripwire_readings[0].reading' && i.level === 'hard'), JSON.stringify(unknown.decision_issues));
  const v3 = validateDecision(safety({ benign: true, reason: 'beğeni' }), sampleContext());
  assert(v3.decision_issues.some((i) => i.path === 'safety.tripwire_readings' && i.code === 'tip_hatasi'), JSON.stringify(v3.decision_issues));
  assertEquals(v3.repair.needed, true, 'a fixable shape error is repaired, never read as "no trigger"');
});

Deno.test('§5.1.10: the reason list is CLOSED — free text, a blank or an unknown id explains nothing (still a miss, and an envelope issue)', () => {
  // v3 took any non-blank text ("bilgi eksik", "acil sağlık durumu; önce güvenlik") as an excuse; a
  // json_object fallback could then silence the coach's question with any words. Only the ids count.
  for (const bad of ['acil sağlık durumu; önce güvenlik', 'bilgi eksik', 'Emergency_Turn', 'no_field', '', '   ', null]) {
    const v = validateDecision(sampleDecision({ self_check: { reported_new_facts: true, not_written_reason: bad } }), sampleContext());
    assertEquals([v.missed_write, v.not_written_reason], [true, null], JSON.stringify(bad));
    if (bad !== null) assert(v.decision_issues.some((i) => i.path === 'self_check.not_written_reason' && i.level === 'hard'), `${JSON.stringify(bad)}: not a declared id`);
  }
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
  assertEquals(d.schema_version, SCHEMA_VERSION);
});
