/**
 * shadow-report.test.ts — the §10 Faz 2 daily report over rows written by the REAL shadow writer.
 *
 * The rows come from runShadow() → shadowTurnLogRow() into a fake sink, so a change to what the
 * writer stores that the report does not understand fails here (writer ↔ report contract), not in
 * the owner's terminal a week into the shadow.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { scanTripwires } from '../../shared/safety-tripwires.ts';
import { sampleDecision, SAMPLE_WRITES } from '../../shared/write-registry/samples.ts';
import { loadTurnInput } from './input.ts';
import { percentile, renderShadowReport, stageAStatusOf, summarizeShadowRows } from './shadow-report.mjs';
import { resetShadowSinkState, runShadow, v1ActionFacts, type V1ActionFact } from './shadow.ts';
import { fakeSink, fakeTurnInputDb, NOW, seedTables, USER } from './testing.ts';
import type { UnderstandOutcome, UnderstandRequest } from './understand.ts';

const DUP = '__dup_skip__';

function facts(actions: Record<string, unknown>[], model: Record<string, unknown>[] = actions): V1ActionFact[] {
  return v1ActionFacts({
    actions, feedback: actions.map(() => 'ok'), dupSkip: DUP, modelActions: new Set(model),
    receipts: actions.map((a) => ({ action_type: String(a.type), ok: true, failure_class: null })),
  });
}

function stageA(decision: unknown, latencyMs: number, over: Partial<UnderstandOutcome> = {}) {
  return (req: UnderstandRequest): Promise<UnderstandOutcome> => Promise.resolve({
    status: 'parsed', decision, refusal: null, issues: [], candidate: null, reason: null, error: null,
    meta: {
      model: req.model, providerModel: null, api: 'responses', format: 'json_schema', effort: req.effort, latencyMs, attempts: 1,
      retries: [], responseId: null, finishReason: 'stop',
      usage: { inputTokens: 10000, outputTokens: 200, totalTokens: 10200, reasoningTokens: 100, cachedTokens: 9000 },
    },
    ...over,
  });
}

/** Seven shadow turns covering every report section. */
async function rows(): Promise<Record<string, unknown>[]> {
  resetShadowSinkState();
  const t = seedTables();
  t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft');
  const turnInput = await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
  const sink = fakeSink();
  const run = (message: string, v1Actions: V1ActionFact[], understand: ReturnType<typeof stageA>) =>
    runShadow({ userId: USER, message, turnInput, v1Actions, v1Mode: 'coaching', now: NOW }, { understand, sink, log: () => {} });
  const water = { type: 'water_log' };
  const weight = { type: 'weight_log', value: 82 };
  const question = sampleDecision({ intent: { primary: 'question', is_hypothetical: false, about_other_person: false } });
  // 1. both agree on water.
  await run('1 bardak su içtim', facts([water]), stageA(sampleDecision({ writes: [SAMPLE_WRITES.water_log] }), 1200));
  // 2. a v1 net wrote a weight, v2 stayed silent.
  await run('82 kilodan inemiyorum', facts([weight], []), stageA(question, 1500));
  // 3. v2 would ASK a day total, v1 did nothing.
  await run('bugün toplam 1 litre su içtim', [], stageA(sampleDecision({
    writes: [{ ...SAMPLE_WRITES.water_log, quantity: 1, unit: 'litre', mode: 'set_day_total' }],
  }), 2500));
  // 4. a REJECT (unit other without ml).
  await run('bir şişe su içtim', [], stageA(sampleDecision({ writes: [{ ...SAMPLE_WRITES.water_log, unit: 'other', other_ml_each: null }] }), 5200));
  // 5. a refusal (parse/schema error class) on a tripwire turn.
  await run('bu tarife bayılmıştım', [], stageA(null, 900, { status: 'refused', decision: null, refusal: 'no' }));
  // 6. a benign reading on a tripwire turn.
  await run('bu tarife bayılmıştım', [], stageA(sampleDecision({
    safety: {
      acute_medical: false, self_harm: false, ed_signal: null,
      tripwire_readings: scanTripwires('bu tarife bayılmıştım').hits.filter((h) => h.tier === 'ambiguous').map((h) => ({ hit_id: h.hit_id, reading: 'benign', reason: 'beğeni' })),
    },
  }), 1800));
  // 7. an explicit hit: skipped, canned.
  await run('kendimi öldürmek istiyorum', [], stageA(question, 1000));
  return sink.rows;
}

