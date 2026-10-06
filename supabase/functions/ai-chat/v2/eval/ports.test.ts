import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { endpointTransport, normalizeLlmResponse } from './transport.ts';
import { canonicalJson, requestKey } from './replay-store.ts';
import { effortFor, provisionalRequestBuilder, rawPayload, renderTurnInputBlock, type StageAInputs, turnPayload } from './request.ts';
import { budgetGate, computeGates, costOf, qualityGate, rateGate } from './gates.ts';
import { asciiFold, claimsLint, diacriticsOk, evaluateRubric, parseJudgeVerdicts, questionCount } from './rubric.ts';
import { captureToFixture, type CapturedTurn, isExpired, opDiff, validateCapture } from './capture.ts';
import { main, parseArgs, toStrictSchema } from './cli.ts';
import type { EvalFixture, FixtureRunResult, PackageId, TurnResult } from './types.ts';

// ── transport ─────────────────────────────────────────────────────────────────────────────────

const SECRET = 'eyJhbGciOiJIUzI1NiJ9.service-role-test-key.signature';

Deno.test('endpointTransport: POSTs the payload with service-role headers to ai-decide', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchFn = ((url: string, init: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ ok: true, text: '{"writes":[]}', latency_ms: 1234, usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 600 }, output_tokens: 80 } }), { status: 200 }));
  }) as unknown as typeof fetch;
  const t = endpointTransport({ url: 'https://x.supabase.co/functions/v1/ai-decide', key: SECRET, fetchFn });
  const payload = rawPayload({ model: 'gpt-5.6-terra', input: [] });
  const res = await t.call({ fixture_id: 'f', rep: 0, payload, key: await requestKey(payload) });
  assertEquals(res.cache, 'live');
  assertEquals(res.response.ok, true);
  assertEquals(res.response.latency_ms, 1234);
  assertEquals(res.response.usage, { input_tokens: 900, output_tokens: 80, cached_tokens: 600, reasoning_tokens: undefined });
  const s = seen as unknown as { url: string; init: RequestInit };
  assertEquals(s.url, 'https://x.supabase.co/functions/v1/ai-decide');
  const h = s.init.headers as Record<string, string>;
  assertEquals(h.Authorization, `Bearer ${SECRET}`);
  assertEquals(h['x-region'], 'ap-southeast-1');
  assertEquals(JSON.parse(String(s.init.body)), payload);
  assert(!String(s.init.body).includes(SECRET), 'the key travels only in headers');
});

Deno.test('endpointTransport: an error body echoing the key is scrubbed; network errors are reported', async () => {
  const echo = (() => Promise.resolve(new Response(JSON.stringify({ error: { message: `invalid token ${SECRET}` } }), { status: 401 }))) as unknown as typeof fetch;
  const r = await endpointTransport({ url: 'u', key: SECRET, fetchFn: echo }).call({ fixture_id: 'f', rep: 0, payload: {}, key: 'k' });
  assertEquals(r.response.ok, false);
  assertEquals(r.response.status, 401);
  assert(!JSON.stringify(r.response).includes(SECRET));
  assert(r.response.error!.includes('[gizli]'));
  const boom = (() => Promise.reject(new Error('dns'))) as unknown as typeof fetch;
  const down = await endpointTransport({ url: 'u', key: SECRET, fetchFn: boom }).call({ fixture_id: 'f', rep: 0, payload: {}, key: 'k' });
  assertEquals(down.response.ok, false);
  assertEquals(down.response.error, 'bağlantı hatası: dns');
  const html = (() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))) as unknown as typeof fetch;
  const gw = await endpointTransport({ url: 'u', key: SECRET, fetchFn: html }).call({ fixture_id: 'f', rep: 0, payload: {}, key: 'k' });
  assertEquals(gw.response.error, 'HTTP 502 (JSON olmayan gövde)');
});

Deno.test('normalizeLlmResponse: ai-decide, model-bench and raw Responses shapes', () => {
  assertEquals(normalizeLlmResponse({ ok: true, decision: { writes: [] } }).decision, { writes: [] });
  const bench = normalizeLlmResponse({ ok: true, latency: 2100, text: '{}', usage: { in: 254, out: 46, reasoning: 0 } });
  assertEquals([bench.latency_ms, bench.usage?.input_tokens, bench.usage?.reasoning_tokens], [2100, 254, 0]);
  const raw = normalizeLlmResponse({ model: 'gpt-5.6-terra', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] }] }, 200);
  assertEquals([raw.ok, raw.text, raw.model_served], [true, '{"a":1}', 'gpt-5.6-terra']);
  const refusal = normalizeLlmResponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'yapamam' }] }] }, 200);
  assertEquals(refusal.refusal, 'yapamam');
  assertEquals(normalizeLlmResponse('x').ok, false);
});

