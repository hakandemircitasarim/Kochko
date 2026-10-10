/**
 * shadow.test.ts — the Faz 2 shadow pipeline with a fake Stage A, a fake DB and a fake sink.
 *
 * Pinned: v1→v2 op mapping and receipt pairing; the agreement classes the daily report counts
 * (both / v1_only (net or model) / v2_only); ASK/REJECT verdicts reach the row; the §7.2 table in
 * shadow (benign override OFF, >4 s = timeout, refusal = fallback, explicit hit never asks Stage A);
 * the row shape (111 columns, not 'ai-chat', no user message); the defensive sink (no-op without
 * migration 111, remembered); and the v1 hook contract (off → null and no reads; reads start at
 * begin(); finish() schedules once and never throws).
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { scanTripwires } from '../../shared/safety-tripwires.ts';
import { SCHEMA_NAMES, validateDecision } from '../../shared/write-registry/mod.ts';
import { sampleContext, sampleDecision, sampleMeal, SAMPLE_WRITES } from '../../shared/write-registry/samples.ts';
import { loadTurnInput, type TurnInput } from './input.ts';
import {
  beginShadowTurn, computeAgreement, isMissingColumnError, resetShadowSinkState, runShadow, scheduleBackground,
  SHADOW_FUNCTION_NAME, shadowTurnLogRow, stageASafetyOutcome, v1ActionFacts, v1AgreementKeys, writeShadowRow,
  type RunShadowInput, type ShadowRecord, type V1ActionFact,
} from './shadow.ts';
import { fakeResponses, fakeSink, fakeTurnInputDb, NOW, responsesBody, seedTables, USER } from './testing.ts';
import type { UnderstandOutcome, UnderstandRequest } from './understand.ts';

const DUP = '__dup_skip__';

async function ti(mutate?: (t: ReturnType<typeof seedTables>) => void): Promise<TurnInput> {
  const t = seedTables();
  t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft');
  mutate?.(t);
  return await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
}

/** A fake Stage A: returns `decision` (or a non-parsed status) and records the request. */
function stageA(decision: unknown, over: Partial<UnderstandOutcome> = {}, latencyMs = 1800) {
  const reqs: UnderstandRequest[] = [];
  const fn = (req: UnderstandRequest): Promise<UnderstandOutcome> => {
    reqs.push(req);
    return Promise.resolve({
      status: 'parsed', decision, refusal: null, issues: [], candidate: null, reason: null, error: null,
      meta: {
        model: req.model, providerModel: 'gpt-5.6-terra-x', api: 'responses', format: 'json_schema', effort: req.effort,
        latencyMs, attempts: 1, retries: [], responseId: 'r1', finishReason: 'stop',
        usage: { inputTokens: 9500, outputTokens: 200, totalTokens: 9700, reasoningTokens: 80, cachedTokens: 8800 },
      },
      ...over,
    });
  };
  return { fn, reqs };
}

function facts(actions: Record<string, unknown>[], opts: { model?: Record<string, unknown>[]; receipts?: { action_type: string; ok: boolean; failure_class: string | null }[]; feedback?: (string | null)[] } = {}): V1ActionFact[] {
  return v1ActionFacts({
    actions,
    feedback: opts.feedback ?? actions.map(() => 'ok'),
    receipts: opts.receipts ?? actions.map((a) => ({ action_type: String(a.type), ok: true, failure_class: null })),
    dupSkip: DUP,
    modelActions: new Set(opts.model ?? actions),
  });
}

async function shadow(over: Partial<RunShadowInput> & { message: string }, decision: unknown, extra: { over?: Partial<UnderstandOutcome>; latencyMs?: number; sink?: ReturnType<typeof fakeSink> } = {}) {
  resetShadowSinkState();
  const a = stageA(decision, extra.over, extra.latencyMs);
  const sink = extra.sink ?? fakeSink();
  const rec = await runShadow(
    { userId: USER, turnInput: await ti(), v1Actions: [], v1Mode: 'coaching', turnId: '00000000-0000-4000-8000-00000000000a', now: NOW, ...over },
    { understand: a.fn, sink, rolloutStamp: 'v2_understand_shadow=on', log: () => {} },
  );
  return { rec, sink, reqs: a.reqs, row: sink.rows[0] as Record<string, unknown> | undefined };
}

// ─── v1 side ─────────────────────────────────────────────────────────────────────────────────────

