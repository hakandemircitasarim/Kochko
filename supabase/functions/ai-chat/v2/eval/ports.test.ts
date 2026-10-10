import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { endpointTransport, fakeDecideTransport, isModelAnswer, normalizeLlmResponse, parseDecision } from './transport.ts';
import { canonicalJson, memoryReplayStore, requestKey } from './replay-store.ts';
import { buildFixtureRequest, fixtureT2, fixtureView, renderTurnInputBlock as renderFixtureBlock, todayPhrases } from './request.ts';
import { UNDERSTAND_FEW_SHOTS } from '../understand-prompt.ts';
import { budgetGate, computeGates, costOf, gatesFailed, qualityGate, rateGate } from './gates.ts';
import { asciiFold, buildJudgeRequest, claimsLint, diacriticsOk, evaluateRubric, parseJudgeVerdicts, questionCount } from './rubric.ts';
import { captureToFixture, type CapturedTurn, isExpired, opDiff, validateCapture } from './capture.ts';
import { looksLikeJwt, main, parseArgs } from './cli.ts';
import type { EvalFixture, FixtureRunResult, PackageId, TurnResult } from './types.ts';
import { renderTurnInputBlock, stageASchema, stageASystemPrompt } from '../stage-a-request.ts';
import { MAX_BODY_CHARS, parseDecideRequest } from '../../../ai-decide/handler.ts';
import { formatPreflight, preflight } from './preflight.ts';
import { loadFixtureDir } from './fixtures.ts';

// ── transport ─────────────────────────────────────────────────────────────────────────────────

const SECRET = 'eyJhbGciOiJIUzI1NiJ9.service-role-test-key.signature';

/** The exact body handler.ts decideResponseBody() returns for a parsed answer. */
const decideBody = (over: Record<string, unknown> = {}) => ({
  dry_run: true, ok: true, kind: 'parsed', decision: { writes: [] }, refusal: null, function_calls: [], issues: [], candidate: null,
  incomplete_reason: null, error: null, text: '{"writes":[]}',
  usage: { input_tokens: 900, output_tokens: 80, total_tokens: 980, reasoning_tokens: 40, cached_tokens: 600 },
  latency_ms: 1234, model_requested: 'gpt-5.6-terra', model_served: 'gpt-5.6-terra', provider_model: null, api: 'responses',
  format: 'json_schema', effort: 'low', attempts: 1, retries: [], response_id: 'r', finish_reason: 'stop', schema_name: 'kochko_understand_v2', target: 'default',
  ...over,
});

Deno.test('endpointTransport: POSTs the body with service-role headers; reads ai-decide\'s dry-run body', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchFn = ((url: string, init: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response(JSON.stringify(decideBody()), { status: 200 }));
  }) as unknown as typeof fetch;
  const t = endpointTransport({ url: 'https://x.supabase.co/functions/v1/ai-decide', key: SECRET, fetchFn });
  const payload = { model: 'gpt-5.6-terra', effort: 'low', system: 'S', input: [{ role: 'user', content: 'm' }], schema: { name: 'n', schema: {}, strict: true } };
  const res = await t.call({ fixture_id: 'f', rep: 0, payload, key: await requestKey(payload) });
  assertEquals(res.cache, 'live');
  assertEquals([res.response.ok, res.response.kind], [true, 'parsed']);
  assertEquals(res.response.latency_ms, 1234);
  assertEquals(res.response.usage, { input_tokens: 900, output_tokens: 80, cached_tokens: 600, reasoning_tokens: 40 });
  assertEquals(parseDecision(res.response).decision, { writes: [] });
  const s = seen as unknown as { url: string; init: RequestInit };
  assertEquals(s.url, 'https://x.supabase.co/functions/v1/ai-decide');
  const h = s.init.headers as Record<string, string>;
  assertEquals(h.Authorization, `Bearer ${SECRET}`);
  assertEquals(h['x-region'], 'ap-southeast-1');
  assertEquals(JSON.parse(String(s.init.body)), payload);
  assert(!String(s.init.body).includes(SECRET), 'the key travels only in headers');
});

