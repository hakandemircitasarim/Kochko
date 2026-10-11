/**
 * handler.test.ts — the v2 turn T0–T9 END TO END: fakes for the database, the writer RPCs, Stage A
 * and the request journal, but the PRODUCTION Stage B (ports.ts stageBPorts → coach.ts runCoach,
 * postcheck.ts with the luna judge, envelope.ts renderEnvelope) over a fake Responses transport.
 * No network, no database.
 *
 * Pinned per branch: the client protocols v2 does not own go to v1 before ANY side effect; an
 * explicit tripwire is canned without an LLM (facts salvaged in the background, spine only); a
 * failed/late Stage A fails closed on the turn's budget class (stage-a-request.ts constants); one
 * repair call at most; a plan action hands the turn to v1 before the commit; the coach speaks after
 * the writes from facts rendered ONCE (facts.ts; the handler passes data); the suggestion invariant
 * regenerates once, then falls back; the code-owned lines (112 / referral, exposure, every safety-hold
 * question) survive ANY post-check port; the envelope keeps the client contract (snapshot + the
 * client's own parsers); chat_messages get turn_id / quota_class / full receipts; the undo button
 * literal undoes the last turn's write (v2 or ledgered v1) with no LLM.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { SAMPLE_MESSAGES, SAMPLE_WRITES, sampleDecision, sampleMeal } from '../../shared/write-registry/samples.ts';
import { CANNED_SAFETY, REQUIRED_SAFETY_LINE, scanTripwires } from '../../shared/safety-tripwires.ts';
import { validateDecision } from '../../shared/write-registry/mod.ts';
import { STAGE_A_MIN_REPAIR_MS } from './budgets.ts';
import { clientLive, clientReload, V1_KEYS } from './client-parsers.test.ts';
import { coachModel } from './coach.ts';
import { quotaClassOf } from './commit.ts';
import type { CommitResult, PostcheckOutput, PostcheckPort } from './contracts.ts';
import { COACH_UNAVAILABLE_TR, RECEIPTS_BELOW_TR, SAFE_FALLBACK_VARIANTS, SUGGESTION_UNVERIFIED_LINE } from './guarantees.ts';
import {
  actionsExecutedOf, BUSY_LINE, buildRepairRequest, extraFactLines, handleV2Turn, honestCrashResponse, honestFallbackText, newTurnState,
  NOTHING_TO_UNDO_LINE, receiptFactLines, STAGE_A_FAILED_LINE, STAGE_B_FAILED_HELD_LINE, STAGE_B_FAILED_LINE, STAGE_B_FAILED_WRITTEN_HELD_LINE,
  undoTargetOf, v1OnlyReason, type TurnState,
} from './handler.ts';
import { turnRefs, validationContext } from './input.ts';
// The owner's §7.2 budgets live in stage-a-request.ts (a tuning branch moves them): imported, never hard-coded.
import { STAGE_A_LIVE_BUDGETS_MS } from './stage-a-request.ts';
import { emptyPostcheckLog } from './postcheck.ts';
import { NOW, OTHER, USER } from './testing.ts';
import {
  chatRequest, coachReply, DEFAULT_COACH_TEXT, failedOutcome, fakeAdapter, fakeCommitPorts, fakeDeps, ledgerRow, parsedOutcome, providerError,
  seededTurnInput,
} from './turn-testing.ts';
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

/** The final user turn Stage B was sent (facts + message), from the HTTP body over the fake transport. */
function stageBUser(body: Record<string, unknown>): string {
  const msgs = body.input as { role: string; content: string }[];
  return msgs.filter((m) => m.role === 'user').at(-1)!.content;
}
const countOf = (s: string, sub: string) => s.split(sub).length - 1;
const coachRowOf = (t: { rec: { turnLogs: Record<string, unknown>[] } }) => t.rec.turnLogs.find((r) => r.stage === 'coach')!;
const issueCodes = (row: Record<string, unknown>) => (row.issues as Array<{ code: string }>).map((i) => i.code);
const postcheckOutcome = (row: Record<string, unknown>) => (row.issues as Array<{ code: string; value?: unknown }>).find((i) => i.code === 'postcheck')?.value;

/** An ambiguous emergency trigger read POSITIVE by Stage A (the protective route). */
function positiveFaint(): { msg: string; decision: Record<string, unknown> } {
  const msg = 'antrenmanda bayıldım';
  const hit = scanTripwires(msg).hits[0].hit_id;
  return {
    msg,
    decision: sampleDecision({
      safety: { acute_medical: true, self_harm: false, ed_signal: null, tripwire_readings: [{ hit_id: hit, reading: 'positive', reason: 'gerçek bayılma' }] },
      intent: { primary: 'report', is_hypothetical: false, about_other_person: false },
    }),
  };
}

// ─── the ordinary turn ───────────────────────────────────────────────────────────────────────────

Deno.test('meal log end to end: Stage A → commit → the REAL Stage B over the transport → T7 → envelope → T9', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim', idempotency_key: 'k1', session_id: 'sess-1' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })) });
  assertEquals(t.out.kind, 'response');
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_meal_apply']);
  // Stage B saw what was really written — as DATA, rendered ONCE by facts.ts (contracts.ts userState).
  assertEquals(t.rec.coachInputs.length, 1);
  const ci = t.rec.coachInputs[0];
  assertEquals(ci.commit.receipts[0].ok, true);
  assertEquals(ci.tripwire.kind, 'normal');
  assertEquals(ci.userState, [], 'no extra facts this turn — never a second, pre-commit copy of profile/targets/constraints');
  const user = stageBUser(t.rec.coachCalls[0]);
  assertEquals(countOf(user, 'KULLANICI DURUMU'), 1);
  assertEquals(countOf(user, '\nProfil: '), 1, 'the profile appears once');
  assertEquals(countOf(user, 'Kısıtlar:'), 1, 'the constraints appear once');
  assert(!user.includes('PROFİL:') && !user.includes('BUGÜNKÜ HEDEF:'), 'the old handler-rendered duplicate block is gone');
  assertStringIncludes(user, '- KAYDEDİLDİ: Öğün kaydedildi — ');
  assertStringIncludes(user, '(bu turdaki kayıtlar dahil)', 'today\'s number includes this turn (§8.2, one target function)');
  assertEquals(t.rec.judgeCalls.length, 1, 'the seed user has a severe allergy: the luna judge read the reply');
  // the envelope the app reads today
  const env = t.env!;
  assertEquals(env.message, DEFAULT_COACH_TEXT);
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
  assertEquals(p.taskMode, env.task_mode, 'one task_mode: the envelope\'s');
  assertEquals(p.model, coachModel(), 'the reply row names the Stage B model');
  assertEquals(p.actionsExecuted?.[0].type, 'meal_log', 'v1 [{type}] readers keep working');
  assertEquals(p.actionsExecuted?.[0].ok, true);
  assertEquals(p.codeNotes, null, 'nothing appended by code');
  assertEquals(t.rec.links, [`${t.state.turnId}:asst-1`]);
  assertEquals(t.rec.turnLogs.map((r) => r.stage), ['understand', 'commit', 'coach']);
  assertEquals(t.rec.turnLogs.every((r) => r.pipeline === 'v2' && r.turn_id === t.state.turnId), true);
  const coach = coachRowOf(t);
  assertEquals(coach.function_name, 'ai-chat', 'the reply row keeps the function name scenarios.mjs pairs on');
  assertEquals([coach.model_requested, coach.finish_reason, coach.prompt_tokens], [coachModel(), 'first', 9000]);
  assert(!issueCodes(coach).some((c) => c.startsWith('guarantee')), 'the default port kept its contract: the code-owned step added nothing');
  assert(t.rec.turnLogs[0].decision !== null, 'the understand row stores the decision');
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'side_effects', 'commit']);
  assertEquals(t.state.sideEffects, true);
});