Deno.test('v1AgreementKeys: the registry coverage map, by type and field NAMES only', () => {
  assertEquals(v1AgreementKeys({ type: 'weight_log', value: 82 }).keys, ['body_weight']);
  assertEquals(v1AgreementKeys({ type: 'venue_log' }).keys, ['meal_log']);
  assertEquals(v1AgreementKeys({ type: 'food_preference', is_allergen: true, food_name: 'fıstık' }).keys, ['constraint_add']);
  assertEquals(v1AgreementKeys({ type: 'food_preference', clear: true, is_allergen: false }).keys, ['constraint_retract']);
  assertEquals(v1AgreementKeys({ type: 'food_preference', preference: 'dislike' }).keys, ['food_pref']);
  assertEquals(v1AgreementKeys({ type: 'profile_update', goal_type: 'lose_weight', occupation: 'öğretmen' }), { keys: ['goal_set', 'profile_set'], fields: ['goal_type', 'occupation'] });
  assertEquals(v1AgreementKeys({ type: 'profile_update', dietary_restriction: 'none' }).keys, ['constraint_retract']);
  assertEquals(v1AgreementKeys({ type: 'profile_update', dietary_restriction: 'vegan' }).keys, ['constraint_add']);
  assertEquals(v1AgreementKeys({ type: 'maintenance_start' }).keys, ['target_change']);
  assertEquals(v1AgreementKeys({ type: 'data_erase_confirm' }).keys, ['pending_confirm']);
  assertEquals(v1AgreementKeys({ type: 'mystery_action' }).keys, ['v1:mystery_action'], 'unmapped stays visible');
});

Deno.test('v1ActionFacts: model/net source, receipts paired in order, DUP_SKIP has no receipt, drift degrades safely', () => {
  const meal = { type: 'meal_log', items: [] };
  const water = { type: 'water_log', liters: 0.2 };
  const dupMeal = { type: 'meal_log', items: [] };
  const f = v1ActionFacts({
    actions: [meal, water, dupMeal],
    feedback: ['Öğün kaydedildi', 'su hata', DUP],
    receipts: [{ action_type: 'meal_log', ok: true, failure_class: null }, { action_type: 'water_log', ok: false, failure_class: 'write_failed' }],
    dupSkip: DUP,
    modelActions: new Set<object>([meal, dupMeal]),
    correctionReverted: { type: 'meal_log' },
  });
  assertEquals(f.map((x) => [x.type, x.source, x.ok, x.failure_class, x.dup]), [
    ['correction_revert', 'net', true, null, false],
    ['meal_log', 'model', true, null, false],
    ['water_log', 'net', false, 'write_failed', false],
    ['meal_log', 'model', null, null, true],
  ]);
  // Receipt order drifted: pairing by type still finds the right receipt.
  const g = v1ActionFacts({
    actions: [meal, water], feedback: ['a', 'b'], dupSkip: DUP, modelActions: null,
    receipts: [{ action_type: 'water_log', ok: true, failure_class: null }, { action_type: 'meal_log', ok: false, failure_class: 'x' }],
  });
  assertEquals(g.map((x) => [x.type, x.ok, x.source]), [['meal_log', false, 'unknown'], ['water_log', true, 'unknown']]);
  // No receipts at all (side effects already applied by a previous attempt) → ok null, never invented.
  assertEquals(v1ActionFacts({ actions: [meal], feedback: [], receipts: [], dupSkip: DUP, modelActions: null })[0].ok, null);
});

// ─── agreement ───────────────────────────────────────────────────────────────────────────────────

