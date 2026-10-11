/**
 * v1-ledger.test.ts — v1 executeActions writes into the turn_writes ledger (AI_MIMARI_V2 §6.1).
 *
 * Pinned:
 *   · the entries v1 builds pass v2_ledger_append's OWN write-time checks (108: field_set required for
 *     restore_previous / revert_delta, before/after carry every field, row_id required, soft_delete
 *     only on soft-deletable tables) — checked here by a fake that implements exactly those rules;
 *   · ONE call per turn, pipeline 'v1', the turn's own turn_id; an entry-level refusal retries group by
 *     group (one bad metric never costs the meal its undo); a transport failure is not retried N times;
 *     never throws;
 *   · BOTH DIRECTIONS of the mixed period: a v1-ledgered photo meal is undone by the v2 undo button
 *     through the ledger (write_id), and a v1 turn without ledger rows sends the button back to v1;
 *   · index.ts wiring: gated on the v2 turn being configured, every covered case records its write,
 *     the turn_id rides on the chat rows.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import type { LedgerAppendEntry } from '../shared/v2-db-types.ts';
import {
  appendV1Ledger, fieldWriteEntry, insertedRowEntry, LEDGER_APPEND_MAX, ledgerChunks, mealSummary, newV1Ledger, V1_LEDGER_SOURCE, type LedgerRpc,
} from './v1-ledger.ts';
import { handleV2Turn, newTurnState, undoTargetOf, type LastTurnLedgerRow } from './v2/handler.ts';
import { USER } from './v2/testing.ts';
import { chatRequest, fakeDeps } from './v2/turn-testing.ts';

const SOFT_DELETE_TABLES = new Set(['meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values', 'achievements', 'strength_sets']);

interface StoredRow extends LastTurnLedgerRow {
  turn_id: string;
  pipeline: string;
  entry: LedgerAppendEntry & { meta?: Record<string, unknown> };
}

/** v2_ledger_append, as far as its write-time checks and its receipt go (108). Rows are kept newest first. */
function fakeLedgerDb(opts: { transportError?: boolean; throws?: boolean } = {}) {
  const rows: StoredRow[] = [];
  const calls: Array<{ turnId: string; entries: Array<LedgerAppendEntry & { pipeline?: string; meta?: Record<string, unknown> }> }> = [];
  let n = 0;
  const check = (e: LedgerAppendEntry): string | null => {
    if (!['soft_delete', 'restore_previous', 'revert_delta', 'none'].includes(e.undo_mode)) return 'undo_mode';
    if (e.undo_mode === 'soft_delete' && !SOFT_DELETE_TABLES.has(e.table_name)) return 'table_has_no_soft_delete';
    const fields = e.field_set ?? [];
    if ((e.undo_mode === 'restore_previous' || e.undo_mode === 'revert_delta') && fields.length === 0) return 'field_set required';
    if (e.undo_mode !== 'none' && !e.row_id) return 'row_id required';
    if (e.undo_mode === 'restore_previous' || e.undo_mode === 'revert_delta') {
      for (const side of [e.before, e.after]) if (side && fields.some((f) => !(f in side))) return 'missing_field';
      if (!e.after) return 'after required (row exists)';
      if (fields.some((f) => f === 'id' || f === 'user_id')) return 'not_writable';
    }
    if (typeof e.op !== 'string' || e.op.length === 0 || e.op.length > 64) return 'op';
    return null;
  };
  const rpc: LedgerRpc = (name, args) => {
    if (opts.throws) throw new Error('socket hang up');
    const entries = args.p_entries as Array<LedgerAppendEntry & { pipeline?: string; meta?: Record<string, unknown> }>;
    calls.push({ turnId: String(args.p_turn_id), entries });
    if (opts.transportError) return Promise.resolve({ data: null, error: { message: 'PGRST timeout' } });
    if (name !== 'v2_ledger_append') return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > LEDGER_APPEND_MAX) {
      return Promise.resolve({ data: { ok: false, op: 'ledger_append', failure_class: 'invalid_value', detail: { path: 'entries' } }, error: null });
    }
    for (const [i, e] of entries.entries()) {
      const bad = check(e);
      if (bad) return Promise.resolve({ data: { ok: false, op: 'ledger_append', failure_class: 'invalid_value', detail: { path: `entries[${i + 1}]`, reason: bad } }, error: null });
    }
    const out = entries.map((e, i) => {
      const id = `tw-${++n}`;
      const ref = e.is_primary === false ? null : e.table_name === 'meal_logs' ? `m${n}` : e.table_name === 'daily_metrics' ? `${(e.field_set ?? []).includes('weight_kg') ? 'w' : 'd'}${n}` : null;
      rows.unshift({ id, ref, op: e.op, is_primary: e.is_primary !== false, undone_at: null, reverses: null, turn_id: String(args.p_turn_id), pipeline: e.pipeline ?? 'v2', entry: e });
      return { index: i, write_id: id, group_id: `g-${e.group}`, ref };
    });
    return Promise.resolve({ data: { ok: true, op: 'ledger_append', turn_id: args.p_turn_id, entries: out }, error: null });
  };
  /** What live.ts lastTurnLedger reads for a turn. */
  const lastTurn = (turnId: string | null) => ({ turnId, rows: turnId ? rows.filter((r) => r.turn_id === turnId).map(({ id, ref, op, is_primary, undone_at, reverses }) => ({ id, ref, op, is_primary, undone_at, reverses })) : [] });
  return { rpc, rows, calls, lastTurn };
}

