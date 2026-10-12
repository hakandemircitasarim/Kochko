/**
 * retrial-integration.test.ts — the SEAMS of the 2026-10-12 re-trial fix round (lanes S, U, C merged
 * into one SCHEMA v7 / prompt v10 / constitution v3 build), END TO END through the handler with the
 * PRODUCTION Stage B and the judge scope production runs (postcheck.ts LIVE_JUDGE_SCOPE).
 *
 * Each lane tested its own change; these pin what only the merge can break:
 *   U × C  an undo of a correction states what was removed AND what came back (SİLİNDİ / GERİ
 *          GETİRİLDİ), the ED tier stays internal and a referral older than the history window is a
 *          dated fact — and the live judge scope does not judge a plain reply.
 *   S × C  the "14 litre su" turn (no symptom words) is an ordinary held write under the live scope:
 *          no emergency contract, no 112, no judge call.
 *   U × S  a delete of yesterday's record carries a verbatim quote (v7) and is HELD with the one code
 *          question — nothing is deleted on the asking turn.
 *   S × U  the strict schema carries both new v7 fields (safety.acute_evidence_quote, record_ops
 *          evidence_quote) as required-but-nullable keys.
 * And the integrator's own wiring: the quota reservation runs WITH the TurnInput read wave (no model
 * call before it answers; THIS turn's reservation row never becomes history), and the referral fact's
 * longer horizon (input.ts coach_replies section).
 */
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { SAMPLE_WRITES, sampleDecision } from '../../shared/write-registry/samples.ts';
import { buildUnderstandSchema } from '../../shared/write-registry/mod.ts';
import { scanTripwires } from '../../shared/safety-tripwires.ts';
import { lastReferralDay, renderUserState } from './facts.ts';
import { handleV2Turn, newTurnState, type TurnState } from './handler.ts';
import {
  COACH_REPLIES_RECENT, loadTurnInput, TURN_INPUT_HISTORY_MESSAGES, turnInputQueries, turnRefs, type TurnInput, withoutTurnRow,
} from './input.ts';
import { LIVE_JUDGE_SCOPE } from './postcheck.ts';
import { fakeTurnInputDb, NOW, seedTables, USER } from './testing.ts';
import { chatRequest, coachReply, fakeCommitPorts, fakeDeps, parsedOutcome, seededTurnInput } from './turn-testing.ts';
import type { TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';

const w = (op: string, over: Record<string, unknown> = {}) => ({ ...structuredClone(SAMPLE_WRITES[op]), ...over });

async function turn(body: Record<string, unknown>, o: Parameters<typeof fakeDeps>[0] = {}, state: TurnState = newTurnState()) {
  const f = fakeDeps({ judgeScope: LIVE_JUDGE_SCOPE, ...o });
  const out = await handleV2Turn(chatRequest(body), USER, f.deps, state);
  const env = out.kind === 'response' ? await out.response.clone().json() as TurnEnvelope & Record<string, unknown> : null;
  return { ...f, out, env, state };
}

/** The final user turn Stage B was sent (facts + message), from the HTTP body over the fake transport. */
function stageBUser(body: Record<string, unknown>): string {
  const msgs = body.input as { role: string; content: string }[];
  return msgs.filter((m) => m.role === 'user').at(-1)!.content;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const REFERRAL_REPLY = 'Bunu tek başına taşımak zorunda değilsin; bir diyetisyenle görüşmeni öneririm.';

/** ED tier red; a referral 3 days ago, older than the eight-message history window (ten fillers in between). */
function redTierWithOldReferral(t: Record<string, Record<string, unknown>[]>): void {
  t.user_safety_state[0].ed_tier = 'red';
  t.chat_messages.push({ user_id: USER, role: 'assistant', content: REFERRAL_REPLY, created_at: '2026-10-04T09:00:00Z', actions_executed: null });
  for (let i = 0; i < 10; i++) {
    const at = `2026-10-05T${String(8 + i).padStart(2, '0')}:00:00Z`;
    t.chat_messages.push({ user_id: USER, role: i % 2 ? 'assistant' : 'user', content: `ara mesaj ${i}`, created_at: at, actions_executed: null });
  }
}

// ─── the integrator's wiring: reservation ∥ read wave ────────────────────────────────────────────

Deno.test('integration: the quota reservation runs WITH the TurnInput read wave — both start before either answers, Stage A only after both', async () => {
  const ti = deferred<TurnInput>();
  const res = deferred<{ allowed: boolean; remaining: number; reservedMessageId: string | null }>();
  const seeded = await seededTurnInput();
  let loads = 0;
  const f = fakeDeps({
    judgeScope: LIVE_JUDGE_SCOPE,
    loadTurnInput: () => { loads++; return ti.promise; },
    reserve: () => res.promise,
    stageA: (req) => parsedOutcome(sampleDecision({ writes: [w('water_log')] }), req),
  });
  const running = handleV2Turn(chatRequest({ message: 'bir bardak su içtim' }), USER, f.deps, newTurnState());
  await tick();
  assertEquals([loads, f.rec.reserved.length, f.rec.understandReqs.length], [1, 1, 0], 'both in flight, no model call yet');
  res.resolve({ allowed: true, remaining: -1, reservedMessageId: 'res-1' });
  await tick();
  assertEquals(f.rec.understandReqs.length, 0, 'the read wave has not answered: Stage A waits');
  ti.resolve(seeded);
  const out = await running;
  assertEquals(out.kind, 'response');
  assertEquals(f.rec.understandReqs.length, 1);
});

Deno.test('integration: at the daily ceiling the parallel read changes nothing — no LLM call, the cap text', async () => {
  const res = deferred<{ allowed: boolean; remaining: number; message?: string; reservedMessageId: string | null }>();
  const f = fakeDeps({ reserve: () => res.promise, stageA: (req) => parsedOutcome(sampleDecision(), req) });
  const running = handleV2Turn(chatRequest({ message: 'merhaba' }), USER, f.deps, newTurnState());
  await tick();
  res.resolve({ allowed: false, remaining: 0, message: 'Bugünlük mesaj hakkın doldu.', reservedMessageId: null });
  const out = await running;
  assertEquals(f.rec.understandReqs.length, 0, 'a capped user costs no Stage A');
  const env = out.kind === 'response' ? await out.response.json() as Record<string, unknown> : null;
  assertEquals(env?.rate_limited, true);
});

Deno.test('integration: the read wave saw THIS turn\'s reservation row → dropped by id; Stage A and Stage B never see the message twice', async () => {
  const msg = 'bir bardak su içtim';
  const seeded = await seededTurnInput();
  const withRow: TurnInput = { ...seeded, history: [...seeded.history, { role: 'user', content: msg, created_at: '2026-10-07T11:29:59Z', action_types: [], id: 'res-1' }] };
  const t = await turn({ message: msg }, { turnInput: withRow, stageA: (req) => parsedOutcome(sampleDecision({ writes: [w('water_log')] }), req) });
  const ci = t.rec.coachInputs[0];
  assert(!ci.turnInput.history.some((h) => h.id === 'res-1'), 'the reservation row is not history');
  assertEquals(ci.history.filter((h) => h.content === msg).length, 0);
  assertEquals(ci.turnInput.history.length, seeded.history.length);
  // The Stage A request renders the message once (its own block), never as a past turn too.
  const stageA = t.rec.understandReqs[0].input.map((m) => m.content).join('\n');
  assertEquals(stageA.split(msg).length - 1, 1, stageA.slice(-600));
});

Deno.test('integration: the read wave fails AFTER the reservation landed → its release is already registered (the route frees the slot)', async () => {
  const state = newTurnState();
  const f = fakeDeps({ loadTurnInput: () => Promise.reject(new Error('read wave down')) });
  await assertRejects(() => handleV2Turn(chatRequest({ message: 'merhaba' }), USER, f.deps, state), Error, 'read wave down');
  for (const c of state.cleanup) await c();
  assertEquals(f.rec.released, ['res-1'], 'no orphan user row');
});

Deno.test('withoutTurnRow: drops the row by id, trims to the window; a TurnInput without the row and within the window is returned as is', async () => {
  const ti = await seededTurnInput();
  assertEquals(withoutTurnRow(ti, null), ti);
  assertEquals(withoutTurnRow(ti, 'not-there'), ti);
  const many: TurnInput = {
    ...ti,
    history: Array.from({ length: TURN_INPUT_HISTORY_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 ? 'assistant' as const : 'user' as const, content: `m${i}`, created_at: `2026-10-07T0${i}:00:00Z`, action_types: [], id: `id-${i}`,
    })),
  };
  const trimmed = withoutTurnRow(many, null);
  assertEquals(trimmed.history.map((h) => h.content), many.history.slice(1).map((h) => h.content), 'the slack row read by the live loader is the OLDEST one dropped');
  const dropped = withoutTurnRow(many, `id-${TURN_INPUT_HISTORY_MESSAGES}`);
  assertEquals(dropped.history.length, TURN_INPUT_HISTORY_MESSAGES);
  assert(!dropped.history.some((h) => h.id === `id-${TURN_INPUT_HISTORY_MESSAGES}`));
  assertEquals(dropped.history[0].content, 'm0', 'with the reservation row gone, the window keeps the oldest real message');
});

// ─── the referral fact's horizon (input.ts coach_replies → facts.ts lastReferralDay) ─────────────

Deno.test('referral horizon: the coach_replies section leaves in the SAME wave — assistant rows only, 7 days, COACH_REPLIES_RECENT', () => {
  const qs = turnInputQueries(USER, NOW);
  const q = qs.find((x) => x.section === 'coach_replies')!;
  assertEquals(q.table, 'chat_messages');
  assertEquals(q.columns, 'created_at, content');
  assert(q.filters.some((f) => f.op === 'eq' && f.column === 'role' && f.value === 'assistant'));
  assert(q.filters.some((f) => f.op === 'gte' && f.column === 'created_at' && f.value === '2026-09-30T00:00:00Z'));
  assertEquals(q.limit, COACH_REPLIES_RECENT);
  assertEquals(q.order, [{ column: 'created_at', ascending: false }]);
  const history = qs.find((x) => x.section === 'history')!;
  assertStringIncludes(history.columns, 'id', 'the history carries the row id (withoutTurnRow)');
});

Deno.test('referral horizon: a referral OLDER than the history window is a dated fact; the ED tier stays internal; a waved-away one is no referral', async () => {
  const t = seedTables();
  redTierWithOldReferral(t);
  const ti = await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
  assert(!ti.history.some((h) => h.content === REFERRAL_REPLY), 'precondition: outside the eight-message window');
  assertEquals(lastReferralDay(ti), '2026-10-04');
  const lines = renderUserState(ti).join('\n');
  assertStringIncludes(lines, 'Uzman yönlendirmesi: Paz 4 Eki yapıldı');
  assertStringIncludes(lines, 'iç bilgi, kişiye söyleme');
  // Waved away ("… gerek yok") is not a referral — judged by the guarantees' own check.
  const waved = seedTables();
  waved.chat_messages.push({ user_id: USER, role: 'assistant', content: 'Bir diyetisyenle görüşmene gerek yok, gayet iyi gidiyorsun.', created_at: '2026-10-04T09:00:00Z', actions_executed: null });
  assertEquals(lastReferralDay(await loadTurnInput(fakeTurnInputDb(waved), { userId: USER, now: NOW })), null);
  // An older producer / fixture without the section: the history window alone (no throw).
  assertEquals(lastReferralDay({ ...ti, coach_replies_recent: undefined }), null);
});

// ─── seams across the lanes, through the handler, on the live judge scope ────────────────────────

Deno.test('SEAM U × C: undoing a correction — SİLİNDİ + GERİ GETİRİLDİ reach the coach with the internal ED tier and the dated referral; a plain reply is not judged live', async () => {
  const ti = await seededTurnInput(redTierWithOldReferral);
  const lastMeal = Object.entries(turnRefs(ti).rendered).find(([, r]) => r.kind === 'm' && r.last_turn === true)![0];
  const msg = 'son düzeltmeyi geri al';
  const decision = sampleDecision({
    intent: { primary: 'correction', is_hypothetical: false, about_other_person: false },
    record_ops: [{ op: 'delete', ref: lastMeal, reason: 'düzeltmeyi geri al', evidence_quote: 'düzeltmeyi geri al' }],
  });
  const reversed = [
    { write_id: 'r1', table: 'meal_logs', row_id: 'ml-3', ref: 'm40', field_set: ['is_deleted'], before: { is_deleted: false }, after: { is_deleted: true } },
    { write_id: 'r2', table: 'meal_logs', row_id: 'ml-3-old', ref: 'm39', field_set: ['is_deleted'], before: { is_deleted: true }, after: { is_deleted: false } },
  ];
  const commit = fakeCommitPorts({
    rpc: (name, args) => name === 'w_record_delete'
      ? { ok: true, op: 'record_delete', turn_id: args.p_turn_id, group_id: 'g4', scope: 'record', target: {}, reversed, needs_review: false }
      : undefined,
  });
  const t = await turn({ message: msg }, { turnInput: ti, commit, stageA: (req) => parsedOutcome(decision, req), coach: () => coachReply('Düzeltmeyi geri aldım; önceki öğün kaydın yeniden geçerli.') });
  assertEquals(commit.rpcCalls.map((c) => c.name), ['w_record_delete'], 'the last turn\'s own write of today: one step');
  const receipt = t.rec.coachInputs[0].commit.receipts[0];
  assertEquals(receipt.ok, true);
  assertStringIncludes(receipt.user_line ?? '', 'düzeltmeden önceki kayıt geri geldi');
  const user = stageBUser(t.rec.coachCalls[0]);
  assertStringIncludes(user, '- SİLİNDİ: Kayıt geri alındı');
  assertStringIncludes(user, '- GERİ GETİRİLDİ: düzeltmeden önceki kayıt yeniden geçerli');
  assertStringIncludes(user, 'Yeme bozukluğu risk düzeyi: yüksek (kırmızı)');
  assertStringIncludes(user, 'iç bilgi, kişiye söyleme');
  assertStringIncludes(user, 'Uzman yönlendirmesi: Paz 4 Eki yapıldı');
  assertEquals(t.rec.judgeCalls.length, 0, 'live scope: a reply with no suggestion, to a message not asking for advice, is not judged');
  assertEquals(t.env!.message, 'Düzeltmeyi geri aldım; önceki öğün kaydın yeniden geçerli.');
});

Deno.test('SEAM S × C: "bugün 14 litre su içtim" under the live judge scope — repaired to a held write, no emergency, no 112, no judge call', async () => {
  const msg = 'bugün 14 litre su içtim';
  assertEquals(scanTripwires(msg).hits.length, 0);
  const acute = sampleDecision({
    safety: { acute_medical: true, acute_evidence_quote: null },
    reply_route: { contract: 'emergency', effort_hint: 'medium' },
    self_check: { reported_new_facts: true, not_written_reason: 'emergency_turn' },
  });
  const water = sampleDecision({ writes: [w('water_log', { as_stated: '14 litre', quantity: 14, unit: 'litre', mode: 'set_day_total' })], self_check: { reported_new_facts: true, not_written_reason: null } });
  const t = await turn({ message: msg }, { stageA: (req, n) => parsedOutcome(n === 1 ? acute : water, req), coach: () => coachReply('14 litre mi yazdın, yoksa 1,4 litre mi?') });
  const ci = t.rec.coachInputs[0];
  assertEquals(ci.tripwire.kind, 'normal');
  assertEquals(ci.commit.holds.map((h) => h.reason_code), ['litre_yazim_suphesi']);
  assert(!stageBUser(t.rec.coachCalls[0]).includes('Bu turun sözleşmesi: acil durum'));
  assert(!t.env!.message.includes('112'), t.env!.message);
  assertEquals(t.rec.judgeCalls.length, 0);
});

Deno.test('SEAM U × S: "dünkü tartıyı sil" — a verbatim quote (v7) and yesterday\'s record → HELD with the one code question; nothing deleted; not judged live', async () => {
  const ti = await seededTurnInput();
  const yesterdayWeight = Object.entries(turnRefs(ti).rendered).find(([, r]) => r.target === 'weight' && r.day === '2026-10-06')![0];
  const msg = 'dünkü tartıyı sil';
  const decision = sampleDecision({
    intent: { primary: 'correction', is_hypothetical: false, about_other_person: false },
    record_ops: [{ op: 'delete', ref: yesterdayWeight, reason: 'dünkü tartı', evidence_quote: 'dünkü tartıyı sil' }],
  });
  const t = await turn({ message: msg }, { turnInput: ti, stageA: (req) => parsedOutcome(decision, req), coach: () => coachReply('Dünkü 70,4 kg tartını silmemi istiyor musun?') });
  assertEquals(t.commit.rpcCalls.map((c) => c.name), ['v2_hold_open'], 'no w_record_delete on the asking turn');
  const hold = t.rec.coachInputs[0].commit.holds[0];
  assertEquals([hold.op, hold.reason_code, hold.question_tr], ['record_delete', 'uzak_kayit_silme', 'Dünkü 70,4 kg tartını silmemi istiyor musun?']);
  const user = stageBUser(t.rec.coachCalls[0]);
  assertStringIncludes(user, 'BEKLETİLDİ, yazılmadı (kaydı silme, henüz silinmedi)');
  assert(!user.includes('doğru mu yazdın'), 'a delete question is not about a value the person typed');
  assertEquals(t.rec.judgeCalls.length, 0);
});

Deno.test('SEAM S × U: the strict v7 schema carries BOTH new fields as required-but-nullable keys', () => {
  const schema = buildUnderstandSchema() as { properties: Record<string, { properties?: Record<string, unknown>; required?: string[]; items?: unknown }> };
  const safety = schema.properties.safety;
  assert(safety.required?.includes('acute_evidence_quote'));
  assertEquals((safety.properties?.acute_evidence_quote as { type: unknown }).type, ['string', 'null']);
  const recordOps = JSON.stringify(schema.properties.record_ops);
  assertStringIncludes(recordOps, '"evidence_quote"');
  // Every record_ops variant that names evidence_quote also requires it (strict mode: no optional keys).
  const variants = (JSON.parse(recordOps) as { items: { anyOf?: Array<{ properties: Record<string, unknown>; required: string[] }>; properties?: Record<string, unknown>; required?: string[] } }).items;
  for (const v of variants.anyOf ?? [variants as { properties: Record<string, unknown>; required: string[] }]) {
    if ('evidence_quote' in v.properties) assert(v.required.includes('evidence_quote'), JSON.stringify(v.required));
  }
});
