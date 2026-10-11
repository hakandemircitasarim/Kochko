/**
 * ports.test.ts — the T6/T7/T8 seams (AI_MIMARI_V2 §3.2): the production wiring and the ONE T6+T7
 * orchestration the handler runs.
 *
 * Pinned: stageBPorts wires the coach builder's modules (coach.ts runCoach over the strict reply
 * schema and the per-user cache key, postcheck.ts with the luna judge on the SAME transport,
 * envelope.ts renderEnvelope); runStageB gives the whole T6+T7 ONE budget (budgets.ts: protective /
 * normal) and every call only what is left of it; a coach or post-check port that throws, hangs or
 * answers nonsense never breaks the turn (the code's own fallback stands in); an explicit tripwire
 * never reaches a port.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { CANNED_SAFETY, resolveTripwires, scanTripwires } from '../../shared/safety-tripwires.ts';
import { buildReplySchema, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';
import { COACH_TIMEOUT_MS, CRISIS_TIMEOUT_MS, POSTCHECK_GRACE_MS } from './budgets.ts';
import { coachCacheKey } from './coach-constitution.ts';
import type { CoachPort, CoachRun, PostcheckPort } from './contracts.ts';
import { renderEnvelope } from './envelope.ts';
import { COACH_UNAVAILABLE_TR } from './guarantees.ts';
import { coachTurn, runStageB, stageBPorts } from './ports.ts';
import { coachInput, commit, protectiveTripwire, replyJson, seededTurnInput, stageBTransport, USER } from './stage-b-testing.ts';

function okRun(reply = replyJson(), regen = false): CoachRun {
  return { status: 'ok', reply, model: 'gpt-5.6-terra', effort: 'low', contract: null, latencyMs: 5, usage: null, attempts: 1, retries: [], detail: null, regen };
}

Deno.test('stageBPorts: the coach builder\'s modules — strict reply schema, per-user cache key, the luna judge on the same transport, renderEnvelope', async () => {
  const ti = await seededTurnInput();
  const t = stageBTransport({ coach: [replyJson({ reply: 'Izgara tavuk iyi gider.' })], judge: [{ violation: false, items: [] }] });
  const ports = stageBPorts({ transport: t.transport });
  const input = coachInput(ti);
  const first = await ports.coach(input, { userId: USER, timeoutMs: 5_000, regen: null });
  assertEquals(first.status, 'ok');
  const body = t.coachCalls()[0].body;
  assertEquals((body.text as { format: Record<string, unknown> }).format, { type: 'json_schema', name: SCHEMA_NAMES.reply, schema: buildReplySchema(), strict: true });
  assertEquals(body.prompt_cache_key, coachCacheKey(USER));
  const out = await ports.postcheck({ input, first, regen: () => Promise.reject(new Error('no regen expected')), remainingMs: () => 5_000 });
  assertEquals([out.log.outcome, out.codeAuthored, out.log.judge], ['first', false, ['clean']]);
  assertEquals(t.judgeCalls().length, 1, 'the severe-constraint user\'s reply was judged over the same transport');
  const req = { text: 'x', codeNotes: [], why: 'y', commit: null, decision: null, tripwire: null, navigateTo: null, assistantMessageId: 'a1', remaining: -1 };
  assertEquals(ports.envelope(req), renderEnvelope(req));
});

Deno.test('runStageB: ONE budget for T6+T7 — the first call gets all of it, the regen what is left (protective 6 s, normal 25 s)', async () => {
  const ti = await seededTurnInput();
  for (const [tripwire, budget] of [[protectiveTripwire('ed'), CRISIS_TIMEOUT_MS], [coachInput(ti).tripwire, COACH_TIMEOUT_MS]] as const) {
    const clock = { t: 0 };
    const asked: number[] = [];
    const coach: CoachPort = (_i, call) => { asked.push(call.timeoutMs); clock.t += 1_000; return Promise.resolve(okRun(replyJson(), call.regen !== null)); };
    const postcheck: PostcheckPort = async (p) => {
      clock.t += 500;
      assertEquals(p.remainingMs(), budget - 1_500);
      const second = await p.regen({ excluded: [{ name: 'x', why: 'y' }], judgeFailed: false });
      return { reply: second.reply!, codeNotes: [], codeAuthored: false, log: { outcome: 'regen', invariant_hits: [], judge: [], judge_fail_reasons: [], regens: 1, budget_exhausted: false, referral_flag_mismatch: false, code_notes: [] } };
    };
    const run = await runStageB(coachInput(ti, { tripwire }), { coach, postcheck }, { userId: USER, now: () => clock.t });
    assertEquals(asked, [budget, budget - 1_500], `${tripwire.kind}: first call ${budget}, the regen what is left`);
    assertEquals(run.runs.map((r) => r.regen), [false, true]);
    assertEquals(run.ms, 2_500);
  }
});

Deno.test('runStageB: a coach port that hangs is cut at the budget; one that throws is an error run — the post-check falls back', async () => {
  const ti = await seededTurnInput((t) => { t.user_constraints = []; });
  const ports = stageBPorts({ judge: null });
  const hang: CoachPort = () => new Promise(() => { /* never settles, holds no timer */ });
  const started = Date.now();
  const crisis = await runStageB(coachInput(ti, { tripwire: protectiveTripwire('self_harm') }), { coach: hang, postcheck: ports.postcheck }, { userId: USER, budgetMs: 50 });
  assertEquals([crisis.runs.map((r) => r.status), crisis.out.log.outcome], [['timeout'], 'crisis_canned']);
  assertStringIncludes(crisis.out.reply.reply, '112');
  assert(Date.now() - started < 2_000, 'cut at ~50 ms');
  const boom: CoachPort = () => { throw new Error('port bug'); };
  const normal = await runStageB(coachInput(ti), { coach: boom, postcheck: ports.postcheck }, { userId: USER });
  assertEquals([normal.runs.map((r) => r.status), normal.out.log.outcome, normal.issues], [['error'], 'coach_failed', ['coach_port_threw']]);
  assertEquals(normal.out.reply.reply, COACH_UNAVAILABLE_TR);
});