/** The entries executeActions builds for a photo meal + water add + weigh-in turn (same builders). */
function photoMealTurn(turnId: string) {
  const l = newV1Ledger(turnId);
  l.add(insertedRowEntry({
    op: 'meal_log', table: 'meal_logs', rowId: 'ml-photo', forDate: '2026-10-07', group: l.nextGroup(),
    summary: mealSummary({ mealType: 'lunch', forDate: '2026-10-07', raw: 'tabakta pilav ve tavuk', items: [{ calories: 420 }, { calories: 230 }] }),
    meta: { input_method: 'photo' },
  }));
  l.add(fieldWriteEntry({ op: 'water_log', table: 'daily_metrics', rowId: 'dm-7', forDate: '2026-10-07', group: l.nextGroup(), before: { water_liters: 1.6 }, after: { water_liters: 1.8 }, additive: true }));
  const g = l.nextGroup();
  l.add(fieldWriteEntry({ op: 'body_weight', table: 'daily_metrics', rowId: 'dm-7', forDate: '2026-10-07', group: g, before: {}, after: { weight_kg: 69.5 } }));
  l.add(fieldWriteEntry({ op: 'body_weight', table: 'weight_history', rowId: 'wh-1', forDate: '2026-10-07', group: g, isPrimary: false, before: null, after: { weight_kg: 69.5 } }));
  l.add(fieldWriteEntry({ op: 'body_weight', table: 'profiles', rowId: USER, forDate: '2026-10-07', group: g, isPrimary: false, before: { weight_kg: 70.2 }, after: { weight_kg: 69.5 } }));
  return l;
}

// ─── builders ────────────────────────────────────────────────────────────────────────────────────

Deno.test('builders: an inserted row is soft_delete (before null, summary after); a field write carries every field on both sides', () => {
  const meal = insertedRowEntry({ op: 'meal_log', table: 'meal_logs', rowId: 'ml-1', forDate: '2026-10-07', group: 'v1-1', summary: mealSummary({ mealType: 'dinner', forDate: '2026-10-07', raw: 'x'.repeat(400), items: [{ calories: 300 }, { calories: 'NaN' }] }) });
  assertEquals(meal.undo_mode, 'soft_delete');
  assertEquals(meal.before, null);
  assertEquals(meal.field_set, []);
  assertEquals((meal.after as Record<string, unknown>).total_kcal, 300);
  assertEquals(((meal.after as Record<string, unknown>).raw_input as string).length, 300);
  const sleep = fieldWriteEntry({ op: 'sleep_log', table: 'daily_metrics', rowId: 'dm-1', forDate: '2026-10-07', group: 'v1-2', before: { sleep_hours: 6, mood_score: 3 }, after: { sleep_quality: null, sleep_hours: 7.5 } })!;
  assertEquals(sleep.field_set, ['sleep_hours', 'sleep_quality']);
  assertEquals(sleep.before, { sleep_hours: 6, sleep_quality: null }, 'a field the row did not have is null; unrelated fields stay out');
  assertEquals(sleep.after, { sleep_hours: 7.5, sleep_quality: null });
  assertEquals(sleep.undo_mode, 'restore_previous');
  assertEquals(fieldWriteEntry({ op: 'water_log', table: 'daily_metrics', rowId: 'dm-1', forDate: null, group: 'g', before: { water_liters: 0 }, after: { water_liters: 0.2 }, additive: true })!.undo_mode, 'revert_delta');
  assertEquals(fieldWriteEntry({ op: 'body_weight', table: 'weight_history', rowId: 'wh', forDate: null, group: 'g', before: null, after: { weight_kg: 70 } })!.before, null, 'created row');
  assertEquals(fieldWriteEntry({ op: 'x', table: 'daily_metrics', rowId: 'dm', forDate: null, group: 'g', before: {}, after: {} }), null);
  const l = newV1Ledger('t');
  l.add(null);
  assertEquals(l.entries.length, 0);
  assertEquals([l.nextGroup(), l.nextGroup()], ['v1-1', 'v1-2']);
});