Deno.test('a conversation turn (no write) reports the server remaining count; quota class conversation', async () => {
  const t = await turn({ message: 'günde 3 litre su içmem gerekiyor mu?' }, { stageA: parsed(sampleDecision({ intent: { primary: 'question', is_hypothetical: false, about_other_person: false } })) });
  assertEquals(t.env!.remaining, 41);
  assertEquals(t.env!.task_mode, 'qa');
  assertEquals(t.rec.persisted[0].quotaClass, 'conversation');
  assertEquals(t.commit.rpcCalls.length, 0);
});

Deno.test('water day total: w_water_apply in set_day_total mode; Stage B is told the new day total from code (§8.2)', async () => {
  const dayTotal = w('water_log', { quantity: 2, unit: 'litre', as_stated: 'bugün toplam 2 litre', mode: 'set_day_total' });
  const t = await turn({ message: 'bugün toplam 2 litre su içtim' }, { stageA: parsed(sampleDecision({ writes: [dayTotal] })), coach: () => coachReply('Günün suyu 2 litre oldu, güzel gidiyorsun.') });
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_water_apply']);
  const payload = t.commit.rpcCalls[0].args.p_payload as Record<string, unknown>;
  assertEquals([payload.mode, payload.liters], ['set_day_total', 2]);
  assertStringIncludes(stageBUser(t.rec.coachCalls[0]), 'su 2,00 / 2,5 L', 'the day total is computed by code, not left to the model');
  assertEquals(t.env!.actions[0].type, 'water_log');
  assertEquals(t.env!.message, 'Günün suyu 2 litre oldu, güzel gidiyorsun.');
  assertEquals(t.rec.persisted[0].quotaClass, 'record');
});

