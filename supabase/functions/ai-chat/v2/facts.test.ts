/**
 * facts.test.ts — the Stage B fact blocks (AI_MIMARI_V2 §3.2 T6, §5.1.10, §8.2 item 5).
 *
 * Pinned: today's numbers come from code and include this turn's committed meals/water only when
 * code can total them exactly (otherwise no "kalan" number at all); BU TURDA OLANLAR lists what was
 * stored / held (with the ONE question) / rejected (with the reason) / flagged, never a failed
 * receipt twice; the missed-write question only for an unexplained omission (mirrors validateDecision);
 * the tripwire facts only on the protective / fail-closed paths; and the block reads as facts, not
 * as a v1 order pile.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  budgetFacts, buildStageBFacts, missedWrite, renderBudgetLine, renderStageBFacts, renderTripwireFacts, renderTurnEvents,
  renderUserState, turnIntakeDelta,
} from './facts.ts';
import { validationContext } from './input.ts';
import { validateDecision } from '../../shared/write-registry/mod.ts';
import { asciiTurkishHits, pileWords, shoutedWords, SHOUT_WORDS } from '../../shared/prompt-lint.ts';
import {
  coachInput, commit, decision, edFallbackTripwire, mealWrite, normalTripwire, NOW, protectiveTripwire, seededTurnInput,
} from './stage-b-testing.ts';

const MEAL_OK = { action_type: 'meal_log', legacy_type: 'meal_log', ok: true, rows_affected: 1, failure_class: null, user_line: 'Öğün kaydedildi — ızgara tavuk (1 porsiyon) ~400 kcal · toplam 400 kcal', ref: 'm4' };

Deno.test('user state: profile, ONE target (plan band) with today\'s position, constraints, holds, promises, plan', async () => {
  const ti = await seededTurnInput();
  const lines = renderUserState(ti);
  const text = lines.join('\n');
  assertStringIncludes(text, 'Şimdi: Çarşamba 2026-10-07 14:30');
  assertStringIncludes(text, 'Profil: cinsiyet kadın · doğum yılı 1990 · boy 165 cm · kilo 70,0 kg');
  assertStringIncludes(text, 'Bugün (sunucu): 675 kcal · hedef aralığı 1.500–1.700 kcal (günlük plan), alt sınıra 825 kcal var · protein 28 / 110 g · su 1,60 / 2,5 L');
  assertStringIncludes(text, '- c1 alerji · fıstık · ciddi');
  assertStringIncludes(text, '- c2 sakatlık · sol_diz · şiddeti belirtilmemiş · bölge: diz');
  assertStringIncludes(text, 'Bekleyen onaylar: p1 veri silme talebi');
  assertStringIncludes(text, 'Açık sözler: k1 "akşam 8\'den sonra yemeyeceğim" (takip Per 8 Eki)');
  assertStringIncludes(text, 'Plan: aktif antrenman planı (hafta 2026-09-28) · dft1 beslenme taslağı (hafta 2026-10-05, onay bekliyor)');
  assert(!text.includes('Yeme bozukluğu risk düzeyi'), 'tier none is not a fact worth a line');
});

Deno.test('user state: no constraints is itself a fact; an unread safety row reads as gated', async () => {
  const ti = await seededTurnInput((t) => { t.user_constraints = []; t.user_safety_state = []; });
  assertStringIncludes(renderUserState(ti).join('\n'), 'Kısıtlar: kayıtlı alerji, sakatlık ya da hastalık yok');
  const amber = await seededTurnInput((t) => { (t.user_safety_state[0] as Record<string, unknown>).ed_tier = 'amber'; });
  assertStringIncludes(renderUserState(amber).join('\n'), 'Yeme bozukluğu risk düzeyi: yükselmiş (amber) (kodda hedef düşürme ve kalori açığı kapalı)');
});

Deno.test('budget: a committed meal of today is added (the coach can quote post-turn numbers)', async () => {
  const ti = await seededTurnInput();
  const d = decision({ writes: [mealWrite([['ızgara tavuk', 400, 45]])] });
  const delta = turnIntakeDelta(ti, d, commit({ receipts: [MEAL_OK] }));
  assertEquals(delta, { kcal: 400, proteinG: 45, waterLiters: null, changed: true, certain: true });
  const line = renderBudgetLine(budgetFacts(ti, delta));
  assertStringIncludes(line, '1.075 kcal (bu turdaki kayıtlar dahil)');
  assertStringIncludes(line, 'alt sınıra 425 kcal var');
  assertStringIncludes(line, 'protein 73 / 110 g');
});

Deno.test('budget: a held meal is not added; a meal of yesterday does not touch today', async () => {
  const ti = await seededTurnInput();
  const held = turnIntakeDelta(ti, decision({ writes: [mealWrite([['büyük pizza', 2600, 90]])] }), commit({
    holds: [{ op: 'meal_log', reason_code: 'ogun_toplam_yuksek', question_tr: 'Bu öğün çok yüksek kalorili çıktı; porsiyonları doğru anladım mı?', hold_id: 'pw-9' }],
  }));
  assertEquals(held, { kcal: 0, proteinG: 0, waterLiters: null, changed: false, certain: true });
  const yesterday = turnIntakeDelta(ti, decision({ writes: [mealWrite([['dün akşam köfte', 600, 30]], { day: 'yesterday' })] }), commit({ receipts: [MEAL_OK] }));
  assertEquals(yesterday.kcal, 0);
  assert(yesterday.certain);
});

Deno.test('budget: an outcome code cannot total exactly gives NO remaining number (never a guess)', async () => {
  const ti = await seededTurnInput();
  // Two meals, one stored, one held: which one is in the total is unknowable from the outcome counts.
  const mixed = turnIntakeDelta(ti, decision({ writes: [mealWrite([['çorba', 200, 8]]), mealWrite([['pizza', 2600, 90]])] }), commit({
    receipts: [MEAL_OK], holds: [{ op: 'meal_log', reason_code: 'ogun_toplam_yuksek', question_tr: '?', hold_id: null }],
  }));
  assertEquals(mixed.certain, false);
  const line = renderBudgetLine(budgetFacts(ti, mixed));
  assertStringIncludes(line, '675 kcal (bu turdan önceki toplam; bu turdaki değişiklik koda göre kesinleşmedi, kalan sayısı yok)');
  assert(!line.includes('alt sınıra'), line);
  // A delete of one of today's meals: uncertain too.
  const del = turnIntakeDelta(ti, decision({ record_ops: [{ op: 'delete', ref: 'm3', reason: 'yanlış' }] }), commit());
  assertEquals(del.certain, false);
});

Deno.test('budget: water uses the ONE unit table; set_day_total replaces the stored total', async () => {
  const ti = await seededTurnInput();
  const add = turnIntakeDelta(ti, decision({ writes: [{ op: 'water_log', day: 'today', as_stated: '2 bardak', quantity: 2, unit: 'bardak', other_ml_each: null, mode: 'add', replaces: null }] }), commit({
    receipts: [{ action_type: 'water_log', legacy_type: 'water_log', ok: true, rows_affected: 1, user_line: 'Su: +0,40 L', failure_class: null }],
  }));
  assertEquals(add.waterLiters, 2);
  assertStringIncludes(renderBudgetLine(budgetFacts(ti, add)), 'su 2,00 / 2,5 L');
  const set = turnIntakeDelta(ti, decision({ writes: [{ op: 'water_log', day: 'today', as_stated: 'toplam 1 litre', quantity: 1, unit: 'litre', other_ml_each: null, mode: 'set_day_total', replaces: null }] }), commit({
    receipts: [{ action_type: 'water_log', legacy_type: 'water_log', ok: true, rows_affected: 1, user_line: 'Su: günün toplamı 1,00 L', failure_class: null }],
  }));
  assertEquals(set.waterLiters, 1);
});

Deno.test('BU TURDA OLANLAR: stored, held with the ONE question, rejected with the reason, flagged, exposure', async () => {
  const ti = await seededTurnInput();
  const lines = renderTurnEvents(ti, decision(), commit({
    receipts: [
      MEAL_OK,
      { action_type: 'water_log', legacy_type: 'water_log', ok: false, rows_affected: 0, user_line: 'Kaydedilmedi (Su): litre 250 mümkün değil', failure_class: 'out_of_range' },
      { action_type: 'body_weight', legacy_type: 'weight_log', ok: false, rows_affected: 0, user_line: 'Tartı kaydedilemedi', failure_class: 'write_failed' },
    ],
    holds: [{ op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', question_tr: 'Bu kaydı gerçekten kaldırmamı istiyor musun? Güvenlik filtrelerin buna göre değişecek.', hold_id: 'pw-2' }],
    rejects: [{ op: 'water_log', reason_code: 'litre_araligi', reason_tr: '250 L su fiziksel olarak mümkün değil' }],
    flags: [{ op: 'meal_log', code: 'dusuk_guven', note_tr: 'porsiyon tahmini belirsiz' }],
    exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }],
  }));
  assertEquals(lines, [
    '- KAYDEDİLDİ: Öğün kaydedildi — ızgara tavuk (1 porsiyon) ~400 kcal · toplam 400 kcal',
    '- KAYDEDİLEMEDİ (teknik hata, write_failed): Tartı kaydedilemedi',
    '- KAYDEDİLDİ AMA BELİRSİZ (Öğün): porsiyon tahmini belirsiz',
    '- BEKLETİLDİ, yazılmadı (Kısıt kaldırma): kullanıcının onayı gerekiyor; bu bir güvenlik onayı, sorusunu kod cevabın sonuna aynen ekler: "Bu kaydı gerçekten kaldırmamı istiyor musun? Güvenlik filtrelerin buna göre değişecek." Bu soruyu kendin tekrar sorma ve başka soru ekleme; istersen neden beklettiğini yarım cümleyle söyle',
    '- REDDEDİLDİ, yazılmadı (Su): 250 L su fiziksel olarak mümkün değil',
    '- ALERJEN ÇAKIŞMASI: kaydedilen öğün (m4) profildeki fıstık alerjisiyle (ciddi) çakışıyor; kayıt yapıldı ve cevapta anılması gerekiyor',
  ]);
});

Deno.test('BU TURDA OLANLAR: EVERY safety hold is code-asked (facts and guarantees agree); an ordinary hold waits behind them', async () => {
  const ti = await seededTurnInput();
  const retract = { op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', question_tr: 'Fıstık alerjini kaldırmamı onaylıyor musun?', hold_id: 'pw-1' };
  const goal = { op: 'goal_set', reason_code: 'hedef_degisiyor', question_tr: 'Hedefini değiştireyim mi?', hold_id: 'pw-2' };
  const portion = { op: 'meal_log', reason_code: 'ogun_toplam_yuksek', question_tr: 'Porsiyonu doğru anladım mı?', hold_id: 'pw-3' };
  const lines = renderTurnEvents(ti, decision(), commit({ holds: [portion, retract, goal] }));
  assertStringIncludes(lines[0], `sorusunu kod cevabın sonuna aynen ekler: "${retract.question_tr}"`);
  assertStringIncludes(lines[1], `sorusunu kod cevabın sonuna aynen ekler: "${goal.question_tr}"`);
  assertStringIncludes(lines[2], 'bu turun sorusu yukarıdaki, bunu sonraki bir turda sor');
  // With no safety hold the first ordinary hold is the turn's one question.
  assertStringIncludes(renderTurnEvents(ti, decision(), commit({ holds: [portion] }))[0], `sorulacak tek soru: "${portion.question_tr}"`);
  // A safety turn asks none of them.
  for (const l of renderTurnEvents(ti, decision(), commit({ holds: [retract, goal] }), true)) assertStringIncludes(l, 'bu bir güvenlik turu, bu turda sorulmaz');
});

Deno.test('BU TURDA OLANLAR: clarify names the candidates with what the model was shown', async () => {
  const ti = await seededTurnInput();
  const lines = renderTurnEvents(ti, decision({ clarify: { topic: 'hangi kaydı silmemi istiyorsun?', candidate_refs: ['m2', 'm3'] } }), commit());
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], '- NETLEŞTİRME GEREKİYOR: hangi kaydı silmemi istiyorsun?; adaylar: m2 (haşlanmış yumurta');
  assertStringIncludes(lines[0], 'm3 (mercimek çorbası');
});

Deno.test('§5.1.10: the missed-write question only for an UNEXPLAINED omission; a closed reason is rendered as the reason', async () => {
  const ti = await seededTurnInput();
  const missed = decision({ intent: { primary: 'report' }, self_check: { reported_new_facts: true, not_written_reason: null } });
  assertEquals(renderTurnEvents(ti, missed, commit()), ['- Kayıt yok: kullanıcı yeni bir şey bildirdi ama hiçbir şey yazılmadı ve bunun bir gerekçesi yok; ne olduğunu sor, yazılmış gibi davranma']);
  const emergency = decision({ self_check: { reported_new_facts: true, not_written_reason: 'emergency_turn' } });
  const lines = renderTurnEvents(ti, emergency, commit());
  assertEquals(lines, ['- Kayıt yok (bilinçli: acil/kriz turu)']);
  assert(!lines.join('').includes('sor'), 'an emergency turn never ends in a data-entry question');
  // Free text is not a reason (closed list).
  assertEquals(missedWrite(decision({ self_check: { reported_new_facts: true, not_written_reason: 'unuttum' } })).missed, true);
  // Clarify or any write means it was not missed.
  assertEquals(missedWrite(decision({ self_check: { reported_new_facts: true, not_written_reason: null }, clarify: { topic: 'x', candidate_refs: [] } })).missed, false);
});

Deno.test('missedWrite mirrors validateDecision (same rule, read off the decision)', async () => {
  const ti = await seededTurnInput();
  const ctx = validationContext(ti, 'bugün 3 km yürüdüm', NOW);
  const cases = [
    decision({ self_check: { reported_new_facts: true, not_written_reason: null } }),
    decision({ self_check: { reported_new_facts: true, not_written_reason: 'question_only' } }),
    decision({ self_check: { reported_new_facts: true, not_written_reason: 'bilmem' } }),
    decision({ self_check: { reported_new_facts: false, not_written_reason: null } }),
    decision({ self_check: { reported_new_facts: true, not_written_reason: null }, clarify: { topic: 'hangisi?', candidate_refs: [] } }),
    decision({ self_check: { reported_new_facts: true, not_written_reason: null }, writes: [mealWrite([['elma', 80, 0]])] }),
  ];
  for (const d of cases) {
    const v = validateDecision(d, ctx);
    const m = missedWrite(d);
    assertEquals([m.missed, m.reason], [v.missed_write, v.not_written_reason], JSON.stringify(d.self_check));
  }
});

Deno.test('decision facts: ED signal vs illness vomiting; a what-if gets the server number; a plan ask is not a draft', async () => {
  const ti = await seededTurnInput();
  const f = buildStageBFacts(coachInput(ti, {
    decision: decision({
      safety: { acute_medical: false, self_harm: false, ed_signal: { category: 'illness_vomiting', severity: 'low', evidence_quote: 'kustum' }, tripwire_readings: [] },
      simulation: { food: 'pizza', kcal_estimate: 900, target_day: '2026-10-07' },
      plan_action: { op: 'generate', plan_type: 'diet', draft_ref: null },
    }),
  }));
  const turn = f.turn.join('\n');
  assertStringIncludes(turn, '- Okuma: hastalık/zehirlenme kaynaklı kusma (YB değil); yeme bozukluğu sinyali değil');
  assertStringIncludes(turn, '- Varsayım sorusu: pizza ~900 kcal (tahmin); yerse bugün 1.575 kcal olur, üst sınıra 125 kcal kalır (sunucu hesabı)');
  assertStringIncludes(turn, '- Plan isteği okundu: yeni plan üret (beslenme); bu turda taslak üretimi bu bloğa yazılmadıysa yapılmadı');
});

Deno.test('tripwire facts: only the protective and fail-closed paths speak', () => {
  assertEquals(renderTripwireFacts(normalTripwire()), []);
  const p = renderTripwireFacts(protectiveTripwire('self_harm')).join('\n');
  assertStringIncludes(p, 'kendine zarar işareti var; koruyucu yol geçerli (kriz sözleşmesi)');
  assertStringIncludes(p, "112'yi ara");
  assertStringIncludes(renderTripwireFacts(edFallbackTripwire()).join('\n'), 'uzman yönlendirmesi cevabın sonuna kodla eklenecek');
});

Deno.test('the facts block reads as facts: Turkish with diacritics, no v1 shouting or ASLA/MUTLAKA piles', async () => {
  const ti = await seededTurnInput();
  const text = renderStageBFacts(buildStageBFacts(coachInput(ti, {
    decision: decision({ writes: [mealWrite([['ızgara tavuk', 400, 45]])] }),
    commit: commit({
      receipts: [MEAL_OK],
      holds: [{ op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', question_tr: 'Bu kaydı gerçekten kaldırmamı istiyor musun?', hold_id: null }],
      rejects: [{ op: 'water_log', reason_code: 'litre_araligi', reason_tr: '250 L su mümkün değil' }],
      exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }],
    }),
    tripwire: protectiveTripwire('ed'),
    userState: ['Kişi notu: kısa cevapları seviyor'],
  })));
  const LABELS = ['KULLANICI DURUMU', 'EK OLGULAR', 'BU TURDA OLANLAR', 'GÜVENLİK DURUMU', 'KAYDEDİLDİ', 'BEKLETİLDİ', 'REDDEDİLDİ', 'ALERJEN ÇAKIŞMASI'];
  assertEquals(shoutedWords(text, LABELS), []);
  assertEquals(pileWords(text), []);
  for (const w of SHOUT_WORDS) assert(!text.includes(w), w);
  // Capitalised Turkish loses its dots ("KULLANICI" = kullanıcı), so labels are left out of the ASCII check.
  assertEquals(asciiTurkishHits(LABELS.reduce((t, l) => t.split(l).join(' '), text)), []);
  assertStringIncludes(text, 'EK OLGULAR\nKişi notu: kısa cevapları seviyor');
  assert(text.indexOf('KULLANICI DURUMU') < text.indexOf('BU TURDA OLANLAR'));
  assert(text.indexOf('BU TURDA OLANLAR') < text.indexOf('GÜVENLİK DURUMU'));
  // A normal turn: the safety hold's "code appends the question" line reads as facts too.
  const normal = renderStageBFacts(buildStageBFacts(coachInput(ti, {
    commit: commit({ holds: [{ op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', question_tr: 'Bu kaydı gerçekten kaldırmamı istiyor musun?', hold_id: null }] }),
  })));
  assertStringIncludes(normal, 'sorusunu kod cevabın sonuna aynen ekler');
  assertEquals(shoutedWords(normal, LABELS), []);
  assertEquals(pileWords(normal), []);
  for (const w of SHOUT_WORDS) assert(!normal.includes(w), w);
  assertEquals(asciiTurkishHits(LABELS.reduce((t, l) => t.split(l).join(' '), normal)), []);
});