Deno.test('computeAgreement: both / v1_only / v2_only / neither, noop and reject are not "v2 fired"', () => {
  const ctx = sampleContext({ user_message: '' });
  const v = validateDecision(sampleDecision({
    writes: [
      SAMPLE_WRITES.water_log,
      sampleMeal([{}], { status: 'restatement' }),
      { ...SAMPLE_WRITES.water_log, unit: 'other', other_ml_each: null },
      { ...SAMPLE_WRITES.sleep_log, replaces: 'd4' },
    ],
  }), ctx).verdicts;
  const v1 = facts([{ type: 'water_log' }, { type: 'meal_log' }, { type: 'weight_log' }], { model: [] });
  const fail = v1ActionFacts({ actions: [{ type: 'sleep_log' }], feedback: ['x'], receipts: [{ action_type: 'sleep_log', ok: false, failure_class: 'e' }], dupSkip: DUP, modelActions: null });
  const a = computeAgreement(v, [...v1, ...fail]);
  assertEquals(a.map((x) => [x.key, x.v1, x.v1_source, x.v2, x.class]), [
    ['body_weight', 'applied', 'net', 'silent', 'v1_only'],
    ['meal_log', 'applied', 'net', 'noop', 'v1_only'],
    ['record_ops', 'silent', null, 'write', 'v2_only'],
    ['sleep_log', 'failed', 'unknown', 'write', 'v2_only'],
    ['water_log', 'applied', 'net', 'write', 'both'],
  ]);
  const rejectOnly = validateDecision(sampleDecision({ writes: [{ ...SAMPLE_WRITES.water_log, unit: 'other', other_ml_each: null }] }), ctx).verdicts;
  assertEquals(computeAgreement(rejectOnly, []).map((x) => [x.key, x.v2, x.class]), [['water_log', 'reject', 'neither']]);
});

// ─── safety mapping ──────────────────────────────────────────────────────────────────────────────

Deno.test('stageASafetyOutcome: one reading for every ambiguous hit, positives, live budget = timeout', () => {
  const scan = scanTripwires('bu tarife bayılmıştım');
  const base = stageA(null).fn;
  void base;
  const parsed = (decision: Record<string, unknown>, latencyMs = 1000): UnderstandOutcome => ({
    status: 'parsed', decision, refusal: null, issues: [], candidate: null, reason: null, error: null,
    meta: { model: 'm', providerModel: null, api: 'responses', format: 'json_schema', effort: 'low', latencyMs, attempts: 1, retries: [], responseId: null, finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 } },
  });
  const d = sampleDecision({ safety: { acute_medical: false, self_harm: true, ed_signal: null, tripwire_reading: { benign: true, reason: 'beğeni' } } });
  const v = validateDecision(d, sampleContext({ user_message: 'bu tarife bayılmıştım' }));
  const out = stageASafetyOutcome(parsed(d), v, scan);
  assert(out && out.status === 'ok');
  if (out?.status === 'ok') {
    assertEquals(out.readings.map((r) => r.reading), scan.hits.filter((h) => h.tier === 'ambiguous').map(() => 'benign'));
    assertEquals(out.positives, [{ category: 'self_harm' }]);
  }
  assertEquals(stageASafetyOutcome(parsed(d, 4200), v, scan), { status: 'timeout' }, 'over the live 4 s budget');
  assertEquals(stageASafetyOutcome({ ...parsed(d), status: 'refused', decision: null, refusal: 'no' }, null, scan), { status: 'refused' });
  assertEquals(stageASafetyOutcome({ ...parsed(d), status: 'invalid', decision: null }, null, scan), { status: 'error' });
  assertEquals(stageASafetyOutcome(null, null, scan), null);
});

// ─── runShadow ───────────────────────────────────────────────────────────────────────────────────

Deno.test('runShadow: parsed + COMMIT → agreement "both"; the row is 111-shaped, not "ai-chat", without the message', async () => {
  const msg = 'öğleden beri 1 bardak su içtim galiba';
  const decision = sampleDecision({ writes: [SAMPLE_WRITES.water_log], self_check: { reported_new_facts: true, not_written_reason: null } });
  const { rec, row, reqs } = await shadow({ message: msg, v1Actions: facts([{ type: 'water_log', liters: 0.2 }]) }, decision);
  assertEquals(reqs.length, 1);
  assertEquals(rec.stage_a.status, 'parsed');
  assertEquals(rec.validation?.counts, { COMMIT: 1, FLAG: 0, ASK: 0, REJECT: 0 });
  assertEquals(rec.agreement, [{ key: 'water_log', v1: 'applied', v1_source: 'model', v2: 'write', class: 'both' }]);
  assertEquals(rec.tripwire.outcome, 'normal');
  assertEquals(rec.write, 'written');
  assert(row);
  assertEquals(row.function_name, SHADOW_FUNCTION_NAME);
  assert(row.function_name !== 'ai-chat', 'scenarios.mjs S5 pairs blocks with the nearest ai-chat row');
  assertEquals([row.pipeline, row.stage, row.schema_version, row.turn_id], ['v2_shadow', 'understand', SCHEMA_NAMES.understand, '00000000-0000-4000-8000-00000000000a']);
  assertEquals([row.finish_reason, row.latency_ms, row.prompt_tokens, row.cached_tokens, row.reasoning_tokens], ['parsed', 1800, 9500, 8800, 80]);
  assertEquals(row.decision, decision);
  assertEquals(row.repaired, false);
  assertEquals(row.guard_verdict, null);
  assertEquals(row.rollout_stamp, 'v2_understand_shadow=on');
  assertEquals(row.system_mode, 'coaching');
  const issues = row.issues as Record<string, unknown>[];
  assert(issues.some((e) => e.kind === 'verdict' && e.op === 'water_log' && e.outcome === 'commit' && e.code === 'verdict'));
  assert(issues.some((e) => e.kind === 'agreement' && e.op === 'water_log' && e.class === 'both'));
  assert(issues.every((e) => 'code' in e && 'path' in e && 'outcome' in e), '111 shape {code, path, outcome}');
  assertEquals(row.v1_actions, [{ type: 'water_log', keys: ['water_log'], source: 'model', ok: true, failure_class: null, dup: false }]);
  assert(!JSON.stringify(row).includes(msg), 'the user message itself is never stored');
  assert(!('turn_input' in row), 'TurnInput capture is not done in this wave');
});