Deno.test('correction by ref: record_update m1 → the patch through w_meal_apply replacing that record; Stage B speaks from the receipt', async () => {
  const decision = sampleDecision({ intent: { primary: 'correction', is_hypothetical: false, about_other_person: false }, record_ops: [w('record_update', { ref: 'm1' })] });
  const t = await turn({ message: SAMPLE_MESSAGES.record_update }, { stageA: parsed(decision), coach: () => coachReply('Düzelttim: o akşamki nugget artık ~290 kcal.') });
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_meal_apply']);
  assertEquals((t.commit.rpcCalls[0].args.p_payload as Record<string, unknown>).replaces, 'm7', 'the persistent ref, never the turn token');
  const receipt = t.rec.coachInputs[0].commit.receipts[0];
  assertEquals(receipt.ok, true);
  assertStringIncludes(receipt.user_line ?? '', 'Kayıt düzeltildi');
  assertStringIncludes(stageBUser(t.rec.coachCalls[0]), '- KAYDEDİLDİ: Kayıt düzeltildi');
  assertEquals(t.env!.receipts?.[0].ok, true);
  assertEquals(t.env!.task_mode, 'register');
  assertEquals(t.env!.message, 'Düzelttim: o akşamki nugget artık ~290 kcal.');
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

Deno.test('explicit tripwire → today’s canned reply at once: no Stage A, no Stage B, no reservation; facts salvaged later (spine only)', async () => {
  const msg = 'kendimi öldürmek istiyorum, fıstık alerjim var zaten, hiçbir şey yemiyorum';
  const salvageDecision = sampleDecision({
    writes: [
      { op: 'constraint_add', kind: 'allergen', subject_id: 'peanut', display_tr: 'fıstık', whose: 'self', polarity: 'has', severity: 'unknown', body_parts: [], event_date: null, note: null, evidence_quote: 'fıstık alerjim var' },
      sampleMeal(),
    ],
  });
  const t = await turn({ message: msg }, { stageA: parsed(salvageDecision) });
  assertEquals(t.env!.task_mode, 'safety');
  assertEquals(t.env!.message, CANNED_SAFETY.self_harm.message);
  assertStringIncludes(t.env!.message, '112');
  assertEquals(t.env!.actions, []);
  assertEquals(t.rec.understandReqs.length, 0, 'no LLM before the reply');
  assertEquals(t.rec.coachCalls.length, 0);
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
  assertEquals(t.rec.coachInputs.length, 0);
});

Deno.test('ambiguous ED trigger + Stage A failure → honest line + the ED referral appended; the tier is escalated (fallback path only)', async () => {
  const t = await turn({ message: 'aç kalmak istiyorum' }, { stageA: (req) => failedOutcome(req) });
  assert(t.env!.message.startsWith(STAGE_A_FAILED_LINE));
  assertStringIncludes(t.env!.message, 'uzman');
  assertEquals(t.rec.edSignals, ['medium']);
});

Deno.test('ambiguous trigger read POSITIVE → the protective route (crisis contract, 112 guaranteed by code, no judge latency)', async () => {
  const { msg, decision } = positiveFaint();
  const t = await turn({ message: msg }, { stageA: parsed(decision), coach: () => coachReply('Geçmiş olsun. Şu an nasılsın, yanında biri var mı?') });
  assertEquals(t.rec.coachInputs[0].tripwire.kind, 'protective');
  assertStringIncludes(stageBUser(t.rec.coachCalls[0]), '## Bu turun sözleşmesi: acil durum');
  assertEquals(t.rec.judgeCalls.length, 0, 'a crisis turn is never held up by the judge');
  assert(t.env!.message.startsWith('Geçmiş olsun. Şu an nasılsın, yanında biri var mı?'), 'the coach\'s words first, untouched');
  assert(t.env!.message.endsWith(REQUIRED_SAFETY_LINE.emergency), 'the 112 line LAST');
  assertEquals(t.rec.persisted[0].codeNotes, [{ kind: 'emergency', text: REQUIRED_SAFETY_LINE.emergency }]);
  assertEquals(t.env!.task_mode, 'emergency');
  assertEquals(coachRowOf(t).guard_verdict, 'emergency');
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

// ─── T4 budgets per class (owned by stage-a-request.ts; imported, never hard-coded) ──────────────

Deno.test('Stage A budget per class: an ordinary turn waits the normal budget, a turn with a tripwire fact the tripwire budget', async () => {
  const ordinary = await turn({ message: '2 dilim lahmacun yedim' }, { stageA: (req) => failedOutcome(req, 'timeout') });
  assertEquals(ordinary.rec.understandReqs[0].timeoutMs, STAGE_A_LIVE_BUDGETS_MS.normal);
  assertEquals(ordinary.env!.message, STAGE_A_FAILED_LINE, 'late on an ordinary turn: honest "nothing recorded"');
  const tripwire = await turn({ message: 'antrenmanda bayıldım' }, { stageA: (req) => failedOutcome(req, 'timeout') });
  assertEquals(tripwire.rec.understandReqs[0].timeoutMs, STAGE_A_LIVE_BUDGETS_MS.tripwire);
  assertEquals(tripwire.env!.message, CANNED_SAFETY.emergency.message, 'late on a live trigger: today\'s canned protection');
  const declaration = await turn({ message: 'fıstık alerjim var' }, { stageA: parsed(sampleDecision()) });
  assertEquals(declaration.rec.understandReqs[0].timeoutMs, STAGE_A_LIVE_BUDGETS_MS.tripwire, 'a declaration cue is a tripwire fact too (the effort rule\'s same certain fact)');
  assert(STAGE_A_LIVE_BUDGETS_MS.tripwire > STAGE_A_LIVE_BUDGETS_MS.normal, 'the safety turns wait longer, still fail-closed');
});

Deno.test('a parsed Stage A past the tripwire budget on a live-trigger turn is a timeout (canned); on time its reading counts; an ordinary late answer is used', async () => {
  const { msg, decision } = positiveFaint();
  const late = await turn({ message: msg }, { stageA: (req) => parsedOutcome(decision, req, {}, STAGE_A_LIVE_BUDGETS_MS.tripwire + 1) });
  assertEquals(late.rec.coachInputs.length, 0);
  assertEquals(late.env!.message, CANNED_SAFETY.emergency.message);
  assertEquals(late.rec.turnLogs.find((r) => r.stage === 'tripwire')?.finish_reason, 'fallback:emergency');
  assertEquals(late.commit.rpcCalls.length, 0);
  const onTime = await turn({ message: msg }, { stageA: (req) => parsedOutcome(decision, req, {}, STAGE_A_LIVE_BUDGETS_MS.tripwire - 1), coach: () => coachReply('Geçmiş olsun, şu an güvende misin?') });
  assertEquals(onTime.rec.coachInputs[0].tripwire.kind, 'protective', 'a reading inside the owner\'s budget is never thrown away');
  const slow = await turn({ message: '6 tavuk nugget yedim' }, { stageA: (req) => parsedOutcome(sampleDecision({ writes: [sampleMeal()] }), req, {}, STAGE_A_LIVE_BUDGETS_MS.normal + 500) });
  assertEquals(slow.commit.rpcCalls.map((c) => c.name), ['w_meal_apply'], 'no safety question hangs on an ordinary turn\'s latency');
});

Deno.test('on a tripwire turn the ONE repair shares the class budget; with too little left it is skipped (the original stands)', async () => {
  const msg = 'antrenmanda bayıldım, sonra bir termos su içtim';
  const hit = scanTripwires(msg).hits[0].hit_id;
  const safety = { acute_medical: true, self_harm: false, ed_signal: null, tripwire_readings: [{ hit_id: hit, reading: 'positive', reason: 'gerçek' }] };
  const bad = sampleDecision({ safety, writes: [w('water_log', { unit: 'other', other_ml_each: null, as_stated: 'bir termos' })] });
  const good = sampleDecision({ safety, writes: [w('water_log', { unit: 'other', other_ml_each: 500, as_stated: 'bir termos' })] });
  const budget = STAGE_A_LIVE_BUDGETS_MS.tripwire;
  const shared = await turn({ message: msg }, { stageA: (req, n) => parsedOutcome(n === 1 ? bad : good, req, {}, 2_000), coach: () => coachReply('Geçmiş olsun.') });
  assertEquals(shared.rec.understandReqs.map((r) => r.timeoutMs), [budget, budget - 2_000]);
  const spent = await turn({ message: msg }, { stageA: (req, n) => parsedOutcome(n === 1 ? bad : good, req, {}, budget - STAGE_A_MIN_REPAIR_MS + 1), coach: () => coachReply('Geçmiş olsun.') });
  assertEquals(spent.rec.understandReqs.length, 1, 'no repair started without time to finish');
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
  // A live request also names its §7.2 budget class (tuning round 3, understand.ts UnderstandRequest).
  const req = {
    model: 'm', effort: 'low' as const, system: 's', input: [{ role: 'user' as const, content: 'u' }], schema: { name: 'n', schema: {}, strict: true as const },
    cache_key: 'c', max_tokens: 10, timeoutMs: 1, sizes: { prefix: 1, turn_input: 1, tripwires: 0, message: 1 },
    liveBudgetMs: STAGE_A_LIVE_BUDGETS_MS.normal, budgetClass: 'normal' as const,
  };
  const r = buildRepairRequest(req, { x: 1 }, a, 777);
  assertEquals(r.timeoutMs, 777);
  assertStringIncludes(r.input[1].content, 'other_ml_each');
});

Deno.test('plan action (Faz 4) → the turn goes to v1 before ANY write; cleanup releases journal + reservation', async () => {
  const decision = sampleDecision({ plan_action: { op: 'generate', plan_type: 'diet', draft_ref: null }, writes: [w('water_log')] });
  const t = await turn({ message: 'bana haftalık diyet planı yap, bu arada 1 bardak su içtim', idempotency_key: 'k3' }, { stageA: parsed(decision) });
  assertEquals(t.out.kind, 'fallback_v1');
  if (t.out.kind === 'fallback_v1') assertEquals(t.out.reason, 'plan_action:generate');
  assertEquals(t.commit.rpcCalls.length, 0);
  assertEquals(t.rec.coachCalls.length, 0, 'no Stage B for a turn v1 answers');
  assertEquals(t.rec.persisted.length, 0);
  assertEquals(t.state.sideEffects, false);
  for (const job of t.state.cleanup) await job();
  assertEquals(t.rec.released, ['res-1']);
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'fail']);
  assertEquals(t.rec.turnLogs.map((r) => r.stage), ['understand'], 'the Stage A row is kept for the shadow comparison');
});

Deno.test('a retried key whose side effects already ran writes nothing again (exactly-once)', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim', idempotency_key: 'k4' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), sideEffectsClaim: false });
  assertEquals(t.commit.rpcCalls.length, 0);
  assert(t.rec.coachInputs[0].commit.flags.some((f) => f.code === 'retry_side_effects_skipped'));
});

// ─── severe allergy declaration ──────────────────────────────────────────────────────────────────

Deno.test('severe allergy declared this turn: written to the spine AND protects this very reply (a suggestion hitting it is regenerated)', async () => {
  const declare = w('constraint_add', { subject_id: 'sesame', display_tr: 'susam', evidence_quote: 'susam alerjim var' });
  const simit = coachReply('Akşama susamlı simit yiyebilirsin.', { suggested_foods: [{ name: 'susamlı simit', allergens: ['sesame', 'gluten'], may_contain: [] }] });
  const soup = coachReply('Akşama mercimek çorbası iyi gider.', { suggested_foods: [{ name: 'mercimek çorbası', allergens: [], may_contain: [] }] });
  const t = await turn({ message: 'susam alerjim var, ciddi. akşam ne yiyeyim?' }, { stageA: parsed(sampleDecision({ writes: [declare] })), coach: (n) => (n === 1 ? simit : soup) });
  assertEquals(t.rec.understandReqs[0].timeoutMs, STAGE_A_LIVE_BUDGETS_MS.tripwire, 'a declaration cue: the tripwire budget class');
  assertEquals(t.commit.adapter.calls.map((c) => c.op), ['constraint_add']);
  assertEquals(t.commit.adapter.calls[0].row.subject_id, 'sesame');
  assertEquals(t.rec.coachCalls.length, 2, 'exactly ONE regen');
  const regen = t.rec.coachCalls[1].input as { role: string; content: string }[];
  assertStringIncludes(regen.at(-1)!.content, 'susamlı simit (susam alerjisi)', 'the regen names the excluded item');
  assertEquals(t.env!.message, 'Akşama mercimek çorbası iyi gider.');
  assertEquals(postcheckOutcome(coachRowOf(t)), 'regen');
});

Deno.test('severe allergy declared + a meal with it in the same turn → the exposure acknowledgement is guaranteed by code', async () => {
  const declare = w('constraint_add', { subject_id: 'sesame', display_tr: 'susam', evidence_quote: 'susam alerjim var' });
  const meal = sampleMeal([{ name: 'simit', allergens: ['sesame', 'gluten'], may_contain: [] }], { raw: 'öğlen simit yedim', meal_type: 'lunch' });
  const t = await turn({ message: 'susam alerjim var, ciddi. öğlen simit yedim' }, { stageA: parsed(sampleDecision({ writes: [declare, meal] })), coach: () => coachReply('Kaydettim, afiyet olsun!') });
  assertEquals(t.rec.coachInputs[0].commit.exposures.map((e) => e.allergens), [['sesame', 'susam']], 'the same-turn declaration is in the spine the exposure check reads');
  assert(t.env!.message.startsWith('Kaydettim, afiyet olsun!'));
  assertStringIncludes(t.env!.message, 'profilinde ciddi susam alerjisi kayıtlı ve kaydettiğin öğün susam içeriyor', 'one label per allergen');
  assertEquals(t.rec.persisted[0].codeNotes?.map((n) => n.kind), ['allergen_exposure']);
  assertEquals(coachRowOf(t).guard_verdict, 'allergen_warned');
});

// ─── T6/T7: the suggestion invariant (postcheck port) ────────────────────────────────────────────

const peanutToast = coachReply('Akşama fıstık ezmeli tost yapabilirsin.', { suggested_foods: [{ name: 'fıstık ezmeli tost', allergens: ['peanut'], may_contain: [] }], why: 'protein' });
const yogurt = coachReply('Akşama yoğurtlu meyve iyi gider.', { suggested_foods: [{ name: 'yoğurtlu meyve', allergens: ['milk'], may_contain: [] }] });

Deno.test('suggestion invariant: a severe-allergen suggestion → ONE regen naming it; the clean regen is what the user gets', async () => {
  const t = await turn({ message: 'akşam ne yiyeyim?' }, { stageA: parsed(sampleDecision()), coach: (n) => (n === 1 ? peanutToast : yogurt) });
  assertEquals(t.rec.coachInputs.length, 2, 'exactly one regen, through the coach port');
  const regen = t.rec.coachCalls[1].input as { role: string; content: string }[];
  assertEquals(regen.at(-1)!.role, 'system');
  assertStringIncludes(regen.at(-1)!.content, 'DENETİM NOTU');
  assertStringIncludes(regen.at(-1)!.content, 'fıstık ezmeli tost (fıstık alerjisi)');
  assertEquals(t.env!.message, 'Akşama yoğurtlu meyve iyi gider.');
  assertEquals(postcheckOutcome(coachRowOf(t)), 'regen');
});

Deno.test('suggestion invariant: still violating after the regen → the safe fallback (receipts kept, no memory from the bad reply)', async () => {
  const bad = coachReply('Squat ve fıstık ezmesi!', {
    suggested_foods: [{ name: 'fıstık ezmesi', allergens: [], may_contain: [] }],
    suggested_exercises: [{ name: 'squat', loads: ['knee'] }],
    memory: [SAMPLE_WRITES.memory_note],
  });
  const t = await turn({ message: '6 tavuk nugget yedim, sonra ne yapayım?' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), coach: () => bad });
  assertEquals(t.rec.coachInputs.length, 2);
  assert(t.env!.message.startsWith('Bu turdaki kaydın yerinde. '), 'what was written is still said');
  assertStringIncludes(t.env!.message, SAFE_FALLBACK_VARIANTS[0]('fıstık alerjin ve diz sakatlığın'));
  assert(!t.env!.message.includes('fıstık ezmesi') && !t.env!.message.includes('Squat'));
  assertEquals(t.env!.actions[0].type, 'meal_log');
  assertEquals(postcheckOutcome(coachRowOf(t)), 'safe_fallback');
  for (const job of t.rec.jobs) await job();
  assertEquals(t.commit.adapter.calls.filter((c) => c.op === 'memory_note').length, 0, 'the rejected reply’s memory is not committed');
});