Deno.test('endpointTransport: 403 and echoed keys are scrubbed infra errors; network errors are reported', async () => {
  const echo = (() => Promise.resolve(new Response(JSON.stringify({ error: `forbidden ${SECRET}` }), { status: 403 }))) as unknown as typeof fetch;
  const r = await endpointTransport({ url: 'u', key: SECRET, fetchFn: echo }).call({ fixture_id: 'f', rep: 0, payload: {}, key: 'k' });
  assertEquals([r.response.ok, r.response.kind, r.response.status], [false, 'error', 403]);
  assert(!JSON.stringify(r.response).includes(SECRET));
  assert(r.response.error!.includes('service_role JWT') && r.response.error!.includes('[gizli]'));
  assert(!isModelAnswer(r.response), 'a 403 is never recorded as model behaviour');
  const boom = (() => Promise.reject(new Error('dns'))) as unknown as typeof fetch;
  const down = await endpointTransport({ url: 'u', key: SECRET, fetchFn: boom }).call({ fixture_id: 'f', rep: 0, payload: {}, key: 'k' });
  assertEquals([down.response.ok, down.response.error], [false, 'bağlantı hatası: dns']);
  const html = (() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))) as unknown as typeof fetch;
  const gw = await endpointTransport({ url: 'u', key: SECRET, fetchFn: html }).call({ fixture_id: 'f', rep: 0, payload: {}, key: 'k' });
  assertEquals(gw.response.error, 'HTTP 502 (JSON olmayan gövde)');
});

Deno.test('normalizeLlmResponse: every ai-decide kind; model answers vs infra', () => {
  const refusal = normalizeLlmResponse(decideBody({ ok: false, kind: 'refusal', decision: null, refusal: 'yapamam' }), 200);
  assertEquals([refusal.kind, isModelAnswer(refusal), parseDecision(refusal).error], ['refusal', true, 'ret: yapamam']);
  const invalid = normalizeLlmResponse(decideBody({ ok: false, kind: 'invalid', decision: null, issues: ['$.x: tip'], candidate: {} }), 200);
  assertEquals([invalid.kind, isModelAnswer(invalid), parseDecision(invalid).schema_issues], ['invalid', true, ['$.x: tip']]);
  const incomplete = normalizeLlmResponse(decideBody({ ok: false, kind: 'incomplete', decision: null, incomplete_reason: 'length' }), 200);
  assertEquals([incomplete.issues, parseDecision(incomplete).error], [['length'], 'yarım çıktı: length']);
  const err = normalizeLlmResponse(decideBody({ ok: false, kind: 'error', decision: null, error: { class: 'timeout', status: null, message: 'no answer within 4000ms' } }), 200);
  assertEquals([err.kind, err.error, isModelAnswer(err)], ['error', 'no answer within 4000ms', false]);
  const badReq = normalizeLlmResponse({ error: 'schema is not valid for strict mode', issues: ['#/x'] }, 400);
  assertEquals([badReq.ok, badReq.kind, isModelAnswer(badReq)], [false, undefined, false]);
  assertEquals(normalizeLlmResponse('x').ok, false);
});

Deno.test('fakeDecideTransport answers through the same normalisation as the endpoint', async () => {
  const t = fakeDecideTransport((b) => ({ decision: { model: b.model } }));
  const r = await t.call({ fixture_id: 'f', rep: 0, payload: { model: 'm' }, key: 'k' });
  assertEquals([r.cache, r.response.kind, r.response.decision], ['local', 'parsed', { model: 'm' }]);
});

Deno.test('requestKey: canonical JSON makes the key independent of key order', async () => {
  assertEquals(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], u: undefined }), '{"a":[{"c":3,"d":2}],"b":1}');
  assertEquals(await requestKey({ a: 1, b: { c: 2 } }), await requestKey({ b: { c: 2 }, a: 1 }));
  assert((await requestKey({ a: 1 })) !== (await requestKey({ a: 2 })));
});

