/**
 * coach.test.ts — Stage B (AI_MIMARI_V2 §3.2 T6, §8.2, §8.4), driven by a fake Responses transport.
 *
 * Pinned: the cached prefix is the constitution + exemplars + capability list, byte-stable and free of
 * user data, under the per-user cache key; the strict reply schema (suggested_* before reply); the
 * §3.2 T6 order of the final user turn; history annotated with receipts and cleaned of machine blocks;
 * §8.4 effort from facts code holds; the crisis contract with the 6 s budget; the outcome statuses;
 * and coachTurn end to end — first reply violates, ONE regen with the DENETİM NOTU, judge clean.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildCapabilities, buildReplySchema, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';
import { buildCoachPrefix, coachCacheKey } from './coach-constitution.ts';
import {
  buildCoachRequest, COACH_TIMEOUT_MS, coachContract, coachEffort, coachTurnBudgetMs, CONTRACT_TEXT,
  CRISIS_TIMEOUT_MS, normalizeCoachReply, renderHistory, renderRegenNote, runCoach,
} from './coach.ts';
import { coachTurn } from './ports.ts';
import type { CoachReply } from './contracts.ts';
import { navigateOf, renderEnvelope } from './envelope.ts';
import type { ProseJudge } from './postcheck.ts';
import type { respond } from '../../shared/openai.ts';
import { CANNED_SAFETY, resolveTripwires, scanTripwires } from '../../shared/safety-tripwires.ts';
import { refusalBody } from './testing.ts';
import {
  coachInput, commit, decision, edFallbackTripwire, mealWrite, protectiveTripwire, replyJson, seededTurnInput, stageBTransport, USER,
} from './stage-b-testing.ts';

const MEAL_OK = { action_type: 'meal_log', legacy_type: 'meal_log', ok: true, rows_affected: 1, failure_class: null, user_line: 'Öğün kaydedildi — elma ~80 kcal · toplam 80 kcal', ref: 'm4' };

Deno.test('request: cached prefix = constitution + exemplars + capabilities, per-user key, strict reply schema', async () => {
  const ti = await seededTurnInput();
  const req = buildCoachRequest(coachInput(ti), { userId: USER });
  assertEquals(req.messages[0], { role: 'system', content: buildCoachPrefix({ capabilities: buildCapabilities() }) });
  assertEquals(req.cacheKey, coachCacheKey(USER));
  assertEquals(req.schema, { name: SCHEMA_NAMES.reply, schema: buildReplySchema(), strict: true });
  const props = Object.keys((req.schema.schema as { properties: Record<string, unknown> }).properties);
  assert(props.indexOf('suggested_foods') < props.indexOf('reply') && props.indexOf('suggested_exercises') < props.indexOf('reply'), '§7.1 suggestions before prose');
  assertEquals(req.effort, 'low');
  assertEquals(req.timeoutMs, COACH_TIMEOUT_MS);
});

Deno.test('prefix is byte-stable across users and turns and carries no user data (the cache property)', async () => {
  const a = buildCoachRequest(coachInput(await seededTurnInput(), { message: 'qzx benzersiz mesaj' }), { userId: USER });
  const b = buildCoachRequest(coachInput(await seededTurnInput((t) => { t.user_constraints = []; }), { message: 'başka bir şey', commit: commit({ receipts: [MEAL_OK] }) }), { userId: 'someone-else' });
  assertEquals(a.messages[0].content, b.messages[0].content);
  const prefix = String(a.messages[0].content);
  for (const userBit of ['qzx benzersiz mesaj', '2026-10-07', 'sol_diz', 'KULLANICI DURUMU', 'BU TURDA OLANLAR\n-']) assert(!prefix.includes(userBit), userBit);
  assert(a.cacheKey !== b.cacheKey, 'the key is per user');
});

Deno.test('final user turn: §3.2 T6 order — state → (contract) → BU TURDA OLANLAR → safety → message, message verbatim last', async () => {
  const ti = await seededTurnInput();
  const req = buildCoachRequest(coachInput(ti, {
    message: 'bugün çok yedim, yarın hiç yemesem mi?',
    tripwire: protectiveTripwire('ed'),
    commit: commit({ receipts: [MEAL_OK] }),
    userState: ['Kişi notu: kısa cevap sever'],
  }), { userId: USER });
  const user = String(req.messages[req.messages.length - 1].content);
  const at = (s: string) => user.indexOf(s);
  for (const s of ['KULLANICI DURUMU', 'EK OLGULAR', CONTRACT_TEXT.ed_support.split('\n')[0], 'BU TURDA OLANLAR', 'GÜVENLİK DURUMU', 'KULLANICI MESAJI']) assert(at(s) >= 0, s);
  assert(at('KULLANICI DURUMU') < at('EK OLGULAR') && at('EK OLGULAR') < at('## Bu turun sözleşmesi') && at('## Bu turun sözleşmesi') < at('BU TURDA OLANLAR'));
  assert(at('BU TURDA OLANLAR') < at('GÜVENLİK DURUMU') && at('GÜVENLİK DURUMU') < at('KULLANICI MESAJI'));
  assert(user.endsWith('KULLANICI MESAJI\nbugün çok yedim, yarın hiç yemesem mi?'));
  assertStringIncludes(user, '- KAYDEDİLDİ: Öğün kaydedildi — elma ~80 kcal · toplam 80 kcal');
});

Deno.test('history: receipts ⟦…⟧ on assistant turns, machine blocks removed, oldest dropped first', () => {
  const msgs = renderHistory([
    { role: 'user', content: 'çok eski' },
    { role: 'user', content: 'su içtim' },
    { role: 'assistant', content: 'Harika gidiyorsun.\n<reasoning>gizli</reasoning>\n<confirm_reject/>', receipts: ['Su: +0,20 L', 'Kayıt geri alındı: d3'] },
    { role: 'system', content: 'yok sayılır' },
  ], 2);
  assertEquals(msgs, [
    { role: 'assistant', content: 'Harika gidiyorsun.\n⟦Su: +0,20 L · Kayıt geri alındı: d3⟧' },
  ]);
});

Deno.test('§8.4 effort: low by default; medium only from facts code holds', async () => {
  const ti = await seededTurnInput();
  assertEquals(coachEffort(coachInput(ti)), 'low');
  assertEquals(coachEffort(coachInput(ti, { tripwire: protectiveTripwire('self_harm') })), 'medium');
  assertEquals(coachEffort(coachInput(ti, { tripwire: edFallbackTripwire() })), 'medium');
  assertEquals(coachEffort(coachInput(ti, { decision: decision({ reply_route: { contract: 'plan', effort_hint: 'low' } }) })), 'medium');
  assertEquals(coachEffort(coachInput(ti, { decision: decision({ reply_route: { contract: 'coach', effort_hint: 'medium' } }) })), 'medium', 'analysis/compensation');
  assertEquals(coachEffort(coachInput(ti, {
    decision: decision({ safety: { acute_medical: false, self_harm: false, ed_signal: { category: 'binge', severity: 'medium', evidence_quote: 'x' }, tripwire_readings: [] } }),
  })), 'medium');
  assertEquals(coachEffort(coachInput(ti, {
    decision: decision({ safety: { acute_medical: false, self_harm: false, ed_signal: { category: 'illness_vomiting', severity: 'low', evidence_quote: 'kustum' }, tripwire_readings: [] } }),
  })), 'low', 'food poisoning is not an ED route');
  const amber = await seededTurnInput((t) => { (t.user_safety_state[0] as Record<string, unknown>).ed_tier = 'amber'; });
  assertEquals(coachEffort(coachInput(amber)), 'medium');
  const unread = await seededTurnInput((t) => { t.user_safety_state = []; });
  assertEquals(coachEffort(coachInput(unread)), 'low', 'no safety row = none (an unreadable row is the fail-closed case)');
});

Deno.test('crisis contract + 6 s budget on the protective path; onboarding contract when the profile is incomplete', async () => {
  const ti = await seededTurnInput();
  const crisis = buildCoachRequest(coachInput(ti, { tripwire: protectiveTripwire('self_harm') }), { userId: USER });
  assertEquals([crisis.contract, crisis.timeoutMs, crisis.effort], ['crisis', CRISIS_TIMEOUT_MS, 'medium']);
  assertStringIncludes(String(crisis.messages.at(-1)!.content), CONTRACT_TEXT.crisis);
  assertEquals(coachContract(coachInput(ti, { tripwire: protectiveTripwire('emergency') })), 'emergency');
  // Retrial 2026-10-12: the coach's own (conditional) 112 line + the code-owned one = the 112 sentence
  // twice. The contract now says the code appends it and the coach writes none; the 2026-10-11 typo
  // paragraph is gone (an acute claim without the user's symptom words no longer reaches this contract).
  assertStringIncludes(CONTRACT_TEXT.emergency, 'kod cevabın sonuna kendisi ekler; sen ayrıca bir 112 cümlesi yazma');
  assert(!CONTRACT_TEXT.emergency.includes("kişiyi hemen 112'yi aramaya"), 'no instruction to write the line the code appends');
  assert(!CONTRACT_TEXT.emergency.includes('koşullu tek cümle') && !CONTRACT_TEXT.emergency.includes('yazım hatası'));
  assertStringIncludes(CONTRACT_TEXT.emergency, 'yalnızca şu anki güvenliğiyle ilgili');
  const fresh = await seededTurnInput((t) => { (t.profiles[0] as Record<string, unknown>).onboarding_completed = false; });
  assertEquals(coachContract(coachInput(fresh)), 'onboarding');
  assertEquals(coachContract(coachInput(ti)), null);
});

Deno.test('runCoach: wire shape (strict format, cache key, store:false, effort) and outcome statuses', async () => {
  const ti = await seededTurnInput();
  const ok = stageBTransport({ coach: [replyJson()] });
  const r = await runCoach(coachInput(ti), { userId: USER, transport: ok.transport });
  assertEquals(r.status, 'ok');
  assertEquals(r.reply, normalizeCoachReply(replyJson()));
  const body = ok.calls[0].body;
  assertEquals((body.text as { format: Record<string, unknown> }).format, {
    type: 'json_schema', name: SCHEMA_NAMES.reply, schema: buildReplySchema(), strict: true,
  });
  assertEquals(body.store, false);
  assertEquals(body.prompt_cache_key, coachCacheKey(USER));
  assertEquals((body.reasoning as { effort: string }).effort, 'low');

  assertEquals((await runCoach(coachInput(ti), { userId: USER, transport: stageBTransport({ coach: [refusalBody('yapamam')] }).transport })).status, 'refused');
  const invalid = await runCoach(coachInput(ti), { userId: USER, transport: stageBTransport({ coach: [{ reply: 'eksik alanlı' } as never] }).transport });
  assertEquals(invalid.status, 'invalid');
  const http = await runCoach(coachInput(ti), { userId: USER, transport: stageBTransport({ coach: [new Response('{"error":{"message":"nope"}}', { status: 400 })] }).transport });
  assertEquals(http.status, 'error');
  const thrown = await runCoach(coachInput(ti), { userId: USER, respond: () => { throw new Error('boom'); } });
  assertEquals([thrown.status, thrown.detail], ['error', 'boom']);
});

Deno.test('normalizeCoachReply: defensive, nameless suggestions dropped, blank why is null', () => {
  const r = normalizeCoachReply({ reply: 'x', suggested_foods: [{ name: ' ', allergens: [] }, { name: 'elma', allergens: ['x', 3] }], why: '  ', referral_included: 'yes' });
  assertEquals(r, {
    reply: 'x', suggested_foods: [{ name: 'elma', allergens: ['x'], may_contain: [] }], suggested_exercises: [], memory: [],
    ui: { navigate_to: null, task_completion_summary: null }, referral_included: false, why: null,
  });
  assertEquals(normalizeCoachReply({ suggested_foods: [] }), null);
});

Deno.test('coachTurn end to end: violating first reply → ONE regen with the DENETİM NOTU → judge clean → out', async () => {
  const ti = await seededTurnInput();
  const t = stageBTransport({
    coach: [
      replyJson({ suggested_foods: [{ name: 'fıstık ezmeli tost', allergens: ['peanut'], may_contain: [] }], reply: 'Fıstık ezmeli tost ye.' }),
      replyJson({ suggested_foods: [{ name: 'peynirli tost', allergens: ['gluten', 'milk'], may_contain: [] }], reply: 'Peynirli tost iyi olur.' }),
    ],
    judge: [{ violation: false, items: [] }],
  });
  const out = await coachTurn(coachInput(ti), { userId: USER, transport: t.transport });
  assertEquals(out.log.outcome, 'regen');
  assertEquals(out.text, 'Peynirli tost iyi olur.');
  assertEquals(out.runs.map((r) => [r.status, r.regen]), [['ok', false], ['ok', true]]);
  const regenMsgs = t.coachCalls()[1].body.input as { role: string; content: string }[];
  const last = regenMsgs[regenMsgs.length - 1];
  assertEquals(last.role, 'system');
  assertStringIncludes(last.content, 'DENETİM NOTU');
  assertStringIncludes(last.content, 'fıstık ezmeli tost (fıstık alerjisi)');
  assertEquals(t.judgeCalls().length, 2, 'the first reply and the regen are both judged (severe-constraint user)');
  assertEquals(renderRegenNote({ excluded: [], judgeFailed: true }).includes('doğrulayamadı'), true);
});

Deno.test('an explicit tripwire never reaches a model: the ready-made reply, with the turn\'s other notices', async () => {
  const ti = await seededTurnInput();
  const scan = scanTripwires('kendimi öldürmek istiyorum');
  const canned = resolveTripwires({ scan, stageA: null });
  assertEquals(canned.kind, 'canned');
  const t = stageBTransport({ coach: [replyJson()] });
  const out = await coachTurn(coachInput(ti, { tripwire: canned, commit: commit({ holds: [{ op: 'meal_log', reason_code: 'x', question_tr: 'Porsiyonu doğru anladım mı?', hold_id: null }] }) }), { userId: USER, transport: t.transport });
  assertEquals(t.calls.length, 0, 'no LLM, no latency');
  assertEquals(out.log.outcome, 'crisis_canned');
  assertEquals(out.text, CANNED_SAFETY.self_harm.message, 'no portion question next to a crisis reply');
  assertEquals(out.runs, []);
  assertEquals(navigateOf({ navigate_to: ' /plan/diet ' }), '/plan/diet');
  assertEquals(navigateOf(null), null);
});

/** A respond() fake on a fake clock: each coach call "takes" `ms` and answers with the next reply. */
function clockedCoach(clock: { t: number }, steps: Array<{ ms: number; reply: CoachReply }>) {
  const timeouts: number[] = [];
  let i = 0;
  const fake = ((o: { timeoutMs?: number }) => {
    timeouts.push(o.timeoutMs ?? -1);
    const s = steps[Math.min(i++, steps.length - 1)];
    clock.t += s.ms;
    return Promise.resolve({ kind: 'parsed', value: s.reply, latencyMs: s.ms, usage: null, attempts: 1, retries: [] });
  }) as unknown as typeof respond;
  return { respond: fake, timeouts };
}