Deno.test('runShadow: a v1 NET write with v2 silent is a "v1_only/net" agreement line', async () => {
  const weight = { type: 'weight_log', value: 82 };
  const { rec } = await shadow(
    { message: '82 kilodan neden inemiyorum?', v1Actions: facts([weight], { model: [] }) },
    sampleDecision({ intent: { primary: 'question', is_hypothetical: false, about_other_person: false } }),
  );
  assertEquals(rec.agreement, [{ key: 'body_weight', v1: 'applied', v1_source: 'net', v2: 'silent', class: 'v1_only' }]);
});

Deno.test('runShadow: ASK and REJECT verdicts land in the row with their codes', async () => {
  const decision = sampleDecision({
    writes: [
      { ...SAMPLE_WRITES.water_log, as_stated: 'toplam 1 litre', quantity: 1, unit: 'litre', mode: 'set_day_total' },
      { ...SAMPLE_WRITES.water_log, unit: 'other', other_ml_each: null },
    ],
    record_ops: [{ op: 'delete', ref: 'm99', reason: 'yanlış' }],
  });
  const { rec, row } = await shadow({ message: 'bugün toplam 1 litre su içtim, şu öğünü de sil' }, decision);
  assertEquals(rec.validation?.counts, { COMMIT: 0, FLAG: 0, ASK: 1, REJECT: 2 });
  const issues = row!.issues as Record<string, unknown>[];
  const codes = issues.filter((e) => e.kind === 'issue').map((e) => `${e.outcome}:${e.code}`);
  for (const c of ['ask:toplam_kayittan_az', 'reject:other_ml_eksik', 'reject:ref_listede_yok']) assert(codes.includes(c), c);
  assertEquals(rec.verdicts.find((v) => v.verdict === 'ASK')?.question_tr, 'Bu miktar günün toplamı mı, yoksa kayıtlıya ek mi?');
  assertEquals(rec.agreement.map((a) => [a.key, a.class]), [['record_ops', 'neither'], ['water_log', 'v2_only']]);
});

Deno.test('runShadow: a reasoned benign tripwire reading is logged but protection stays (override OFF in shadow)', async () => {
  const msg = 'bu tarife bayılmıştım';
  const decision = sampleDecision({
    intent: { primary: 'chat', is_hypothetical: false, about_other_person: false },
    safety: { acute_medical: false, self_harm: false, ed_signal: null, tripwire_reading: { benign: true, reason: '"bayılmıştım" çok beğenmek anlamında' } },
  });
  const { rec, row, reqs } = await shadow({ message: msg }, decision);
  assertEquals(reqs[0].effort, 'medium', '§8.4: a tripwire fact raises Stage A effort');
  assertEquals(rec.tripwire.outcome, 'protective');
  assert(rec.tripwire.log.benign_suppressed);
  const issues = row!.issues as Record<string, unknown>[];
  assert(issues.some((e) => e.kind === 'tripwire' && e.trigger === 'emg.bayilma' && e.reading === 'benign'));
  assert(issues.some((e) => e.kind === 'safety' && e.code === 'tripwire_outcome' && e.value === 'protective'));
  assert(issues.some((e) => e.kind === 'safety' && e.code === 'benign_suppressed'));
  assert(!JSON.stringify(row).includes('tarife'), 'no ±40-char user context in the row');
});