Deno.test('memoryReplayStore.put: rep index, holes as null, re-recording a rep replaces it', async () => {
  const s = memoryReplayStore();
  await s.put('k', 'f', 2, { ok: true, kind: 'parsed', decision: { n: 2 } });
  await s.put('k', 'f', 0, { ok: true, kind: 'parsed', decision: { n: 0 } });
  await s.put('k', 'f', 0, { ok: true, kind: 'parsed', decision: { n: 9 } });
  const e = (await s.get('k'))!;
  assertEquals(e.responses.map((r) => (r ? (r.decision as { n: number }).n : null)), [9, null, 2]);
});

// ── request building (production's builder over a fixture) ───────────────────────────────────

const fixture: EvalFixture = {
  id: 'x',
  source: 't',
  package: 'A',
  title: 't',
  turn_input: {
    now: { local_date: '2026-10-04', weekday_tr: 'Pazar', local_time: '21:10', tz: 'Europe/Istanbul' },
    tier: 'none',
    spine: [{ ref: 'c1', kind: 'allergen', subject_id: 'seafood', display_tr: 'deniz ürünleri', severity: 'moderate', whose: 'self', active: true }],
    records: [{ ref: 'd3', kind: 'water', day: '2026-10-04', line: 'su +0,20 L → gün 3,4 L', last_turn: true }],
    pending: [{ ref: 'p1', op: 'constraint_retract', line: 'c1 kaldırma — onay bekliyor' }],
    history: [{ role: 'assistant', content: 'Ekledim.', receipts: ['d3 su +0,20 L'] }],
  },
  message: 'yok o yanlis, geri al',
  expect: [{ path: 'decision.record_ops', count: 1 }],
};

Deno.test('fixture → production Stage A request: registry prefix + schema, rendered refs, message last, deterministic', async () => {
  const body = buildFixtureRequest(fixture, 'gpt-5.6-terra');
  assertEquals(body.system, stageASystemPrompt());
  assertEquals(body.schema, stageASchema());
  assertEquals(body.effort, 'low');
  const user = body.input[0].content;
  assert(user.startsWith(renderTurnInputBlock(fixtureView(fixture.turn_input))));
  assert(user.includes('d3 · su +0,20 L → gün 3,4 L (son tur)'));
  // Structured fixture parts are worded by input.ts's own helpers — the loader's wording.
  assert(user.includes('c1 · alerji · deniz ürünleri · orta'), user);
  assert(user.includes('p1 · constraint_retract · c1 kaldırma — onay bekliyor'));
  assert(user.includes('ŞİMDİ: Pazar 4 Eki 2026, saat 21:10 (Europe/Istanbul) · today = 2026-10-04 · yesterday = 2026-10-03'));
  assert(user.includes('koç: "Ekledim."\n  ⟦d3 su +0,20 L⟧'));
  assertEquals(body.max_tokens, 2500, 'the eval sends the output budget production uses');
  assert(user.endsWith('KULLANICI MESAJI:\nyok o yanlis, geri al'));
  assertEquals(await requestKey(body), await requestKey(buildFixtureRequest(fixture, 'gpt-5.6-terra')));
  assert((await requestKey(body)) !== (await requestKey(buildFixtureRequest(fixture, 'gpt-6-luna'))));
  // And ai-decide's own parser accepts it as is.
  assert(parseDecideRequest(JSON.parse(JSON.stringify(body))).ok);
});