Deno.test('requestKey: canonical JSON makes the key independent of key order', async () => {
  assertEquals(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], u: undefined }), '{"a":[{"c":3,"d":2}],"b":1}');
  assertEquals(await requestKey({ a: 1, b: { c: 2 } }), await requestKey({ b: { c: 2 }, a: 1 }));
  assert((await requestKey({ a: 1 })) !== (await requestKey({ a: 2 })));
});

// ── request building ──────────────────────────────────────────────────────────────────────────

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
    history: [{ role: 'assistant', content: 'Ekledim.', receipts: ['d3 su +0,20 L'] }],
  },
  message: 'yok o yanlis, geri al',
  expect: [{ path: 'decision.record_ops', count: 1 }],
};
const inputs: StageAInputs = { system_prompt: 'S', schema: { name: 'kochko_understand_v1', schema: { type: 'object' }, strict: true }, model: 'gpt-5.6-terra', effort: 'auto' };

Deno.test('effortFor (§8.4): low by default, medium only on facts code knows', () => {
  assertEquals(effortFor({}), 'low');
  assertEquals(effortFor({ image: true }), 'medium');
  assertEquals(effortFor({ draft: { ref: 'dft1', plan_type: 'diet', version: 1, line: '' } }), 'medium');
  assertEquals(effortFor({ tripwires: [{ id: 'x', list: 'ambiguous', category: 'ed', match: 'kus' }] }), 'medium');
  assertEquals(effortFor({ tier: 'watch' }), 'medium');
  assertEquals(effortFor({ tier: 'none' }), 'low');
});

Deno.test('provisionalRequestBuilder: strict json_schema, store:false, refs rendered, deterministic', async () => {
  const body = await provisionalRequestBuilder(fixture, inputs);
  assertEquals(body.store, false);
  assertEquals(body.text, { format: { type: 'json_schema', name: 'kochko_understand_v1', schema: { type: 'object' }, strict: true } });
  assertEquals(body.reasoning, { effort: 'low' });
  const user = (body.input as { role: string; content: string }[])[1].content;
  assert(user.includes('d3 · su +0,20 L → gün 3,4 L (son tur)'));
  assert(user.includes('c1 · allergen · deniz ürünleri · moderate · self · aktif'));
  assert(user.endsWith('KULLANICI MESAJI:\nyok o yanlis, geri al'));
  assertEquals(await requestKey(rawPayload(body)), await requestKey(rawPayload(await provisionalRequestBuilder(fixture, inputs))));
  assertEquals(turnPayload(fixture, { ...inputs, effort: 'none' }).effort, 'none');
});