Deno.test('summarizeShadowRows: agreement, net-vs-silent, ask/reject, parse errors, latency, tripwires', async () => {
  const s = summarizeShadowRows(await rows());
  assertEquals(s.rows, 7);
  assertEquals(s.ran, 6);
  assertEquals(s.status, { parsed: 5, refused: 1, invalid: 0, incomplete: 0, function_call: 0, error: 0, skipped: 1 });
  assertEquals(s.skipped, { explicit_tripwire: 1 });
  assertEquals(s.parse_error_rate, 1 / 6);
  assertEquals(s.errors, { refused: 1 });
  // latencies of the 6 turns that ran: 1200 1500 2500 5200 900 1800 → nearest-rank p50 1500, p90 5200
  assertEquals([s.latency.n, s.latency.p50, s.latency.p90, s.latency.over_live_budget], [6, 1500, 5200, 1]);
  assertEquals(s.tokens, { input_avg: 10000, cached_ratio: 0.9, output_avg: 200, reasoning_avg: 100 });
  assertEquals(s.ops.water_log, { both: 1, v1_only: 0, v2_only: 1, neither: 1, agreement_rate: 0.5 });
  assertEquals(s.ops.body_weight, { both: 0, v1_only: 1, v2_only: 0, neither: 0, agreement_rate: 0 });
  assertEquals(s.net_fired_v2_silent, { body_weight: 1 });
  assertEquals(s.model_fired_v2_silent, {});
  assertEquals(s.v2_fired_v1_silent, { water_log: { write: 0, ask: 1 } });
  assertEquals([s.verdicts.total, s.verdicts.commit, s.verdicts.ask, s.verdicts.reject], [3, 1, 1, 1]);
  assertEquals(s.verdicts.ask_rate, 1 / 3);
  assertEquals(s.verdicts.top_ask_codes, [['water_log:toplam_kayittan_az', 1]]);
  assertEquals(s.verdicts.top_reject_codes, [['water_log:other_ml_eksik', 1]]);
  assertEquals([s.turns_with_ask, s.turns_with_reject, s.turn_ask_rate], [1, 1, 1 / 5]);
  assertEquals(s.tripwire.matrix['emg.bayilma'], { tier: 'ambiguous', positive: 0, benign: 1, missing: 0, 'n/a': 1, late_positive: 0, late_benign: 0, late_missing: 0 });
  assertEquals(s.tripwire.outcomes, { normal: 4, fallback: 1, protective: 1, canned: 1 });
  assertEquals([s.tripwire.fallback_causes, s.tripwire.on_time_outcomes], [{ refused: 1 }, {}], 'a refusal has no late reading');
  assertEquals(s.tripwire.benign_suppressed, 1);
  assertEquals(s.v1_sources, { model: 1, net: 1, unknown: 0 });
});