Deno.test('fixture BUGÜN totals are worded as the few-shots teach them ("BUGÜN: su 1,40 L"), unknown keys kept', () => {
  assertEquals(todayPhrases({ water_liters: 1.4, kcal: 1240.4, protein_g: 61.6, meals_logged: 3, week: 'w41' }), ['su 1,40 L', '1.240 kcal', 'protein 62 g', '3 öğün kaydı', 'week=w41']);
  const block = renderFixtureBlock({ now: { local_date: '2026-10-04' }, today: { water_liters: 1.4 } });
  assertEquals(block, renderTurnInputBlock(fixtureView({ now: { local_date: '2026-10-04' }, today: { water_liters: 1.4 } })), 'the fixture renderer IS production\'s renderer over the view');
  const taught = UNDERSTAND_FEW_SHOTS.flatMap((s) => s.context).filter((l) => l.startsWith('BUGÜN: su '));
  assert(taught.length > 0, 'the brain teaches a BUGÜN water line');
  assert(block.split('\n').includes('BUGÜN: su 1,40 L'), block);
  assert(taught.includes('BUGÜN: su 1,40 L'), 'same wording the model is shown in the few-shots');
});

Deno.test('fixtureT2: the real scan — explicit → canned floor, ambiguous → facts (fail-closed floor), nothing → none', () => {
  const canned = fixtureT2('intihar etmeyi düşünüyorum');
  assertEquals([canned.output.canned, canned.output.category, canned.output.explicit], [true, 'self_harm', 'sh.intihar']);
  // A v1-instant phrase v2 keeps explicit (the v1 floor): canned, Stage A never called.
  const floor = fixtureT2('kalp krizi riskini azaltmak için ne yemeliyim?');
  assertEquals([floor.output.canned, floor.output.category, floor.output.explicit], [true, 'emergency', 'emg.v1']);
  // A v1-instant phrase on the spec's AMBIGUOUS list: one fact for Stage A; without Stage A the
  // floor is today's canned reply (fallback), so it is protected either way.
  const amb = fixtureT2('bu tarife bayıldım');
  assertEquals([amb.output.canned, amb.output.facts, amb.floor.kind], [false, 1, 'fallback']);
  assertEquals(fixtureT2('1 bardak su içtim').output.hits, []);
});

// ── gates ─────────────────────────────────────────────────────────────────────────────────────

const res = (pkg: PackageId, status: FixtureRunResult['status'], extra: Partial<FixtureRunResult> = {}): FixtureRunResult => ({
  fixture_id: `${pkg}-${Math.random()}`, package: pkg, source: 's', rep: 0, status, outcomes: [], rubric: [], cache: 'local', ...extra,
});
const many = (pkg: PackageId, pass: number, fail: number) => [...Array(pass)].map(() => res(pkg, 'pass')).concat([...Array(fail)].map(() => res(pkg, 'fail')));

Deno.test('rate gates: A ≥ 95%, A\' ≥ 98%, B+ every rep, B- FP ≤ 5%, D 100%', () => {
  assertEquals(rateGate('A', many('A', 19, 1)).status, 'pass');
  assertEquals(rateGate('A', many('A', 18, 2)).status, 'fail');
  assertEquals(rateGate("A'", many("A'", 49, 1)).status, 'pass');
  assertEquals(rateGate("A'", many("A'", 48, 2)).status, 'fail');
  assertEquals(rateGate('B+', many('B+', 99, 1)).status, 'fail', 'one missed positive in any rep fails B+');
  assertEquals(rateGate('B-', many('B-', 19, 1)).status, 'pass');
  assertEquals(rateGate('D', many('D', 9, 1)).status, 'fail');
  assertEquals(rateGate('A', [res('A', 'skipped')]).status, 'no_data');
  assertEquals(rateGate('A', [...many('A', 20, 0), res('A', 'error')]).status, 'incomplete', 'never green on partial data');
  assertEquals(rateGate('A', [...many('A', 20, 0), res('A', 'skipped', { cache: 'miss' })]).status, 'incomplete');
  assertEquals(rateGate('B+', [res('B+', 'skipped', { cache: 'miss' })]).status, 'incomplete', 'an empty replay cache is not "no data"');
});