// ─── the append ──────────────────────────────────────────────────────────────────────────────────

Deno.test('append: ONE v2_ledger_append for the turn — pipeline v1, the turn’s own turn_id, source meta — and every entry passes 108’s checks', async () => {
  const db = fakeLedgerDb();
  const l = photoMealTurn('turn-v1-1');
  const r = await appendV1Ledger(db.rpc, USER, l);
  assertEquals(r, { written: 5, failed: 0, calls: 1, failure_classes: [] });
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].turnId, 'turn-v1-1');
  assert(db.calls[0].entries.every((e) => e.pipeline === 'v1' && e.meta?.source === V1_LEDGER_SOURCE));
  assertEquals(db.calls[0].entries[0].meta?.input_method, 'photo', 'the entry’s own meta is kept');
  assertEquals(db.rows.filter((x) => x.is_primary).map((x) => x.op).sort(), ['body_weight', 'meal_log', 'water_log']);
});

Deno.test('append: an entry-level refusal retries group by group — one bad metric never costs the meal its undo', async () => {
  const db = fakeLedgerDb();
  const l = photoMealTurn('turn-v1-2');
  l.add({ op: 'sleep_log', table_name: 'daily_metrics', row_id: 'dm-7', field_set: [], before: null, after: null, undo_mode: 'restore_previous', group: l.nextGroup() });
  const logs: string[] = [];
  const r = await appendV1Ledger(db.rpc, USER, l, (line) => logs.push(line));
  assertEquals(r.written, 5);
  assertEquals(r.failed, 1);
  assertEquals(r.calls, 1 + 4, 'the batch, then each of the 4 groups alone');
  assert(db.rows.some((x) => x.op === 'meal_log'), 'the meal is in the ledger');
  assert(logs.some((x) => x.includes('LEDGER APPEND FAILED')));
});

Deno.test('append: a transport failure is not retried per group; a throwing client never throws out; nothing to send → no call', async () => {
  const down = fakeLedgerDb({ transportError: true });
  const r = await appendV1Ledger(down.rpc, USER, photoMealTurn('t'));
  assertEquals(r, { written: 0, failed: 5, calls: 1, failure_classes: ['write_failed'] });
  const thrown = await appendV1Ledger(fakeLedgerDb({ throws: true }).rpc, USER, photoMealTurn('t'));
  assertEquals(thrown.failed, 5);
  const idle = fakeLedgerDb();
  assertEquals((await appendV1Ledger(idle.rpc, USER, newV1Ledger('t'))).calls, 0);
  assertEquals(idle.calls.length, 0);
});

Deno.test('ledgerChunks: at most 50 entries per call, a group never split across calls (its label binds inside one call)', () => {
  const entries: LedgerAppendEntry[] = [];
  for (let g = 0; g < 30; g++) for (let i = 0; i < 3; i++) entries.push({ op: 'meal_log', table_name: 'meal_logs', row_id: `r${g}-${i}`, undo_mode: 'soft_delete', group: `v1-${g}` });
  const chunks = ledgerChunks(entries);
  assert(chunks.every((c) => c.flat().length <= LEDGER_APPEND_MAX));
  assertEquals(chunks.flat(2).length, 90);
  const groupsSeen = chunks.map((c) => new Set(c.flat().map((e) => e.group)));
  for (let a = 0; a < groupsSeen.length; a++) for (let b = a + 1; b < groupsSeen.length; b++) for (const g of groupsSeen[a]) assert(!groupsSeen[b].has(g));
});

// ─── both directions of the mixed period ─────────────────────────────────────────────────────────

Deno.test('v1 → v2: a photo meal v1 logged (ledgered under the v1 turn_id) is undone by the v2 undo button by write_id', async () => {
  const db = fakeLedgerDb();
  const l = photoMealTurn('turn-v1-photo');
  await appendV1Ledger(db.rpc, USER, l);
  const last = db.lastTurn('turn-v1-photo'); // storeMessages stamped turn_id on the v1 chat rows
  const target = undoTargetOf(last, 'meal_log');
  assertEquals(target.kind, 'write');
  const f = fakeDeps({ lastTurn: last });
  const out = await handleV2Turn(chatRequest({ message: 'Son öğün kaydını geri al' }), USER, f.deps, newTurnState());
  assertEquals(out.kind, 'response');
  assertEquals(f.commit.rpcCalls.map((c) => c.name), ['w_record_delete']);
  const mealWrite = db.rows.find((x) => x.op === 'meal_log')!;
  assertEquals(f.commit.rpcCalls[0].args.p_target, { write_id: mealWrite.id });
  // the side effects of a weigh-in are not "the write" the button means
  assertEquals(undoTargetOf(last, 'body_weight').kind, 'write');
  assertEquals(undoTargetOf(last, 'supplement_log').kind, 'not_in_ledger');
});