Deno.test('suggestion invariant on a PROTECTIVE turn: the canned safety reply (with 112), never a coaching fallback', async () => {
  const { msg, decision } = positiveFaint();
  const t = await turn({ message: msg }, { stageA: parsed(decision), coach: () => peanutToast });
  assertEquals(t.env!.message, CANNED_SAFETY.emergency.message);
  assert(!t.env!.message.includes('fıstık'));
  assertEquals(postcheckOutcome(coachRowOf(t)), 'crisis_canned');
});

Deno.test('suggestion invariant: an unreadable spine never lets a suggestion out (honest "could not check" line, no regen)', async () => {
  const ti = await seededTurnInput();
  ti.load_errors.push({ section: 'constraints', message: 'timeout' });
  const t = await turn({ message: 'akşam ne yiyeyim?' }, { turnInput: ti, stageA: parsed(sampleDecision()), coach: () => yogurt });
  assertEquals(t.rec.coachInputs.length, 1, 'no regen: it could not be verified either');
  assertEquals(t.env!.message, SUGGESTION_UNVERIFIED_LINE);
});

// ─── T7: the code-owned lines survive ANY post-check port ────────────────────────────────────────

/** A post-check port that drops every line and claims the model's reply went out as is. */
const droppingPort = (text = 'Tamam.'): PostcheckPort => () =>
  Promise.resolve({ reply: coachReply(text), codeNotes: [], codeAuthored: false, log: emptyPostcheckLog('first') });

