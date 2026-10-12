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
  budgetFacts, buildStageBFacts, holdNumbers, MISSED_WRITE_ALSO_LINE, MISSED_WRITE_LINE, missedWrite, postTurnState, renderBudgetLine, renderStageBFacts,
  renderTripwireFacts, renderTurnEvents, renderUserState, turnIntakeDelta, unanchoredQuestionForbidden,
} from './facts.ts';
import type { CoachInput, V2Undo } from './contracts.ts';
import { USER } from './testing.ts';
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
  assertStringIncludes(line, '1.075 kcal (az önce yazılanlar dahil)');
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
  assertStringIncludes(line, '675 kcal (az önceki değişiklikten önceki toplam; yeni toplam hesaplanamadı, toplam ya da kalan sayısı verme)');
  assert(!line.includes('alt sınıra'), line);
  // A delete of one of today's meals: uncertain too.
  const del = turnIntakeDelta(ti, decision({ record_ops: [{ op: 'delete', ref: 'm3', reason: 'yanlış', evidence_quote: null }] }), commit());
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

Deno.test('BU TURDA OLANLAR: clarify names the candidates with what the model was shown — the user-facing summary, no provenance tag to echo', async () => {
  const ti = await seededTurnInput();
  const lines = renderTurnEvents(ti, decision({ clarify: { topic: 'hangi kaydı silmemi istiyorsun?', candidate_refs: ['m2', 'm3'] } }), commit());
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], '- NETLEŞTİRME GEREKİYOR: hangi kaydı silmemi istiyorsun?; adaylar: m2 (haşlanmış yumurta');
  assertStringIncludes(lines[0], 'm3 (mercimek çorbası');
  // The live trial's "[model]" leak (input.ts SOURCE_TAG) is Stage A context; the coach gets user_summary_tr.
  assert(!/\[(model|user|kullanıcı)[^\]]*\]/u.test(lines[0]), lines[0]);
});

