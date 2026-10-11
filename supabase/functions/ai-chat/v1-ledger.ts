/**
 * ai-chat/v1-ledger.ts — v1 executeActions writes land in the turn_writes ledger (AI_MIMARI_V2 §6.1:
 * "Faz 1'den itibaren v1 executeActions da yazar. Karışık geçiş döneminde v2 kullanıcısı v1'de
 * yapılmış bir yazmayı da tam olarak geri alabilir").
 *
 * WHY: in the v2 cohort some turns are still answered by v1 (photo, voice, plan chips, the approval
 * button, a v2 hand-over before any write). The v2 undo button and v2's ref-based corrections read
 * the ledger. Without these rows the undo button found nothing for a photo meal ("Geri alınacak bir
 * kayıt bulunamadı") while the meal stayed logged, and "su yanlış, 2 bardaktı" after a v1 water write
 * answered not_in_ledger.
 *
 * WHAT: executeActions records one entry per write it REALLY made (added after the write succeeded),
 * with the before/after the undo engine compares against (v2_ledger_append stores them canonically,
 * 108 _v2_canon). After the action loop, appendV1Ledger sends them in ONE v2_ledger_append call with
 * pipeline 'v1' and the turn's own turn_id; storeMessages stamps the same turn_id + pipeline 'v1' on
 * the turn's chat rows, so "the last turn" resolves from chat_messages to its ledger rows.
 *
 * Covered ops (the ones the undo button and the d#/w# refs need):
 *   meal_log, workout_log, supplement_log → the inserted row, undo_mode soft_delete (a workout's sets
 *     and achievements go with it inside the undo engine);
 *   water_log → daily_metrics.water_liters: an 'add' is revert_delta (undo subtracts the delta, a
 *     client water add in between is never clobbered), a day total is restore_previous;
 *   sleep_log, mood_log, step_log → the daily_metrics fields that write set, restore_previous;
 *   weight_log, and profile_update's weigh-in mirror ("85.5 kiloyum", the common chat weigh-in) →
 *     daily_metrics.weight_kg (the w# write) + weight_history + profiles.weight_kg (only a today
 *     weigh-in touches the profile, and only once that update landed), one group, restore_previous.
 * A day row is read ONCE per turn for the `before` (executeActions metricsBefore) and patched only
 * after a read, so a later write on the same day never records a guessed "before".
 * Not covered, on purpose: rows v2 deletes by ref without a ledger row anyway (life_event, lab_value —
 * 108's direct soft-delete path), tables the ledger cannot undo (constraints, food preferences,
 * commitments, recipes, plans, programs, venues logged on their own) and profile_update's other
 * columns (a profile value is corrected by writing the new value).
 *
 * NOT a behaviour change for v1: nothing here alters what v1 writes, answers or returns. Best effort,
 * like the RPC's own contract (108: "en iyi çaba"): a failed append is logged loudly and the write
 * stands; the v2 undo button then answers with v1's handleUndo semantics (a turn the ledger cannot
 * answer for goes to v1, handler.ts undoTargetOf).
 *
 * GATE (index.ts): on only while KOCHKO_ROLLOUT_V2_TURN is configured, i.e. during the mixed period.
 * Unset / off → v1 byte-identical: no extra read, no RPC, no turn_id column written.
 * Only the main turn's executeActions call is ledgered. The two salvage calls (the safety early
 * return's spine facts, the plan-cap fact salvage) write facts the undo button never offers and
 * store no turn chat row a turn_id could ride on.
 */
import { type LedgerAppendEntry, type LedgerAppendOk, parseRpcReceipt, V2_RPC } from '../shared/v2-db-types.ts';

export const V1_LEDGER_SOURCE = 'v1_execute_actions';
/** v2_ledger_append accepts 1..50 entries per call (108). */
export const LEDGER_APPEND_MAX = 50;

/** The daily_metrics columns a v1 metric write may touch (read once per day for the `before`). */
export const V1_METRIC_COLUMNS = 'id, water_liters, sleep_hours, sleep_quality, mood_score, mood_note, steps, steps_source, weight_kg';

export interface V1Ledger {
  readonly turnId: string;
  readonly entries: LedgerAppendEntry[];
  /** A fresh group label for ONE logical write (a weigh-in and its side effects share it). */
  nextGroup(): string;
  add(entry: LedgerAppendEntry | null): void;
}

export function newV1Ledger(turnId: string): V1Ledger {
  let n = 0;
  const ledger: V1Ledger = {
    turnId,
    entries: [],
    nextGroup: () => `v1-${++n}`,
    add(entry) {
      if (entry) ledger.entries.push(entry);
    },
  };
  return ledger;
}

// ─── entry builders (pure) ───────────────────────────────────────────────────────────────────────

export type SoftDeleteTable = 'meal_logs' | 'workout_logs' | 'supplement_logs';

/** A row this turn INSERTED into a soft-deletable table: undo = soft delete (+ its dependents). */
export function insertedRowEntry(p: {
  op: string;
  table: SoftDeleteTable;
  rowId: string;
  forDate: string | null;
  group: string;
  summary?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}): LedgerAppendEntry {
  return {
    op: p.op, table_name: p.table, row_id: p.rowId, for_date: p.forDate, field_set: [], before: null, after: p.summary ?? null,
    undo_mode: 'soft_delete', group: p.group, is_primary: true, ...(p.meta ? { meta: p.meta } : {}),
  };
}