Deno.test('v2 → v1: the button after a v1 turn the ledger never saw (append failed / pre-ledger) goes back to v1 handleUndo', async () => {
  const db = fakeLedgerDb({ transportError: true });
  await appendV1Ledger(db.rpc, USER, photoMealTurn('turn-v1-lost'));
  for (const last of [db.lastTurn('turn-v1-lost'), db.lastTurn(null)]) {
    const f = fakeDeps({ lastTurn: last });
    const out = await handleV2Turn(chatRequest({ message: 'Son öğün kaydını geri al' }), USER, f.deps, newTurnState());
    assertEquals(out.kind, 'fallback_v1');
    assertEquals(f.commit.rpcCalls.length, 0);
  }
});

// ─── index.ts wiring (source anchors: a moved anchor fails loud) ──────────────────────────────────

Deno.test('index.ts wiring: gated on the v2 turn, every covered case records its write, the turn_id rides on the chat rows', async () => {
  // core.autocrlf checkouts are CRLF on Windows: compare on LF.
  const src = (await Deno.readTextFile(new URL('./index.ts', import.meta.url))).replaceAll('\r\n', '\n');
  assert(src.includes('const v1Ledger: V1Ledger | undefined = v2TurnConfigured() ? newV1Ledger(crypto.randomUUID()) : undefined;'), 'gate: mixed period only');
  assert(src.includes('idempotency_key as string | undefined, userTz, v1Ledger);'), 'the main executeActions call passes the ledger');
  assert(src.includes("reservedUserMessageId, undefined, v1Ledger ? { turnId: v1Ledger.turnId } : undefined);"), 'storeMessages stamps the v1 turn_id');
  assert(src.includes('const v1LedgerResult = v1LedgerAppend ? await v1LedgerAppend : null;'), 'the append lands before the chat rows');
  const start = src.indexOf('async function executeActions(');
  const end = src.indexOf('async function learnMealTime(');
  assert(start > 0 && end > start, 'anchor: executeActions moved');
  const body = src.slice(start, end);
  assert(body.includes('ledger?: V1Ledger,'), 'executeActions takes the optional ledger');
  for (const op of ['meal_log', 'workout_log', 'supplement_log']) assert(body.includes(`insertedRowEntry({ op: '${op}'`) || body.includes(`op: '${op}', table: '`), `${op} recorded`);
  for (const op of ['water_log', 'sleep_log', 'mood_log', 'step_log', 'body_weight']) assert(body.includes(`op: '${op}', table: 'daily_metrics'`), `${op} recorded`);
  // Without a ledger the daily_metrics write is v1's exact call (no select, no extra read).
  assert(body.includes("if (!ledger) {\n      const { error } = await q;"), 'no-ledger path = the original upsert');
  // A day row is patched only after it was read: a water add (no read) must not seed a partial row
  // that a later sleep/weight write would take as its "before".
  assert(body.includes('const metricsAfter = (date: string, rowId: string, values: Record<string, unknown>) => {\n    if (!metricsSeen.has(date)) return;'), 'metricsAfter never seeds an unread day');
  // profile_update's weigh-in mirror (the common "85.5 kiloyum" path) is the same body_weight group.
  const pu = body.slice(body.indexOf("case 'profile_update': {"));
  assert(pu.length > 0 && pu.includes("op: 'body_weight', table: 'daily_metrics', rowId: pwDmId"), 'profile_update weigh-in → day row entry');
  assert(pu.includes("op: 'body_weight', table: 'weight_history', rowId: whId"), 'profile_update weigh-in → weight_history entry');
  assert(pu.includes("if (ledger && profileWeightLedger && updates.weight_kg !== undefined) {"), 'profile weight recorded only once the profile update landed');
  const store = src.slice(src.indexOf('async function storeMessages('), src.indexOf('const DUP_SKIP'));
  assert(store.includes("!v2 && v1Turn ? { turn_id: v1Turn.turnId, pipeline: 'v1' } : {}"), 'only turn_id + pipeline on v1 rows');
});