Deno.test('§5.1.10: the missed-write question only for an UNEXPLAINED omission; a closed reason is rendered as the reason', async () => {
  const ti = await seededTurnInput();
  const missed = decision({ intent: { primary: 'report' }, self_check: { reported_new_facts: true, not_written_reason: null } });
  assertEquals(renderTurnEvents(ti, missed, commit()), [MISSED_WRITE_LINE]);
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

// ─── live trial 2026-10-11 (lane C): no hold-less write offers, numbers on holds, confirmed holds are final ───

const MISSED = decision({ intent: { primary: 'report' }, self_check: { reported_new_facts: true, not_written_reason: null } });

Deno.test('trial 2026-10-11: a missed write says nothing was saved and forbids a yes/no write offer (no hold behind it)', async () => {
  const ti = await seededTurnInput();
  // The commit's turn flag is NOT a stored record: never "KAYDEDİLDİ AMA BELİRSİZ (turn)".
  const flagged = commit({ flags: [{ op: 'turn', code: 'missed_write', note_tr: 'kullanıcı yeni bir şey bildirdi ama hiçbir şey yazılmadı' }] });
  const lines = renderTurnEvents(ti, MISSED, flagged);
  assertEquals(lines, [MISSED_WRITE_LINE]);
  for (const l of lines) assert(!l.includes('KAYDEDİLDİ') && !l.includes('(turn)'), l);
  assertStringIncludes(MISSED_WRITE_LINE, 'Kaydetmediğini açıkça söyle');
  assertStringIncludes(MISSED_WRITE_LINE, 'açık uçlu sor');
  assertStringIncludes(MISSED_WRITE_LINE, 'onay teklif etme');
  // A declared reason's turn flag is not listed either: the reason line comes from the decision.
  const declared = decision({ self_check: { reported_new_facts: true, not_written_reason: 'question_only' } });
  assertEquals(renderTurnEvents(ti, declared, commit({ flags: [{ op: 'turn', code: 'not_written:question_only', note_tr: 'bilinçli' }] })), ['- Kayıt yok (bilinçli: yalnız soru)']);
  // Any other turn note (the handler's retry note) is the plain fact it is.
  assertEquals(renderTurnEvents(ti, decision(), commit({ flags: [{ op: 'turn', code: 'retry_side_effects_skipped', note_tr: 'tekrar yazılmadı' }] })), ['- Not: tekrar yazılmadı']);
  // Next to a crisis no data-entry question is asked, open or not.
  const safety = renderTurnEvents(ti, MISSED, flagged, true);
  assertEquals(safety.length, 1);
  assert(!safety[0].includes('sor'), safety[0]);
});

Deno.test('unanchoredQuestionForbidden: the handler\'s typed fact (CoachInput.facts), the commit flag, or the decision itself — any one forbids', async () => {
  const ti = await seededTurnInput();
  const base = coachInput(ti);
  assertEquals(unanchoredQuestionForbidden(base), false);
  const withFacts = (extra: Partial<CoachInput>): CoachInput => ({ ...base, ...extra });
  assertEquals(unanchoredQuestionForbidden(withFacts({ facts: { unanchoredQuestionForbidden: true } })), true);
  assertEquals(unanchoredQuestionForbidden(withFacts({ facts: { unanchoredQuestionForbidden: false } })), false);
  // An explicit false never switches the protection off when the decision/commit say it was missed (an OR).
  assertEquals(unanchoredQuestionForbidden(coachInput(ti, { decision: MISSED, facts: { unanchoredQuestionForbidden: false } })), true);
  assertEquals(unanchoredQuestionForbidden(coachInput(ti, { commit: commit({ flags: [{ op: 'turn', code: 'missed_write', note_tr: 'x' }] }) })), true);
  assertEquals(unanchoredQuestionForbidden(coachInput(ti, { decision: MISSED })), true);
  // The fact block carries it, and the handler's flag on a turn where something else happened adds the softer line.
  const f = buildStageBFacts(withFacts({ facts: { unanchoredQuestionForbidden: true }, commit: commit({ receipts: [MEAL_OK] }) }));
  assertEquals(f.unanchoredQuestionForbidden, true);
  assertEquals(f.turn.slice(0, 2), ['- KAYDEDİLDİ: Öğün kaydedildi — ızgara tavuk (1 porsiyon) ~400 kcal · toplam 400 kcal', MISSED_WRITE_ALSO_LINE]);
  assertEquals(buildStageBFacts(coachInput(ti, { decision: MISSED })).turn[0], MISSED_WRITE_LINE);
  assertEquals(buildStageBFacts(base).unanchoredQuestionForbidden, false);
});

Deno.test('a confirmed hold is final: its ask reason reaches the coach as confirmed, not as "belirsiz"', async () => {
  const ti = await seededTurnInput();
  // validate.ts turns the answered ask issue into a flag "kullanıcı onayladı — …" (kilo_sicramasi is body_weight's ask rule).
  const lines = renderTurnEvents(ti, decision(), commit({
    receipts: [{ action_type: 'body_weight', legacy_type: 'weight_log', ok: true, rows_affected: 1, failure_class: null, user_line: 'Tartı kaydedildi: 81,6 kg' }],
    flags: [
      { op: 'body_weight', code: 'kilo_sicramasi', note_tr: 'kullanıcı onayladı — son tartı 78,2 kg, şimdi 81,6 kg' },
      { op: 'meal_log', code: 'dusuk_guven', note_tr: 'porsiyon tahmini belirsiz' },
    ],
  }));
  assertEquals(lines[1], '- ONAYLANDI (Tartı): kullanıcı doğruladı ve kayıt yazıldı (son tartı 78,2 kg, şimdi 81,6 kg); kesinleşti, yeniden sorgulama');
  assert(!lines[1].includes('BELİRSİZ') && !lines[1].includes('kullanıcı onayladı —'), lines[1]);
  assertEquals(lines[2], '- KAYDEDİLDİ AMA BELİRSİZ (Öğün): porsiyon tahmini belirsiz', 'a real doubt stays a doubt');
  // A field-level ask (no op rule) is recognised by the registry's prefix.
  assertStringIncludes(renderTurnEvents(ti, decision(), commit({ flags: [{ op: 'sleep_log', code: 'alisilmadik_deger', note_tr: 'kullanıcı onayladı — hours: 13 alışılmadık' }] }))[0], '- ONAYLANDI (Uyku): kullanıcı doğruladı');
});

Deno.test('a held value shows its numbers (old → new) and is asked about what the USER wrote', async () => {
  const ti = await seededTurnInput();
  const weight = decision({ intent: { primary: 'report' }, writes: [{ op: 'body_weight', day: 'today', kg: 74.6, as_stated: '74.6', replaces: null }] });
  const hold = { op: 'body_weight', reason_code: 'kilo_sicramasi', question_tr: 'Kısa sürede büyük bir değişim görünüyor; tartı sonucunu doğru mu yazdım?', hold_id: 'pw-1' };
  // The seed's last weigh-in: 70,4 kg on 6 Eki (today 7 Eki).
  assertEquals(holdNumbers(hold, weight, ti), 'son tartı 70,4 kg → yazdığı 74,6 kg');
  const line = renderTurnEvents(ti, weight, commit({ holds: [hold] }))[0];
  assertStringIncludes(line, 'kullanıcının onayı gerekiyor (son tartı 70,4 kg → yazdığı 74,6 kg)');
  assertStringIncludes(line, `sorulacak tek soru: "${hold.question_tr}"`);
  assertStringIncludes(line, 'kendi sözlerinle, sayılarıyla sor; soru kişinin yazdığı değer hakkında ("doğru mu yazdın?")');
  // No weigh-in in the window: the stored profile weight is the comparison.
  const noHistory = await seededTurnInput((t) => { t.weight_history = []; });
  assertEquals(holdNumbers(hold, weight, noHistory), 'kayıtlı kilo 70,0 kg → yazdığı 74,6 kg');
  // Water: the stored day total next to what the user wrote (the 14 L typo case is an ASK hold on lane B's side).
  const water = decision({ writes: [{ op: 'water_log', day: 'today', as_stated: '14 litre', quantity: 14, unit: 'litre', other_ml_each: null, mode: 'add', replaces: null }] });
  assertEquals(holdNumbers({ op: 'water_log', reason_code: 'gunluk_toplam_cok', question_tr: '?', hold_id: null }, water, ti), 'kayıtlı 1,60 L · yazdığı 14,00 L (ekleme olarak)');
  // A meal: its total — and the kcal is the model's estimate, so that question is NOT turned on the user.
  const pizza = decision({ writes: [mealWrite([['büyük pizza', 2600, 90]])] });
  const mealHold = { op: 'meal_log', reason_code: 'ogun_toplam_yuksek', question_tr: 'Bu öğün çok yüksek kalorili çıktı; porsiyonları doğru anladım mı?', hold_id: null };
  assertEquals(holdNumbers(mealHold, pizza, ti), 'öğün ~2.600 kcal');
  const mealLine = renderTurnEvents(ti, pizza, commit({ holds: [mealHold] }))[0];
  assertStringIncludes(mealLine, '(öğün ~2.600 kcal); sorulacak tek soru:');
  assert(!mealLine.includes('doğru mu yazdın'), mealLine);
  // An explicit detail from the commit side wins; two writes of the op (which one?) give no number.
  assertEquals(holdNumbers({ ...hold, detail_tr: 'son tartı 78,2 kg, şimdi 81,6 kg' } as typeof hold, weight, ti), 'son tartı 78,2 kg, şimdi 81,6 kg');
  const two = decision({ writes: [...(weight.writes as unknown[]), { op: 'body_weight', day: 'yesterday', kg: 74, as_stated: '74', replaces: null }] });
  assertEquals(holdNumbers(hold, two, ti), null);
  assertEquals(holdNumbers({ op: 'goal_set', reason_code: 'hedef_degisiyor', question_tr: '?', hold_id: null }, weight, ti), null);
});

Deno.test('the facts speak without the pipeline words the coach echoed in the trial ("bu turdaki kayıtlar", "koda göre", "makbuz")', async () => {
  const ti = await seededTurnInput();
  const certain = renderBudgetLine(budgetFacts(ti, turnIntakeDelta(ti, decision({ writes: [mealWrite([['ızgara tavuk', 400, 45]])] }), commit({ receipts: [MEAL_OK] }))));
  const uncertain = renderBudgetLine(budgetFacts(ti, turnIntakeDelta(ti, decision({ record_ops: [{ op: 'delete', ref: 'm3', reason: 'yanlış', evidence_quote: null }] }), commit())));
  for (const text of [certain, uncertain, MISSED_WRITE_LINE, MISSED_WRITE_ALSO_LINE]) {
    for (const w of ['bu turdaki kayıtlar', 'koda göre', 'makbuz', 'sistem']) assert(!text.includes(w), `${w} in: ${text}`);
  }
});

// ─── re-trial 2026-10-12 (lane U): removals are facts the reply states; touched numbers are pre-turn ───

const UNDO_OK = { action_type: 'record_delete', legacy_type: 'undo', ok: true, rows_affected: 6, failure_class: null, user_line: 'Kayıt geri alındı — tartı 88 → 82 kg', ref: 'w2' };
const CORRECTION_UNDO: V2Undo = {
  op: 'record_delete', ref: 'd5', line: UNDO_OK.user_line, day: '2026-10-07', metrics: [{ field: 'weight_kg', before: 88, after: 82 }],
  profile_weight_after: 82, restored: true, constraints_removed: 0,
};

Deno.test('a landed record op is SİLİNDİ (never "KAYDEDİLDİ"), and what it brought back is GERİ GETİRİLDİ with the value left', async () => {
  const ti = await seededTurnInput();
  const lines = renderTurnEvents(ti, decision(), commit({ receipts: [UNDO_OK], undos: [CORRECTION_UNDO] }));
  assertEquals(lines, [
    '- SİLİNDİ: Kayıt geri alındı — tartı 88 → 82 kg; bunu cevabında açıkça söyle, silinen kayıt hâlâ duruyormuş gibi konuşma',
    '- GERİ GETİRİLDİ: düzeltmeden önceki kayıt yeniden geçerli (tartı şimdi 82,0 kg); bunu da cevabında söyle',
  ]);
  // A plain undo brings nothing back: one SİLİNDİ line; a confirmed delete's flag is not a second "kayıt yazıldı" line.
  const plain = renderTurnEvents(ti, decision(), commit({
    receipts: [{ ...UNDO_OK, user_line: 'Kayıt geri alındı — tartı 81,6 kg kaldırıldı; dün için tartı kaydı kalmadı' }],
    undos: [{ ...CORRECTION_UNDO, metrics: [{ field: 'weight_kg', before: 81.6, after: null }], restored: false }],
    flags: [{ op: 'record_delete', code: 'uzak_kayit_silme', note_tr: 'kullanıcı onayladı — d5: başka güne ait kayıt' }],
  }));
  assertEquals(plain, ['- SİLİNDİ: Kayıt geri alındı — tartı 81,6 kg kaldırıldı; dün için tartı kaydı kalmadı; bunu cevabında açıkça söyle, silinen kayıt hâlâ duruyormuş gibi konuşma']);
});

Deno.test('KULLANICI DURUMU: a number a record op changed is marked pre-turn with the writer\'s post-commit value (profile weight, water, a just-removed constraint)', async () => {
  const ti = await seededTurnInput();
  const f = buildStageBFacts(coachInput(ti, {
    commit: commit({
      receipts: [UNDO_OK],
      undos: [
        CORRECTION_UNDO,
        { op: 'record_delete', ref: 'd1', line: 'x', day: '2026-10-07', metrics: [{ field: 'water_liters', before: 1.6, after: 1.4 }], restored: false, constraints_removed: 0 },
        { op: 'record_delete', ref: 'c1', line: 'y', day: null, metrics: [], restored: false, constraints_removed: 1 },
      ],
    }),
  }));
  const state = f.state.join('\n');
  assertStringIncludes(state, 'kilo 70,0 kg (geri almadan önceki değer; şimdi 82,0 kg)');
  assertStringIncludes(state, 'su 1,60 L (geri almadan önceki değer; şimdi 1,40 L) / hedef 2,5 L');
  assertStringIncludes(state, '- c1 alerji · fıstık · ciddi (az önce geri alındı, artık geçerli değil)');
  assertEquals(postTurnState(ti, commit()), { removedConstraintRefs: [] }, 'no record op → nothing marked');
  assertStringIncludes(renderBudgetLine(budgetFacts(ti), null), 'su 1,60 L (geri almadan önceki değer; şimdi kayıt kalmadı)');
  const text = renderStageBFacts(f);
  const LABELS = ['KULLANICI DURUMU', 'BU TURDA OLANLAR', 'SİLİNDİ', 'GERİ GETİRİLDİ', 'KAYDEDİLDİ'];
  assertEquals(shoutedWords(text, LABELS), []);
  assertEquals(pileWords(text), []);
  for (const w of ['bu turdaki kayıtlar', 'koda göre', 'makbuz', 'sistem']) assert(!text.includes(w), w);
});

Deno.test('"geri al" with nothing written last turn: a correction clarify without candidates offers the newest writes by name', async () => {
  const ti = await seededTurnInput((t) => {
    t.turn_writes = [
      { id: 'w-1', seq: 9, user_id: USER, ref: 'w4', op: 'body_weight', table_name: 'daily_metrics', row_id: 'dm-6', for_date: '2026-10-06', field_set: ['weight_kg'], before: null, is_primary: true, group_id: 'g1', turn_id: 't1', reverses: null, undone_at: null, created_at: '2026-10-06T08:00:00Z', meta: {} },
      { id: 'w-2', seq: 12, user_id: USER, ref: 'm9', op: 'meal_log', table_name: 'meal_logs', row_id: 'ml-2', for_date: '2026-10-07', field_set: [], before: null, is_primary: true, group_id: 'g2', turn_id: 't2', reverses: null, undone_at: null, created_at: '2026-10-07T05:00:00Z', meta: {} },
    ];
  });
  const open = decision({ intent: { primary: 'correction', is_hypothetical: false, about_other_person: false }, clarify: { topic: 'hangi kaydın geri alınacağı', candidate_refs: [] } });
  const line = renderTurnEvents(ti, open, commit()).find((l) => l.startsWith('- NETLEŞTİRME'))!;
  const weight = ti.metric_days.find((d) => d.target === 'weight')!.ref;
  assertStringIncludes(line, `son yazılan kayıtlar (seçenek olarak adlarıyla sun): m2 (bugün · haşlanmış yumurta (2 adet) 155 kcal · toplam 155 kcal), ${weight} (dün · tartı: 70,4 kg)`);
  // Named candidates from Stage A win; a question that is not a correction gets no list.
  assert(!renderTurnEvents(ti, decision({ intent: { primary: 'correction', is_hypothetical: false, about_other_person: false }, clarify: { topic: 'x', candidate_refs: ['m3'] } }), commit()).join('\n').includes('son yazılan'));
  assert(!renderTurnEvents(ti, decision({ clarify: { topic: 'x', candidate_refs: [] } }), commit()).join('\n').includes('son yazılan'));
});