Deno.test('an injected post-check that drops the 112 line: the handler appends it LAST (protective route)', async () => {
  const { msg, decision } = positiveFaint();
  const t = await turn({ message: msg }, { stageA: parsed(decision), postcheck: droppingPort() });
  assertEquals(t.env!.message, `Tamam.\n\n${REQUIRED_SAFETY_LINE.emergency}`);
  assertEquals(t.rec.persisted[0].codeNotes, [{ kind: 'emergency', text: REQUIRED_SAFETY_LINE.emergency }]);
  assert(issueCodes(coachRowOf(t)).includes('guarantee_line:emergency'), 'ai_turn_log shows the port broke its contract');
});

Deno.test('an injected post-check that drops the ED referral: the handler appends it (the model flag never stands in)', async () => {
  const msg = 'aç kalmak istiyorum';
  const hit = scanTripwires(msg).hits[0].hit_id;
  const decision = sampleDecision({ safety: { acute_medical: false, self_harm: false, ed_signal: null, tripwire_readings: [{ hit_id: hit, reading: 'positive', reason: 'kısıtlama' }] } });
  const port: PostcheckPort = () => Promise.resolve({ reply: coachReply('Yanındayım.', { referral_included: true }), codeNotes: [], codeAuthored: false, log: emptyPostcheckLog('first') });
  const t = await turn({ message: msg }, { stageA: parsed(decision), postcheck: port });
  assertEquals(t.rec.coachInputs[0].tripwire.kind, 'protective');
  assertEquals(t.env!.message, `Yanındayım.\n\n${REQUIRED_SAFETY_LINE.ed}`);
  assertEquals(t.rec.persisted[0].codeNotes?.map((n) => n.kind), ['referral']);
});

Deno.test('an injected post-check that drops the safety-hold question (KVKK erase, allergy removal): the template is appended LAST', async () => {
  const erase = await turn({ message: SAMPLE_MESSAGES.data_erase_request }, { stageA: parsed(sampleDecision({ writes: [w('data_erase_request')] })), postcheck: droppingPort('Anladım. Bugün nasılsın?') });
  assertEquals(erase.commit.adapter.eraseHolds, ['memory']);
  assert(erase.env!.message.startsWith('Anladım. Bugün nasılsın?'), 'nothing removed');
  assertStringIncludes(erase.env!.message, 'Emin olmak için soruyorum');
  assertEquals(erase.rec.persisted[0].codeNotes?.map((n) => n.kind), ['safety_hold']);
  const retract = { op: 'constraint_retract', target: 'c1', evidence_quote: 'fıstık alerjim geçti', note: null };
  const t = await turn({ message: 'fıstık alerjim geçti artık' }, { stageA: parsed(sampleDecision({ writes: [retract] })), postcheck: droppingPort('Ne güzel! Kaç kalori aldın bugün?') });
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['v2_hold_open']);
  const hold = t.rec.coachInputs[0].commit.holds[0];
  assertEquals(hold.hold_class, 'safety');
  assert(t.env!.message.endsWith(hold.question_tr), 'an unrelated "?" never stands in for the hold question');
  assertEquals(t.rec.persisted[0].codeNotes?.at(-1), { kind: 'safety_hold', text: hold.question_tr });
});

Deno.test('an injected post-check that drops the allergen-exposure acknowledgement: the handler appends it', async () => {
  const meal = sampleMeal([{ name: 'fıstık ezmeli tost', allergens: ['gluten', 'peanut'], may_contain: [] }]);
  const t = await turn({ message: 'fıstık ezmeli tost yedim' }, { stageA: parsed(sampleDecision({ writes: [meal] })), postcheck: droppingPort('Afiyet olsun!') });
  assertEquals(t.rec.coachInputs[0].commit.exposures[0].allergens, ['fıstık']);
  assert(t.env!.message.startsWith('Afiyet olsun!\n\n⚠️ Dikkat: profilinde ciddi fıstık alerjisi'));
  assertEquals(t.rec.persisted[0].codeNotes?.map((n) => n.kind), ['allergen_exposure']);
});

Deno.test('a post-check port that throws, or answers nonsense: the code\'s own reply, every code-owned line kept', async () => {
  const boom: PostcheckPort = () => { throw new Error('port bug'); };
  const t = await turn({ message: SAMPLE_MESSAGES.data_erase_request }, { stageA: parsed(sampleDecision({ writes: [w('data_erase_request')] })), postcheck: boom });
  assert(t.env!.message.startsWith(COACH_UNAVAILABLE_TR));
  assertStringIncludes(t.env!.message, 'Emin olmak için soruyorum');
  assert(issueCodes(coachRowOf(t)).includes('postcheck_failed'));
  const junk = (() => Promise.resolve({ reply: null, codeNotes: 'x' } as unknown as PostcheckOutput)) as PostcheckPort;
  const j = await turn({ message: '6 tavuk nugget yedim' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), postcheck: junk });
  assertEquals(j.env!.message, `${RECEIPTS_BELOW_TR} ${COACH_UNAVAILABLE_TR}`);
  assert(issueCodes(coachRowOf(j)).includes('postcheck_invalid'));
});

Deno.test('a post-check port that lets a violating suggestion through: the handler\'s structural re-check replaces it', async () => {
  const leaky: PostcheckPort = (p) => Promise.resolve({ reply: p.first.reply!, codeNotes: [], codeAuthored: false, log: emptyPostcheckLog('first') });
  const t = await turn({ message: 'akşam ne yiyeyim?' }, { stageA: parsed(sampleDecision()), coach: () => peanutToast, postcheck: leaky });
  assert(!t.env!.message.includes('fıstık ezmeli tost'));
  assertStringIncludes(t.env!.message, SAFE_FALLBACK_VARIANTS[0]('fıstık alerjin ve diz sakatlığın'));
  assert(issueCodes(coachRowOf(t)).includes('guarantee_suggestion_violation'));
  assert(!t.env!.message.includes('<reasoning>protein'), 'nothing of the rejected draft (its why) reaches the screen');
});

// ─── T6/T7: Stage B failures and holds ───────────────────────────────────────────────────────────

Deno.test('Stage B failure after the writes → an honest code reply; the receipts are the badges (never a claim beyond them)', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim' }, { stageA: parsed(sampleDecision({ writes: [sampleMeal()] })), coach: () => providerError() });
  assertEquals(t.env!.message, `${RECEIPTS_BELOW_TR} ${COACH_UNAVAILABLE_TR}`);
  assertEquals(t.env!.actions[0].type, 'meal_log');
  assertEquals(coachRowOf(t).finish_reason, 'coach_failed');
  assert(String(coachRowOf(t).fallback_reason).startsWith('first:error'));
});

Deno.test('Stage B failure on a holds-only turn: never "kaydedildi" — nothing saved yet, the hold question follows', async () => {
  const decision = sampleDecision({ writes: [w('water_log', { quantity: 2, unit: 'litre', as_stated: '2 litre' })] });
  const t = await turn({ message: '2 litre su içtim' }, { stageA: parsed(decision), coach: () => providerError() });
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['v2_hold_open']);
  assert(t.env!.message.startsWith(COACH_UNAVAILABLE_TR));
  assert(!t.env!.message.includes('kaydedildi'));
  assert(t.env!.message.trimEnd().endsWith('?'), 'the hold question is asked by code (nobody else will)');
  assertEquals(t.env!.actions, []);
  assertEquals(t.rec.persisted[0].quotaClass, 'record', 'a hold is a stored decision, not idle chat');
});

