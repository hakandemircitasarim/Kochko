/**
 * receipts.test.ts — Turkish receipt lines with diacritics, built from what was STORED
 * (AI_MIMARI_V2 §4.1 receipts.ts, §5.2; mem#13 'yaş' label, final2#15 English enum leaks).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { holdLine, MEAL_LOGGED_MARK, receiptLine, rejectLine, toActionReceipt, turnFactLine } from './receipts.ts';
import { validateChannelItems, type WriteVerdict } from './validate.ts';
import { SAMPLE_MESSAGES, SAMPLE_REFS, SAMPLE_TODAY, SAMPLE_WRITES, sampleContext, sampleMeal } from './samples.ts';
import type { RenderedRef } from './refs.ts';
import { REGISTRY } from './registry.ts';
import type { Channel } from './dsl.ts';

const ctx = sampleContext();
const v1 = (channel: Channel, item: Record<string, unknown>, msg = ''): WriteVerdict =>
  validateChannelItems(channel, [item], sampleContext({ user_message: msg }))[0];
const w = (op: string, over: Record<string, unknown> = {}) => ({ ...structuredClone(SAMPLE_WRITES[op]), ...over });

Deno.test('meal receipt keeps the byte-identical "Öğün kaydedildi" prefix and itemises the STORED numbers (~ = estimate)', () => {
  assertEquals(MEAL_LOGGED_MARK, 'Öğün kaydedildi');
  const line = receiptLine(v1('writes', sampleMeal()), ctx)!;
  assert(line.startsWith('Öğün kaydedildi — '), line);
  assert(line.includes('tavuk nugget (6 adet) ~320 kcal'), line);
  assert(line.endsWith('toplam 320 kcal'), line);
});

Deno.test('water receipts: "+0,20 L", day total, and "(dün)" for yesterday', () => {
  assertEquals(receiptLine(v1('writes', w('water_log')), ctx), 'Su: +0,20 L');
  assertEquals(receiptLine(v1('writes', w('water_log', { quantity: 2, unit: 'litre', mode: 'set_day_total' })), ctx), 'Su: günün toplamı 2,00 L');
  assertEquals(receiptLine(v1('writes', w('water_log', { day: 'yesterday' })), ctx), 'Su: +0,20 L (dün)');
});

Deno.test('metric receipts use Turkish numbers and labels', () => {
  assertEquals(receiptLine(v1('writes', w('body_weight')), ctx), 'Tartı kaydedildi: 82,25 kg');
  assertEquals(receiptLine(v1('writes', w('step_log')), ctx), '12.000 adım kaydedildi');
  assertEquals(receiptLine(v1('writes', w('sleep_log')), ctx), 'Uyku kaydedildi: 6,5 saat (kötü)');
  assertEquals(receiptLine(v1('writes', w('mood_log')), ctx), 'Ruh hali kaydedildi: 4/5');
  assertEquals(receiptLine(v1('writes', w('workout_log')), ctx), 'Antrenman kaydedildi: ağırlık/kuvvet, 46 dk (~280 kcal yakım) (dün)');
});

Deno.test('profile receipts never leak enum ids or mislabel birth year as age (mem#13)', () => {
  const h = receiptLine(v1('writes', w('profile_set'), 'boyum 1.75'), ctx);
  assertEquals(h, 'Profil güncellendi: boy 175 cm');
  const act = receiptLine(v1('writes', { op: 'profile_set', subject: 'self', changes: [{ field: 'activity_level', value: 'sedentary', unit: null, list_op: null, as_stated: 'masa başı' }] }), ctx)!;
  assertEquals(act, 'Profil güncellendi: günlük aktivite düzeyi hareketsiz');
  assert(!act.includes('sedentary'));
  const by = receiptLine(v1('writes', { op: 'profile_set', subject: 'self', changes: [{ field: 'birth_year', value: '37', unit: 'age_years', list_op: null, as_stated: '37 yaşındayım' }] }, '37 yaşındayım'), ctx)!;
  assert(by.startsWith('Profil güncellendi: doğum yılı'), by);
  assert(by.endsWith('1989'), by);
  const list = receiptLine(v1('writes', { op: 'profile_set', subject: 'self', changes: [{ field: 'disliked_exercises', value: 'burpee', unit: null, list_op: 'add', as_stated: 'burpee yapamıyorum' }] }), ctx);
  assertEquals(list, 'Profil güncellendi: sevmediği/yapamadığı egzersizler +burpee');
});

Deno.test('spine receipts say what really happened (activated / absence noted / someone else\'s, not yours)', () => {
  assertEquals(receiptLine(v1('writes', w('constraint_add'), SAMPLE_MESSAGES.constraint_add), ctx), 'Alerji kaydedildi: fındık (ciddi)');
  assertEquals(receiptLine(v1('writes', w('constraint_add', { kind: 'medication', subject_id: 'levotiroksin', display_tr: 'levotiroksin', severity: 'mild' }), SAMPLE_MESSAGES.constraint_add), ctx), 'İlaç kaydedildi: levotiroksin');
  const kid = v1('writes', w('constraint_add', { subject_id: 'egg', display_tr: 'yumurta', whose: 'other_person', evidence_quote: 'kızımın yumurta alerjisi var' }), 'kızımın yumurta alerjisi var');
  assertEquals(receiptLine(kid, ctx), 'Not aldım: yumurta (başkası için; senin kısıtlarına eklenmedi)');
  assertEquals(receiptLine(v1('writes', w('constraint_retract'), 'dizim tamamen iyileşti'), ctx), 'Kaldırıldı: diz sakatlığı (orta)');
});

Deno.test('record receipts quote the record the user was shown; a correction shows the STORED patch (old record quoted only without a snapshot)', () => {
  assertEquals(receiptLine(v1('record_ops', w('record_delete')), ctx), 'Kayıt geri alındı: su +0,20 L (gün 1,60 L)');
  assertEquals(
    receiptLine(v1('record_ops', w('record_update'), SAMPLE_MESSAGES.record_update), ctx),
    'Kayıt düzeltildi — tavuk nugget (6 küçük) ~290 kcal · toplam 290 kcal (2026-10-02); önceki kayıt: Per 2 Eki akşam · "6 tavuk nugget" → 900 g 1708 kcal',
  );
});

// ─── live trial 2026-10-11 (final2 "pardon lahmacun aslında tek dilimdi") ──────────────────────────

/** The trial's m1 as the loader renders it: model-facing summary WITH the tag, user summary + snapshot without. */
const LAHMACUN_REF: RenderedRef = {
  kind: 'm', target: 'meal', op: 'meal_log', day: '2026-10-06', last_turn: true,
  summary_tr: 'lahmacun (2 dilim ~200 g) 500 kcal; ayran (bir ayran ~250 g) 90 kcal · toplam 590 kcal [model]',
  user_summary_tr: 'lahmacun (2 dilim ~200 g) 500 kcal; ayran (bir ayran ~250 g) 90 kcal · toplam 590 kcal',
  snapshot: { items: [{ name: 'lahmacun', portion: '2 dilim', kcal: 500 }, { name: 'ayran', portion: 'bir ayran', kcal: 90 }], total_kcal: 590 },
};
const trialCtx = (msg: string) => sampleContext({ user_message: msg, refs: { ...SAMPLE_REFS, m1: LAHMACUN_REF } });
const lahmacunFix = () => ({
  op: 'update', ref: 'm1', basis: 'user_correction', reason: 'tek dilim', evidence_quote: 'lahmacun aslında tek dilimdi',
  patch: sampleMeal([
    { name: 'lahmacun', as_stated: 'tek dilim', grams: 100, kcal: 250, protein_g: 10, carbs_g: 30, fat_g: 9, allergens: ['gluten'], may_contain: [] },
    { name: 'ayran', as_stated: 'bir ayran', grams: 250, kcal: 90, protein_g: 5, carbs_g: 7, fat_g: 4, allergens: ['milk'], may_contain: [] },
  ], { day: 'today', meal_type: 'lunch', raw: 'lahmacun tek dilim, ayran' }),
});