Deno.test('coachTurn budget is END TO END on the protective path: coach + judge + regen share 6 s, then the ready-made reply', async () => {
  const ti = await seededTurnInput();
  const ed = protectiveTripwire('ed');
  assert(ed.kind === 'protective');
  assertEquals(coachTurnBudgetMs(coachInput(ti, { tripwire: ed })), CRISIS_TIMEOUT_MS);
  assertEquals(coachTurnBudgetMs(coachInput(ti)), COACH_TIMEOUT_MS);
  const peanut = replyJson({ suggested_foods: [{ name: 'fıstık ezmeli tost', allergens: ['peanut'], may_contain: [] }], reply: 'Bir dilim fıstık ezmeli tost ye.' });
  const safe = replyJson({ reply: 'Yanındayım; bunu bir diyetisyenle konuşman iyi gelebilir.' });

  // Coach 4,5 s + judge 1 s → 0,5 s left: no regen can finish → the canned ED reply, ~6 s, not ~22 s.
  const clock = { t: 0 };
  const coach = clockedCoach(clock, [{ ms: 4_500, reply: peanut }, { ms: 4_500, reply: safe }]);
  let judged = 0;
  const judge: ProseJudge = (req) => { judged++; assertEquals(req.timeoutMs, 1_500); clock.t += 1_000; return Promise.resolve({ status: 'ok', violation: false, items: [], ms: 1_000 }); };
  const out = await coachTurn(coachInput(ti, { tripwire: ed }), { userId: USER, respond: coach.respond, judge, now: () => clock.t });
  assertEquals(coach.timeouts, [CRISIS_TIMEOUT_MS], 'one coach call, given the whole 6 s');
  assertEquals([out.log.outcome, out.log.regens, out.log.budget_exhausted, judged], ['crisis_canned', 0, true, 1]);
  assertEquals(out.reply.reply, ed.fallback.message);
  assert(clock.t <= CRISIS_TIMEOUT_MS, `spent ${clock.t} ms`);

  // Coach 1 s + judge 0,5 s → the ONE regen gets exactly what is left (4,5 s), and its judge what is left after it.
  const c2 = { t: 0 };
  const coach2 = clockedCoach(c2, [{ ms: 1_000, reply: peanut }, { ms: 1_000, reply: safe }]);
  const left: number[] = [];
  const judge2: ProseJudge = (req) => { left.push(req.timeoutMs ?? -1); c2.t += 500; return Promise.resolve({ status: 'ok', violation: false, items: [], ms: 500 }); };
  const out2 = await coachTurn(coachInput(ti, { tripwire: ed }), { userId: USER, respond: coach2.respond, judge: judge2, now: () => c2.t });
  assertEquals(coach2.timeouts, [CRISIS_TIMEOUT_MS, 4_500]);
  assertEquals(left, [5_000, 3_500]);
  assertEquals([out2.log.outcome, out2.runs.map((r) => r.regen)], ['regen', [false, true]]);
  assertStringIncludes(out2.text, 'diyetisyenle konuşman');
  assertEquals(out2.codeNotes, [], 'the regen carries a real referral in its text');
});