Deno.test('Stage B failure when a hold could not even be stored: the reject is said (no receipt existed for it)', async () => {
  const ports = fakeCommitPorts({ rpc: (name) => (name === 'v2_hold_open' ? { ok: false, op: 'hold_open', failure_class: 'write_failed', detail: {} } : undefined) });
  const decision = sampleDecision({ writes: [w('water_log', { quantity: 2, unit: 'litre', as_stated: '2 litre' })] });
  const t = await turn({ message: '2 litre su içtim' }, { stageA: parsed(decision), commit: ports, coach: () => providerError() });
  assertStringIncludes(t.env!.message, 'Su kaydedilmedi: onay sorusunu kaydedemedim');
  assert(t.env!.message.startsWith(COACH_UNAVAILABLE_TR));
});

Deno.test('KVKK erase request with the default port → the hold + its fixed question appended LAST by code', async () => {
  const t = await turn({ message: SAMPLE_MESSAGES.data_erase_request }, { stageA: parsed(sampleDecision({ writes: [w('data_erase_request')] })), coach: () => coachReply('Tamam, bunu konuşalım.') });
  assertEquals(t.commit.adapter.eraseHolds, ['memory']);
  assert(t.env!.message.startsWith('Tamam, bunu konuşalım.'));
  assertStringIncludes(t.env!.message, 'Emin olmak için soruyorum');
  assertEquals(t.rec.persisted[0].codeNotes?.map((n) => n.kind), ['safety_hold']);
  assert(!issueCodes(coachRowOf(t)).some((c) => c.startsWith('guarantee')), 'the default port appended it itself');
  assertEquals(t.rec.persisted[0].quotaClass, 'record');
});

Deno.test('memory[] from Stage B is validated and written in the background (memory_note via the adapter)', async () => {
  const t = await turn({ message: 'akşam yine tatlı yedim' }, { stageA: parsed(sampleDecision()), coach: () => coachReply('Anlıyorum.', { memory: [SAMPLE_WRITES.memory_note] }) });
  assertEquals(t.rec.jobs.length, 1);
  await t.rec.jobs[0]();
  assertEquals(t.commit.adapter.calls.map((c) => c.op), ['memory_note']);
});

// ─── T8: the envelope against the client ─────────────────────────────────────────────────────────

Deno.test('envelope snapshot: v1 key order, legacy badges, receipts, reasoning — read by the client\'s OWN parsers, live and after reload', async () => {
  const t = await turn({ message: '6 tavuk nugget yedim' }, {
    stageA: parsed(sampleDecision({ writes: [sampleMeal()] })),
    coach: () => coachReply('Afiyet olsun! ~320 kcal saydım.', { why: 'akşam proteini düşük kaldı', ui: { navigate_to: '/plan/diet', task_completion_summary: null } }),
  });
  const env = t.env!;
  const line = t.rec.coachInputs[0].commit.receipts[0].user_line!;
  assertEquals(line, 'Öğün kaydedildi — tavuk nugget (6 adet) ~320 kcal · toplam 320 kcal');
  assertEquals(Object.keys(env), V1_KEYS, 'same keys, same order as v1 responseData');
  assertEquals(JSON.stringify(env), JSON.stringify({
    message: 'Afiyet olsun! ~320 kcal saydım.\n<reasoning>akşam proteini düşük kaldı</reasoning>',
    actions: [{ type: 'meal_log', feedback: line, confidence: 'medium' }],
    receipts: [{ action_type: 'meal_log', ok: true, rows_affected: 1, user_line: line, failure_class: null }],
    assistant_message_id: 'asst-1',
    task_mode: 'register',
    task_completion: null,
    plan_snapshot: null,
    plan_draft_id: null,
    plan_type: null,
    plan_reasoning: null,
    plan_persist_error: null,
    plan_approved: null,
    navigate_to: '/plan/diet',
    simulation: null,
    remaining: -1,
  }));
  const live = clientLive(env);
  assertEquals([live.visible, live.reasoning, live.hasPlanSuggestion, live.simulationData], ['Afiyet olsun! ~320 kcal saydım.', 'akşam proteini düşük kaldı', false, null]);
  // T9 stores exactly the envelope message: the history reload shows the same text and "Neden?".
  const stored = t.rec.persisted[0].assistantMessage;
  assertEquals(stored, env.message);
  const reload = clientReload(stored, t.rec.persisted[0].taskMode);
  assertEquals([reload.visible, reload.reasoning, reload.hasPlan], [live.visible, live.reasoning, false]);
});

Deno.test('envelope: the code-owned lines are the LAST visible lines, also through the client parser', async () => {
  const meal = sampleMeal([{ name: 'fıstık ezmeli tost', allergens: ['gluten', 'peanut'], may_contain: [] }]);
  const t = await turn({ message: 'fıstık ezmeli tost yedim' }, { stageA: parsed(sampleDecision({ writes: [meal] })), coach: () => coachReply('Afiyet olsun!', { why: 'kayıt' }) });
  const live = clientLive(t.env!);
  assert(live.visible.startsWith('Afiyet olsun!\n\n⚠️ Dikkat:'), live.visible);
  assert(live.visible.endsWith("112'yi ara."), 'the reaction line is the end of what the user reads');
  assertEquals(live.reasoning, 'kayıt');
});

Deno.test('T1 facts: an onboarding card hint and an accepted nudge reach Stage B as EXTRA facts; the nudge is stamped after the reply', async () => {
  const f = fakeDeps({ stageA: parsed(sampleDecision()) });
  const stamped: string[] = [];
  f.deps.nudge = { read: () => Promise.resolve({ content: 'Yarın 20 dk yürüyüş yapalım mı?' }), stamp: (_u, id) => { stamped.push(id); return Promise.resolve(); } };
  const applied: string[] = [];
  f.deps.afterCommit = (p) => { applied.push(...p.applied.map((a) => a.op)); return Promise.resolve(); };
  await handleV2Turn(chatRequest({ message: 'tamam yaparım', task_mode_hint: 'onboarding_activity', accepted_nudge_id: 'n1' }), USER, f.deps, newTurnState());
  assertEquals(f.rec.coachInputs[0].userState, [
    'TANIŞMA KARTI: kullanıcı "onboarding_activity" kartından yazıyor',
    'KABUL EDİLEN TEKLİF (bu turda): "Yarın 20 dk yürüyüş yapalım mı?"',
  ]);
  const user = stageBUser(f.rec.coachCalls[0]);
  assert(user.indexOf('EK OLGULAR') > user.indexOf('KULLANICI DURUMU'), 'rendered by facts.ts as the EXTRA block');
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

Deno.test('undo button after a v2 write → the last turn’s meal write undone by write_id, no LLM, typed undo receipt', async () => {
  const t = await turn({ message: 'Son öğün kaydını geri al', idempotency_key: 'k8' }, { lastTurn: { turnId: 'turn-prev', rows: [ledgerRow('water_log', 'wid-w'), ledgerRow('meal_log', 'wid-77', { ref: 'm40' })] } });
  assertEquals(t.rec.undoLookups, [USER]);
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_record_delete']);
  assertEquals(t.commit.rpcCalls[0].args.p_target, { write_id: 'wid-77' });
  assertEquals(t.rec.understandReqs.length, 0);
  assertEquals(t.rec.coachCalls.length, 0);
  assertEquals(t.rec.reserved.length, 0, 'the undo button is exempt (no quota row reserved)');
  const env = t.env!;
  assertEquals(env.task_mode, 'repair');
  assertEquals(env.receipts, [{ action_type: 'undo', ok: true, rows_affected: 1, user_line: 'Son öğün kaydını geri aldım.', failure_class: null }]);
  assertEquals(env.actions, [{ type: 'undo', feedback: 'Son öğün kaydını geri aldım.' }]);
  assertEquals(t.rec.persisted[0].quotaClass, 'exempt');
  assertEquals(t.rec.turnLogs[0].stage, 'undo_fast');
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'commit']);
});