Deno.test('trial: a meal record_update receipt renders the PATCH kcal, old → new — never the old record (the coach believed it)', () => {
  const msg = 'pardon lahmacun aslında tek dilimdi';
  const v = validateChannelItems('record_ops', [lahmacunFix()], trialCtx(msg))[0];
  assertEquals(v.verdict, 'COMMIT', JSON.stringify(v.issues));
  const line = receiptLine(v, { today: SAMPLE_TODAY, refs: trialCtx(msg).refs })!;
  assertEquals(line, 'Kayıt düzeltildi — lahmacun 2 dilim → tek dilim (500 → ~250 kcal) · toplam 590 → 340 kcal');
  assert(!line.includes('[model]'), 'the provenance tag is model-facing');
  // The Stage B fact is the same line: the coach reads the corrected record as the fact.
  const fact = turnFactLine(v, { today: SAMPLE_TODAY, refs: trialCtx(msg).refs });
  assertEquals(fact, `KAYDEDİLDİ: ${line}`);
  assert(fact.includes('340') && !fact.includes('toplam 590 kcal'), fact);
});

Deno.test('trial: undo / delete receipts quote the USER summary — no "[model]" tag', () => {
  const del = validateChannelItems('record_ops', [{ op: 'delete', ref: 'm1', reason: 'geri al' }], trialCtx('geri al'))[0];
  const line = receiptLine(del, { today: SAMPLE_TODAY, refs: trialCtx('geri al').refs })!;
  assertEquals(line, 'Kayıt geri alındı: lahmacun (2 dilim ~200 g) 500 kcal; ayran (bir ayran ~250 g) 90 kcal · toplam 590 kcal');
});