Deno.test('runShadow: refusal or a Stage A over the live budget → the canned fallback (fail-closed)', async () => {
  const refused = await shadow({ message: 'bu tarife bayılmıştım' }, null, { over: { status: 'refused', decision: null, refusal: 'Yardımcı olamam.' } });
  assertEquals([refused.rec.stage_a.status, refused.row?.finish_reason, refused.rec.tripwire.outcome], ['refused', 'refused', 'fallback']);
  assertEquals(refused.rec.validation, null);
  const slow = await shadow({ message: 'bu tarife bayılmıştım' }, sampleDecision(), { latencyMs: 5200 });
  assertEquals([slow.rec.stage_a.status, slow.rec.stage_a.over_live_budget, slow.rec.tripwire.outcome], ['parsed', true, 'fallback']);
  const invalid = await shadow({ message: 'merhaba' }, null, { over: { status: 'invalid', decision: null, issues: ['$.writes: eksik'], candidate: {} } });
  assertEquals(invalid.row?.finish_reason, 'invalid');
  assertEquals(invalid.rec.stage_a.detail, '$.writes: eksik');
  const err = await shadow({ message: 'merhaba' }, null, { over: { status: 'error', decision: null, error: { class: 'timeout', status: null, message: 't' } } });
  assertEquals(err.row?.finish_reason, 'error:timeout');
});

Deno.test('runShadow: an explicit self-harm/emergency hit never asks Stage A (v2 answers canned)', async () => {
  const { rec, row, reqs } = await shadow({ message: 'kendimi öldürmek istiyorum' }, sampleDecision());
  assertEquals(reqs.length, 0);
  assertEquals([rec.stage_a.status, rec.stage_a.detail, row?.finish_reason], ['skipped', 'explicit_tripwire', 'skipped:explicit_tripwire']);
  assertEquals(rec.tripwire.outcome, 'canned');
});

Deno.test('runShadow: a hit only the v1 floor makes instant is canned too; the ledger keeps the curated reading beside it', async () => {
  // v1 answers "bayıldım" instantly (§7.4: no demotion without owner approval + shadow evidence).
  const { rec, row, reqs } = await shadow({ message: 'bu tarife bayıldım' }, sampleDecision());
  assertEquals(reqs.length, 0);
  assertEquals([rec.stage_a.detail, rec.tripwire.outcome, rec.tripwire.log.explicit], ['explicit_tripwire', 'canned', 'emg.v1']);
  const trip = (row!.issues as Record<string, unknown>[]).filter((e) => e.kind === 'tripwire').map((e) => [e.trigger, e.tier, e.reading]);
  assertEquals(trip, [['emg.bayilma', 'ambiguous', 'n/a'], ['emg.v1', 'explicit', 'n/a']]);
});

Deno.test('runShadow: no TurnInput → skipped row; a crashing Stage A → error row; never throws', async () => {
  const none = await shadow({ message: 'merhaba', turnInput: null, turnInputError: 'boom' }, sampleDecision());
  assertEquals([none.rec.stage_a.status, none.row?.finish_reason, none.reqs.length], ['skipped', 'skipped:turn_input', 0]);
  resetShadowSinkState();
  const sink = fakeSink();
  const rec = await runShadow(
    { userId: USER, message: 'merhaba', turnInput: await ti(), v1Actions: [], v1Mode: null, now: NOW },
    { understand: () => Promise.reject(new Error('kaboom')), sink, log: () => {} },
  );
  assertEquals(rec.stage_a.status, 'error');
  assertStringIncludes(String(sink.rows[0].finish_reason), 'error:shadow_crash: kaboom');
  assertEquals(rec.tripwire.computed, false);
  const issues = sink.rows[0].issues as Record<string, unknown>[];
  assert(!issues.some((e) => e.code === 'tripwire_outcome'), 'a crash does not pretend the §7.2 table said "normal"');
  assert((none.row?.issues as Record<string, unknown>[]).some((e) => e.code === 'tripwire_outcome'), 'a skipped turn still records the table');
});