Deno.test('runStageB: a post-check port that hangs past the budget (+ grace), throws or answers nonsense → the code\'s fallback', async () => {
  const ti = await seededTurnInput();
  const coach: CoachPort = () => Promise.resolve(okRun());
  const input = coachInput(ti, { commit: commit({ holds: [{ op: 'meal_log', reason_code: 'x', question_tr: 'Porsiyonu doğru anladım mı?', hold_id: 'p1' }] }) });
  const started = Date.now();
  const hung = await runStageB(input, { coach, postcheck: () => new Promise(() => {}) }, { userId: USER, budgetMs: 50 });
  assert(Date.now() - started < 50 + POSTCHECK_GRACE_MS + 1_000);
  assertEquals([hung.issues, hung.out.log.outcome, hung.out.codeAuthored], [['postcheck_timeout'], 'coach_failed', true]);
  assertEquals(hung.out.codeNotes, [{ kind: 'other', text: 'Porsiyonu doğru anladım mı?' }], 'the code-authored reply asks the hold itself');
  const thrown = await runStageB(input, { coach, postcheck: () => { throw new Error('bug'); } }, { userId: USER });
  assertEquals(thrown.issues, ['postcheck_failed']);
  const nonsense = await runStageB(input, { coach, postcheck: (() => Promise.resolve({ reply: 7 })) as unknown as PostcheckPort }, { userId: USER });
  assertEquals([nonsense.issues, nonsense.out.reply.reply], [['postcheck_invalid'], COACH_UNAVAILABLE_TR]);
  const protective = await runStageB(coachInput(ti, { tripwire: protectiveTripwire('emergency') }), { coach, postcheck: () => { throw new Error('bug'); } }, { userId: USER });
  assertEquals(protective.out.log.outcome, 'crisis_canned');
});

Deno.test('runStageB: an explicit tripwire or a fail-closed replace never reaches a port (no LLM, no latency)', async () => {
  const ti = await seededTurnInput();
  const canned = resolveTripwires({ scan: scanTripwires('kendimi öldürmek istiyorum'), stageA: null });
  const never: CoachPort = () => { throw new Error('no coach call expected'); };
  const run = await runStageB(coachInput(ti, { tripwire: canned }), { coach: never, postcheck: () => { throw new Error('no post-check expected'); } }, { userId: USER });
  assertEquals([run.runs, run.out.reply.reply, run.out.log.outcome], [[], CANNED_SAFETY.self_harm.message, 'crisis_canned']);
});

Deno.test('coachTurn = runStageB with the production ports + the code-owned guarantees', async () => {
  const ti = await seededTurnInput();
  const t = stageBTransport({ coach: [replyJson({ reply: 'Kaydettim.' })] });
  const input = coachInput(ti, { commit: commit({ exposures: [{ allergens: ['peanut'], source: 'meal', ref: 'm4' }] }) });
  const out = await coachTurn(input, { userId: USER, transport: t.transport });
  assertEquals(out.log.outcome, 'first');
  assertEquals(out.codeNotes.map((n) => n.kind), ['allergen_exposure']);
  assertEquals(out.added, [], 'the default port appended it itself');
  assertEquals(out.runs.length, 1);
});
