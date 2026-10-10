/**
 * handler.test.ts — the v2 turn T0–T9 with fakes for every port (no network, no database).
 *
 * Pinned per branch: the client protocols v2 does not own go to v1 before ANY side effect; an
 * explicit tripwire is canned without an LLM (facts salvaged in the background, spine only); a
 * failed/late Stage A fails closed (canned on a tripwire turn, an honest "nothing recorded" line
 * otherwise); one repair call at most; a plan action hands the turn to v1 before the commit; the
 * coach speaks after the writes and its failure falls back to the receipts; post-checks only
 * append; the envelope keeps the client contract; chat_messages get turn_id / quota_class / full
 * receipts; the undo button literal undoes the last turn's write with no LLM.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { SAMPLE_MESSAGES, SAMPLE_WRITES, sampleDecision, sampleMeal } from '../../shared/write-registry/samples.ts';
import { scanTripwires } from '../../shared/safety-tripwires.ts';
import { validateDecision } from '../../shared/write-registry/mod.ts';
import {
  actionsExecutedOf, BUSY_LINE, buildRepairRequest, handleV2Turn, honestCrashResponse, newTurnState, NOTHING_TO_UNDO_LINE, quotaClassOf,
  STAGE_A_FAILED_LINE, STAGE_B_FAILED_LINE, taskModeOf, userStateLines, v1OnlyReason, type TurnState,
} from './handler.ts';
import { turnRefs, validationContext } from './input.ts';
import { NOW, OTHER, USER } from './testing.ts';
import { chatRequest, coachReply, failedOutcome, fakeAdapter, fakeCommitPorts, fakeDeps, parsedOutcome, seededTurnInput } from './turn-testing.ts';
import type { CommitResult } from './contracts.ts';
import type { TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';

const w = (op: string, over: Record<string, unknown> = {}) => ({ ...structuredClone(SAMPLE_WRITES[op]), ...over });

async function turn(body: Record<string, unknown>, o: Parameters<typeof fakeDeps>[0] = {}, state: TurnState = newTurnState()) {
  const f = fakeDeps(o);
  const out = await handleV2Turn(chatRequest(body), USER, f.deps, state);
  const env = out.kind === 'response' ? await out.response.clone().json() as TurnEnvelope & Record<string, unknown> : null;
  const status = out.kind === 'response' ? out.response.status : null;
  return { ...f, out, env, status, state };
}

const parsed = (decision: unknown) => (req: Parameters<typeof parsedOutcome>[1]) => parsedOutcome(decision, req);

// ─── the ordinary turn ───────────────────────────────────────────────────────────────────────────

Deno.test('meal turn: Stage A → commit (w_meal_apply) → Stage B after the receipts → envelope in the client contract', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim', idempotency_key: 'k1', session_id: 'sess-1' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })) });
  assertEquals(t.out.kind, 'response');
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_meal_apply']);
  // Stage B saw what was really written
  assertEquals(t.rec.coachInputs.length, 1);
  const ci = t.rec.coachInputs[0];
  assertEquals(ci.commit.receipts[0].ok, true);
  assertEquals(ci.tripwire.kind, 'normal');
  assert(ci.userState.some((l) => l.startsWith('PROFİL:')));
  // the envelope the app reads today
  const env = t.env!;
  assertEquals(env.message, 'Afiyet olsun! Akşam için protein ağırlıklı bir şey düşünelim mi?');
  assertEquals(env.actions.length, 1);
  assertEquals(env.actions[0].type, 'meal_log');
  assert(env.actions[0].feedback?.startsWith('Öğün kaydedildi — '));
  assertEquals(env.receipts?.[0].action_type, 'meal_log', 'BADGE_DEFS key on the legacy name');
  assertEquals(env.task_mode, 'register');
  assertEquals(env.assistant_message_id, 'asst-1');
  assertEquals(env.remaining, -1, 'a record turn is exempt from the conversation cap');
  // T9
  const p = t.rec.persisted[0];
  assertEquals(p.quotaClass, 'record');
  assertEquals(p.reservedUserMessageId, 'res-1');
  assertEquals(p.sessionId, 'sess-1');
  assertEquals(p.turnId, t.state.turnId);
  assertEquals(p.actionsExecuted?.[0].type, 'meal_log', 'v1 [{type}] readers keep working');
  assertEquals(p.actionsExecuted?.[0].ok, true);
  assertEquals(p.codeNotes, null, 'nothing appended by code');
  assertEquals(t.rec.links, [`${t.state.turnId}:asst-1`]);
  assertEquals(t.rec.turnLogs.map((r) => r.stage), ['understand', 'commit', 'coach']);
  assertEquals(t.rec.turnLogs.every((r) => r.pipeline === 'v2' && r.turn_id === t.state.turnId), true);
  assertEquals(t.rec.turnLogs[2].function_name, 'ai-chat', 'the reply row keeps the function name scenarios.mjs pairs on');
  assert(t.rec.turnLogs[0].decision !== null, 'the understand row stores the decision');
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'side_effects', 'commit']);
  assertEquals(t.state.sideEffects, true);
});

Deno.test('a conversation turn (no write) reports the server remaining count; quota class conversation', async () => {
  const t = await turn({ message: 'günde 3 litre su içmem gerekiyor mu?' }, { stageA: parsed(sampleDecision({ intent: { primary: 'question', is_hypothetical: false, about_other_person: false } })) });
  assertEquals(t.env!.remaining, 41);
  assertEquals(t.env!.task_mode, 'coaching');
  assertEquals(t.rec.persisted[0].quotaClass, 'conversation');
  assertEquals(t.commit.rpcCalls.length, 0);
});

// ─── T0/T1 → v1 before any side effect ──────────────────────────────────────────────────────────

for (const [label, body] of [
  ['photo', { message: 'bu ne', image_base64: 'xx' }],
  ['voice transcription', { audio_base64: 'xx', transcribe_only: true }],
  ['plan chip', { message: 'haftalık diyet planı', task_mode_hint: 'plan_diet', plan_type: 'diet' }],
  ['approval button', { message: 'Onayla', user_approved: true, draft_id: 'd1' }],
] as const) {
  Deno.test(`${label} → v1, with no reservation, journal or Stage A`, async () => {
    const t = await turn(body as Record<string, unknown>);
    assertEquals(t.out.kind, 'fallback_v1');
    assertEquals(t.rec.reserved.length, 0);
    assertEquals(t.rec.journal.length, 0);
    assertEquals(t.rec.understandReqs.length, 0);
    assertEquals(t.state.sideEffects, false);
  });
}

Deno.test('a token for another user than the routed one → v1 (the route only read the claim)', async () => {
  const t = await turn({ message: 'selam' }, { userId: OTHER });
  assertEquals(t.out.kind, 'fallback_v1');
  if (t.out.kind === 'fallback_v1') assertEquals(t.out.reason, 'routed_user_mismatch');
});

Deno.test('v1OnlyReason: exact client protocols only (no language parsing)', () => {
  assertEquals(v1OnlyReason({ message: 'plan yap bana' }), null, 'a plan REQUEST in words is Stage A’s to read');
  assertEquals(v1OnlyReason({ message: 'x', task_mode_hint: 'onboarding_identity' }), null);
  assertEquals(v1OnlyReason({ message: '  ' }), 'no_text');
  assertEquals(v1OnlyReason({ message: 'x', task_mode_hint: 'plan_workout' }), 'plan_hint');
});

// ─── T2 safety ───────────────────────────────────────────────────────────────────────────────────

Deno.test('explicit tripwire → today’s canned reply at once: no Stage A, no reservation; facts salvaged later (spine only)', async () => {
  const msg = 'kendimi öldürmek istiyorum, fıstık alerjim var zaten, hiçbir şey yemiyorum';
  const salvageDecision = sampleDecision({
    writes: [
      { op: 'constraint_add', kind: 'allergen', subject_id: 'peanut', display_tr: 'fıstık', whose: 'self', polarity: 'has', severity: 'unknown', body_parts: [], event_date: null, note: null, evidence_quote: 'fıstık alerjim var' },
      sampleMeal(),
    ],
  });
  const t = await turn({ message: msg }, { stageA: parsed(salvageDecision) });
  assertEquals(t.env!.task_mode, 'safety');
  assertStringIncludes(t.env!.message, '112');
  assertEquals(t.env!.actions, []);
  assertEquals(t.rec.understandReqs.length, 0, 'no LLM before the reply');
  assertEquals(t.rec.reserved.length, 0);
  assertEquals(t.rec.persisted[0].quotaClass, 'exempt');
  assertEquals(t.rec.persisted[0].codeNotes?.[0].kind, 'emergency');
  assertEquals(t.rec.turnLogs[0].stage, 'tripwire');
  assertEquals(t.rec.jobs.length, 1, 'salvage runs after the reply');
  await t.rec.jobs[0]();
  assertEquals(t.commit.adapter.calls.map((c) => c.op), ['constraint_add'], 'only the protective spine fact; never the meal');
  assertEquals(t.commit.rpcCalls.length, 0);
});

Deno.test('ambiguous emergency trigger + Stage A failure → today’s canned reply (fail-closed), nothing written', async () => {
  const t = await turn({ message: 'antrenmanda bayıldım' }, { stageA: (req) => failedOutcome(req, 'timeout') });
  assertStringIncludes(t.env!.message, "112'yi ara");
  assertEquals(t.env!.task_mode, 'emergency');
  assertEquals(t.commit.rpcCalls.length, 0);
  assertEquals(t.rec.understandReqs[0].timeoutMs, 4_000, 'a tripwire turn runs on the live safety budget');
  assertEquals(t.rec.coachInputs.length, 0);
});

Deno.test('ambiguous ED trigger + Stage A failure → honest line + the ED referral appended; the tier is escalated (fallback path only)', async () => {
  const t = await turn({ message: 'aç kalmak istiyorum' }, { stageA: (req) => failedOutcome(req) });
  assert(t.env!.message.startsWith(STAGE_A_FAILED_LINE));
  assertStringIncludes(t.env!.message, 'uzman');
  assertEquals(t.rec.edSignals, ['medium']);
});

Deno.test('ambiguous trigger read POSITIVE by Stage A → protective route; a reply without 112 gets the line appended (code note)', async () => {
  const msg = 'antrenmanda bayıldım';
  const hit = scanTripwires(msg).hits[0].hit_id;
  const decision = sampleDecision({ safety: { acute_medical: true, self_harm: false, ed_signal: null, tripwire_readings: [{ hit_id: hit, reading: 'positive', reason: 'gerçek bayılma' }] }, intent: { primary: 'report', is_hypothetical: false, about_other_person: false } });
  const t = await turn({ message: msg }, { stageA: parsed(decision), coach: () => Promise.resolve(coachReply('Geçmiş olsun. Şu an nasılsın, yanında biri var mı?')) });
  assertEquals(t.rec.coachInputs[0].tripwire.kind, 'protective');
  assertStringIncludes(t.env!.message, '112');
  assertEquals(t.rec.persisted[0].codeNotes?.[0].kind, 'emergency');
  assertEquals(t.env!.task_mode, 'emergency');
  assertEquals(t.rec.turnLogs.find((r) => r.stage === 'coach')?.guard_verdict, 'emergency');
});

Deno.test('a benign reading does NOT lift protection while the B+ gate is closed (benignOverride off)', async () => {
  const msg = 'bu tarife bayıldım';
  const hit = scanTripwires(msg).hits[0].hit_id;
  const decision = sampleDecision({ safety: { acute_medical: false, self_harm: false, ed_signal: null, tripwire_readings: [{ hit_id: hit, reading: 'benign', reason: 'çok beğenmek' }] } });
  const t = await turn({ message: msg }, { stageA: parsed(decision) });
  assertEquals(t.rec.coachInputs[0].tripwire.kind, 'protective');
});

Deno.test('Stage A failure on an ordinary turn → a short honest line; nothing recorded; reservation kept as a used turn', async () => {
  const t = await turn({ message: '2 dilim lahmacun yedim', idempotency_key: 'k2' }, { stageA: (req) => failedOutcome(req) });
  assertEquals(t.env!.message, STAGE_A_FAILED_LINE);
  assertEquals(t.commit.rpcCalls.length, 0);
  assertEquals(t.rec.understandReqs[0].timeoutMs, 12_000, 'an ordinary turn has the longer turn budget');
  assertEquals(t.rec.persisted[0].quotaClass, 'conversation');
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'commit']);
});

Deno.test('an accepted ED signal (verbatim user quote) escalates the durable tier', async () => {
  const msg = 'yedikten sonra parmağımı boğazıma sokuyorum';
  const decision = sampleDecision({ safety: { acute_medical: false, self_harm: false, ed_signal: { category: 'purging', severity: 'high', evidence_quote: 'parmağımı boğazıma sokuyorum' }, tripwire_readings: [] } });
  const t = await turn({ message: msg }, { stageA: parsed(decision) });
  assertEquals(t.rec.edSignals, ['high']);
  assertEquals(t.rec.coachInputs[0].tripwire.kind, 'protective', 'a Stage A positive with no list hit is protective too');
});

// ─── T5: repair, plan, retry ─────────────────────────────────────────────────────────────────────

Deno.test('ONE repair call when a REJECT is repairable; the repaired decision is used', async () => {
  const bad = sampleDecision({ writes: [w('water_log', { unit: 'other', other_ml_each: null, as_stated: 'bir termos' })] });
  const good = sampleDecision({ writes: [w('water_log', { unit: 'other', other_ml_each: 500, as_stated: 'bir termos' })] });
  const t = await turn({ message: 'bir termos su içtim' }, { stageA: (req, n) => parsedOutcome(n === 1 ? bad : good, req) });
  assertEquals(t.rec.understandReqs.length, 2);
  const repair = t.rec.understandReqs[1];
  assertEquals(repair.input.length, 2);
  assertStringIncludes(repair.input[1].content, 'ONARIM');
  assertEquals(repair.system, t.rec.understandReqs[0].system, 'same cached prefix');
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_water_apply']);
  assertEquals((t.commit.rpcCalls[0].args.p_payload as Record<string, unknown>).liters, 0.5);
  assertEquals(t.rec.turnLogs.find((r) => r.stage === 'understand')?.repaired, true);
});

Deno.test('a repair that is worse is discarded (the original stands)', async () => {
  const ti = await seededTurnInput();
  const refs = turnRefs(ti);
  const ctx = validationContext(ti, 'x', NOW, refs);
  const a = validateDecision(sampleDecision({ writes: [w('water_log', { unit: 'other', other_ml_each: null })] }), ctx);
  const req = { model: 'm', effort: 'low' as const, system: 's', input: [{ role: 'user' as const, content: 'u' }], schema: { name: 'n', schema: {}, strict: true as const }, cache_key: 'c', max_tokens: 10, timeoutMs: 1, sizes: { prefix: 1, turn_input: 1, tripwires: 0, message: 1 } };
  const r = buildRepairRequest(req, { x: 1 }, a, 777);
  assertEquals(r.timeoutMs, 777);
  assertStringIncludes(r.input[1].content, 'other_ml_each');
});

Deno.test('plan action (Faz 4) → the turn goes to v1 before ANY write; cleanup releases journal + reservation', async () => {
  const decision = sampleDecision({ plan_action: { op: 'generate', plan_type: 'diet', draft_ref: null }, writes: [w('water_log')] });
  const t = await turn({ message: 'bana haftalık diyet planı yap, bu arada 1 bardak su içtim', idempotency_key: 'k3' }, { stageA: parsed(decision) });
  assertEquals(t.out.kind, 'fallback_v1');
  assertEquals(t.commit.rpcCalls.length, 0);
  assertEquals(t.state.sideEffects, false);
  for (const job of t.state.cleanup) await job();
  assertEquals(t.rec.released, ['res-1']);
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'fail']);
});

Deno.test('a retried key whose side effects already ran writes nothing again (exactly-once)', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim', idempotency_key: 'k4' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), sideEffectsClaim: false });
  assertEquals(t.commit.rpcCalls.length, 0);
  assert(t.rec.coachInputs[0].commit.flags.some((f) => f.code === 'retry_side_effects_skipped'));
});

// ─── T6/T7 ───────────────────────────────────────────────────────────────────────────────────────

Deno.test('Stage B failure after the writes → the receipts, plainly (never a claim beyond them)', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), coach: () => Promise.reject(new Error('provider 500')) });
  assert(t.env!.message.startsWith('Öğün kaydedildi — '));
  assert(t.env!.message.endsWith(STAGE_B_FAILED_LINE));
  assertEquals(t.rec.turnLogs.find((r) => r.stage === 'coach')?.finish_reason, 'coach_fallback');
});

Deno.test('KVKK erase request → the hold + its fixed question appended LAST by code', async () => {
  const msg = SAMPLE_MESSAGES.data_erase_request;
  const t = await turn({ message: msg }, { stageA: parsed(sampleDecision({ writes: [w('data_erase_request')] })), coach: () => Promise.resolve(coachReply('Tamam, bunu konuşalım.')) });
  assertEquals(t.commit.adapter.eraseHolds, ['memory']);
  assert(t.env!.message.startsWith('Tamam, bunu konuşalım.'));
  assertStringIncludes(t.env!.message, 'Emin olmak için soruyorum');
  assertEquals(t.rec.persisted[0].codeNotes?.map((n) => n.kind), ['safety_hold']);
  assertEquals(t.rec.persisted[0].quotaClass, 'record', 'a hold is a stored decision, not idle chat');
});

Deno.test('allergen exposure in a committed meal → acknowledged; if the coach did not, code appends the line', async () => {
  const meal = sampleMeal([{ name: 'fıstık ezmeli tost', allergens: ['gluten', 'peanut'], may_contain: [] }]);
  const t = await turn({ message: 'fıstık ezmeli tost yedim' }, { stageA: parsed(sampleDecision({ writes: [meal] })), coach: () => Promise.resolve(coachReply('Afiyet olsun!')) });
  assertEquals(t.rec.coachInputs[0].commit.exposures[0].allergens, ['fıstık']);
  assertStringIncludes(t.env!.message, 'fıstık alerjisi');
  assertEquals(t.rec.persisted[0].codeNotes?.[0].kind, 'allergen_exposure');
  const warned = await turn({ message: 'fıstık ezmeli tost yedim' }, { stageA: parsed(sampleDecision({ writes: [meal] })), coach: () => Promise.resolve(coachReply('Kaydettim ama dikkat: fıstık alerjin var, kendini nasıl hissediyorsun?')) });
  assertEquals(warned.rec.persisted[0].codeNotes, null, 'the coach already said it: nothing appended');
});

Deno.test('memory[] from Stage B is validated and written in the background (memory_note via the adapter)', async () => {
  const mem = [{ op: 'memory_note', kind: 'coach_note', text: 'Akşamları tatlı krizi yaşıyor.', food: null, grams: null, confidence: 0.8 }];
  const t = await turn({ message: 'akşam yine tatlı yedim' }, { stageA: parsed(sampleDecision()), coach: () => Promise.resolve(coachReply('Anlıyorum.', { memory: mem })) });
  assertEquals(t.rec.jobs.length, 1);
  await t.rec.jobs[0]();
  assertEquals(t.commit.adapter.calls.map((c) => c.op), ['memory_note']);
});

Deno.test('the stored content IS the envelope message (in-message <reasoning> included, for history reloads)', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), coach: () => Promise.resolve(coachReply('Afiyet olsun!', { why: 'akşam proteini düşük kaldı' })) });
  assertEquals(t.env!.message, '<reasoning>akşam proteini düşük kaldı</reasoning>\nAfiyet olsun!');
  assertEquals(t.rec.persisted[0].assistantMessage, t.env!.message);
});

Deno.test('T1 facts: an onboarding card hint and an accepted nudge reach Stage B as facts; the nudge is stamped after the reply', async () => {
  const f = fakeDeps({ stageA: parsed(sampleDecision()) });
  const stamped: string[] = [];
  f.deps.nudge = { read: () => Promise.resolve({ content: 'Yarın 20 dk yürüyüş yapalım mı?' }), stamp: (_u, id) => { stamped.push(id); return Promise.resolve(); } };
  const applied: string[] = [];
  f.deps.afterCommit = (p) => { applied.push(...p.applied.map((a) => a.op)); return Promise.resolve(); };
  await handleV2Turn(chatRequest({ message: 'tamam yaparım', task_mode_hint: 'onboarding_activity', accepted_nudge_id: 'n1' }), USER, f.deps, newTurnState());
  const facts = f.rec.coachInputs[0].userState;
  assert(facts.some((l) => l.includes('onboarding_activity')));
  assert(facts.some((l) => l.includes('Yarın 20 dk yürüyüş')));
  assertEquals(stamped, []);
  for (const job of f.rec.jobs) await job();
  assertEquals(stamped, ['n1']);
  assertEquals(applied, [], 'nothing written → no hooks');
});

Deno.test('post-commit hooks receive what was REALLY written (TDEE / onboarding live in index.ts)', async () => {
  const f = fakeDeps({ stageA: parsed(sampleDecision({ writes: [w('body_weight', { kg: 69.5, as_stated: '69,5' })] })) });
  const applied: Array<{ op: string; kg: unknown }> = [];
  f.deps.afterCommit = (p) => { applied.push(...p.applied.map((a) => ({ op: a.op, kg: a.row.kg }))); return Promise.resolve(); };
  await handleV2Turn(chatRequest({ message: 'bu sabah 69,5 kiloydum' }), USER, f.deps, newTurnState());
  for (const job of f.rec.jobs) await job();
  assertEquals(applied, [{ op: 'body_weight', kg: 69.5 }]);
  assertEquals(f.commit.rpcCalls[0].name, 'w_metric_apply');
});

// ─── quota / journal / persistence ───────────────────────────────────────────────────────────────

Deno.test('a capped conversation turn stops before Stage B: rate_limited, reservation released, journal released', async () => {
  const t = await turn({ message: 'nasılsın', idempotency_key: 'k5' }, { stageA: parsed(sampleDecision()), capAllowed: false });
  assertEquals(t.env!.rate_limited, true);
  assertEquals(t.env!.remaining, 0);
  assertEquals(t.rec.coachInputs.length, 0);
  assertEquals(t.rec.released, ['res-1']);
  assertEquals(t.rec.journal.at(-1)?.kind, 'fail');
});

Deno.test('the hard daily ceiling blocks before any LLM call', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim' }, { reserveAllowed: false });
  assertEquals(t.env!.task_mode, 'rate_limited');
  assertEquals(t.rec.understandReqs.length, 0);
});

Deno.test('journal replay / busy: no second run', async () => {
  const replay = await turn({ message: 'x', idempotency_key: 'k6' }, { claim: { mode: 'replay', envelope: { message: 'önceki cevap', actions: [], task_mode: 'coaching' } } });
  assertEquals(replay.env!.message, 'önceki cevap');
  assertEquals(replay.rec.understandReqs.length, 0);
  const busy = await turn({ message: 'x', idempotency_key: 'k7' }, { claim: { mode: 'busy' } });
  assertEquals(busy.env!.message, BUSY_LINE);
});

Deno.test('a stale session_id answers 404 like v1 (SESSION_NOT_FOUND)', async () => {
  const t = await turn({ message: 'nasılsın', session_id: 'gone' }, { stageA: parsed(sampleDecision()), persistThrows: 'SESSION_NOT_FOUND: gone' });
  assertEquals(t.status, 404);
  assertEquals(t.rec.released, ['res-1']);
});

// ─── T1 undo button ──────────────────────────────────────────────────────────────────────────────

Deno.test('undo button literal → the last turn’s meal write undone by write_id, no LLM, typed undo receipt', async () => {
  const t = await turn({ message: 'Son öğün kaydını geri al', idempotency_key: 'k8' }, { lastTurnWrite: { write_id: 'wid-77', ref: 'm40' } });
  assertEquals(t.rec.undoLookups, ['meal_log']);
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_record_delete']);
  assertEquals(t.commit.rpcCalls[0].args.p_target, { write_id: 'wid-77' });
  assertEquals(t.rec.understandReqs.length, 0);
  assertEquals(t.rec.reserved.length, 0, 'the undo button is exempt (no quota row reserved)');
  const env = t.env!;
  assertEquals(env.task_mode, 'repair');
  assertEquals(env.receipts, [{ action_type: 'undo', ok: true, rows_affected: 1, user_line: 'Son öğün kaydını geri aldım.', failure_class: null }]);
  assertEquals(env.actions, [{ type: 'undo', feedback: 'Son öğün kaydını geri aldım.' }]);
  assertEquals(t.rec.persisted[0].quotaClass, 'exempt');
  assertEquals(t.rec.turnLogs[0].stage, 'undo_fast');
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'commit']);
});

Deno.test('undo with nothing in the last turn → nothing_to_undo (the client shows no extra alert)', async () => {
  const t = await turn({ message: 'Son antrenman kaydını geri al' }, { lastTurnWrite: null });
  assertEquals(t.commit.rpcCalls.length, 0);
  assertEquals(t.env!.message, NOTHING_TO_UNDO_LINE);
  assertEquals(t.env!.receipts?.[0].failure_class, 'nothing_to_undo');
  assertEquals(t.env!.actions, []);
});

Deno.test('undo refused by the ledger (later_write) → honest reason, ok:false', async () => {
  const ports = fakeCommitPorts({ rpc: (name) => (name === 'w_record_delete' ? { ok: false, op: 'record_delete', failure_class: 'later_write', detail: {} } : undefined) });
  const t = await turn({ message: 'Son supplement kaydını geri al' }, { lastTurnWrite: { write_id: 'wid-1', ref: 's3' }, commit: ports });
  assertEquals(t.env!.receipts?.[0].ok, false);
  assertEquals(t.env!.receipts?.[0].failure_class, 'later_write');
  assertStringIncludes(t.env!.message, 'Kaydı geri alamadım');
});

Deno.test('only the exact literal is the button: a typed "son öğünü geri al" is a normal message for Stage A', async () => {
  const t = await turn({ message: 'son öğünü geri al' }, { stageA: parsed(sampleDecision()) });
  assertEquals(t.rec.undoLookups.length, 0);
  assertEquals(t.rec.understandReqs.length, 1);
});

// ─── pure helpers ────────────────────────────────────────────────────────────────────────────────

const commitOf = (over: Partial<CommitResult> = {}): CommitResult => ({ turnId: 't', receipts: [], holds: [], rejects: [], flags: [], writtenRefs: [], exposures: [], ...over });

Deno.test('quotaClassOf / taskModeOf / actionsExecutedOf', () => {
  const okR = { action_type: 'water_log', ok: true, rows_affected: 1, user_line: 'Su: +0,20 L', failure_class: null, legacy_type: 'water_log' };
  assertEquals(quotaClassOf(commitOf()), 'conversation');
  assertEquals(quotaClassOf(commitOf({ receipts: [{ ...okR, ok: false }] })), 'conversation', 'a failed write is not a record turn');
  assertEquals(quotaClassOf(commitOf({ receipts: [okR] })), 'record');
  assertEquals(taskModeOf({ tripwire: { kind: 'normal', log: {} as never }, decision: { intent: { primary: 'report' } }, commit: commitOf({ receipts: [okR] }) }), 'register');
  assertEquals(taskModeOf({ tripwire: { kind: 'normal', log: {} as never }, decision: { intent: { primary: 'correction' } }, commit: null }), 'repair');
  assertEquals(taskModeOf({ tripwire: { kind: 'normal', log: {} as never }, decision: { reply_route: { contract: 'onboarding' } }, commit: null }), 'onboarding');
  assertEquals(actionsExecutedOf([okR])?.[0], { type: 'water_log', ...okR });
  assertEquals(actionsExecutedOf([]), null);
});

Deno.test('userStateLines: Turkish facts from the TurnInput (profile, targets, constraints, ED tier)', async () => {
  const ti = await seededTurnInput((t) => { t.user_safety_state[0].ed_tier = 'amber'; });
  const lines = userStateLines(ti, ['TANIŞMA KARTI: x']);
  assert(lines.some((l) => l.startsWith('PROFİL: cinsiyet kadın')));
  assert(lines.some((l) => l === 'BUGÜNKÜ HEDEF: 1500–1700 kcal · protein 110 g'));
  assert(lines.some((l) => l.startsWith('KISIT c1: alerji · fıstık · ciddi')));
  assert(lines.some((l) => l.includes('kademesi amber')));
  assertEquals(lines.at(-1), 'TANIŞMA KARTI: x');
});

Deno.test('honestCrashResponse: after a side effect the receipts are answered and the journal stores them', async () => {
  const f = fakeDeps();
  const state = newTurnState();
  state.userId = USER;
  state.journalKey = 'k9';
  state.commit = commitOf({ receipts: [{ action_type: 'meal_log', ok: true, rows_affected: 1, user_line: 'Öğün kaydedildi — x 100 kcal · toplam 100 kcal', failure_class: null, legacy_type: 'meal_log' }] });
  const res = await honestCrashResponse(state, f.deps);
  const env = await res.json() as TurnEnvelope;
  assert(env.message.startsWith('Öğün kaydedildi'));
  assertEquals(env.actions[0].type, 'meal_log');
  assertEquals(f.rec.journal[0].kind, 'commit');
});

Deno.test('fakeAdapter sanity: the default adapter answers ok', async () => {
  const a = fakeAdapter();
  assertEquals((await a.createEraseHold(USER, 'memory')).ok, true);
});