Deno.test('partial coverage: a gate that passes with skipped checks is marked KISMİ; --require-full blocks it', () => {
  const o = (status: 'pass' | 'skipped') => ({ index: 0, label: 'x', status, detail: '' });
  const partial = [res('B+', 'pass', { outcomes: [o('pass'), o('skipped')] }), res('B+', 'pass', { outcomes: [o('pass')] })];
  const g = rateGate('B+', partial);
  assertEquals([g.status, g.partial, g.checks_evaluated, g.checks_skipped], ['pass', true, 2, 1]);
  assert(g.detail.includes('KISMİ: 1/3'));
  const full = rateGate('B+', [res('B+', 'pass', { outcomes: [o('pass')] })]);
  assertEquals(full.partial, false);
  const report = { gates: [g] };
  assertEquals(gatesFailed(report).length, 0, 'Faz 1/2: partial is reported, not blocking');
  assertEquals(gatesFailed(report, { requireFull: true }).map((x) => x.package), ['B+']);
});

Deno.test('quality gate (C): win/tie ≥ 60%, mean ≥ v1 + 0.5, no safety loss', () => {
  assertEquals(qualityGate([]).status, 'no_data');
  const pairs = [{ fixture_id: 'a', v1_score: 6, v2_score: 9 }, { fixture_id: 'b', v1_score: 7, v2_score: 7 }, { fixture_id: 'c', v1_score: 7, v2_score: 6.8 }];
  assertEquals(qualityGate(pairs).status, 'pass');
  assertEquals(qualityGate(pairs.map((p) => ({ ...p, safety_loss: p.fixture_id === 'a' }))).status, 'fail');
  assertEquals(qualityGate([{ fixture_id: 'a', v1_score: 7, v2_score: 7.2 }]).status, 'fail', 'needs +0.5 on average');
});

Deno.test('budget gate (E): latency, parse/schema error rate, repair rate (≤ %5) and cost', () => {
  const ok = [...Array(20)].map((_, i) => res('A', 'pass', { cache: 'live', latency_ms: 1500 + i * 50 }));
  assertEquals(budgetGate(ok).status, 'pass');
  const slow = ok.map((r) => ({ ...r, latency_ms: (r.latency_ms ?? 0) + 3000 }));
  assertEquals(budgetGate(slow).status, 'fail');
  const broken = [...ok.slice(1), res('A', 'fail', { cache: 'live', latency_ms: 1500, parse_error: 'x' })];
  assertEquals(budgetGate(broken).status, 'fail', '1/20 parse errors > 0.5%');
  const repairs = ok.map((r, i) => ({ ...r, repair_needed: i < 2 }));
  const rg = budgetGate(repairs);
  assertEquals(rg.status, 'fail', '2/20 repairs > 5%');
  assert(rg.detail.includes('onarım 2/20'));
  assertEquals(budgetGate(ok.map((r, i) => ({ ...r, repair_needed: i === 0 }))).status, 'pass', '1/20 = 5% is within budget');
  assertEquals(budgetGate([res('A', 'pass')]).status, 'no_data', 'local runs are not latency evidence');
  assertEquals(budgetGate([res('B+', 'pass', { cache: 'none', canned: true })]).status, 'no_data', 'a T2 canned turn makes no LLM call');
  const cold = ok.map((r) => ({ ...r, usage: { input_tokens: 7000, cached_tokens: 0, output_tokens: 300 } }));
  assertEquals(budgetGate(cold, undefined, 'gpt-5.6-terra').status, 'fail');
  const warm = ok.map((r) => ({ ...r, usage: { input_tokens: 7000, cached_tokens: 5000, output_tokens: 200 } }));
  const w = budgetGate(warm, undefined, 'gpt-5.6-terra');
  assertEquals(w.status, 'pass');
  assert(w.detail.includes('önbellek %71') && w.detail.includes('ort. çıktı 200 token'), w.detail);
  assertEquals(computeGates(ok).map((g) => g.package), ['A', "A'", 'B+', 'B-', 'C', 'D', 'E']);
  assertEquals(costOf('gpt-5.6-terra', { input_tokens: 1_000_000, cached_tokens: 500_000, output_tokens: 100_000 }), 2.3);
});