Deno.test('runShadow end-to-end through the real respond(): request, validation, row', async () => {
  resetShadowSinkState();
  const decision = sampleDecision({ writes: [SAMPLE_WRITES.water_log] });
  const { transport, calls } = fakeResponses(() => responsesBody(decision));
  const sink = fakeSink();
  const rec = await runShadow(
    { userId: USER, message: '1 bardak su daha içtim', turnInput: await ti(), v1Actions: facts([{ type: 'water_log' }]), v1Mode: 'register', now: NOW },
    { understandDeps: { transport, apiKey: 'k', baseUrl: 'https://api.openai.com/v1' }, sink, log: () => {} },
  );
  assertEquals(calls.length, 1);
  assertEquals((calls[0].body.text as { format: { name: string } }).format.name, SCHEMA_NAMES.understand);
  assertEquals(rec.stage_a.status, 'parsed');
  assertEquals(rec.agreement[0].class, 'both');
  assertEquals(sink.rows.length, 1);
  assertEquals(sink.rows[0].model_requested, rec.stage_a.model);
});

// ─── sink ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('writeShadowRow: no-ops (and remembers it) while migration 111 is missing; other errors are "failed"', async () => {
  resetShadowSinkState();
  const missing = fakeSink('no_columns');
  assertEquals(await writeShadowRow(missing, { a: 1 }, 1_000), 'no_columns');
  assertEquals(await writeShadowRow(missing, { a: 1 }, 2_000), 'no_columns');
  assertEquals(missing.attempts, 1, 'the doomed insert is not retried for 10 minutes');
  assertEquals(await writeShadowRow(fakeSink(), { a: 1 }, 5_000), 'no_columns', 'still inside the back-off window');
  const ok = fakeSink();
  assertEquals(await writeShadowRow(ok, { a: 1 }, 1_000 + 10 * 60_000 + 1), 'written', 'retried after the window');
  resetShadowSinkState();
  assertEquals(await writeShadowRow(fakeSink('error'), { a: 1 }), 'failed');
  const throwing = { insert: () => Promise.reject(new Error('net down')) };
  assertEquals(await writeShadowRow(throwing, { a: 1 }), 'failed');
  assertEquals(isMissingColumnError({ code: '42703', message: '' }), true);
  assertEquals(isMissingColumnError({ message: 'column "decision" of relation "ai_turn_log" does not exist' }), true);
  assertEquals(isMissingColumnError({ code: '23514', message: 'check constraint' }), false);
  assertEquals(isMissingColumnError(null), false);
  resetShadowSinkState();
});

Deno.test('shadowTurnLogRow is deterministic for a record', async () => {
  const { rec } = await shadow({ message: 'merhaba' }, sampleDecision());
  const scan = scanTripwires('merhaba');
  assertEquals(shadowTurnLogRow(rec as ShadowRecord, scan), shadowTurnLogRow(rec as ShadowRecord, scan));
});

// ─── the v1 hook ─────────────────────────────────────────────────────────────────────────────────

Deno.test('beginShadowTurn: step off → null, and NOTHING is read', () => {
  const db = fakeTurnInputDb(seedTables());
  assertEquals(beginShadowTurn({ userId: USER, message: 'merhaba', hasImage: false }, { mode: () => 'off', db }), null);
  assertEquals(db.calls.length, 0);
  for (const p of [
    { userId: USER, message: '', hasImage: false },
    { userId: USER, message: '   ', hasImage: false },
    { userId: USER, message: undefined, hasImage: false },
    { userId: USER, message: 'foto', hasImage: true },
    { userId: USER, message: 'ses', hasImage: false, transcribeOnly: true },
  ]) {
    assertEquals(beginShadowTurn(p, { mode: () => 'on', db }), null, JSON.stringify(p));
  }
  assertEquals(db.calls.length, 0);
});

