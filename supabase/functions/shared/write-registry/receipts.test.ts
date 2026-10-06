/**
 * receipts.test.ts — Turkish receipt lines with diacritics, built from what was STORED
 * (AI_MIMARI_V2 §4.1 receipts.ts, §5.2; mem#13 'yaş' label, final2#15 English enum leaks).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { holdLine, MEAL_LOGGED_MARK, receiptLine, rejectLine, toActionReceipt, turnFactLine } from './receipts.ts';
import { validateChannelItems, type WriteVerdict } from './validate.ts';
import { SAMPLE_MESSAGES, SAMPLE_WRITES, sampleContext, sampleMeal } from './samples.ts';
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

Deno.test('record receipts quote the record the user was shown', () => {
  assertEquals(receiptLine(v1('record_ops', w('record_delete')), ctx), 'Kayıt geri alındı: su +0,20 L (gün 1,60 L)');
  assertEquals(receiptLine(v1('record_ops', w('record_update'), SAMPLE_MESSAGES.record_update), ctx), 'Kayıt düzeltildi: Per 2 Eki akşam · "6 tavuk nugget" → 900 g 1708 kcal');
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