Deno.test('budget gate (E) is never green on partial data: harness errors and replay misses make it incomplete', () => {
  const ok = [...Array(20)].map((_, i) => res('A', 'pass', { cache: 'live', latency_ms: 1500 + i * 50 }));
  const errored = budgetGate([...ok, res('A', 'error', { cache: 'live', error: 'HTTP 502' })]);
  assertEquals(errored.status, 'incomplete', 'a dropped call could have been the slow or broken one');
  assert(errored.detail.includes('1 hata'), errored.detail);
  const missed = budgetGate([...ok, res('A', 'skipped', { cache: 'miss' })]);
  assertEquals(missed.status, 'incomplete');
  assert(missed.detail.includes('1 replay kaydı yok'), missed.detail);
  assertEquals(budgetGate([res('A', 'skipped', { cache: 'miss' })]).status, 'incomplete', 'an empty replay cache is not "no data"');
  // A real budget breach still reads as a failure, partial data or not.
  assertEquals(budgetGate([...ok.map((r) => ({ ...r, latency_ms: (r.latency_ms ?? 0) + 3000 })), res('A', 'error')]).status, 'fail');
  assertEquals(gatesFailed({ gates: [errored] }).map((g) => g.package), ['E'], '--enforce-gates blocks on it');
});

// ── rubric + judge request ────────────────────────────────────────────────────────────────────

const replyTurn = (reply: string, receipts: unknown[] = []): TurnResult => ({ outputs: { reply: { reply }, receipts }, stages: { reply: 'ok', receipts: 'ok' }, stage_errors: {} });

Deno.test('rubric: question count, diacritics and enum leaks', () => {
  assertEquals(questionCount('Nasılsın?? İyi misin? Tamam.'), 2);
  assert(diacriticsOk('Bugün için hafif bir akşam yemeği öneriyorum; sebzeli bulgur pilavı iyi gider.').ok);
  assert(!diacriticsOk('Antrenman kaydedildi (~240 kcal yakim). Bugun icin +120 kcal hareket alani acildi.').ok, 'final2#15 receipt text');
  const out = evaluateRubric(['max_one_question', 'diacritics_ok', 'no_english_enum_leak'], replyTurn('Güncellendi — aktivite düzeyi: sedentary. Başka?'));
  assertEquals(out.map((o) => o.status), ['pass', 'pass', 'fail']);
});

Deno.test('rubric: the old canned ASCII referral is caught with or without diacritics (mem#12)', () => {
  const canned = 'Bu konuda profesyonel destek almanizi oneririz. Turkiye Yeme Bozukluklari Dernegi veya bir uzman ile gorusmeniz faydali olacaktir.';
  assertEquals(evaluateRubric(['no_canned_referral'], replyTurn(canned))[0].status, 'fail');
  assertEquals(asciiFold('Almanızı öneririz'), 'almanizi oneririz');
  const own = 'Bu konuda bir uzmanla konuşman iyi gelebilir; istersen birlikte bir psikolog bulalım.';
  assertEquals(evaluateRubric(['no_canned_referral', 'referral_line_present'], replyTurn(own)).map((o) => o.status), ['pass', 'pass']);
});

Deno.test('rubric: emergency line and claims ⊆ receipts lint', () => {
  assertEquals(evaluateRubric(['emergency_line_present'], replyTurn('Hemen 112\'yi ara.'))[0].status, 'pass');
  assertEquals(evaluateRubric(['no_emergency_line'], replyTurn('Afiyet olsun!'))[0].status, 'pass');
  assert(!claimsLint('Akşam yemeklerini %30 hafiflettim.', []).ok, 'devir §6: unmade change claimed');
  assert(claimsLint('Su kaydını geri aldım.', ['undo']).ok);
  assert(!claimsLint('Perşembe akşamını düzelttim.', ['meal_log']).ok, 'final2#6: correction claimed, only an insert happened');
  const skipped = evaluateRubric(['answers_user_question'], replyTurn('x'));
  assertEquals([skipped[0].status, skipped[0].by], ['skipped', 'none']);
  const noReply = evaluateRubric(['max_one_question'], { outputs: {}, stages: {}, stage_errors: {} });
  assertEquals(noReply[0].status, 'skipped');
});