Deno.test('coachTurn: a Stage B call that ignores its timeout is cut at the turn budget', async () => {
  const ti = await seededTurnInput((t) => { t.user_constraints = []; });
  const hang = (() => new Promise(() => { /* never settles, holds no timer */ })) as unknown as typeof respond;
  const started = Date.now();
  const crisis = await coachTurn(coachInput(ti, { tripwire: protectiveTripwire('self_harm') }), { userId: USER, respond: hang, judge: null, budgetMs: 50 });
  assertEquals([crisis.log.outcome, crisis.runs.map((r) => r.status)], ['crisis_canned', ['timeout']]);
  assertStringIncludes(crisis.text, '112');
  const normal = await coachTurn(coachInput(ti), { userId: USER, respond: hang, judge: null, budgetMs: 50 });
  assertEquals(normal.log.outcome, 'coach_failed');
  assert(Date.now() - started < 2_000, 'both cut at ~50 ms');
});

Deno.test('fail-closed ED replace: the ready-made referral reply, no duplicate referral line, no model', async () => {
  const ti = await seededTurnInput();
  const log = protectiveTripwire('ed').log;
  for (const response of [CANNED_SAFETY.ed_high, CANNED_SAFETY.ed_medium]) {
    const t = stageBTransport({ coach: [replyJson()] });
    const out = await coachTurn(coachInput(ti, { tripwire: { kind: 'fallback', category: 'ed', response, mode: 'replace', ed_signal: 'high', log } }), { userId: USER, transport: t.transport });
    assertEquals([t.calls.length, out.text, out.codeNotes], [0, response.message, []], response.kind);
  }
});