Deno.test('renderShadowReport: every §10 Faz 2 section, counts only (no user text)', async () => {
  const r = await rows();
  const text = renderShadowReport(summarizeShadowRows(r), { since: '2026-10-07', until: '2026-10-08' });
  for (const s of [
    'KOCHKO v2 Stage A gölge raporu — 2026-10-07 → 2026-10-08',
    'Ayrıştırma/şema hatası: 16.7%',
    'Stage A gecikmesi: p50 1.50 sn · p90 5.20 sn · n=6 · canlı 4 sn bütçesini aşan 1',
    'OP BAŞINA UYUM',
    'body_weight',
    'v1 AĞI TETİKLENDİ, v2 SESSİZ',
    '  body_weight: 1',
    'v2 YAZARDI/SORARDI, v1 SESSİZ',
    '  water_log: yazma 0 · soru 1',
    'en sık ASK: water_log:toplam_kayittan_az 1',
    'TETİK × OKUMA',
    'emg.bayilma [ambiguous]: pozitif 0 · benign 1',
  ]) assertStringIncludes(text, s);
  for (const userText of ['bardak su içtim', 'tarife bayılmıştım', 'öldürmek istiyorum', USER]) assert(!text.includes(userText), userText);
});

Deno.test('late Stage A (parsed past the 4 s budget): the fallback keeps its cause, the late reading is counted apart — never as "no Stage A"', async () => {
  resetShadowSinkState();
  const t = seedTables();
  t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft');
  const turnInput = await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
  const sink = fakeSink();
  const msg = 'dün gece kustum, zehirlendim galiba';
  const decision = sampleDecision({
    safety: {
      acute_medical: false, self_harm: false,
      tripwire_readings: scanTripwires(msg).hits.filter((h) => h.tier === 'ambiguous').map((h) => ({ hit_id: h.hit_id, reading: 'benign', reason: 'zehirlenme' })),
      ed_signal: { category: 'illness_vomiting', severity: 'low', evidence_quote: 'dün gece kustum' },
    },
    self_check: { reported_new_facts: true, not_written_reason: 'illness_not_food' },
  });
  await runShadow({ userId: USER, message: msg, turnInput, v1Actions: [], v1Mode: 'safety', now: NOW }, { understand: stageA(decision, 4345), sink, log: () => {} });
  const s = summarizeShadowRows(sink.rows);
  assertEquals(s.tripwire.outcomes, { fallback: 1 });
  assertEquals(s.tripwire.fallback_causes, { timeout: 1 });
  assertEquals(s.tripwire.on_time_outcomes, { protective: 1 });
  assertEquals(s.tripwire.matrix['ed.kustum'], { tier: 'ambiguous', positive: 0, benign: 0, missing: 0, 'n/a': 1, late_positive: 0, late_benign: 1, late_missing: 0 });
  const text = renderShadowReport(s);
  assertStringIncludes(text, 'tabloya okuma ulaşmadı 1 (geç okuma, 4 sn üstü: pozitif 0 · benign 1 · okuma yok 0)');
  assertStringIncludes(text, 'fallback nedeni: timeout 1 · Stage A zamanında gelseydi: protective 1');
});

Deno.test('self_check: an unexplained omission is a missed write; a reasoned one (emergency/illness) is counted apart', async () => {
  resetShadowSinkState();
  const t = seedTables();
  t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft');
  const turnInput = await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
  const sink = fakeSink();
  const run = (message: string, decision: unknown) =>
    runShadow({ userId: USER, message, turnInput, v1Actions: [], v1Mode: 'coaching', now: NOW }, { understand: stageA(decision, 1000), sink, log: () => {} });
  const missed = await run('bugün 3 km yürüdüm', sampleDecision({ self_check: { reported_new_facts: true, not_written_reason: null } }));
  const explained = await run('dün gece kustum, zehirlendim galiba', sampleDecision({
    safety: {
      acute_medical: false, self_harm: false,
      tripwire_readings: scanTripwires('dün gece kustum, zehirlendim galiba').hits.filter((h) => h.tier === 'ambiguous').map((h) => ({ hit_id: h.hit_id, reading: 'benign', reason: 'zehirlenme' })),
      ed_signal: { category: 'illness_vomiting', severity: 'low', evidence_quote: 'dün gece kustum' },
    },
    self_check: { reported_new_facts: true, not_written_reason: 'illness_not_food' },
  }));
  assertEquals([missed.validation?.missed_write, explained.validation?.missed_write], [true, false]);
  const s = summarizeShadowRows(sink.rows);
  assertEquals([s.missed_write, s.not_written_explained], [1, 1]);
  assertStringIncludes(renderShadowReport(s), 'kaçırılan kayıt (self_check) 1 · gerekçeyle yazılmayan 1');
  assert(!JSON.stringify(sink.rows.map((r) => r.issues)).includes('illness_not_food'), 'issues carry codes, the reason stays in the decision');
});