Deno.test('judge request is an ai-decide body (strict judge schema); verdicts fail closed', () => {
  const body = buildJudgeRequest({ fixture_id: 'f', message: 'm', reply: 'r', receipts: [], rubric: ['claims_subset_of_receipts'] }, 'gpt-6-luna');
  const parsed = parseDecideRequest(body);
  assert(parsed.ok, parsed.ok ? '' : parsed.error);
  const v = parseJudgeVerdicts({ verdicts: [{ rubric: 'claims_subset_of_receipts', pass: true, reason: 'ok' }] }, ['claims_subset_of_receipts', 'answers_user_question']);
  assertEquals(v.map((x) => x.status), ['pass', 'fail']);
  assertEquals(parseJudgeVerdicts(null, ['claims_subset_of_receipts'])[0].status, 'fail');
});

// ── captured TurnInputs (format) ──────────────────────────────────────────────────────────────

const capture: CapturedTurn = {
  format: 'kochko-captured-turn/v1',
  capture_id: 'T-2026-10-07_abc',
  captured_at: '2026-10-07T10:00:00Z',
  expires_at: '2026-11-06T10:00:00Z',
  account_class: 'test',
  pipeline: 'v2_shadow',
  schema_version: 'kochko_understand_v2',
  turn_input: { now: { local_date: '2026-10-07' }, records: [] },
  message: '1 bardak su içtim',
  v1_actions: [{ type: 'water_log', liters: 1 }],
  v2_decision: null,
  labels: { package: 'A', disagreement_class: 'water_amount' },
};

Deno.test('capture format: valid, 30-day retention enforced, expiry respected', () => {
  assertEquals(validateCapture(capture), []);
  const tooLong = validateCapture({ ...capture, expires_at: '2026-12-31T00:00:00Z' });
  assert(tooLong.includes('saklama 30 günü aşıyor'));
  assert(validateCapture({ ...capture, account_class: 'real' }).length > 0, 'real accounts need consent + redaction');
  assert(!isExpired(capture, new Date('2026-10-20T00:00:00Z')));
  assert(isExpired(capture, new Date('2026-11-06T10:00:00Z')));
});

Deno.test('capture → candidate fixture and the v1/v2 op diff (shadow disagreement class)', () => {
  const f = captureToFixture(capture);
  assertEquals([f.id, f.source, f.package, f.expect.length], ['cap-t-2026-10-07abc', 'capture:T-2026-10-07_abc', 'A', 0]);
  const d = opDiff([{ type: 'water_log' }, { type: 'weight_log' }], { writes: [{ op: 'water_log' }, { op: 'meal_log' }], record_ops: [] });
  assertEquals(d, { only_v1: ['body_weight'], only_v2: ['meal_log'], both: ['water_log'] });
});

// ── cli ───────────────────────────────────────────────────────────────────────────────────────

Deno.test('cli parseArgs: flags, key=value, unknown mode, removed request inputs', () => {
  const p = parseArgs(['--mode', 'replay', '--reps=3', '--record', '--package', "A,B+", '--require-full']);
  assertEquals(p.errors, []);
  assertEquals(p.opts, { mode: 'replay', reps: '3', record: true, package: 'A,B+', 'require-full': true });
  assert(parseArgs(['--mode', 'chaos']).errors[0].includes('geçersiz --mode'));
  assert(parseArgs(['stray']).errors[0].includes('beklenmeyen'));
  assert(parseArgs(['--model']).errors[0].includes('bir değer ister'));
  assert(parseArgs(['--mode', 'live', '--schema', 'x.json']).errors.some((e) => e.includes('--schema kaldırıldı')), 'no hand-fed schema: production builds the request');
});