Deno.test('a correction diff names added and removed items; a metric correction is old → new in its unit', () => {
  const msg = 'ayranı yanlış yazmışım, kola içtim';
  const fix = lahmacunFix();
  (fix.patch as Record<string, unknown>).items = [
    (fix.patch as { items: unknown[] }).items[0],
    { name: 'kola', as_stated: '1 kutu', grams: 330, kcal: 139, protein_g: 0, carbs_g: 35, fat_g: 0, alcohol_g: 0, caffeine_mg: 32, preparation: null, allergens: [], may_contain: [], reference_key: null, confidence: 0.8 },
  ];
  fix.evidence_quote = 'kola içtim';
  const v = validateChannelItems('record_ops', [fix], trialCtx(msg))[0];
  const line = receiptLine(v, { today: SAMPLE_TODAY, refs: trialCtx(msg).refs })!;
  assertEquals(line, 'Kayıt düzeltildi — lahmacun 2 dilim → tek dilim (500 → ~250 kcal) · kola (1 kutu) ~139 kcal (yeni) · ayran çıkarıldı · toplam 590 → 389 kcal');
  const weightRef: RenderedRef = { kind: 'd', target: 'weight', op: 'body_weight', day: SAMPLE_TODAY, summary_tr: 'tartı: 78,2 kg', snapshot: { value: 78.2 } };
  const wctx = sampleContext({ user_message: 'tartı 81,6 olacaktı', refs: { ...SAMPLE_REFS, d9: weightRef } });
  const wv = validateChannelItems('record_ops', [{
    op: 'update', ref: 'd9', basis: 'user_correction', reason: 'yanlış', evidence_quote: 'tartı 81,6 olacaktı',
    patch: { op: 'body_weight', day: 'today', kg: 81.6, as_stated: '81,6', replaces: null },
  }], wctx)[0];
  assertEquals(wv.verdict, 'COMMIT', JSON.stringify(wv.issues));
  assertEquals(receiptLine(wv, { today: SAMPLE_TODAY, refs: wctx.refs }), 'Kayıt düzeltildi — tartı 78,2 → 81,6 kg');
});

Deno.test('trial: someone else\'s constraint — ONE pair of parentheses even when display_tr names the owner', () => {
  const kid = v1('writes', w('constraint_add', { subject_id: 'egg', display_tr: 'yumurta (kızının)', whose: 'other_person', evidence_quote: 'kızımın da yumurta alerjisi var' }), 'kızımın da yumurta alerjisi var');
  assertEquals(receiptLine(kid, ctx), 'Not aldım: yumurta (kızının; senin kısıtlarına eklenmedi)');
  const pref = v1('writes', w('food_pref', { food: 'brokoli (eşimin)', whose: 'other_person' }));
  assertEquals(receiptLine(pref, ctx), 'Not aldım: brokoli (eşimin; senin tercihlerine eklenmedi)');
  assertEquals(receiptLine(v1('writes', w('food_pref', { whose: 'other_person' })), ctx), 'Not aldım: brokoli (başkasının tercihi)');
});