Deno.test('A′ watch: writes v2 would make on a QUESTION / hypothetical turn, and FLAG codes split by that intent', async () => {
  resetShadowSinkState();
  const t = seedTables();
  t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft');
  const turnInput = await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
  const sink = fakeSink();
  const run = (message: string, decision: unknown) =>
    runShadow({ userId: USER, message, turnInput, v1Actions: [], v1Mode: 'coaching', now: NOW }, { understand: stageA(decision, 1000), sink, log: () => {} });
  // A paraphrased protective quote is stored + FLAGged (koruyucu_beyan_teyidi) — here on a QUESTION turn.
  const paraphrased = { ...SAMPLE_WRITES.constraint_add, evidence_quote: 'fındığa alerjim olduğunu söyledi' };
  await run('fındık alerjisi olan biri ne yiyebilir?', sampleDecision({
    intent: { primary: 'question', is_hypothetical: false, about_other_person: false }, writes: [paraphrased],
  }));
  // The same FLAG on a REPORT turn is not an A′ candidate.
  await run('Fındık alerjim var', sampleDecision({ writes: [paraphrased] }));
  // A hypothetical-flagged turn that still writes water.
  await run('2 bardak su içsem yeter mi', sampleDecision({
    intent: { primary: 'report', is_hypothetical: true, about_other_person: false }, writes: [SAMPLE_WRITES.water_log],
  }));
  const s = summarizeShadowRows(sink.rows);
  assertEquals(s.intents, { question: 1, report: 2 });
  assertEquals(s.hypothetical, 1);
  assertEquals(s.writes_on_question, { constraint_add: 1, water_log: 1 });
  assertEquals(s.verdicts.flag_codes['constraint_add:koruyucu_beyan_teyidi'], 2);
  assertEquals(s.verdicts.flag_codes_on_question, { 'constraint_add:koruyucu_beyan_teyidi': 1 });
  const text = renderShadowReport(s);
  for (const line of [
    'Niyet: report 2 · question 1 · varsayım bayraklı 1',
    'SORU/VARSAYIM TURUNDA v2 YAZARDI (A′ adayı — elle incelenmeli)',
    '  constraint_add: 1',
    'bu turlardaki FLAG: constraint_add:koruyucu_beyan_teyidi 1',
    'en sık FLAG: constraint_add:koruyucu_beyan_teyidi 2',
  ]) assertStringIncludes(text, line);
  const intents = sink.rows.flatMap((r) => (r.issues as Record<string, unknown>[]).filter((e) => e.kind === 'intent'));
  assertEquals(intents.length, 3, 'one intent entry per parsed turn');
  assert(intents.every((e) => Object.keys(e).sort().join() === 'code,hypothetical,kind,other_person,outcome,path,primary'), 'enums and flags only');
});

Deno.test('percentile and stageAStatusOf edge cases', () => {
  assertEquals(percentile([], 50), null);
  assertEquals(percentile([5], 90), 5);
  assertEquals(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assertEquals(percentile([3, 1, 2], 50), 2);
  assertEquals(percentile(['x', null, 4], 50), 4);
  assertEquals(stageAStatusOf('incomplete:length'), 'incomplete');
  assertEquals(stageAStatusOf('skipped:turn_input'), 'skipped');
  assertEquals(stageAStatusOf('stop'), 'error', 'an unknown status is never counted as parsed');
  assertEquals(stageAStatusOf(null), 'error');
  const empty = summarizeShadowRows([]);
  assertEquals([empty.rows, empty.parse_error_rate, empty.latency.p50], [0, null, null]);
});