Deno.test('T6 → T7 → T8: the coach reply, the code lines LAST and the envelope the app parses', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, {
    message: 'öğlen satay tavuk yedim',
    decision: decision({ intent: { primary: 'report' }, writes: [mealWrite([['satay tavuk', 520, 35]])] }),
    commit: commit({
      receipts: [{ ...MEAL_OK, user_line: 'Öğün kaydedildi — satay tavuk (1 porsiyon) ~520 kcal · toplam 520 kcal' }],
      exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }],
    }),
  });
  const t = stageBTransport({
    coach: [replyJson({ reply: 'Kaydettim; akşamı hafif tutarsan gün dengede kapanır.', why: 'Bugün aralığın ortasındasın.' })],
    judge: [{ violation: false, items: [] }],
  });
  const out = await coachTurn(input, { userId: USER, transport: t.transport });
  assertEquals(out.log.outcome, 'first');
  assertEquals(out.codeNotes.map((n) => n.kind), ['allergen_exposure'], 'the coach did not acknowledge the exposure, code does');
  const env = renderEnvelope({ text: out.text, why: out.reply.why, commit: input.commit, decision: input.decision, tripwire: input.tripwire, remaining: -1 });
  assert(env.message.startsWith('Kaydettim; akşamı hafif tutarsan gün dengede kapanır.\n\n⚠️ Dikkat: profilinde ciddi fıstık alerjisi'), env.message);
  assert(env.message.endsWith('<reasoning>Bugün aralığın ortasındasın.</reasoning>'));
  assertEquals(env.actions, [{ type: 'meal_log', feedback: 'Öğün kaydedildi — satay tavuk (1 porsiyon) ~520 kcal · toplam 520 kcal', confidence: 'medium' }]);
  assertEquals(env.task_mode, 'register');
  // Stage B saw the post-turn number and the exposure as facts.
  const user = String((t.coachCalls()[0].body.input as { content: string }[]).at(-1)!.content);
  assertStringIncludes(user, 'Bugün (sunucu): 1.195 kcal (az önce yazılanlar dahil)');
  assertStringIncludes(user, 'ALERJEN ÇAKIŞMASI: kaydedilen öğün (m4)');
});
