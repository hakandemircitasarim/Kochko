/**
 * commit.test.ts — T5 commit: the pure plan (verdict → step) and the I/O half against a fake
 * writer-RPC backend. Pinned: rows are the verdict's rows (never rewritten), writer RPC payloads,
 * ref translation through the refMap, holds store row ids (never tokens) and come back on confirm,
 * a confirmed hold is re-validated and closed by the writer itself, REJECT/unsupported ops are
 * visible and write nothing, receipts carry the writer's ok + legacy badge type + Turkish lines,
 * exposures come only from committed items.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { SCHEMA_VERSION, validateDecision } from '../../shared/write-registry/mod.ts';
import { SAMPLE_MESSAGES, SAMPLE_WRITES, sampleDecision, sampleMeal } from '../../shared/write-registry/samples.ts';
import {
  executeCommit, exposuresOf, holdClassOf, holdPayloadOf, isHoldPayloadV2, isSafetyHold, LEDGER_MISSING_NOTE, mealPayload, metricPayload, pathKeys, planCommit,
  setAtPath, targetOf, thawHoldArgs, type CommitPlan,
} from './commit.ts';
import { turnRefs, validationContext, type TurnInput } from './input.ts';
import { NOW, USER } from './testing.ts';
import { fakeAdapter, fakeCommitPorts, seededTurnInput } from './turn-testing.ts';

const w = (op: string, over: Record<string, unknown> = {}) => ({ ...structuredClone(SAMPLE_WRITES[op]), ...over });

function planFor(ti: TurnInput, decision: Record<string, unknown>, message: string) {
  const refs = turnRefs(ti);
  const ctx = validationContext(ti, message, NOW, refs);
  const validation = validateDecision(decision, ctx);
  const plan = planCommit({ turnId: 'turn-1', userId: USER, validation, turnInput: ti, refs, ctx });
  return { refs, ctx, validation, plan };
}

const tokenOf = (ti: TurnInput, pred: (d: TurnInput['metric_days'][number]) => boolean) => ti.metric_days.find(pred)!.ref;

// ─── pure helpers ────────────────────────────────────────────────────────────────────────────────

Deno.test('pathKeys / setAtPath: collectRefs paths without pattern matching', () => {
  assertEquals(pathKeys('patch.items[2].name'), ['patch', 'items', 2, 'name']);
  assertEquals(pathKeys('ref'), ['ref']);
  const o: Record<string, unknown> = { patch: { items: [{}, { replaces: 'm1' }] } };
  assert(setAtPath(o, 'patch.items[1].replaces', null));
  assertEquals((o.patch as { items: Record<string, unknown>[] }).items[1].replaces, null);
  assert(!setAtPath(o, 'missing.deep', 1));
});

Deno.test('mealPayload / metricPayload: the verdict row, field for field; NULL details are not sent', () => {
  const p = mealPayload({ date: '2026-10-07', meal_type: 'dinner', raw: 'x', time_local: null, venue: ' Lahmacuncu ', items: [{ name: 'lahmacun', as_stated: '2 adet', grams: 260, kcal: 520, protein_g: 20, carbs_g: 70, fat_g: 18, alcohol_g: 0, caffeine_mg: 0, allergens: ['gluten'], may_contain: [], reference_key: null, confidence: 0.8, data_source: 'ai_estimate' }] });
  assertEquals(p.day, '2026-10-07');
  assertEquals(p.venue, { name: 'Lahmacuncu' });
  assertEquals((p.items as Record<string, unknown>[])[0].kcal, 520);
  assertEquals((p.items as Record<string, unknown>[])[0].as_stated, '2 adet');
  const s = metricPayload('sleep_log', { date: '2026-10-07', hours: 6.5, quality: null, bed_time: '00:30', wake_time: null, as_stated: '6-7' }, '2026-10-07');
  assertEquals(s.values, { hours: 6.5, sleep_time: '00:30' }, 'quality/wake_time not stated → not sent (113: NULL ≠ CLEAR)');
  const wgt = metricPayload('body_weight', { date: '2026-10-06', kg: 70.2, as_stated: '70,2' }, '2026-10-07');
  assertEquals(wgt.update_profile, false, 'a backdated weigh-in never moves profiles.weight_kg');
});

Deno.test('targetOf: turn token → database target through the refMap only', async () => {
  const ti = await seededTurnInput();
  const refs = turnRefs(ti);
  assertEquals(targetOf('m1', refs), { kind: 'row', table: 'meal_logs', id: 'ml-1', token: 'm1' });
  const d = tokenOf(ti, (x) => x.target === 'water' && x.day === '2026-10-07');
  const t = targetOf(d, refs);
  assertEquals(t.kind, 'metric');
  if (t.kind === 'metric') {
    assertEquals(t.field, 'water_liters');
    assertEquals(t.op, 'water_log');
  }
  assertEquals(targetOf('m99', refs).kind, 'unresolvable');
  assertEquals(targetOf('c1', refs).kind, 'unresolvable', 'the spine is not deletable by record ops');
});

// ─── plan: writes ────────────────────────────────────────────────────────────────────────────────

Deno.test('meal COMMIT → one w_meal_apply step with the model numbers (no table override)', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [sampleMeal()] }), '6 tavuk nugget yedim');
  assertEquals(plan.steps.length, 1);
  const s = plan.steps[0];
  assertEquals(s.kind, 'rpc');
  if (s.kind !== 'rpc') return;
  assertEquals(s.rpc, 'w_meal_apply');
  assertEquals(s.payload.day, '2026-10-07', 'relative day resolved against the user day');
  const item = (s.payload.items as Record<string, unknown>[])[0];
  assertEquals(item.kcal, 320);
  assertEquals(item.data_source, 'ai_estimate');
  assertEquals(item.allergens, ['gluten']);
  assertEquals(s.replaces, null);
  assertEquals(s.pendingId, null);
});

Deno.test('REJECT writes nothing and says why (250 L water)', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('water_log', { quantity: 250, unit: 'litre' })] }), '250 litre su içtim');
  assertEquals(plan.steps.length, 0);
  assertEquals(plan.rejects.length, 1);
  assertEquals(plan.rejects[0].receipt?.ok, false);
  assertEquals(plan.rejects[0].receipt?.failure_class, 'out_of_range');
  assertStringIncludes(plan.rejects[0].receipt?.user_line ?? '', 'Kaydedilmedi (Su)');
});

Deno.test('ASK → a v2 hold: frozen day, subject key, ask class; no write step', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('water_log', { quantity: 2, unit: 'litre', as_stated: '2 litre' })] }), '2 litre su içtim');
  assertEquals(plan.steps.length, 1);
  const s = plan.steps[0];
  assertEquals(s.kind, 'hold_open');
  if (s.kind !== 'hold_open') return;
  assertEquals(s.holdOp, 'water_log');
  assertEquals(s.payload.v, 2);
  assertEquals(s.payload.schema_version, SCHEMA_VERSION);
  assertEquals(s.payload.args.day, '2026-10-07', 'a "yes" after midnight still writes to the asked day');
  assertEquals(s.opts.subject_key, 'water_log:2026-10-07');
  assertEquals(s.opts.hold_class, 'ask');
  assertEquals(s.opts.reason_code, 'tek_seferde_cok');
});

Deno.test('severe allergen removal → SAFETY hold; the payload holds the row id, never the turn token', async () => {
  const ti = await seededTurnInput();
  const msg = 'fıstık alerjim geçti';
  const { plan, refs } = planFor(ti, sampleDecision({ writes: [{ op: 'constraint_retract', target: 'c1', evidence_quote: msg, note: null }] }), msg);
  const s = plan.steps[0];
  assertEquals(s.kind, 'hold_open');
  if (s.kind !== 'hold_open') return;
  assertEquals(s.opts.hold_class, 'safety');
  assertEquals(s.opts.subject_key, 'constraint_retract:uc-1');
  assertEquals(s.payload.args.target, null);
  assertEquals(s.payload.refs, [{ path: 'target', table: 'user_constraints', id: 'uc-1' }]);
  assertEquals(thawHoldArgs(s.payload, refs).args.target, 'c1', 'next turn: the row id maps back to THAT turn’s token');
});

Deno.test('record_delete: a meal by row ref, a water value by its metric target', async () => {
  const ti = await seededTurnInput();
  const d = tokenOf(ti, (x) => x.target === 'water' && x.day === '2026-10-07');
  const { plan } = planFor(ti, sampleDecision({ record_ops: [{ op: 'delete', ref: 'm2', reason: 'yanlış' }, { op: 'delete', ref: d, reason: 'yanlış' }] }), 'yok o yanlış geri al');
  assertEquals(plan.steps.map((s) => s.kind), ['record_delete', 'record_delete']);
  const [a, b] = plan.steps;
  if (a.kind === 'record_delete') assertEquals(a.target.kind, 'row');
  if (b.kind === 'record_delete') assertEquals(b.target.kind, 'metric');
});

Deno.test('record_update of a meal → the patch through w_meal_apply with replaces = that record (one transaction)', async () => {
  const ti = await seededTurnInput();
  const upd = w('record_update', { ref: 'm1' });
  const { plan } = planFor(ti, sampleDecision({ record_ops: [upd] }), SAMPLE_MESSAGES.record_update);
  const s = plan.steps[0];
  assertEquals(s.kind, 'rpc');
  if (s.kind !== 'rpc') return;
  assertEquals(s.rpc, 'w_meal_apply');
  assertEquals(s.replaces?.kind, 'row');
  assertEquals(s.payload.day, '2026-10-02');
  assertEquals((s.payload.items as Record<string, unknown>[])[0].kcal, 290);
});

Deno.test('target_change is rejected visibly (never held: its "yes" could not be executed)', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('target_change', { program: 'maintenance_start' })] }), 'bakıma geçelim');
  assertEquals(plan.steps.length, 0);
  assertEquals(plan.rejects[0].reason_code, 'v2_desteklenmiyor');
  assertEquals(plan.rejects[0].receipt?.failure_class, 'not_supported');
});

Deno.test('restatement is a declared no-op; an unexplained report becomes a missed_write fact', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [sampleMeal([{}], { status: 'restatement' })] }), 'öğlen çorba içmiştim');
  assertEquals(plan.steps.length, 0);
  assertEquals(plan.noops.length, 1);
  const missed = planFor(ti, sampleDecision({ self_check: { reported_new_facts: true, not_written_reason: null } }), 'bir şey yedim').plan;
  assert(missed.flags.some((f) => f.code === 'missed_write'));
});

// ─── plan: hold answers ──────────────────────────────────────────────────────────────────────────

function withWaterHold(payloadOver: Record<string, unknown> = {}) {
  return seededTurnInput((t) => {
    t.pending_writes.push({
      id: 'pw-w', user_id: USER, op: 'water_log', status: 'pending', created_at: '2026-10-07T09:58:05Z', expires_at: '2026-10-09T09:58:05Z',
      hold_class: 'ask', schema_version: SCHEMA_VERSION,
      payload: {
        v: 2, op: 'water_log', schema_version: SCHEMA_VERSION, refs: [],
        args: { op: 'water_log', day: '2026-10-07', as_stated: '2 litre', quantity: 2, unit: 'litre', other_ml_each: null, mode: 'add', replaces: null },
        ...payloadOver,
      },
    });
  });
}

Deno.test('pending confirm → the held write re-validated (ASK reasons become FLAG notes) and written WITH pending_id', async () => {
  const ti = await withWaterHold();
  const hold = ti.pending.find((p) => p.id === 'pw-w')!;
  const { plan } = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: hold.ref }] }), 'evet');
  assertEquals(plan.steps.length, 1);
  const s = plan.steps[0];
  assertEquals(s.kind, 'rpc');
  if (s.kind !== 'rpc') return;
  assertEquals(s.rpc, 'w_water_apply');
  assertEquals(s.pendingId, 'pw-w', 'the writer claims and closes the hold in the same transaction');
  assertEquals(s.verdict.op, 'water_log');
  assertEquals(s.verdict.verdict, 'FLAG');
  assert(plan.flags.some((f) => f.code === 'tek_seferde_cok'));
});

Deno.test('a hold from an older registry version is never applied blindly → reject + hold closed as failed', async () => {
  const ti = await withWaterHold({ schema_version: 'v1' });
  const hold = ti.pending.find((p) => p.id === 'pw-w')!;
  const { plan } = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: hold.ref }] }), 'evet');
  assertEquals(plan.rejects[0].reason_code, 'eski_bekletme');
  assertEquals(plan.steps.map((s) => s.kind), ['hold_resolve']);
});

Deno.test('erase hold confirm → shared/erase-hold.ts path; discard → v2_hold_resolve discarded', async () => {
  const ti = await withWaterHold();
  const erase = ti.pending.find((p) => p.op === 'account_erase_request')!;
  const water = ti.pending.find((p) => p.id === 'pw-w')!;
  const c = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: erase.ref }] }), 'evet sil');
  assertEquals(c.plan.steps.map((s) => s.kind), ['erase_confirm']);
  const d = planFor(ti, sampleDecision({ pending_ops: [{ op: 'discard', ref: water.ref }] }), 'hayır kalsın');
  const s = d.plan.steps[0];
  assertEquals(s.kind, 'hold_resolve');
  if (s.kind === 'hold_resolve') assertEquals(s.status, 'discarded');
});

Deno.test('trial 2026-10-11: a hold answered with the OTHER option (discard + same-kind write) shows only the write — no "Vazgeçildi" chip', async () => {
  const ti = await withWaterHold();
  const water = ti.pending.find((p) => p.id === 'pw-w')!;
  const msg = 'ek olarak, 2 litrenin üstüne';
  const decision = sampleDecision({
    pending_ops: [{ op: 'discard', ref: water.ref }],
    writes: [w('water_log', { quantity: 1.4, unit: 'litre', as_stated: '1.4', mode: 'add' })],
  });
  const { plan } = planFor(ti, decision, msg);
  const discard = plan.steps.find((s) => s.kind === 'hold_resolve');
  assert(discard && discard.kind === 'hold_resolve' && discard.superseded === true);
  const ports = fakeCommitPorts();
  const result = await executeCommit(plan, ports);
  assertEquals(ports.rpcCalls.find((c) => c.name === 'v2_hold_resolve')?.args.p_status, 'discarded', 'the old hold is still closed');
  assertEquals(result.receipts.map((r) => r.legacy_type), ['water_log'], 'only the write');
  assert(!result.receipts.some((r) => r.user_line === 'Vazgeçildi'));
  // A plain discard (or one next to an unrelated write) keeps its receipt.
  const alone = await executeCommit(planFor(ti, sampleDecision({ pending_ops: [{ op: 'discard', ref: water.ref }] }), 'vazgeçtim').plan, fakeCommitPorts());
  assertEquals(alone.receipts.map((r) => r.user_line), ['Vazgeçildi']);
  const other = planFor(ti, sampleDecision({ pending_ops: [{ op: 'discard', ref: water.ref }], writes: [w('step_log')] }), 'vazgeçtim, 12 bin adım attım');
  assertEquals((other.plan.steps.find((s) => s.kind === 'hold_resolve') as { superseded?: boolean }).superseded, undefined);
  // A FAILED discard still reports, superseded or not (a hold left open must not be silent).
  const failing = fakeCommitPorts({ rpc: (name) => (name === 'v2_hold_resolve' ? { ok: false, op: 'hold_resolve', failure_class: 'hold_not_open', detail: {} } : undefined) });
  const failed = await executeCommit(plan, failing);
  assert(failed.receipts.some((r) => r.action_type === 'pending_discard' && r.ok === false));
});

Deno.test('holdPayloadOf / isHoldPayloadV2 round trip', async () => {
  const ti = await seededTurnInput();
  const msg = 'fıstık alerjim geçti';
  const { validation, refs } = planFor(ti, sampleDecision({ writes: [{ op: 'constraint_retract', target: 'c1', evidence_quote: msg, note: null }] }), msg);
  const p = holdPayloadOf(validation.verdicts[0], refs);
  assert(isHoldPayloadV2(JSON.parse(JSON.stringify(p))));
  assert(!isHoldPayloadV2({ scope: 'memory' }), 'the KVKK erase payload is not a v2 hold');
});

// ─── execution ───────────────────────────────────────────────────────────────────────────────────

async function run(plan: CommitPlan, ports = fakeCommitPorts()) {
  const result = await executeCommit(plan, ports);
  return { result, ports };
}

Deno.test('execute meal: writer receipt → "Öğün kaydedildi — …" (byte-identical prefix), legacy badge type, written ref', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [sampleMeal()] }), '6 tavuk nugget yedim');
  const { result, ports } = await run(plan);
  assertEquals(ports.rpcCalls.map((c) => c.name), ['w_meal_apply']);
  const args = ports.rpcCalls[0].args;
  assertEquals(args.p_user, USER);
  assertEquals(args.p_turn_id, 'turn-1');
  assertEquals((args.p_payload as Record<string, unknown>).replaces, null);
  assertEquals(result.receipts.length, 1);
  const r = result.receipts[0];
  assertEquals(r.ok, true);
  assertEquals(r.action_type, 'meal_log');
  assertEquals(r.legacy_type, 'meal_log');
  assert(r.user_line?.startsWith('Öğün kaydedildi — tavuk nugget (6 adet)'), r.user_line ?? '');
  assertEquals(r.ref, 'm40');
  assertEquals(result.writtenRefs, ['m40']);
  assertEquals(ports.writes, 1, 'onWrite fires once, before the first write');
});

Deno.test('execute water add: the receipt also states the day total the writer reported', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('water_log')] }), '1 bardak su içtim');
  const { result, ports } = await run(plan);
  assertEquals((ports.rpcCalls[0].args.p_payload as Record<string, unknown>).liters, 0.2);
  assertEquals(result.receipts[0].user_line, 'Su: +0,20 L · gün toplamı 1,80 L');
  assertEquals(result.receipts[0].legacy_type, 'water_log');
});

Deno.test('execute hold: v2_hold_open with the payload; a V2Hold with its id and the one question; no receipt', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('water_log', { quantity: 2, unit: 'litre', as_stated: '2 litre' })] }), '2 litre su içtim');
  const { result, ports } = await run(plan);
  assertEquals(ports.rpcCalls.map((c) => c.name), ['v2_hold_open']);
  assertEquals(ports.rpcCalls[0].args.p_op, 'water_log');
  assertEquals(result.holds.length, 1);
  assertEquals(result.holds[0].hold_id, 'pw-new');
  assert(result.holds[0].question_tr.endsWith('?'));
  assertEquals(result.receipts.length, 0, 'nothing was written yet: no badge');
  assertEquals(result.holds[0].hold_class, 'ask', 'the stored class rides on the hold (T7 reads it, never the prose)');
  assertEquals(isSafetyHold(result.holds[0]), false);
});

Deno.test('safety holds carry hold_class safety into T7 (allergen removal, KVKK erase); unknown class falls back to the op', async () => {
  const ti = await seededTurnInput();
  const msg = 'fıstık alerjim geçti';
  const { plan } = planFor(ti, sampleDecision({ writes: [{ op: 'constraint_retract', target: 'c1', evidence_quote: msg, note: null }] }), msg);
  const { result } = await run(plan);
  assertEquals(result.holds[0].hold_class, 'safety');
  assert(isSafetyHold(result.holds[0]));
  const erase = await executeCommit(planFor(ti, sampleDecision({ writes: [w('data_erase_request')] }), SAMPLE_MESSAGES.data_erase_request).plan, fakeCommitPorts());
  assertEquals(erase.holds[0].hold_class, 'safety');
  assert(isSafetyHold({ op: 'goal_set', reason_code: 'x', question_tr: 'q?', hold_id: null }), 'a hold built without a class: by op');
  assert(isSafetyHold({ op: 'profile_set', reason_code: 'kimlik_degisimi', question_tr: 'q?', hold_id: null }), '…or by its reason code (the ONE classifier, facts.ts)');
  assert(!isSafetyHold({ op: 'water_log', reason_code: 'x', question_tr: 'q?', hold_id: null }));
});

Deno.test('holdClassOf: an identity field in ANY change of a profile_set makes a safety hold (not only the first change)', () => {
  const verdict = (changes: Record<string, unknown>[]) => ({ op: 'profile_set', args: { op: 'profile_set', subject: 'self', changes } }) as unknown as Parameters<typeof holdClassOf>[0];
  assertEquals(holdClassOf(verdict([{ field: 'activity_level' }, { field: 'birth_year' }])), 'safety');
  assertEquals(holdClassOf(verdict([{ field: 'height_cm' }])), 'safety');
  assertEquals(holdClassOf(verdict([{ field: 'activity_level' }])), 'ask');
});

Deno.test('an adapter write whose ledger row did not land → receipt says it cannot be undone + a ledger_missing fact for the coach', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('supplement_log')] }), 'whey aldım');
  const adapter = fakeAdapter(() => ({ ok: true, rows_affected: 1, failure_class: null, ref: null, write_id: null, ledger_missing: true }));
  const result = await executeCommit(plan, fakeCommitPorts({ adapter }));
  assertEquals(result.receipts[0].ok, true, 'the write stands');
  assertStringIncludes(result.receipts[0].user_line ?? '', LEDGER_MISSING_NOTE);
  assertEquals(result.flags.map((f) => [f.op, f.code]), [['supplement_log', 'ledger_missing']]);
  const clean = await executeCommit(plan, fakeCommitPorts());
  assertEquals(clean.flags.filter((f) => f.code === 'ledger_missing'), [], 'a landed ledger row → no flag');
});

Deno.test('execute record_delete: resolves the target, calls w_record_delete by persistent ref → "Kayıt geri alındı"', async () => {
  const ti = await seededTurnInput();
  const d = tokenOf(ti, (x) => x.target === 'water' && x.day === '2026-10-07');
  const { plan } = planFor(ti, sampleDecision({ record_ops: [{ op: 'delete', ref: d, reason: 'yanlış' }] }), 'yok o yanlış geri al');
  const { result, ports } = await run(plan);
  assertEquals(ports.resolved[0].kind, 'metric');
  assertEquals(ports.rpcCalls[0].name, 'w_record_delete');
  assertEquals(ports.rpcCalls[0].args.p_target, { ref: 'd7' });
  assertEquals(result.receipts[0].legacy_type, 'undo');
  assertStringIncludes(result.receipts[0].user_line ?? '', 'Kayıt geri alındı: su');
});

Deno.test('execute record_update meal: replaces = the resolved persistent ref (never the turn token)', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ record_ops: [w('record_update', { ref: 'm1' })] }), SAMPLE_MESSAGES.record_update);
  const { result, ports } = await run(plan);
  assertEquals((ports.rpcCalls[0].args.p_payload as Record<string, unknown>).replaces, 'm7');
  assertEquals(result.receipts[0].ok, true);
  assertStringIncludes(result.receipts[0].user_line ?? '', 'Kayıt düzeltildi');
});

Deno.test('a value the ledger never wrote cannot be replaced → not_in_ledger, honest, nothing written', async () => {
  const ti = await seededTurnInput();
  const d = tokenOf(ti, (x) => x.target === 'water' && x.day === '2026-10-07');
  const upd = { op: 'update', ref: d, basis: 'user_correction', reason: '2 bardaktı', evidence_quote: '2 bardaktı', patch: w('water_log', { quantity: 2 }) };
  const { plan } = planFor(ti, sampleDecision({ record_ops: [upd] }), 'su yanlış, 2 bardaktı');
  const ports = fakeCommitPorts({ resolve: (t) => (t.kind === 'metric' ? { ok: false, failure_class: 'not_in_ledger' } : { ok: true, ref: 'm7', write_id: null }) });
  const { result } = await run(plan, ports);
  assertEquals(ports.rpcCalls.length, 0);
  assertEquals(result.receipts[0].ok, false);
  assertEquals(result.receipts[0].failure_class, 'not_in_ledger');
  assertEquals(result.rejects[0].reason_code, 'not_in_ledger');
  assertEquals(ports.writes, 0, 'nothing left the building');
});

Deno.test('writer failure (later_write) → ok:false receipt with the Turkish reason + a reject fact; the next step still runs', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('water_log'), sampleMeal()] }), '1 bardak su ve 6 nugget');
  const ports = fakeCommitPorts({ rpc: (name) => (name === 'w_water_apply' ? { ok: false, op: 'water_log', failure_class: 'later_write', detail: {} } : undefined) });
  const { result } = await run(plan, ports);
  assertEquals(result.receipts.map((r) => r.ok), [false, true]);
  assertStringIncludes(result.receipts[0].user_line ?? '', 'Su kaydedilemedi: aynı kayda sonradan');
  assertEquals(result.rejects.map((r) => r.reason_code), ['later_write']);
});

Deno.test('a thrown RPC is a write_failed receipt, never a crash', async () => {
  const ti = await seededTurnInput();
  const { plan } = planFor(ti, sampleDecision({ writes: [w('water_log')] }), '1 bardak su içtim');
  const ports = fakeCommitPorts();
  ports.rpc = () => Promise.reject(new Error('network down'));
  const { result } = await run(plan, ports);
  assertEquals(result.receipts[0].ok, false);
  assertEquals(result.receipts[0].failure_class, 'write_failed');
});

Deno.test('confirmed hold executes with pending_id; adapter ops close their hold through v2_hold_resolve', async () => {
  const ti = await withWaterHold();
  const hold = ti.pending.find((p) => p.id === 'pw-w')!;
  const { plan } = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: hold.ref }] }), 'evet');
  const { result, ports } = await run(plan);
  assertEquals((ports.rpcCalls[0].args.p_payload as Record<string, unknown>).pending_id, 'pw-w');
  assertEquals(result.receipts[0].action_type, 'water_log');
  assertEquals(result.receipts[0].ok, true);

  // an adapter op held and confirmed: a profile identity change
  const ti2 = await seededTurnInput((t) => {
    t.pending_writes.push({
      id: 'pw-p', user_id: USER, op: 'profile_set', status: 'pending', created_at: '2026-10-07T09:58:05Z', expires_at: '2026-10-09T09:58:05Z',
      payload: { v: 2, op: 'profile_set', schema_version: SCHEMA_VERSION, refs: [], args: { op: 'profile_set', subject: 'self', changes: [{ field: 'height_cm', value: '172', unit: 'cm', list_op: null, as_stated: 'boyum 172' }] } },
    });
  });
  const h2 = ti2.pending.find((p) => p.id === 'pw-p')!;
  const p2 = planFor(ti2, sampleDecision({ pending_ops: [{ op: 'confirm', ref: h2.ref }] }), 'evet doğru').plan;
  const ports2 = fakeCommitPorts();
  const r2 = await executeCommit(p2, ports2);
  assertEquals(ports2.adapter.calls[0].op, 'profile_set');
  assertEquals(ports2.adapter.calls[0].row.value, 172);
  const resolve = ports2.rpcCalls.find((c) => c.name === 'v2_hold_resolve');
  assertEquals(resolve?.args.p_status, 'confirmed');
  assertEquals(resolve?.args.p_pending_id, 'pw-p');
  assertEquals(r2.receipts[0].legacy_type, 'profile_update');
});

Deno.test('a confirmed SUSPICIOUS correction: the patch writer runs with replaces, and the record_update hold is closed after it', async () => {
  const ti = await seededTurnInput((t) => {
    t.pending_writes.push({
      id: 'pw-s', user_id: USER, op: 'record_update', status: 'pending', created_at: '2026-10-07T09:58:05Z', expires_at: '2026-10-09T09:58:05Z',
      payload: {
        v: 2, op: 'record_update', schema_version: SCHEMA_VERSION, refs: [{ path: 'ref', table: 'meal_logs', id: 'ml-1' }],
        args: {
          op: 'update', ref: null, basis: 'suspicious', reason: '6 nugget için 1708 kcal olamaz', evidence_quote: null,
          patch: sampleMeal([{ name: 'tavuk nugget', as_stated: '6 adet', grams: 110, kcal: 300, protein_g: 15, carbs_g: 18, fat_g: 18 }], { day: '2026-10-02', raw: '6 tavuk nugget' }),
        },
      },
    });
  });
  const hold = ti.pending.find((p) => p.id === 'pw-s')!;
  const { plan } = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: hold.ref }] }), 'evet düzelt');
  const s = plan.steps[0];
  assertEquals(s.kind, 'rpc');
  const { result, ports } = await run(plan);
  const meal = ports.rpcCalls[0];
  assertEquals(meal.name, 'w_meal_apply');
  assertEquals((meal.args.p_payload as Record<string, unknown>).pending_id, null, 'w_meal_apply only claims meal_log holds');
  assertEquals((meal.args.p_payload as Record<string, unknown>).replaces, 'm7');
  const close = ports.rpcCalls[1];
  assertEquals(close.name, 'v2_hold_resolve');
  assertEquals(close.args.p_pending_id, 'pw-s');
  assertEquals(close.args.p_status, 'confirmed');
  assertEquals(result.receipts[0].ok, true);
});

Deno.test('an atomic confirmed write refused for good (invalid_value) closes its hold as failed; a transient failure leaves it open', async () => {
  const ti = await withWaterHold();
  const hold = ti.pending.find((p) => p.id === 'pw-w')!;
  const { plan } = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: hold.ref }] }), 'evet');
  const refused = fakeCommitPorts({ rpc: (name) => (name === 'w_water_apply' ? { ok: false, op: 'water_log', failure_class: 'invalid_value', detail: {} } : undefined) });
  await executeCommit(plan, refused);
  assertEquals(refused.rpcCalls.map((c) => c.name), ['w_water_apply', 'v2_hold_resolve']);
  assertEquals(refused.rpcCalls[1].args.p_status, 'failed');
  const transient = fakeCommitPorts({ rpc: (name) => (name === 'w_water_apply' ? { ok: false, op: 'water_log', failure_class: 'write_failed', detail: {} } : undefined) });
  await executeCommit(plan, transient);
  assertEquals(transient.rpcCalls.map((c) => c.name), ['w_water_apply']);
});

Deno.test('execute erase confirm + discard: code-owned erase line; the discard closes the hold', async () => {
  const ti = await withWaterHold();
  const erase = ti.pending.find((p) => p.op === 'account_erase_request')!;
  const water = ti.pending.find((p) => p.id === 'pw-w')!;
  const adapter = fakeAdapter();
  const { plan } = planFor(ti, sampleDecision({ pending_ops: [{ op: 'confirm', ref: erase.ref }, { op: 'discard', ref: water.ref }] }), 'evet');
  const ports = fakeCommitPorts({ adapter });
  const result = await executeCommit(plan, ports);
  assertEquals(adapter.eraseConfirms, 1);
  const er = result.receipts.find((r) => r.legacy_type === 'data_erase_confirm');
  assertEquals(er?.ok, true);
  assertEquals(ports.rpcCalls.find((c) => c.name === 'v2_hold_resolve')?.args.p_status, 'discarded');
});

Deno.test('data_erase_request → the erase hold (shared/erase-hold.ts) + its fixed question', async () => {
  const ti = await seededTurnInput();
  const adapter = fakeAdapter();
  const msg = SAMPLE_MESSAGES.data_erase_request;
  const { plan } = planFor(ti, sampleDecision({ writes: [w('data_erase_request')] }), msg);
  const result = await executeCommit(plan, fakeCommitPorts({ adapter }));
  assertEquals(adapter.eraseHolds, ['memory']);
  assertEquals(result.holds[0].op, 'account_erase_request');
  assertStringIncludes(result.holds[0].question_tr, 'koç hafızasını');
});

Deno.test('adapter ops: the verdict row goes to the adapter; ref-taking ops get their row', async () => {
  const ti = await seededTurnInput();
  const msg = 'dizim tamamen iyileşti';
  const { plan } = planFor(ti, sampleDecision({ writes: [w('supplement_log'), { op: 'constraint_retract', target: 'c2', evidence_quote: msg, note: null }] }), `whey aldım, ${msg}`);
  const adapter = fakeAdapter();
  const result = await executeCommit(plan, fakeCommitPorts({ adapter }));
  assertEquals(adapter.calls.map((c) => c.op), ['supplement_log', 'constraint_retract']);
  assertEquals(adapter.calls[0].row.name, 'whey protein');
  assertEquals(adapter.calls[1].refRow, { table: 'user_constraints', id: 'uc-2' });
  assertEquals(result.receipts.map((r) => r.legacy_type), ['supplement_log', 'profile_update']);
});

Deno.test('exposures: only COMMITTED items, tags ∪ name dictionary ∩ the spine (incl. one declared this turn)', async () => {
  const ti = await seededTurnInput();
  const peanutMeal = sampleMeal([{ name: 'fıstık ezmeli tost', allergens: ['gluten'], may_contain: ['peanut'] }]);
  const { plan } = planFor(ti, sampleDecision({ writes: [peanutMeal] }), 'fıstık ezmeli tost yedim');
  const { result } = await run(plan);
  assertEquals(result.exposures, [{ allergens: ['fıstık'], source: 'meal', ref: 'm40' }]);

  // the same meal REJECTED → no exposure (nothing was eaten into the log)
  const failing = fakeCommitPorts({ rpc: (name) => (name === 'w_meal_apply' ? { ok: false, op: 'meal_log', failure_class: 'write_failed', detail: {} } : undefined) });
  const r2 = await executeCommit(plan, failing);
  assertEquals(r2.exposures, []);

  // pure: an allergen declared this turn joins the spine
  assertEquals(exposuresOf([{ source: 'supplement', ref: 's1', items: [{ name: 'whey', allergens: ['milk'], may_contain: [] }] }], ['süt']).length, 1);
  assertEquals(exposuresOf([{ source: 'supplement', ref: 's1', items: [{ name: 'kreatin', allergens: [], may_contain: [] }] }], ['süt']).length, 0);
});