Deno.test('undo button after a LEDGERED v1 write (photo meal, pipeline v1) → undone by v2 through the ledger', async () => {
  // v1-ledger.ts wrote the photo meal under the v1 turn's turn_id (storeMessages stamped the chat row).
  const t = await turn({ message: 'Son öğün kaydını geri al' }, { lastTurn: { turnId: 'turn-v1-photo', rows: [ledgerRow('meal_log', 'wid-v1-meal', { ref: 'm12' })] } });
  assertEquals(t.out.kind, 'response');
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['w_record_delete']);
  assertEquals(t.commit.rpcCalls[0].args.p_target, { write_id: 'wid-v1-meal' });
  assertEquals(t.env!.receipts?.[0].ok, true);
});

Deno.test('undo when the last turn’s write of that type is already undone → nothing_to_undo (the client shows no extra alert)', async () => {
  const t = await turn({ message: 'Son antrenman kaydını geri al' }, { lastTurn: { turnId: 'turn-prev', rows: [ledgerRow('workout_log', 'wid-t', { undone_at: '2026-10-08T09:00:00Z' })] } });
  assertEquals(t.commit.rpcCalls.length, 0);
  assertEquals(t.env!.message, NOTHING_TO_UNDO_LINE);
  assertEquals(t.env!.receipts?.[0].failure_class, 'nothing_to_undo');
  assertEquals(t.env!.actions, []);
});

// HIGH (Faz 3 review): photo / voice / plan-fallback turns are answered by v1. A last turn the ledger
// cannot answer for must NOT get "nothing to undo" while the meal stays logged: v1's handleUndo answers.
for (const [label, lastTurn] of [
  ['pre-ledger v1 turn (no turn_id on the chat row)', { turnId: null, rows: [] }],
  ['v1 turn whose best-effort ledger append failed (turn_id, no rows)', { turnId: 'turn-v1', rows: [] }],
  ['turn that wrote another op only', { turnId: 'turn-prev', rows: [ledgerRow('water_log', 'wid-w')] }],
  ['the previous undo turn (only record_delete rows)', { turnId: 'turn-undo', rows: [ledgerRow('record_delete', 'wid-r', { reverses: 'wid-77' })] }],
] as const) {
  Deno.test(`undo button, ${label} → v1 handleUndo answers (fallback before any side effect)`, async () => {
    const t = await turn({ message: 'Son öğün kaydını geri al', idempotency_key: 'k10' }, { lastTurn: structuredClone(lastTurn) as never });
    assertEquals(t.out.kind, 'fallback_v1');
    if (t.out.kind === 'fallback_v1') assertEquals(t.out.reason, 'undo_not_in_ledger');
    assertEquals(t.commit.rpcCalls.length, 0, 'nothing undone by v2');
    assertEquals(t.rec.persisted.length, 0, 'nothing stored: v1 stores its own undo turn');
    assertEquals(t.state.sideEffects, false, 'the route may still hand the ORIGINAL request to v1');
    for (const job of t.state.cleanup) await job();
    assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'fail'], 'the journal claim is released for v1');
  });
}

Deno.test('undo button: a failed ledger read → v1 handleUndo answers (never a guess)', async () => {
  const t = await turn({ message: 'Son supplement kaydını geri al' }, { lastTurn: 'error' });
  assertEquals(t.out.kind, 'fallback_v1');
  assertEquals(t.commit.rpcCalls.length, 0);
});

Deno.test('undoTargetOf: the ledger answers only for a turn it knows wrote that op', () => {
  assertEquals(undoTargetOf({ turnId: null, rows: [] }, 'meal_log'), { kind: 'not_in_ledger' });
  assertEquals(undoTargetOf({ turnId: 't', rows: [ledgerRow('meal_log', 'a', { is_primary: false })] }, 'meal_log'), { kind: 'not_in_ledger' }, 'a side effect is not the write');
  assertEquals(undoTargetOf({ turnId: 't', rows: [ledgerRow('meal_log', 'b', { ref: 'm2' }), ledgerRow('meal_log', 'a', { ref: 'm1' })] }, 'meal_log'), { kind: 'write', write_id: 'b', ref: 'm2' }, 'newest live write first');
  assertEquals(undoTargetOf({ turnId: 't', rows: [ledgerRow('meal_log', 'b', { undone_at: 'x' }), ledgerRow('meal_log', 'a')] }, 'meal_log'), { kind: 'write', write_id: 'a', ref: null });
  assertEquals(undoTargetOf({ turnId: 't', rows: [ledgerRow('supplement_log', 'a', { undone_at: 'x' })] }, 'supplement_log'), { kind: 'already_undone' });
});

Deno.test('undo refused by the ledger (later_write) → honest reason, ok:false', async () => {
  const ports = fakeCommitPorts({ rpc: (name) => (name === 'w_record_delete' ? { ok: false, op: 'record_delete', failure_class: 'later_write', detail: {} } : undefined) });
  const t = await turn({ message: 'Son supplement kaydını geri al' }, { lastTurn: { turnId: 'turn-prev', rows: [ledgerRow('supplement_log', 'wid-1', { ref: 's3' })] }, commit: ports });
  assertEquals(t.env!.receipts?.[0].ok, false);
  assertEquals(t.env!.receipts?.[0].failure_class, 'later_write');
  assertStringIncludes(t.env!.message, 'Kaydı geri alamadım');
});

Deno.test('only the exact literal is the button: a typed "son öğünü geri al" is a normal message for Stage A', async () => {
  const t = await turn({ message: 'son öğünü geri al' }, { stageA: parsed(sampleDecision()) });
  assertEquals(t.rec.undoLookups.length, 0);
  assertEquals(t.rec.understandReqs.length, 1);
});