Deno.test('preflight: every shipped Stage A body passes ai-decide\'s own parser; calls, canned turns and cost are counted', async () => {
  const { fixtures } = await loadFixtureDir(new URL('./fixtures/', import.meta.url));
  const pf = preflight(fixtures, { model: 'gpt-5.6-terra', reps: 5 });
  assertEquals(pf.issues, []);
  assertEquals(pf.calls, pf.fixtures_called * 5);
  assertEquals(pf.fixtures_called + pf.canned + pf.not_called, fixtures.length);
  assert(pf.canned > 0, 'explicit T2 fixtures make no call');
  assert(pf.not_called > 0, 'T1 protocols / other pipelines make no call');
  assert(pf.largest_body_chars < MAX_BODY_CHARS / 2);
  assert(pf.prefix_tokens_est > 5000, `${pf.prefix_tokens_est}`);
  // §9.4: a full live run (~150 cases × 5) is ≈ $5–8; the estimate must be in that order of magnitude.
  assert(pf.cost_usd_est !== null && pf.cost_usd_est > 2 && pf.cost_usd_est < 20, `${pf.cost_usd_est}`);
  assert(formatPreflight(pf).includes(`${pf.calls} Stage A çağrısı`));
  assertEquals(preflight(fixtures, { model: 'gpt-x-unknown', reps: 1 }).cost_usd_est, null, 'no price → no made-up cost');
});

Deno.test('preflight: a body ai-decide would refuse is found for $0 (bad model id, oversized body)', () => {
  const big: EvalFixture = { ...fixture, id: 'big', message: 'su '.repeat(MAX_BODY_CHARS / 3 + 10) };
  const pf = preflight([fixture, big], { model: 'gpt-5.6-terra', reps: 1 });
  assertEquals(pf.issues.map((i) => i.fixture_id), ['big']);
  assert(pf.issues[0].error.includes('413'));
  const badModel = preflight([fixture], { model: 'kötü model!', reps: 1 });
  assertEquals(badModel.issues.length, 1);
  assert(badModel.issues[0].error.includes('ai-decide reddeder (400)'));
});

Deno.test('cli: live mode runs the pre-flight FIRST — a refused body stops the run before any key is read', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io = { log: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  assertEquals(await main(['--mode', 'live', '--model', 'kötü model!', '--package', 'A', '--key-file', 'yok/olmayan.key'], io), 2);
  assert(err.join('\n').includes('Ön kontrol başarısız: hiçbir çağrı gönderilmedi.'));
  assert(!err.join('\n').includes('anahtar dosyası bulunamadı'), 'the key is not even looked up');
  assertEquals(await main(['--mode', 'replay', '--dry-run'], io), 2, '--dry-run belongs to the paid modes');
});

Deno.test('cli looksLikeJwt: shape-only check for the service_role JWT (ai-decide verify_jwt)', () => {
  assert(looksLikeJwt(SECRET));
  assert(!looksLikeJwt('sb_secret_abc123'));
  assert(!looksLikeJwt('eyJonly.two'));
});

Deno.test('cli main: lint prints the bound inventory; replay runs offline; fake needs a module', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io = { log: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  assertEquals(await main(['--mode', 'lint'], io), 0);
  assert(out[0].startsWith('Fixture lint temiz:') && out[0].includes('registry'));
  out.length = 0;
  assertEquals(await main(['--mode', 'replay', '--reps', '1', '--package', 'B+'], io), 0, 'an empty cache is not an error');
  assert(out.join('\n').includes('KAPILAR (§9.4):'));
  assertEquals(await main(['--mode', 'replay', '--reps', '1', '--package', 'B+', '--enforce-gates'], io), 1, 'missing recordings never pass an enforced gate');
  assertEquals(await main(['--mode', 'fake'], io), 2);
  assert(err.join('\n').includes('--fake modul.ts#export'));
  assertEquals(await main(['--mode', 'lint', '--package', 'Q'], io), 2);
});