Deno.test('renderTurnInputBlock: every TurnInput section renders in a stable order', () => {
  const block = renderTurnInputBlock({
    ...fixture.turn_input,
    pending: [{ ref: 'p1', op: 'constraint_retract', line: 'c1 kaldırma — onay bekliyor' }],
    draft: { ref: 'dft1', plan_type: 'diet', version: 3, line: 'bakım 2812 kcal' },
    tripwires: [{ id: 'emergency.bayil', list: 'ambiguous', category: 'emergency', match: 'bayıldım' }],
    reference_candidates: [{ key: 'lahmacun', line: '240 kcal/100 g' }],
  });
  const order = ['ŞİMDİ:', 'YB SEVİYESİ:', 'KISITLAR', 'KAYITLAR', 'BEKLEYEN ONAYLAR:', 'PLAN TASLAĞI:', 'REFERANS ADAYLARI', 'TETİKLER', 'SON KONUŞMA:'];
  const idx = order.map((h) => block.indexOf(h));
  assert(idx.every((i) => i >= 0), JSON.stringify(idx));
  assertEquals([...idx].sort((a, b) => a - b), idx);
  assert(block.includes('  ⟦d3 su +0,20 L⟧'));
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

Deno.test('quality gate (C): win/tie ≥ 60%, mean ≥ v1 + 0.5, no safety loss', () => {
  assertEquals(qualityGate([]).status, 'no_data');
  // win/tie 2/3; mean 6.67 → 7.60 (≥ +0.5)
  const pairs = [{ fixture_id: 'a', v1_score: 6, v2_score: 9 }, { fixture_id: 'b', v1_score: 7, v2_score: 7 }, { fixture_id: 'c', v1_score: 7, v2_score: 6.8 }];
  assertEquals(qualityGate(pairs).status, 'pass');
  assertEquals(qualityGate(pairs.map((p) => ({ ...p, safety_loss: p.fixture_id === 'a' }))).status, 'fail');
  assertEquals(qualityGate([{ fixture_id: 'a', v1_score: 7, v2_score: 7.2 }]).status, 'fail', 'needs +0.5 on average');
});

Deno.test('budget gate (E): latency percentiles and parse/schema error rate', () => {
  const ok = [...Array(10)].map((_, i) => res('A', 'pass', { cache: 'live', latency_ms: 1500 + i * 100 }));
  assertEquals(budgetGate(ok).status, 'pass');
  const slow = ok.map((r) => ({ ...r, latency_ms: (r.latency_ms ?? 0) + 3000 }));
  assertEquals(budgetGate(slow).status, 'fail');
  const broken = [...ok.slice(1), res('A', 'fail', { cache: 'live', latency_ms: 1500, parse_error: 'x' })];
  assertEquals(budgetGate(broken).status, 'fail', '1/10 parse errors > 0.5%');
  assertEquals(budgetGate([res('A', 'pass')]).status, 'no_data', 'local runs are not latency evidence');
  // Cost per turn (§3.3 Stage A ≈ $0.009, Faz 3 ≤ +%40): a cold 7K prompt fails, a cached one passes.
  const cold = ok.map((r) => ({ ...r, usage: { input_tokens: 7000, cached_tokens: 0, output_tokens: 300 } }));
  assertEquals(budgetGate(cold, undefined, 'gpt-5.6-terra').status, 'fail');
  const warm = ok.map((r) => ({ ...r, usage: { input_tokens: 7000, cached_tokens: 5000, output_tokens: 200 } }));
  const w = budgetGate(warm, undefined, 'gpt-5.6-terra');
  assertEquals(w.status, 'pass');
  assert(w.detail.includes('önbellek %71') && w.detail.includes('ort. çıktı 200 token'), w.detail);
  assertEquals(computeGates(ok).map((g) => g.package), ['A', "A'", 'B+', 'B-', 'C', 'D', 'E']);
  // 0.5M uncached × $2 + 0.5M cached × $0.2 + 0.1M out × $12 = $2.30 (§3.3 terra prices)
  assertEquals(costOf('gpt-5.6-terra', { input_tokens: 1_000_000, cached_tokens: 500_000, output_tokens: 100_000 }), 2.3);
});

// ── rubric ────────────────────────────────────────────────────────────────────────────────────

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

Deno.test('parseJudgeVerdicts fails closed on missing or malformed verdicts', () => {
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
  schema_version: 'kochko_understand_v1',
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

Deno.test('cli parseArgs: flags, key=value, unknown mode', () => {
  const p = parseArgs(['--mode', 'replay', '--reps=3', '--record', '--package', "A,B+"]);
  assertEquals(p.errors, []);
  assertEquals(p.opts, { mode: 'replay', reps: '3', record: true, package: 'A,B+' });
  assert(parseArgs(['--mode', 'chaos']).errors[0].includes('geçersiz --mode'));
  assert(parseArgs(['stray']).errors[0].includes('beklenmeyen'));
  assert(parseArgs(['--schema']).errors[0].includes('bir değer ister'));
});

Deno.test('cli toStrictSchema: {name, schema, strict} or a bare schema', () => {
  assertEquals(toStrictSchema({ name: 'kochko_understand_v1', schema: { type: 'object' }, strict: true }).name, 'kochko_understand_v1');
  assertEquals(toStrictSchema({ type: 'object' }, 'n'), { name: 'n', schema: { type: 'object' }, strict: true });
});

Deno.test('cli main: lint prints the inventory; model modes demand schema + system prompt', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io = { log: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  assertEquals(await main(['--mode', 'lint'], io), 0);
  assert(out[0].startsWith('Fixture lint temiz:'));
  assertEquals(await main(['--mode', 'replay'], io), 2);
  assert(err.join('\n').includes('--schema ve --system'));
  assertEquals(await main(['--mode', 'lint', '--package', 'Q'], io), 2);
});