Deno.test('beginShadowTurn: reads start at begin(); finish() schedules ONE background run with tagged v1 facts', async () => {
  const db = fakeTurnInputDb(seedTables());
  const jobs: Array<() => Promise<unknown>> = [];
  const runs: RunShadowInput[] = [];
  const sinkSeen: unknown[] = [];
  const turn = beginShadowTurn(
    { userId: USER, message: '1 bardak su içtim', hasImage: false, clientTimezone: 'Europe/Istanbul' },
    {
      mode: () => 'shadow', db, now: () => NOW, sink: null,
      schedule: (job) => { jobs.push(job); },
      run: (input, deps) => { runs.push(input); sinkSeen.push(deps.sink); return Promise.resolve(); },
    },
  );
  assert(turn);
  assertEquals(turn.mode, 'shadow', "'shadow' runs the shadow too");
  assert(db.calls.length > 0, 'the TurnInput read left before any v1 write');
  const model = { type: 'water_log', liters: 0.2 };
  const net = { type: 'weight_log', value: 82 };
  turn.markModelActions([model]);
  const actions = [model, net];
  turn.finish({
    actions, feedback: ['ok', 'ok'], dupSkip: DUP, v1Mode: 'register', v1Safety: ['ed_medium_referral'],
    receipts: [{ action_type: 'water_log', ok: true, failure_class: null }, { action_type: 'weight_log', ok: true, failure_class: null }],
  });
  turn.finish({ actions, feedback: [], receipts: [], dupSkip: DUP, v1Mode: null });
  assertEquals(jobs.length, 1, 'finish is idempotent');
  assertEquals(runs.length, 0, 'nothing runs until the scheduler runs the job');
  await jobs[0]();
  assertEquals(runs.length, 1);
  const r = runs[0];
  assertEquals([r.userId, r.message, r.v1Mode, r.turnId], [USER, '1 bardak su içtim', 'register', turn.turnId]);
  assertEquals(r.turnInput?.day, '2026-10-07');
  assertEquals(r.v1Actions.map((f) => [f.type, f.source]), [['water_log', 'model'], ['weight_log', 'net']]);
  assertEquals(r.v1Safety, ['ed_medium_referral']);
  assertEquals(sinkSeen, [null]);
});

Deno.test('beginShadowTurn: a broken finish() input or scheduler never throws into the v1 turn', () => {
  const db = fakeTurnInputDb(seedTables());
  const turn = beginShadowTurn({ userId: USER, message: 'x', hasImage: false }, { mode: () => 'on', db, schedule: () => { throw new Error('no scheduler'); } });
  assert(turn);
  turn.markModelActions(null as unknown as object[]);
  turn.finish({ actions: null as unknown as Record<string, unknown>[], feedback: [], receipts: [], dupSkip: DUP, v1Mode: null });
  const bad = beginShadowTurn({ userId: USER, message: 'x', hasImage: false }, { mode: () => { throw new Error('env'); } });
  assertEquals(bad, null);
});

Deno.test('beginShadowTurn → scheduleBackground → runShadow → row, end to end with fakes', async () => {
  resetShadowSinkState();
  const db = fakeTurnInputDb(seedTables());
  const sink = fakeSink();
  const jobs: Array<() => Promise<unknown>> = [];
  const a = stageA(sampleDecision({ writes: [SAMPLE_WRITES.water_log] }));
  const turn = beginShadowTurn(
    { userId: USER, message: '1 bardak su içtim', hasImage: false },
    { mode: () => 'on', db, sink, now: () => NOW, schedule: (j) => { jobs.push(j); }, runDeps: { understand: a.fn, log: () => {} } },
  )!;
  const water = { type: 'water_log' };
  turn.markModelActions([water]);
  turn.finish({ actions: [water], feedback: ['ok'], receipts: [{ action_type: 'water_log', ok: true, failure_class: null }], dupSkip: DUP, v1Mode: 'register' });
  await jobs[0]();
  assertEquals(sink.rows.length, 1);
  assertEquals(sink.rows[0].turn_id, turn.turnId);
  assertEquals(typeof sink.rows[0].rollout_stamp, 'string');
  const agreement = (sink.rows[0].issues as Record<string, unknown>[]).filter((e) => e.kind === 'agreement');
  assertEquals(agreement.map((e) => [e.op, e.class, e.v1_source]), [['water_log', 'both', 'model']]);
});

Deno.test('scheduleBackground: hands the job to EdgeRuntime.waitUntil and starts it on a later macrotask', async () => {
  const g = globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } };
  const prev = g.EdgeRuntime;
  let waited: Promise<unknown> | null = null;
  let ran = false;
  g.EdgeRuntime = { waitUntil: (p) => { waited = p; } };
  try {
    scheduleBackground(() => { ran = true; return Promise.resolve(); });
    assert(waited !== null, 'registered with waitUntil');
    assertEquals(ran, false, 'nothing runs synchronously inside the v1 request path');
    await waited;
    assertEquals(ran, true);
    let failed = false;
    scheduleBackground(() => { failed = true; return Promise.reject(new Error('swallowed')); });
    await waited;
    assertEquals(failed, true, 'a failing job is caught (no unhandled rejection)');
  } finally {
    if (prev) g.EdgeRuntime = prev;
    else delete g.EdgeRuntime;
  }
});