/** The meal summary the v2 meal writer also stores as `after` (113 w_meal_apply). */
export function mealSummary(p: { mealType: string; forDate: string; raw: string; items: ReadonlyArray<{ calories?: unknown }> }): Record<string, unknown> {
  return {
    meal_type: p.mealType,
    logged_for_date: p.forDate,
    raw_input: p.raw.slice(0, 300),
    item_count: p.items.length,
    total_kcal: p.items.reduce((s, it) => s + (typeof it.calories === 'number' && Number.isFinite(it.calories) ? it.calories : 0), 0),
  };
}

/**
 * The fields one write set on an existing (or just created) row, with their values before and after.
 * `before` null = this write created the row (weight_history); for daily_metrics the undo engine
 * then empties only these fields, never the day row. Every field of `after` is in field_set and in
 * `before` (missing = null), which is what v2_ledger_append checks for restore_previous/revert_delta.
 */
export function fieldWriteEntry(p: {
  op: string;
  table: 'daily_metrics' | 'weight_history' | 'profiles';
  rowId: string;
  forDate: string | null;
  group: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  /** water 'add': undo subtracts the delta instead of restoring the old total. */
  additive?: boolean;
  isPrimary?: boolean;
  meta?: Record<string, unknown>;
}): LedgerAppendEntry | null {
  const fields = Object.keys(p.after).sort();
  if (fields.length === 0 || !p.rowId) return null;
  let before: Record<string, unknown> | null = null;
  if (p.before) {
    before = {};
    for (const f of fields) before[f] = p.before[f] ?? null;
  }
  const after: Record<string, unknown> = {};
  for (const f of fields) after[f] = p.after[f] ?? null;
  return {
    op: p.op, table_name: p.table, row_id: p.rowId, for_date: p.forDate, field_set: fields, before, after,
    undo_mode: p.additive ? 'revert_delta' : 'restore_previous', group: p.group, is_primary: p.isPrimary ?? true,
    ...(p.meta ? { meta: p.meta } : {}),
  };
}

// ─── the append ──────────────────────────────────────────────────────────────────────────────────

export type LedgerRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export interface V1LedgerResult {
  written: number;
  failed: number;
  calls: number;
  failure_classes: string[];
}

/** Entries per group, in order; groups packed into calls of at most LEDGER_APPEND_MAX entries (a group is never split: its label only binds inside one call). */
export function ledgerChunks(entries: readonly LedgerAppendEntry[]): LedgerAppendEntry[][][] {
  const groups = new Map<string, LedgerAppendEntry[]>();
  entries.forEach((e, i) => {
    const key = e.group ?? `auto:${i}`;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  });
  const chunks: LedgerAppendEntry[][][] = [];
  let cur: LedgerAppendEntry[][] = [];
  let size = 0;
  for (const g of groups.values()) {
    const part = g.slice(0, LEDGER_APPEND_MAX);
    if (size + part.length > LEDGER_APPEND_MAX && cur.length > 0) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(part);
    size += part.length;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Entry-level refusals: one bad entry rejects the whole call, so the groups are retried alone. */
const ENTRY_LEVEL_FAILURES: ReadonlySet<string> = new Set(['invalid_value', 'row_missing', 'not_owner']);

type CallOutcome = { ok: true } | { ok: false; failure_class: string; entryLevel: boolean };

async function appendOnce(rpc: LedgerRpc, userId: string, turnId: string, entries: LedgerAppendEntry[]): Promise<CallOutcome> {
  try {
    const r = await rpc(V2_RPC.ledgerAppend, {
      p_user: userId,
      p_turn_id: turnId,
      p_entries: entries.map((e) => ({ ...e, pipeline: 'v1', meta: { source: V1_LEDGER_SOURCE, ...(e.meta ?? {}) } })),
    });
    if (r.error) return { ok: false, failure_class: 'write_failed', entryLevel: false };
    const parsed = parseRpcReceipt<LedgerAppendOk>(r.data, ['ledger_append']);
    if (parsed.ok) return { ok: true };
    return { ok: false, failure_class: parsed.failure_class, entryLevel: ENTRY_LEVEL_FAILURES.has(parsed.failure_class) };
  } catch {
    return { ok: false, failure_class: 'write_failed', entryLevel: false };
  }
}

/**
 * Send the turn's entries. Never throws. One call per chunk (normally one per turn); a chunk refused
 * for an ENTRY-level reason is retried group by group, so one bad metric entry never costs the meal
 * its undo. A transport/DB failure is not retried (it would fail the same way N times).
 */
export async function appendV1Ledger(
  rpc: LedgerRpc,
  userId: string,
  ledger: Pick<V1Ledger, 'turnId' | 'entries'>,
  log?: (line: string, data: Record<string, unknown>) => void,
): Promise<V1LedgerResult> {
  const out: V1LedgerResult = { written: 0, failed: 0, calls: 0, failure_classes: [] };
  if (ledger.entries.length === 0) return out;
  const fail = (n: number, cls: string, ops: string[]) => {
    out.failed += n;
    out.failure_classes.push(cls);
    log?.('[v1_ledger] LEDGER APPEND FAILED (write stands; v2 undo falls back to v1 semantics)', { turn_id: ledger.turnId, failure_class: cls, ops });
  };
  for (const chunk of ledgerChunks(ledger.entries)) {
    const flat = chunk.flat();
    out.calls++;
    const r = await appendOnce(rpc, userId, ledger.turnId, flat);
    if (r.ok) {
      out.written += flat.length;
      continue;
    }
    if (!r.entryLevel || chunk.length === 1) {
      fail(flat.length, r.failure_class, flat.map((e) => e.op));
      continue;
    }
    for (const group of chunk) {
      out.calls++;
      const g = await appendOnce(rpc, userId, ledger.turnId, group);
      if (g.ok) out.written += group.length;
      else fail(group.length, g.failure_class, group.map((e) => e.op));
    }
  }
  return out;
}