Deno.test('a restatement of an active spine row says "zaten kayıtlı" (or the severity it updated) — never "kaydedildi" as if new', () => {
  // SAMPLE_REFS c1 = peanut (severe), c3 = milk (severity unknown).
  const again = v1('writes', w('constraint_add', { subject_id: 'peanut', display_tr: 'fıstık', severity: 'unknown', evidence_quote: 'fıstık alerjim var' }), 'fıstık alerjim var');
  assertEquals(again.row?.effect, 'already_active');
  assertEquals(receiptLine(again, ctx), 'Alerji zaten kayıtlı: fıstık (ciddi)');
  assertEquals(again.issues.filter((i) => i.code === 'siddet_bilinmiyor').length, 0, 'the stored severity is known: no re-ask');
  const milder = v1('writes', w('constraint_add', { subject_id: 'milk', display_tr: 'süt', severity: 'severe', evidence_quote: 'süt alerjim ciddi' }), 'süt alerjim ciddi');
  assertEquals(milder.row?.effect, 'activate');
  assertEquals(receiptLine(milder, ctx), 'Alerji güncellendi: süt (şiddet: ciddi)');
});

Deno.test('every registry op yields a non-empty Turkish line or an intentional silence for its sample', () => {
  const silent = new Set(['data_erase_request', 'memory_note']);
  for (const o of REGISTRY) {
    const v = v1(o.channel, w(o.type), SAMPLE_MESSAGES[o.type] ?? '');
    const line = receiptLine(v, ctx);
    if (silent.has(o.type)) assertEquals(line, null, o.type);
    else assert(line && line.length > 3, `${o.type}: ${line}`);
    if (line) assert(!/\b(Ogun|kaydi|basarisiz|Taahhut)\b/.test(line), `${o.type}: ASCII-folded Turkish in "${line}"`);
  }
});

Deno.test('toActionReceipt: ok comes from the WRITER; ASK has no receipt; REJECT is ok:false with its class', () => {
  const commit = v1('writes', w('water_log'));
  assertEquals(toActionReceipt(commit, { ok: true, rows_affected: 1 }, ctx), {
    action_type: 'water_log', ok: true, rows_affected: 1, user_line: 'Su: +0,20 L', failure_class: null,
  });
  const failed = toActionReceipt(commit, { ok: false, rows_affected: 0, failure_class: 'write_failed' }, ctx)!;
  assertEquals(failed.ok, false);
  assertEquals(failed.user_line, 'Su kaydedilemedi');
  assertEquals(toActionReceipt(commit, null, ctx)?.ok, false, 'no writer result → never a green badge');
  const ask = v1('writes', w('water_log', { quantity: 2, unit: 'litre' }));
  assertEquals(toActionReceipt(ask, null, ctx), null);
  const rej = v1('writes', w('water_log', { quantity: 250, unit: 'litre' }));
  const r = toActionReceipt(rej, null, ctx)!;
  assertEquals(r.ok, false);
  assertEquals(r.failure_class, 'out_of_range');
  assert(r.user_line!.startsWith('Kaydedilmedi (Su): '));
});

Deno.test('Stage B facts: hold and reject lines carry the reason and the one question', () => {
  const ask = v1('writes', w('water_log', { quantity: 1, unit: 'litre', mode: 'set_day_total' }));
  assert(holdLine(ask).startsWith('Onayını bekliyor (Su): '));
  const fact = turnFactLine(ask, ctx);
  assert(fact.startsWith('BEKLETİLDİ: '), fact);
  assert(fact.includes('sorulacak: Bu miktar günün toplamı mı'), fact);
  const rej = v1('writes', w('water_log', { quantity: 250, unit: 'litre' }));
  assert(rejectLine(rej).includes('mümkün değil'));
  assert(turnFactLine(v1('writes', w('water_log')), ctx).startsWith('KAYDEDİLDİ: Su: +0,20 L'));
  const noop = v1('writes', sampleMeal([{}], { status: 'restatement' }));
  assert(turnFactLine(noop, ctx).startsWith('YAZILMADI (Öğün): '));
  assertEquals(receiptLine(noop, ctx), null);
});