// ─── protective turns are never rate-limited ─────────────────────────────────────────────────────

Deno.test('daily ceiling + a live ambiguous safety trigger → today’s canned safety reply (quota-exempt), never the rate-limit text', async () => {
  const t = await turn({ message: 'antrenmanda bayıldım', idempotency_key: 'k11' }, { reserveAllowed: false });
  assertStringIncludes(t.env!.message, "112'yi ara");
  assertEquals(t.env!.task_mode, 'emergency');
  assert(!t.env!.rate_limited);
  assertEquals(t.rec.understandReqs.length, 0, 'no LLM call at the cap');
  assertEquals(t.rec.persisted[0].quotaClass, 'exempt');
  assertEquals(t.rec.turnLogs[0].finish_reason, 'cap_protective:emergency');
  assertEquals(t.rec.journal.map((j) => j.kind), ['claim', 'commit']);
  // an ED trigger (append mode): the cap text, then the referral — both true
  const ed = await turn({ message: 'aç kalmak istiyorum' }, { reserveAllowed: false });
  assert(ed.env!.message.startsWith('Bugünlük kayıt limitine ulaştın.'));
  assertStringIncludes(ed.env!.message, 'uzman');
  assertEquals(ed.rec.edSignals, ['medium']);
  // no trigger → the ordinary rate-limit answer
  const plain = await turn({ message: 'nasılsın' }, { reserveAllowed: false });
  assertEquals(plain.env!.rate_limited, true);
});

Deno.test('conversation cap + a PROTECTIVE turn → Stage B still answers (quota exempt), no rate-limit text', async () => {
  const { msg, decision } = positiveFaint();
  const t = await turn({ message: msg }, { stageA: parsed(decision), capAllowed: false, coach: () => coachReply('Geçmiş olsun. Şu an nasılsın?') });
  assert(!t.env!.rate_limited);
  assertEquals(t.rec.coachInputs.length, 1);
  assertStringIncludes(t.env!.message, '112');
  assertEquals(t.rec.persisted[0].quotaClass, 'exempt');
  assertEquals(t.env!.remaining, -1);
  assertEquals(t.rec.released, [], 'the reservation stays: the turn was answered');
});

// ─── the crash path (route.ts honest answer) ─────────────────────────────────────────────────────

const commitOf = (over: Partial<CommitResult> = {}): CommitResult => ({ turnId: 't', receipts: [], holds: [], rejects: [], flags: [], writtenRefs: [], exposures: [], ...over });

Deno.test('honestFallbackText / receiptFactLines: written, held, failed and receipt-less rejects, each said once', () => {
  const okR = { action_type: 'meal_log', ok: true, rows_affected: 1, user_line: 'Öğün kaydedildi — x', failure_class: null, legacy_type: 'meal_log' };
  const failR = { action_type: 'water_log', ok: false, rows_affected: 0, user_line: 'Su kaydedilemedi: x', failure_class: 'later_write', legacy_type: 'water_log' };
  const hold = { op: 'water_log', reason_code: 'tek_seferde_cok', question_tr: 'Tek seferde mi?', hold_id: 'p1' };
  assertEquals(honestFallbackText(commitOf({ receipts: [okR] })), `Öğün kaydedildi — x\n${STAGE_B_FAILED_LINE}`);
  assertEquals(honestFallbackText(commitOf({ holds: [hold] })), STAGE_B_FAILED_HELD_LINE);
  assertEquals(honestFallbackText(commitOf({ receipts: [okR], holds: [hold] })), `Öğün kaydedildi — x\n${STAGE_B_FAILED_WRITTEN_HELD_LINE}`);
  const facts = receiptFactLines(commitOf({
    receipts: [failR],
    rejects: [{ op: 'water_log', reason_code: 'later_write', reason_tr: 'sonradan yazılmış' }, { op: 'constraint_retract', reason_code: 'hold_persist_failed', reason_tr: 'onay sorusunu kaydedemedim; bu yüzden yazmadım' }],
  }));
  assertEquals(facts.failed, ['Su kaydedilemedi: x', 'Kaydedilmedi: onay sorusunu kaydedemedim; bu yüzden yazmadım'], 'the reject a receipt explains is not repeated');
});

Deno.test('honestCrashResponse: after a side effect the receipts are answered, the code-owned lines kept, the journal stores it', async () => {
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
  // a crash after a hold opened and an exposure: no T7 ran, so both lines are appended here
  state.commit = commitOf({
    holds: [{ op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', question_tr: 'Fıstık alerjini kaldırmamı onaylıyor musun?', hold_id: 'p1', hold_class: 'safety' }],
    exposures: [{ allergens: ['peanut'], source: 'meal', ref: 'm4' }],
  });
  const env2 = await (await honestCrashResponse(state, f.deps)).json() as TurnEnvelope;
  assert(env2.message.startsWith(STAGE_B_FAILED_HELD_LINE));
  assertStringIncludes(env2.message, '⚠️ Dikkat: profilinde ciddi yer fıstığı alerjisi');
  assert(env2.message.endsWith('Fıstık alerjini kaldırmamı onaylıyor musun?'));
});

// ─── pure helpers ────────────────────────────────────────────────────────────────────────────────

Deno.test('quotaClassOf (the ONE definition, commit.ts) / actionsExecutedOf / extraFactLines', () => {
  const okR = { action_type: 'water_log', ok: true, rows_affected: 1, user_line: 'Su: +0,20 L', failure_class: null, legacy_type: 'water_log' };
  assertEquals(quotaClassOf(commitOf()), 'conversation');
  assertEquals(quotaClassOf(commitOf({ receipts: [{ ...okR, ok: false }] })), 'conversation', 'a failed write is not a record turn');
  assertEquals(quotaClassOf(commitOf({ receipts: [okR] })), 'record');
  assertEquals(quotaClassOf(commitOf({ holds: [{ op: 'water_log', reason_code: 'x', question_tr: 'q', hold_id: 'p' }] })), 'record', 'a held decision is a record turn');
  assertEquals(actionsExecutedOf([okR])?.[0], { type: 'water_log', ...okR });
  const failed = actionsExecutedOf([{ ...okR, ok: false, failure_class: 'later_write' }])![0];
  assertEquals(failed.type, undefined, 'a failed write never comes back from history as a green badge');
  assertEquals([failed.legacy_type, failed.ok, failed.failure_class], ['water_log', false, 'later_write'], 'the receipt itself is kept');
  assertEquals(actionsExecutedOf([]), null);
  assertEquals(extraFactLines({ taskModeHint: 'plan_diet', nudge: null }), [], 'only onboarding cards are a fact');
  assertEquals(extraFactLines({ taskModeHint: null, nudge: 'x'.repeat(300) })[0].length, 'KABUL EDİLEN TEKLİF (bu turda): ""'.length + 200);
});

Deno.test('fakeAdapter sanity: the default adapter answers ok', async () => {
  const a = fakeAdapter();
  assertEquals((await a.createEraseHold(USER, 'memory')).ok, true);
});
