/**
 * ai-chat/v2/input.ts — the TurnInput loader, its Stage A view and the validation context
 * (AI_MIMARI_V2 §3.2 T3, §4.2). What Stage A sees of the user's records BEFORE it decides anything.
 *
 * Ownership: this file turns DATA into LINES (stageAView: meal / metric / workout / lab / hold
 * wording, Turkish numbers, "(son tur)"); stage-a-request.ts renders those lines into the ONE
 * TurnInput block every caller sends (shadow, live, eval). buildValidationContext is the ONE
 * ValidationContext builder (the eval's fixture binding calls it too).
 *
 * WHY plain queries: migrations 108-113 (record_refs, turn_writes, v2_turn_input) are not applied yet,
 * but Faz 2 needs a TurnInput now to run Stage A in shadow. So this loader reads the tables v1 already
 * has, in ONE parallel wave, and returns an object with the SAME top-level keys as the v2_turn_input
 * RPC (TURN_INPUT_KEYS, in order, item shapes from shared/v2-db-types.ts) plus the TS-side extras the
 * RPC leaves to TypeScript (local clock, history, last assistant message). Swapping the body of
 * loadTurnInput() for the RPC later keeps every consumer (view, validation context, shadow) as is.
 *
 * What the plain loader cannot know without the ledger, and says so instead of inventing it:
 *   · metric_writes / recent_writes / recently_undone are [] (they ARE turn_writes rows). Day-level
 *     metric values get d# refs in `metric_days` instead, so "su yanlış, 2 bardaktı" still has a ref.
 *   · refs are numbered per turn (oldest first), not persisted — a ref is valid for THIS turn only,
 *     which is all the validator's refInRenderedSet rule needs.
 *   · REFERANS ADAYLARI (food-reference candidates) are not loaded yet: `references` is [].
 *
 * REF GRAMMAR = the write registry's (write-registry/refs.ts: m meal · d daily metric · w workout ·
 * s supplement · e event · l lab · c constraint · k commitment · p hold · dft draft) because that is
 * the grammar the Stage A doc teaches and validateDecision checks. NOTE: shared/v2-db-types.ts (the
 * RPC side) uses t=workout and w=weight write; the swap to the RPC must translate (see risks).
 *
 * Pure except loadTurnInput's reads (through the TurnInputDb port). No user-text parsing anywhere:
 * user text is only quoted back to the model.
 */
import { getEffectiveDateForUser, getLocalParts, shiftDateString } from '../../shared/day-boundary.ts';
import { canonicalAllergenId } from '../../shared/safety-invariants.ts';
import {
  TURN_INPUT_KEYS, TURN_INPUT_SCHEMA,
  type TurnInputDay, type TurnInputMeal, type TurnInputMealItem, type TurnInputRow,
} from '../../shared/v2-db-types.ts';
import {
  ERASE_HOLD_OP, vocab,
  type DayTotals, type EdTier, type ReferenceRow, type RefKind, type RefTarget, type RenderedRef, type RenderedRefs, type ValidationContext,
} from '../../shared/write-registry/mod.ts';
import { dayLabelTr, fmtTr, quoteLine, type RefLine, renderTurnInputBlock, type StageATurnView, WEEKDAY_TR } from './stage-a-request.ts';

// ─── DB port ───────────────────────────────────────────────────────────────────────────────────────

export type DbFilter =
  | { op: 'eq'; column: string; value: string | number | boolean }
  | { op: 'gte' | 'lte' | 'gt' | 'lt'; column: string; value: string | number }
  | { op: 'in'; column: string; values: readonly (string | number)[] }
  | { op: 'is'; column: string; value: null };

export interface SelectQuery {
  /** Section name for load_errors (not a table name). */
  section: string;
  table: string;
  columns: string;
  filters: DbFilter[];
  order?: { column: string; ascending: boolean }[];
  limit?: number;
}

export type DbRow = Record<string, unknown>;
export interface DbResult {
  data: DbRow[] | null;
  error: { message: string; code?: string } | null;
}

/** The only I/O the loader does. Tests pass an in-memory fake; production passes supabaseTurnInputDb. */
export interface TurnInputDb {
  select(q: SelectQuery): Promise<DbResult>;
}

/** Minimal structural view of the supabase-js query builder (keeps this file free of the SDK). */
interface PgBuilder extends PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  select(columns: string): PgBuilder;
  eq(column: string, value: unknown): PgBuilder;
  gte(column: string, value: unknown): PgBuilder;
  lte(column: string, value: unknown): PgBuilder;
  gt(column: string, value: unknown): PgBuilder;
  lt(column: string, value: unknown): PgBuilder;
  in(column: string, values: readonly unknown[]): PgBuilder;
  is(column: string, value: null): PgBuilder;
  order(column: string, opts: { ascending: boolean }): PgBuilder;
  limit(n: number): PgBuilder;
}
export interface PgClientLike {
  from(table: string): { select(columns: string): unknown };
}

/**
 * supabase-js adapter. `.then()` is called inside select(), so the HTTP request leaves when the
 * loader is CALLED (not when it is awaited) — that is what lets the hook snapshot the user's records
 * before v1's own pre-LLM writes go out.
 */
export function supabaseTurnInputDb(client: PgClientLike): TurnInputDb {
  return {
    select(q) {
      let b = client.from(q.table).select(q.columns) as PgBuilder;
      for (const f of q.filters) {
        if (f.op === 'in') b = b.in(f.column, f.values);
        else if (f.op === 'is') b = b.is(f.column, null);
        else b = b[f.op](f.column, f.value);
      }
      for (const o of q.order ?? []) b = b.order(o.column, { ascending: o.ascending });
      if (q.limit !== undefined) b = b.limit(q.limit);
      return Promise.resolve(b.then(
        (r) => ({ data: Array.isArray(r.data) ? (r.data as DbRow[]) : r.data ? [r.data as DbRow] : null, error: r.error }),
        (e) => ({ data: null, error: { message: (e as Error)?.message ?? String(e) } }),
      ));
    },
  };
}

// ─── TurnInput ─────────────────────────────────────────────────────────────────────────────────────

export const PLAIN_TURN_INPUT_SCHEMA = 'v2_turn_input/plain-1';

/** A day-level metric value with a turn-scoped d# ref (plain loader; the RPC gives per-write d#). */
export interface MetricDayRef {
  ref: string;
  day: string;
  target: 'water' | 'sleep' | 'mood' | 'steps' | 'weight';
  /** daily_metrics column. */
  field: 'water_liters' | 'sleep_hours' | 'mood_score' | 'steps' | 'weight_kg';
  value: number;
  /** daily_metrics row id (refMap target). */
  row_id: string;
  last_turn: boolean;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  /** chat_messages.actions_executed types (v1 stores [{type}]). */
  action_types: string[];
  /** chat_messages.id — lets the handler drop THIS turn's reservation row (withoutTurnRow). */
  id?: string;
}

/** A recent coach reply (chat_messages role 'assistant'), read only for what the coach already said. */
export interface CoachReplyRow {
  created_at: string;
  content: string;
}

export interface TurnInputLoadError {
  section: string;
  message: string;
}

/**
 * One turn_writes row the loader read (newest first). The plain loader renders records from their own
 * tables; these rows add what only the ledger knows about them (re-trial 2026-10-12, lane U): which
 * write group is newest ("geri al" candidates), whether a record's live write was confirmed through
 * a hold or is a correction (record_delete asks first), and which constraint was just added (the one
 * c# record_delete may undo).
 */
export interface LedgerRecentRow {
  id: string;
  seq: number;
  /** Persistent record_refs ref (m12, w3…) — NOT a turn token. */
  ref: string | null;
  op: string;
  table: string;
  row_id: string | null;
  day: string | null;
  field_set: string[];
  before: Record<string, unknown> | null;
  is_primary: boolean;
  group_id: string;
  turn_id: string | null;
  reverses: string | null;
  undone_at: string | null;
  created_at: string;
  /** meta.pending_id: a writer claimed a hold atomically for this write. */
  pending_id: string | null;
  /** meta.reason ('replaced' on a correction's deletes). */
  reason: string | null;
  /** Written in the previous turn (the same window as the records' "son tur"). */
  last_turn: boolean;
}

/** The RPC's TurnInputRow (same keys, same item shapes) + what TypeScript adds. */
export type TurnInput = Omit<TurnInputRow, 'schema'> & {
  schema: typeof TURN_INPUT_SCHEMA | typeof PLAIN_TURN_INPUT_SCHEMA;
  ref_grammar: 'registry';
  /** The user's wall clock this turn (the effective `day` can be yesterday before the day boundary). */
  local: { tz: string | null; date: string; time: string; weekday_tr: string };
  metric_days: MetricDayRef[];
  /** Last few messages, oldest first (the current user message is NOT stored yet). */
  history: HistoryMessage[];
  last_assistant: HistoryMessage | null;
  /** What v1 wrote in the previous turn, by type (from the last assistant row). */
  last_turn_action_types: string[];
  /** Refs of the records the previous turn wrote ("son tur"), every kind (workouts included). */
  last_turn_refs: string[];
  /** REFERANS ADAYLARI — not loaded yet (§4.2 item 5). */
  references: [];
  /** A failed section is empty and listed here; the turn never fails because of it. */
  load_errors: TurnInputLoadError[];
  /** The user's newest ledger rows, newest first (absent: an older producer / fixture — no ledger facts). */
  ledger_recent?: LedgerRecentRow[];
  /** Persistent refs that confirmed holds produced (pending_writes.result.ref, last 8 days). */
  hold_confirmed_refs?: string[];
  /**
   * The coach's newest replies beyond the history window (COACH_REPLIES_RECENT, last 7 days), newest
   * first — read only so facts.ts lastReferralDay sees a specialist referral older than Stage B's
   * eight-message window (absent: an older producer / fixture — the history window alone).
   */
  coach_replies_recent?: CoachReplyRow[];
};

export interface LoadTurnInputOptions {
  userId: string;
  now?: Date;
  /** Request body's client_timezone — v1's precedence: client → active_timezone → home_timezone. */
  clientTimezone?: string | null;
  /** How many recent chat messages to load (default TURN_INPUT_HISTORY_MESSAGES). */
  historyLimit?: number;
}

// ─── small pure helpers ────────────────────────────────────────────────────────────────────────────

const isRec = (v: unknown): v is DbRow => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const day10 = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
const between = (d: string | null, lo: string, hi: string): d is string => d !== null && d >= lo && d <= hi;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function pick(row: DbRow | null, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/** Profile columns mirrored from v2_turn_input (113). A column missing in the DB is a missing key. */
const PROFILE_KEYS = [
  'gender', 'birth_year', 'height_cm', 'weight_kg', 'activity_level', 'unit_system', 'diet_mode',
  'home_timezone', 'active_timezone', 'day_boundary_hour', 'water_target_liters', 'step_target',
  'protein_per_kg', 'tdee_calculated', 'tdee_calculated_at', 'calorie_range_training_min',
  'calorie_range_training_max', 'calorie_range_rest_min', 'calorie_range_rest_max',
  'periodic_state', 'periodic_state_start', 'periodic_state_end', 'if_active', 'if_window',
  'if_eating_start', 'if_eating_end', 'onboarding_completed', 'occupation', 'sleep_time', 'wake_time',
  'work_start', 'work_end', 'dietary_restriction', 'menstrual_tracking', 'training_style',
  'equipment_access', 'cooking_skill', 'budget_level', 'household_size', 'coach_tone',
] as const;
const GOAL_KEYS = [
  'id', 'goal_type', 'target_weight_kg', 'target_weeks', 'start_weight_kg', 'weekly_rate',
  'restriction_mode', 'phase_label', 'phase_order', 'goal_reason', 'created_at',
] as const;
const TARGET_KEYS = [
  'date', 'plan_type', 'calorie_target_min', 'calorie_target_max', 'protein_target_g', 'carbs_target_g',
  'fat_target_g', 'water_target_liters', 'status', 'version',
] as const;

function weekdayOf(isoDay: string): number {
  return new Date(`${isoDay}T00:00:00Z`).getUTCDay();
}

// ─── loader ────────────────────────────────────────────────────────────────────────────────────────

/** The parallel read wave. Windows are UTC-wide (±1 day) because the user's tz comes in the same wave. */
/**
 * Recent chat messages the loader reads: Stage B's window (coach.ts COACH_HISTORY_MESSAGES = 8, four
 * coach turns) — the loader used to read 6, so the coach saw three of its own replies and repeated
 * advice it had given a turn earlier (first live trial: the "telafi etme" line four times). Stage A
 * reads only the last STAGE_A_HISTORY_MESSAGES of it.
 */
export const TURN_INPUT_HISTORY_MESSAGES = 8;

export function turnInputQueries(userId: string, now: Date, historyLimit = TURN_INPUT_HISTORY_MESSAGES): SelectQuery[] {
  const utcDay = now.toISOString().slice(0, 10);
  const lo = shiftDateString(utcDay, -8);
  const hi = shiftDateString(utcDay, 1);
  const own = (col = 'user_id'): DbFilter => ({ op: 'eq', column: col, value: userId });
  return [
    { section: 'profile', table: 'profiles', columns: '*', filters: [own('id')], limit: 1 },
    { section: 'goal', table: 'goals', columns: '*', filters: [own(), { op: 'eq', column: 'is_active', value: true }], order: [{ column: 'created_at', ascending: false }], limit: 1 },
    { section: 'safety', table: 'user_safety_state', columns: '*', filters: [own()], limit: 1 },
    {
      section: 'targets_today', table: 'daily_plans',
      columns: 'date, plan_type, calorie_target_min, calorie_target_max, protein_target_g, carbs_target_g, fat_target_g, water_target_liters, status, version',
      filters: [own(), { op: 'gte', column: 'date', value: shiftDateString(utcDay, -1) }, { op: 'lte', column: 'date', value: hi }],
      order: [{ column: 'version', ascending: false }],
    },
    { section: 'constraints', table: 'user_constraints', columns: '*', filters: [own(), { op: 'eq', column: 'active', value: true }], order: [{ column: 'stated_at', ascending: true }] },
    {
      section: 'meals', table: 'meal_logs', columns: '*, meal_log_items(*)',
      filters: [own(), { op: 'gte', column: 'logged_for_date', value: lo }, { op: 'lte', column: 'logged_for_date', value: hi }],
      order: [{ column: 'logged_for_date', ascending: true }, { column: 'logged_at', ascending: true }], limit: 120,
    },
    { section: 'days', table: 'daily_metrics', columns: '*', filters: [own(), { op: 'gte', column: 'date', value: lo }, { op: 'lte', column: 'date', value: hi }] },
    {
      section: 'workouts', table: 'workout_logs', columns: '*, strength_sets(*)',
      filters: [own(), { op: 'gte', column: 'logged_for_date', value: lo }, { op: 'lte', column: 'logged_for_date', value: hi }],
      order: [{ column: 'logged_for_date', ascending: true }, { column: 'logged_at', ascending: true }], limit: 60,
    },
    {
      section: 'supplements', table: 'supplement_logs', columns: '*',
      filters: [own(), { op: 'gte', column: 'logged_for_date', value: lo }, { op: 'lte', column: 'logged_for_date', value: hi }],
      order: [{ column: 'logged_for_date', ascending: true }, { column: 'logged_at', ascending: true }], limit: 60,
    },
    {
      section: 'labs', table: 'lab_values', columns: '*',
      filters: [own(), { op: 'gte', column: 'measured_at', value: lo }, { op: 'lte', column: 'measured_at', value: hi }],
      order: [{ column: 'measured_at', ascending: true }], limit: 40,
    },
    {
      section: 'life_events', table: 'life_events', columns: '*',
      filters: [own(), { op: 'eq', column: 'is_active', value: true }, { op: 'gte', column: 'event_date', value: shiftDateString(utcDay, -2) }],
      order: [{ column: 'event_date', ascending: true }], limit: 8,
    },
    {
      section: 'weights_recent', table: 'weight_history', columns: 'recorded_at, weight_kg',
      filters: [own(), { op: 'lte', column: 'recorded_at', value: hi }], order: [{ column: 'recorded_at', ascending: false }], limit: 10,
    },
    {
      section: 'pending', table: 'pending_writes', columns: '*',
      filters: [own(), { op: 'eq', column: 'status', value: 'pending' }, { op: 'gt', column: 'expires_at', value: now.toISOString() }],
      order: [{ column: 'created_at', ascending: true }],
    },
    {
      section: 'commitments', table: 'user_commitments', columns: '*',
      filters: [own(), { op: 'is', column: 'resolved_at', value: null }], order: [{ column: 'created_at', ascending: false }], limit: 20,
    },
    {
      section: 'plans', table: 'weekly_plans', columns: 'id, plan_type, status, week_start, generated_at, approved_at, revision_count',
      filters: [own(), { op: 'in', column: 'status', values: ['draft', 'active'] }], order: [{ column: 'generated_at', ascending: true }],
    },
    {
      // `id`: the live turn reserves its quota slot (inserts THIS message's row) while this wave reads,
      // so the handler drops that row by id and keeps the newest TURN_INPUT_HISTORY_MESSAGES (withoutTurnRow).
      section: 'history', table: 'chat_messages', columns: 'id, role, content, created_at, actions_executed',
      filters: [own(), { op: 'in', column: 'role', values: ['user', 'assistant'] }], order: [{ column: 'created_at', ascending: false }], limit: historyLimit,
    },
    {
      // Integration 2026-10-12 (re-trial): a referral older than the history window was no fact, so the
      // coach referred again after four quiet turns. Only the coach's own replies, newest first.
      section: 'coach_replies', table: 'chat_messages', columns: 'created_at, content',
      filters: [own(), { op: 'eq', column: 'role', value: 'assistant' }, { op: 'gte', column: 'created_at', value: `${shiftDateString(utcDay, -7)}T00:00:00Z` }],
      order: [{ column: 'created_at', ascending: false }], limit: COACH_REPLIES_RECENT,
    },
    { section: 'active_intent', table: 'chat_sessions', columns: 'active_intent', filters: [own(), { op: 'eq', column: 'is_active', value: true }], limit: 1 },
    { section: 'portion_calibration', table: 'ai_summary', columns: 'portion_calibration', filters: [own()], limit: 1 },
    // Lane U (re-trial 2026-10-12): what only the ledger knows about the rendered records.
    {
      section: 'ledger_recent', table: 'turn_writes',
      columns: 'id, seq, ref, op, table_name, row_id, for_date, field_set, before, is_primary, group_id, turn_id, reverses, undone_at, created_at, meta',
      filters: [own(), { op: 'gte', column: 'created_at', value: `${lo}T00:00:00Z` }],
      order: [{ column: 'seq', ascending: false }], limit: LEDGER_RECENT_ROWS,
    },
    {
      section: 'holds_confirmed', table: 'pending_writes', columns: 'op, result, resolved_at',
      filters: [own(), { op: 'eq', column: 'status', value: 'confirmed' }, { op: 'gte', column: 'resolved_at', value: `${lo}T00:00:00Z` }],
      order: [{ column: 'resolved_at', ascending: false }], limit: 30,
    },
  ];
}

/** How many of the user's newest ledger rows the loader reads (a turn writes a handful; 3 groups ≪ 80). */
export const LEDGER_RECENT_ROWS = 80;

/** How many of the coach's newest replies (last 7 days) the referral fact looks back over. */
export const COACH_REPLIES_RECENT = 20;

/**
 * Extra history rows the LIVE loader reads (live.ts): the quota reservation inserts this turn's user row
 * while the read wave runs, so the newest row may be the current message itself; withoutTurnRow drops
 * it by id and trims back to TURN_INPUT_HISTORY_MESSAGES, so the window never shrinks.
 */
export const TURN_ROW_SLACK = 1;

/**
 * The TurnInput without THIS turn's reservation row (if the read wave saw it), history trimmed to the
 * newest `limit` messages. The derived "son tur" fields are unaffected: they hang on the last coach
 * reply, and the reservation row is a user row after it.
 */
export function withoutTurnRow(ti: TurnInput, rowId: string | null, limit = TURN_INPUT_HISTORY_MESSAGES): TurnInput {
  const history = ti.history.filter((h) => !(rowId && h.id === rowId));
  if (history.length === ti.history.length && history.length <= limit) return ti;
  return { ...ti, history: history.slice(-limit) };
}

/**
 * Load the TurnInput. Every read is issued before the first await (one wave), so callers that start
 * it at the top of a turn snapshot the records before the turn's own writes. Never throws: a failed
 * section is empty and named in `load_errors` (a failed SAFETY read makes the ED tier 'unknown').
 */
export async function loadTurnInput(db: TurnInputDb, opts: LoadTurnInputOptions): Promise<TurnInput> {
  const now = opts.now ?? new Date();
  const queries = turnInputQueries(opts.userId, now, opts.historyLimit ?? TURN_INPUT_HISTORY_MESSAGES);
  const pending = queries.map((q) => {
    try {
      return db.select(q).catch((e) => ({ data: null, error: { message: (e as Error)?.message ?? String(e) } }) as DbResult);
    } catch (e) {
      return Promise.resolve({ data: null, error: { message: (e as Error)?.message ?? String(e) } } as DbResult);
    }
  });
  const results = await Promise.all(pending);
  const sections = new Map<string, DbRow[]>();
  const load_errors: TurnInputLoadError[] = [];
  queries.forEach((q, i) => {
    const r = results[i];
    if (r.error) load_errors.push({ section: q.section, message: r.error.message.slice(0, 300) });
    sections.set(q.section, (r.data ?? []).filter(isRec));
  });
  return assembleTurnInput(sections, load_errors, { now, clientTimezone: opts.clientTimezone ?? null });
}

/** Pure assembly from raw section rows (exported for tests and for replaying captured reads). */
export function assembleTurnInput(
  sections: ReadonlyMap<string, DbRow[]>,
  load_errors: TurnInputLoadError[],
  ctx: { now: Date; clientTimezone: string | null },
): TurnInput {
  const rows = (s: string) => sections.get(s) ?? [];
  const profileRow = rows('profile')[0] ?? null;
  const tz = ctx.clientTimezone ?? str(profileRow?.active_timezone) ?? str(profileRow?.home_timezone);
  const today = getEffectiveDateForUser(tz, num(profileRow?.day_boundary_hour), ctx.now);
  const from = shiftDateString(today, -6);
  const yesterday = shiftDateString(today, -1);
  const lp = getLocalParts(tz, ctx.now);
  const pad2 = (n: number) => String(n).padStart(2, '0');

  // History first: "son tur" is the window between the last user message and the coach's answer.
  const history: HistoryMessage[] = rows('history')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: typeof m.content === 'string' ? m.content : '',
      created_at: str(m.created_at) ?? '',
      action_types: Array.isArray(m.actions_executed)
        ? (m.actions_executed as unknown[]).map((a) => (isRec(a) && typeof a.type === 'string' ? a.type : '')).filter(Boolean)
        : [],
      ...(typeof m.id === 'string' && m.id ? { id: m.id } : {}),
    }))
    .sort((a, b) => cmp(a.created_at, b.created_at));
  let last_assistant: HistoryMessage | null = null;
  for (const m of history) if (m.role === 'assistant') last_assistant = m;
  let lastTurnFrom: string | null = null;
  if (last_assistant) {
    for (const m of history) if (m.role === 'user' && m.created_at < last_assistant.created_at) lastTurnFrom = m.created_at;
    lastTurnFrom ??= new Date(Date.parse(last_assistant.created_at) - 120_000).toISOString();
  }
  const inLastTurn = (at: unknown): boolean => {
    const t = str(at);
    if (!t || !last_assistant || !lastTurnFrom) return false;
    const ms = Date.parse(t);
    return ms >= Date.parse(lastTurnFrom) - 1_000 && ms <= Date.parse(last_assistant.created_at) + 1_000;
  };
  const last_turn_action_types = last_assistant?.action_types ?? [];

  // ── meals (m#) ──
  const mealRows = rows('meals')
    .filter((m) => m.is_deleted !== true && between(day10(m.logged_for_date), from, today))
    .sort((a, b) => cmp(String(a.logged_for_date), String(b.logged_for_date)) || cmp(String(a.logged_at ?? ''), String(b.logged_at ?? '')) || cmp(String(a.id), String(b.id)));
  const meals: TurnInputMeal[] = mealRows.map((m, i) => {
    const itemRows = (Array.isArray(m.meal_log_items) ? m.meal_log_items : []).filter(isRec);
    const items: TurnInputMealItem[] = itemRows.map((it) => {
      const meta = isRec(it.meta) ? it.meta : {};
      return {
        name: str(it.food_name) ?? '?',
        as_stated: str(it.as_stated),
        portion_text: str(it.portion_text) ?? '',
        grams: num(it.portion_grams),
        kcal: num(it.calories) ?? 0,
        protein_g: num(it.protein_g) ?? 0,
        carbs_g: num(it.carbs_g) ?? 0,
        fat_g: num(it.fat_g) ?? 0,
        alcohol_g: num(it.alcohol_g),
        data_source: str(it.data_source),
        reference_key: str(it.reference_key),
        allergen_tags: Array.isArray(it.allergen_tags) ? (it.allergen_tags as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        may_contain: Array.isArray(meta.may_contain) ? (meta.may_contain as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        confidence: num(meta.confidence),
      };
    });
    const sum = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g') => items.reduce((s, it) => s + it[k], 0);
    return {
      ref: `m${i + 1}`,
      id: String(m.id),
      day: day10(m.logged_for_date)!,
      meal_type: (str(m.meal_type) ?? 'snack') as TurnInputMeal['meal_type'],
      logged_at: str(m.logged_at) ?? '',
      raw_input: (str(m.raw_input) ?? '').slice(0, 300),
      input_method: str(m.input_method),
      confidence: (str(m.confidence) as TurnInputMeal['confidence']) ?? null,
      supersedes_ref: null,
      source: 'app',
      turn_id: null,
      last_turn: inLastTurn(m.logged_at),
      total_kcal: sum('kcal'),
      total_protein_g: sum('protein_g'),
      total_carbs_g: sum('carbs_g'),
      total_fat_g: sum('fat_g'),
      total_alcohol_g: items.reduce((s, it) => s + (it.alcohol_g ?? 0), 0),
      items,
    };
  });

  // ── days (7, oldest first) + metric day refs (d#, today and yesterday) ──
  const metricByDay = new Map<string, DbRow>();
  for (const r of rows('days')) {
    const d = day10(r.date);
    if (d) metricByDay.set(d, r);
  }
  const days: TurnInputDay[] = [];
  for (let k = 6; k >= 0; k--) {
    const d = shiftDateString(today, -k);
    const dm = metricByDay.get(d) ?? null;
    const dayMeals = meals.filter((m) => m.day === d);
    const q = str(dm?.sleep_quality);
    days.push({
      day: d,
      meal_count: dayMeals.length,
      kcal: dayMeals.reduce((s, m) => s + m.total_kcal, 0),
      protein_g: dayMeals.reduce((s, m) => s + m.total_protein_g, 0),
      carbs_g: dayMeals.reduce((s, m) => s + m.total_carbs_g, 0),
      fat_g: dayMeals.reduce((s, m) => s + m.total_fat_g, 0),
      water_liters: num(dm?.water_liters),
      sleep_hours: num(dm?.sleep_hours),
      sleep_quality: q === 'good' || q === 'ok' || q === 'bad' ? q : null,
      mood_score: num(dm?.mood_score),
      steps: num(dm?.steps),
      weight_kg: num(dm?.weight_kg),
    });
  }
  const METRIC_FIELDS: ReadonlyArray<[MetricDayRef['field'], MetricDayRef['target'], string]> = [
    ['water_liters', 'water', 'water_log'],
    ['sleep_hours', 'sleep', 'sleep_log'],
    ['mood_score', 'mood', 'mood_log'],
    ['steps', 'steps', 'step_log'],
    ['weight_kg', 'weight', 'weight_log'],
  ];
  const metric_days: MetricDayRef[] = [];
  for (const d of [yesterday, today]) {
    const dm = metricByDay.get(d);
    if (!dm) continue;
    for (const [field, target, v1Type] of METRIC_FIELDS) {
      const value = num(dm[field]);
      if (value === null || (field === 'water_liters' && value <= 0)) continue;
      metric_days.push({
        ref: `d${metric_days.length + 1}`, day: d, target, field, value, row_id: String(dm.id),
        // daily_metrics has no write timestamp: a metric is "son tur" when the last turn wrote that
        // type and this is today's row (the ledger makes this exact once 108 is applied).
        last_turn: d === today && last_turn_action_types.includes(v1Type),
      });
    }
  }

  // ── workouts (w#), supplements (s#), labs (l#), life events (e#) ──
  const workouts: TurnInputRow['workouts'] = rows('workouts')
    .filter((w) => w.is_deleted !== true && between(day10(w.logged_for_date), from, today))
    .map((w, i) => ({
      ref: `w${i + 1}`, id: String(w.id), day: day10(w.logged_for_date)!,
      workout_type: str(w.workout_type), duration_min: num(w.duration_min) ?? 0, intensity: str(w.intensity),
      calories_burned: num(w.calories_burned), raw_input: (str(w.raw_input) ?? '').slice(0, 200),
      set_count: Array.isArray(w.strength_sets) ? (w.strength_sets as unknown[]).filter((s) => isRec(s) && s.is_deleted !== true).length : 0,
    }));
  const workoutLastTurn = new Set(rows('workouts').filter((w) => inLastTurn(w.logged_at)).map((w) => String(w.id)));
  const supplementLastTurn = new Set(rows('supplements').filter((s) => inLastTurn(s.logged_at)).map((s) => String(s.id)));
  const supplements: TurnInputRow['supplements'] = rows('supplements')
    .filter((s) => s.is_deleted !== true && between(day10(s.logged_for_date), from, today))
    .map((s, i) => ({
      ref: `s${i + 1}`, id: String(s.id), day: day10(s.logged_for_date)!, name: str(s.supplement_name) ?? '?',
      amount: str(s.amount), calories: num(s.calories), protein_g: num(s.protein_g), logged_at: str(s.logged_at),
    }));
  const labs: TurnInputRow['labs'] = rows('labs')
    .filter((l) => l.is_deleted !== true && between(day10(l.measured_at), from, today))
    .map((l, i) => ({
      ref: `l${i + 1}`, id: String(l.id), day: day10(l.measured_at)!, parameter: str(l.parameter_name) ?? '?',
      value: num(l.value) ?? 0, unit: str(l.unit) ?? '', reference_min: num(l.reference_min), reference_max: num(l.reference_max),
      is_out_of_range: typeof l.is_out_of_range === 'boolean' ? l.is_out_of_range : null, notes: str(l.notes),
    }));
  const life_events: TurnInputRow['life_events'] = rows('life_events')
    .filter((e) => e.is_deleted !== true && e.is_active !== false && (day10(e.event_date) ?? '') >= yesterday)
    .slice(0, 5)
    .map((e, i) => ({
      ref: `e${i + 1}`, id: String(e.id), title: str(e.title) ?? '?', event_type: str(e.event_type) ?? 'other',
      event_date: day10(e.event_date)!, note: str(e.note),
    }));

  // ── constraints (c#), holds (p#), commitments (k#), drafts (dft#) ──
  const constraints: TurnInputRow['constraints'] = rows('constraints')
    .filter((c) => c.active !== false)
    .sort((a, b) => cmp(String(a.stated_at ?? ''), String(b.stated_at ?? '')) || cmp(String(a.id), String(b.id)))
    .map((c, i) => {
      const sev = str(c.severity);
      return {
        ref: `c${i + 1}`, id: String(c.id), kind: str(c.kind) ?? '?', subject: str(c.subject) ?? '?',
        severity: sev === 'mild' || sev === 'moderate' || sev === 'severe' ? sev : null,
        body_parts: Array.isArray(c.body_parts) ? (c.body_parts as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        note: str(c.note), source: str(c.source) ?? 'user_stated', confidence: num(c.confidence) ?? 1,
        confirmed_at: str(c.confirmed_at), stated_at: str(c.stated_at) ?? '',
      };
    });
  const holds: TurnInputRow['pending'] = rows('pending')
    .filter((p) => p.status === 'pending' && (str(p.expires_at) ?? '') > ctx.now.toISOString())
    .sort((a, b) => cmp(String(a.created_at ?? ''), String(b.created_at ?? '')))
    .map((p, i) => {
      const op = str(p.op) ?? '?';
      const hc = str(p.hold_class);
      return {
        ref: `p${i + 1}`, id: String(p.id), op, payload: isRec(p.payload) ? p.payload : {},
        subject_key: str(p.subject_key),
        // Pre-109 rows have no hold_class; the KVKK erase hold is a consent (safety) record (111).
        hold_class: hc === 'ask' || hc === 'safety' ? hc : op === ERASE_HOLD_OP ? 'safety' : 'ask',
        reason_code: str(p.reason_code), schema_version: str(p.schema_version), turn_id: str(p.turn_id),
        created_at: str(p.created_at) ?? '', expires_at: str(p.expires_at) ?? '',
      };
    });
  const commitments: TurnInputRow['commitments'] = rows('commitments')
    .filter((c) => !c.resolved_at && ['pending', 'followed_up'].includes(str(c.status) ?? 'pending'))
    .sort((a, b) => {
      const fa = str(a.follow_up_at), fb = str(b.follow_up_at);
      if (fa !== fb) return fa === null ? 1 : fb === null ? -1 : cmp(fa, fb);
      return cmp(String(a.created_at ?? ''), String(b.created_at ?? ''));
    })
    .slice(0, 10)
    .map((c, i) => ({
      ref: `k${i + 1}`, id: String(c.id), commitment: str(c.commitment) ?? '', follow_up_at: str(c.follow_up_at),
      status: str(c.status), created_at: str(c.created_at) ?? '',
    }));
  const planRows = rows('plans');
  const plans: TurnInputRow['plans'] = {
    active: planRows.filter((p) => p.status === 'active').map((p) => ({
      id: String(p.id), plan_type: str(p.plan_type) ?? 'diet', plan_subtype: null, week_start: day10(p.week_start) ?? '',
      approved_at: str(p.approved_at), stale_reason: null,
    })),
    drafts: planRows.filter((p) => p.status === 'draft').map((p, i) => ({
      ref: `dft${i + 1}`, id: String(p.id), plan_type: str(p.plan_type) ?? 'diet', plan_subtype: null,
      week_start: day10(p.week_start) ?? '', generated_at: str(p.generated_at) ?? '', revision_count: num(p.revision_count) ?? 0,
    })),
  };

  // ── ledger facts (lane U): newest first; refs here are persistent record_refs refs, never turn tokens ──
  const ledger_recent: LedgerRecentRow[] = rows('ledger_recent')
    .filter((w) => typeof w.id === 'string' && typeof w.op === 'string' && typeof w.group_id === 'string')
    .map((w) => {
      const meta = isRec(w.meta) ? w.meta : {};
      return {
        id: String(w.id), seq: num(w.seq) ?? 0, ref: str(w.ref), op: String(w.op), table: str(w.table_name) ?? '',
        row_id: str(w.row_id), day: day10(w.for_date),
        field_set: Array.isArray(w.field_set) ? (w.field_set as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        before: isRec(w.before) ? w.before : null, is_primary: w.is_primary === true, group_id: String(w.group_id),
        turn_id: str(w.turn_id), reverses: str(w.reverses), undone_at: str(w.undone_at), created_at: str(w.created_at) ?? '',
        pending_id: str(meta.pending_id), reason: str(meta.reason), last_turn: inLastTurn(w.created_at),
      };
    })
    .sort((a, b) => b.seq - a.seq);
  const hold_confirmed_refs = rows('holds_confirmed')
    .map((p) => (isRec(p.result) ? str(p.result.ref) : null))
    .filter((r): r is string => r !== null);
  const coach_replies_recent: CoachReplyRow[] = rows('coach_replies')
    .map((m) => ({ created_at: str(m.created_at) ?? '', content: typeof m.content === 'string' ? m.content : '' }))
    .filter((m) => m.created_at !== '' && m.content !== '')
    .sort((a, b) => cmp(b.created_at, a.created_at));

  const safetyRow = rows('safety')[0] ?? null;
  const tier = str(safetyRow?.ed_tier);
  const ot = str(safetyRow?.overtraining_tier);
  const targetRows = rows('targets_today').filter((t) => day10(t.date) === today);
  const intentRow = rows('active_intent')[0] ?? null;
  const portionRow = rows('portion_calibration')[0] ?? null;

  const ti: TurnInput = {
    schema: PLAIN_TURN_INPUT_SCHEMA,
    day: today,
    window: { from, to: today },
    generated_at: ctx.now.toISOString(),
    last_turn: { turn_id: null, at: last_assistant?.created_at ?? null },
    profile: pick(profileRow, PROFILE_KEYS),
    goal: rows('goal')[0] ? pick(rows('goal')[0], GOAL_KEYS) : null,
    safety: safetyRow
      ? {
        ed_tier: tier === 'watch' || tier === 'amber' || tier === 'red' ? tier : 'none',
        ed_signal_count: num(safetyRow.ed_signal_count) ?? 0,
        ed_last_signal_at: str(safetyRow.ed_last_signal_at),
        ed_escalated_at: str(safetyRow.ed_escalated_at),
        overtraining_tier: ot === 'watch' || ot === 'amber' ? ot : 'none',
        updated_at: str(safetyRow.updated_at) ?? '',
      }
      : null,
    targets_today: targetRows[0] ? pick(targetRows[0], TARGET_KEYS) : null,
    constraints,
    meals,
    days,
    metric_writes: [],
    workouts,
    supplements,
    labs,
    life_events,
    weights_recent: rows('weights_recent')
      .map((w) => ({ day: day10(w.recorded_at) ?? '', kg: num(w.weight_kg) ?? 0 }))
      .filter((w) => w.day !== '' && w.day <= today && w.kg > 0)
      .sort((a, b) => cmp(a.day, b.day)),
    recent_writes: [],
    recently_undone: [],
    pending: holds,
    commitments,
    plans,
    portion_calibration: isRec(portionRow?.portion_calibration) ? portionRow.portion_calibration : {},
    active_intent: isRec(intentRow?.active_intent) ? intentRow.active_intent : null,
    // ── TS-side extras ──
    ref_grammar: 'registry',
    local: { tz, date: lp.dateStr, time: `${pad2(lp.hour)}:${pad2(lp.minute)}`, weekday_tr: WEEKDAY_TR[weekdayOf(lp.dateStr)] ?? '' },
    metric_days,
    history,
    last_assistant,
    last_turn_action_types,
    // TurnInputRow's workout/supplement shapes have no last_turn field, so the flag rides here.
    last_turn_refs: [
      ...meals.filter((m) => m.last_turn).map((m) => m.ref),
      ...metric_days.filter((d) => d.last_turn).map((d) => d.ref),
      ...workouts.filter((w) => workoutLastTurn.has(w.id)).map((w) => w.ref),
      ...supplements.filter((x) => supplementLastTurn.has(x.id)).map((x) => x.ref),
    ],
    references: [],
    load_errors,
    ledger_recent,
    hold_confirmed_refs,
    coach_replies_recent,
  };
  return ti;
}

/** Every TURN_INPUT_KEYS key, in RPC order — the mirror contract (input.test.ts pins it). */
export function turnInputKeyOrder(ti: TurnInput): string[] {
  return Object.keys(ti).filter((k) => (TURN_INPUT_KEYS as readonly string[]).includes(k));
}

// ─── refs ──────────────────────────────────────────────────────────────────────────────────────────

/** Server-side refMap target (never shown to the model). */
export interface RefMapTarget {
  table: string;
  id: string;
  /** daily_metrics column for a d# day ref. */
  field?: string;
}

export interface TurnRefs {
  /** What validateDecision checks a ref against (exactly the rendered set). */
  rendered: RenderedRefs;
  /** token → row (for a future commit; the shadow only counts it). */
  refMap: Map<string, RefMapTarget>;
}

const METRIC_OP: Record<MetricDayRef['target'], string> = {
  water: 'water_log', sleep: 'sleep_log', mood: 'mood_log', steps: 'step_log', weight: 'body_weight',
};

const ALLERGEN_IDS: readonly string[] = Object.keys(vocab.ALLERGENS);

/**
 * The id a spine subject is compared by. v1 stored allergen subjects in Turkish ('fıstık',
 * 'yumurta') while v2 writes vocabulary ids ('peanut', 'egg'); read through the allergen
 * invariant's OWN dictionary (safety-invariants canonicalAllergenId — one source), a legacy row
 * carries the id the model writes, so a re-statement is recognised (no duplicate row) and a "yok"
 * finds the row to retract. Only allergen/intolerance subjects have a vocabulary; anything without
 * exactly one matching id ('kabuklu', 'laktoz', an injury subject) stays as stored.
 */
export function canonicalConstraintSubject(kind: string, subject: string): string {
  if (kind !== 'allergen' && kind !== 'intolerance') return subject;
  return canonicalAllergenId(subject, ALLERGEN_IDS) ?? subject;
}

/** The refs rendered this turn, from the TurnInput alone (pure). */
export function turnRefs(ti: TurnInput): TurnRefs {
  const rendered: Record<string, RenderedRef> = {};
  const refMap = new Map<string, RefMapTarget>();
  const add = (ref: string, kind: RefKind, target: RefTarget, table: string, id: string, extra: Partial<RenderedRef> = {}, field?: string) => {
    rendered[ref] = { kind, target, undone: false, later_write_on_same_field: false, ...extra };
    refMap.set(ref, field ? { table, id, field } : { table, id });
  };
  const last = new Set(ti.last_turn_refs);
  for (const m of ti.meals) {
    add(m.ref, 'm', 'meal', 'meal_logs', m.id, {
      op: 'meal_log', day: m.day, last_turn: m.last_turn, summary_tr: mealSummary(m), user_summary_tr: mealSummary(m, false),
      snapshot: {
        items: m.items.map((it) => ({ name: it.name, portion: it.as_stated ?? (it.portion_text || null), kcal: it.kcal })),
        total_kcal: m.total_kcal,
      },
    });
  }
  for (const d of ti.metric_days) {
    add(d.ref, 'd', d.target, 'daily_metrics', d.row_id, {
      op: METRIC_OP[d.target], day: d.day, last_turn: d.last_turn, summary_tr: metricSummary(d), snapshot: { value: d.value },
    }, d.field);
  }
  for (const w of ti.workouts) add(w.ref, 'w', 'workout', 'workout_logs', w.id, { op: 'workout_log', day: w.day, last_turn: last.has(w.ref) });
  for (const s of ti.supplements) add(s.ref, 's', 'supplement', 'supplement_logs', s.id, { op: 'supplement_log', day: s.day, last_turn: last.has(s.ref) });
  for (const l of ti.labs) add(l.ref, 'l', 'lab', 'lab_values', l.id, { op: 'lab_value', day: l.day });
  for (const e of ti.life_events) add(e.ref, 'e', 'life_event', 'life_events', e.id, { op: 'life_event', day: e.event_date });
  for (const c of ti.constraints) {
    const subject = canonicalConstraintSubject(c.kind, c.subject);
    add(c.ref, 'c', 'constraint', 'user_constraints', c.id, {
      // Worded from the STORED subject: a legacy row keeps the user's own word ("fıstık alerjisi"),
      // a vocabulary id becomes its label ("yer fıstığı alerjisi").
      user_summary_tr: constraintSummaryTr({ kind: c.kind, subject: c.subject, severity: c.severity, body_parts: c.body_parts }),
      constraint: {
        kind: c.kind, subject, severity: c.severity, body_parts: c.body_parts,
        ...(subject !== c.subject ? { stored_subject: c.subject } : {}),
      },
    });
  }
  const assistantTimes = ti.history.filter((h) => h.role === 'assistant').map((h) => h.created_at);
  for (const p of ti.pending) {
    add(p.ref, 'p', 'pending', 'pending_writes', p.id, {
      // Only replies the loader saw (historyLimit) are counted; a hold older than that window reads
      // as "many replies since", which is the conservative side for the one-turn erase rule.
      pending: { op: p.op, expires_at: p.expires_at, replies_since: assistantTimes.filter((t) => t > p.created_at).length },
    });
  }
  for (const k of ti.commitments) add(k.ref, 'k', 'commitment', 'user_commitments', k.id);
  for (const d of ti.plans.drafts) add(d.ref, 'dft', 'plan_draft', 'weekly_plans', d.id);
  applyLedgerFacts(ti, rendered, refMap);
  return { rendered, refMap };
}

// ─── ledger facts on the rendered refs (lane U, re-trial 2026-10-12) ───────────────────────────────

const RECORD_OPS: ReadonlySet<string> = new Set(['record_delete', 'record_restore']);
/** The tables whose rows a rendered record ref names (d# = a daily_metrics row + field). */
const LEDGERED_TABLES: ReadonlySet<string> = new Set([
  'meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values', 'daily_metrics', 'user_constraints',
]);
/** How many of the newest write groups "geri al" may name as candidates. */
export const RECENT_WRITE_GROUPS = 3;

const isLiveWrite = (w: LedgerRecentRow) => w.is_primary && w.undone_at === null && w.reverses === null && !RECORD_OPS.has(w.op);

/**
 * The newest live write group ids, newest first (at most RECENT_WRITE_GROUPS). A group is one
 * logical write (a meal + its venue, a correction = the old record's deletes + the new record).
 */
export function recentWriteGroups(ledger: readonly LedgerRecentRow[]): string[] {
  const out: string[] = [];
  for (const w of ledger) {
    if (!isLiveWrite(w) || out.includes(w.group_id)) continue;
    out.push(w.group_id);
    if (out.length >= RECENT_WRITE_GROUPS) break;
  }
  return out;
}

/**
 * What the ledger says about each rendered record: its live write (the newest live primary row on
 * that row — and that field, for a d#), whether that write was confirmed through a hold (the writer
 * claimed it — meta.pending_id — or a confirmed hold's result names its ref), whether it is a
 * correction, how recent its group is, and — for a c# — whether its constraint_add is the user's
 * newest write and switched the row on (the one constraint record_delete may undo). Pure; a TurnInput
 * without ledger rows (an older producer, a fixture) changes nothing.
 */
function applyLedgerFacts(ti: TurnInput, rendered: Record<string, RenderedRef>, refMap: ReadonlyMap<string, RefMapTarget>): void {
  const ledger = ti.ledger_recent ?? [];
  if (ledger.length === 0) return;
  const confirmed = new Set(ti.hold_confirmed_refs ?? []);
  const groups = recentWriteGroups(ledger);
  for (const [token, t] of refMap) {
    const r = rendered[token];
    if (!r || !LEDGERED_TABLES.has(t.table)) continue;
    const w = ledger.find((x) => isLiveWrite(x) && x.table === t.table && x.row_id === t.id
      && (t.field ? x.field_set.includes(t.field) : true)
      && (t.table === 'user_constraints' ? x.op === 'constraint_add' : true));
    if (!w) continue;
    const rank = groups.indexOf(w.group_id) + 1;
    if (rank > 0) r.recent_rank = rank;
    if (t.table === 'user_constraints') {
      if (w.last_turn) r.last_turn = true;
      // The add switched the row on AND belongs to the user's newest write turn: nothing was written in
      // another turn since (a confirming "evet" writes nothing before its own commit, so it still holds there).
      const newestTurn = w.turn_id !== null && ledger.every((x) => !isLiveWrite(x) || x.seq <= w.seq || x.turn_id === w.turn_id);
      if (newestTurn && w.before?.active === false) r.undo_add = true;
      continue;
    }
    if (w.pending_id !== null || (w.ref !== null && confirmed.has(w.ref))) r.confirmed_hold = true;
    if (ledger.some((x) => x.group_id === w.group_id && x.op === 'record_delete' && x.reason === 'replaced' && x.undone_at === null)) r.correction = true;
  }
}

// ─── validation context ────────────────────────────────────────────────────────────────────────────

/** ED tier for validation: a failed safety read is 'unknown' (fail closed, §7.1), a missing row 'none'. */
export function edTierOf(ti: TurnInput): EdTier {
  if (ti.load_errors.some((e) => e.section === 'safety')) return 'unknown';
  return ti.safety?.ed_tier ?? 'none';
}

/**
 * The facts validateDecision reads, in the shape BOTH producers have: the loader's TurnInput
 * (validationContext below) and an eval fixture snapshot (eval/bind.ts validationContextFor). The
 * ValidationContext is built from them by ONE function, so shadow/live and the eval can never
 * disagree on how a profile key is typed, which weigh-in counts as "last" or how a day total looks.
 */
export interface ValidationFacts {
  today: string;
  now_iso: string;
  message: string;
  /** Exactly the refs rendered this turn. */
  refs: RenderedRefs;
  /** Stored per-day totals before this turn's writes (a missing value is null). */
  days: ReadonlyArray<{ day: string; water_liters?: unknown; steps?: unknown; sleep_hours?: unknown; weight_kg?: unknown }>;
  /** Raw profile record (profiles row / fixture profile); identity keys are typed here. */
  profile: Readonly<Record<string, unknown>> | null;
  /** Raw active goal (goals row), or null. */
  goal: Readonly<Record<string, unknown>> | null;
  /** Stored weigh-ins (any order); the latest within LAST_WEIGHT_DAYS becomes last_weight. */
  weights: ReadonlyArray<{ day: string; kg: number }>;
  ed_tier: EdTier;
  reference_rows?: Readonly<Record<string, ReferenceRow>>;
}

/** How far back a stored weigh-in still counts for the jump-plausibility check. */
export const LAST_WEIGHT_DAYS = 14;

/** THE ValidationContext builder (pure). */
export function buildValidationContext(f: ValidationFacts): ValidationContext {
  const day_totals: Record<string, DayTotals> = {};
  for (const d of f.days) {
    day_totals[d.day] = {
      water_liters: num(d.water_liters), steps: num(d.steps), sleep_hours: num(d.sleep_hours), weight_kg: num(d.weight_kg),
    };
  }
  const p = f.profile ?? {};
  const from = shiftDateString(f.today, -LAST_WEIGHT_DAYS);
  let lastW: { kg: number; day: string } | null = null;
  for (const w of f.weights) {
    if (w.day < from || w.day > f.today || !(w.kg > 0)) continue;
    if (!lastW || w.day >= lastW.day) lastW = { kg: w.kg, day: w.day };
  }
  return {
    today: f.today,
    now_iso: f.now_iso,
    user_message: f.message,
    refs: f.refs,
    day_totals,
    profile: {
      birth_year: num(p.birth_year), height_cm: num(p.height_cm), weight_kg: num(p.weight_kg),
      gender: str(p.gender), periodic_state: str(p.periodic_state),
    },
    last_weight: lastW,
    goal: f.goal ? { goal_type: str(f.goal.goal_type), target_weight_kg: num(f.goal.target_weight_kg) } : null,
    ed_tier: f.ed_tier,
    reference_rows: { ...(f.reference_rows ?? {}) },
  };
}

/** validateDecision's context for this turn (pure; `now` for hold expiry). */
export function validationContext(ti: TurnInput, userMessage: string, now: Date, refs: TurnRefs = turnRefs(ti)): ValidationContext {
  return buildValidationContext({
    today: ti.day,
    now_iso: now.toISOString(),
    message: userMessage,
    refs: refs.rendered,
    days: ti.days,
    profile: ti.profile,
    goal: ti.goal,
    weights: ti.weights_recent,
    ed_tier: edTierOf(ti),
    // REFERANS ADAYLARI are not loaded yet (§4.2 item 5).
    reference_rows: {},
  });
}

// ─── data → lines (what Stage A reads; rendered ONCE by stage-a-request.ts) ──────────────────────

export { dayLabelTr, fmtTr };

/** An ISO instant as the user's local "bugün 14:20" / "dün 23:05" / "Per 2 Eki 09:00". */
function localClock(iso: string, tz: string | null, today: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '?';
  const lp = getLocalParts(tz, new Date(ms));
  return `${dayLabelTr(lp.dateStr, today)} ${String(lp.hour).padStart(2, '0')}:${String(lp.minute).padStart(2, '0')}`;
}

const SOURCE_TAG: Record<string, string> = {
  ai_estimate: 'model', reference: 'tablo', barcode: 'barkod', user_correction: 'kullanıcı', venue_memory: 'mekân', template: 'şablon',
};
const KIND_TR: Record<string, string> = {
  allergen: 'alerji', intolerance: 'intolerans', injury: 'sakatlık', surgery: 'ameliyat', condition: 'hastalık',
  medication: 'ilaç', dietary: 'beslenme kısıtı',
};
const SEVERITY_TR: Record<string, string> = { mild: 'hafif', moderate: 'orta', severe: 'ciddi' };

/** 'workout' → 'antrenman', anything else → 'beslenme' (the plan types weekly_plans stores). */
export function planTypeTr(planType: string): string {
  return planType === 'workout' ? 'antrenman' : 'beslenme';
}

/**
 * One meal as a line. `withSource` appends the provenance tag ("[model]", "[tablo]") Stage A reads
 * to judge a record; the user-facing form (receipts, code-authored replies) leaves it off — the tag
 * is a model-facing marker, never something to show the user (trial 2026-10-11: "… [model]").
 */
function mealSummary(m: TurnInputMeal, withSource = true): string {
  const shown = m.items.slice(0, 6).map((it) => {
    const portion = it.as_stated ?? it.portion_text;
    const grams = it.grams !== null ? ` ~${fmtTr(it.grams)} g` : '';
    return `${it.name}${portion ? ` (${portion}${grams})` : grams} ${fmtTr(it.kcal)} kcal`;
  });
  if (m.items.length > 6) shown.push(`+${m.items.length - 6} kalem`);
  const body = `${shown.join('; ') || 'kalem yok'} · toplam ${fmtTr(m.total_kcal)} kcal`;
  if (!withSource) return body;
  const src = [...new Set(m.items.map((it) => SOURCE_TAG[it.data_source ?? ''] ?? 'model'))].join('/');
  return `${body} [${src || 'model'}]`;
}

/**
 * Turkish possessive of the constraint kinds whose subject is a thing ("yer fıstığı alerjisi", "diz
 * sakatlığı"). Conditions and medications are named states ("hastalık: diyabet") — no possessive.
 */
const KIND_POSSESSIVE_TR: Record<string, string> = {
  allergen: 'alerjisi', intolerance: 'intoleransı', injury: 'sakatlığı', surgery: 'ameliyatı', dietary: 'beslenme kısıtı',
};

/**
 * A spine row worded for the user — what a retract/confirm receipt quotes ("Kaldırıldı: yer fıstığı
 * alerjisi (ciddi)"). Vocabulary ids become their Turkish label; nothing English leaks.
 */
export function constraintSummaryTr(c: { kind: string; subject: string; severity: string | null; body_parts?: readonly string[] }): string {
  const lbl = (map: Readonly<Record<string, string>>, id: string): string | null => (map[id] ? map[id].split(' (')[0] : null);
  const custom = c.subject.startsWith('custom:') ? c.subject.slice('custom:'.length) : null;
  const region = c.body_parts?.length ? c.body_parts.map((p) => lbl(vocab.BODY_PARTS, p) ?? p).join(', ') : null;
  const name = custom
    ?? ((c.kind === 'allergen' || c.kind === 'intolerance') ? lbl(vocab.ALLERGENS, c.subject) : null)
    ?? (c.kind === 'dietary' ? lbl(vocab.DIETARY_SUBJECTS, c.subject) : null)
    ?? ((c.kind === 'injury' || c.kind === 'surgery') ? region : null)
    ?? c.subject.split('_').join(' ');
  const sev = c.severity && SEVERITY_TR[c.severity] ? ` (${SEVERITY_TR[c.severity]})` : '';
  const poss = KIND_POSSESSIVE_TR[c.kind];
  return poss ? `${name} ${poss}${sev}` : `${KIND_TR[c.kind] ?? c.kind}: ${name}${sev}`;
}

function metricSummary(d: MetricDayRef): string {
  switch (d.target) {
    case 'water': return `su: gün toplamı ${fmtTr(d.value, 2)} L`;
    case 'sleep': return `uyku: ${fmtTr(d.value, 1)} saat`;
    case 'mood': return `ruh hali: ${fmtTr(d.value)}/5`;
    case 'steps': return `adım: ${fmtTr(d.value)}`;
    case 'weight': return `tartı: ${fmtTr(d.value, 1)} kg`;
  }
}

/**
 * PROFİL phrases from a raw profile record (+ the active goal). `rest: true` appends every other
 * key as `key=value` (the eval's loose fixture profiles); the loader leaves it off because the
 * mirrored profile row also carries plumbing columns (timezones, TDEE stamps) Stage A does not need.
 */
export function profilePhrases(
  p: Readonly<Record<string, unknown>>,
  goal: Readonly<Record<string, unknown>> | null,
  opts: { rest?: boolean } = {},
): string[] {
  const prof: string[] = [];
  const used = new Set<string>();
  const take = (k: string): unknown => {
    used.add(k);
    return p[k];
  };
  const g = str(take('gender'));
  if (g) prof.push(`cinsiyet ${(vocab.GENDER as Record<string, string>)[g] ?? g}`);
  const by = num(take('birth_year'));
  if (by !== null) prof.push(`doğum yılı ${by}`);
  const h = num(take('height_cm'));
  if (h !== null) prof.push(`boy ${fmtTr(h)} cm`);
  const w = num(take('weight_kg'));
  if (w !== null) prof.push(`kilo ${fmtTr(w, 1)} kg`);
  for (const k of ['activity_level', 'diet_mode', 'dietary_restriction', 'periodic_state', 'occupation', 'wake_time', 'sleep_time'] as const) {
    const v = take(k);
    if (typeof v === 'string' && v) prof.push(`${k}=${quoteLine(v, 40)}`);
    else if (typeof v === 'number') prof.push(`${k}=${v}`);
  }
  const wt = num(take('water_target_liters'));
  if (wt !== null) prof.push(`su hedefi ${fmtTr(wt, 1)} L`);
  const st = num(take('step_target'));
  if (st !== null) prof.push(`adım hedefi ${fmtTr(st)}`);
  if (take('onboarding_completed') === false) prof.push('tanışma tamamlanmadı');
  if (goal) {
    const gt = str(goal.goal_type);
    const tw = num(goal.target_weight_kg);
    if (gt) prof.push(`hedef ${(vocab.GOAL_TYPES as Record<string, string>)[gt] ?? gt}${tw !== null ? ` (hedef kilo ${fmtTr(tw, 1)})` : ''}`);
    else if (tw !== null) prof.push(`hedef kilo ${fmtTr(tw, 1)}`);
  }
  if (opts.rest) {
    for (const [k, v] of Object.entries(p)) {
      if (used.has(k) || (goal !== null && (k === 'goal_type' || k === 'target_weight_kg'))) continue;
      prof.push(`${k}=${typeof v === 'string' ? quoteLine(v, 80) : JSON.stringify(v)}`);
    }
  }
  return prof;
}

/** One KISITLAR line body (after the ref): kind · subject · severity [· başkasının] [· PASİF] [· bölge] [· not]. */
export function constraintLine(c: {
  kind: string;
  subject: string;
  severity: string | null;
  body_parts?: readonly string[];
  note?: string | null;
  whose?: string | null;
  active?: boolean;
}): string {
  const bits = [KIND_TR[c.kind] ?? c.kind, quoteLine(c.subject, 40), (c.severity && SEVERITY_TR[c.severity]) || 'şiddeti belirtilmemiş'];
  if (c.whose === 'other_person') bits.push('başkasının');
  if (c.active === false) bits.push('PASİF (geri alındı)');
  if (c.body_parts?.length) bits.push(`bölge: ${c.body_parts.join(',')}`);
  if (c.note) bits.push(`not: "${quoteLine(c.note, 80)}"`);
  return bits.join(' · ');
}

/**
 * TurnInput → the view stage-a-request.ts renders (§4.2). Every line is worded here; the block
 * order, headings, "yok" lines, the ED-tier gate, the history window and the user-turn assembly
 * are the renderer's. Pure; no row id reaches a line (refs only).
 */
export function stageAView(ti: TurnInput, opts: { image?: boolean } = {}): StageATurnView {
  const t = ti.day;
  const todayRow = ti.days.find((d) => d.day === t);
  const today: string[] = [];
  if (todayRow) {
    today.push(`${todayRow.meal_count} öğün ${fmtTr(todayRow.kcal)} kcal`);
    if (todayRow.water_liters !== null && todayRow.water_liters > 0) today.push(`su ${fmtTr(todayRow.water_liters, 2)} L`);
    if (todayRow.steps !== null) today.push(`adım ${fmtTr(todayRow.steps)}`);
    if (todayRow.sleep_hours !== null) today.push(`uyku ${fmtTr(todayRow.sleep_hours, 1)} saat`);
    if (todayRow.weight_kg !== null) today.push(`tartı ${fmtTr(todayRow.weight_kg, 1)} kg`);
  }

  const last = new Set(ti.last_turn_refs);
  // Lane U: with nothing written last turn, "geri al" can still name the newest writes (ledger order).
  const rendered = turnRefs(ti).rendered;
  const recent = (ref: string, lastTurn: boolean | undefined): string => {
    const rank = rendered[ref]?.recent_rank;
    if (!rank || lastTurn) return '';
    return rank === 1 ? ' (en son yazılan)' : ` (sondan ${rank}. yazılan)`;
  };
  const records: RefLine[] = [];
  for (const m of ti.meals) {
    const mt = (vocab.MEAL_TYPES as Record<string, string>)[m.meal_type] ?? m.meal_type;
    records.push({ ref: m.ref, line: `${dayLabelTr(m.day, t)} ${mt} · "${quoteLine(m.raw_input, 100)}" → ${mealSummary(m)}${recent(m.ref, m.last_turn)}`, last_turn: m.last_turn });
  }
  for (const d of ti.metric_days) records.push({ ref: d.ref, line: `${dayLabelTr(d.day, t)} ${metricSummary(d)}${recent(d.ref, d.last_turn)}`, last_turn: d.last_turn });
  for (const w of ti.workouts) {
    const it = w.intensity ? ` ${(vocab.INTENSITY as Record<string, string>)[w.intensity] ?? w.intensity}` : '';
    const kc = w.calories_burned ? ` ~${fmtTr(w.calories_burned)} kcal` : '';
    const sets = w.set_count ? ` · ${w.set_count} set` : '';
    records.push({
      ref: w.ref,
      line: `${dayLabelTr(w.day, t)} antrenman · "${quoteLine(w.raw_input, 80)}" → ${w.workout_type ?? '?'} ${fmtTr(w.duration_min)} dk${it}${kc}${sets}${recent(w.ref, last.has(w.ref))}`,
      last_turn: last.has(w.ref),
    });
  }
  for (const s of ti.supplements) {
    records.push({
      ref: s.ref,
      line: `${dayLabelTr(s.day, t)} takviye · ${quoteLine(s.name, 40)}${s.amount ? ` (${quoteLine(s.amount, 20)})` : ''}${recent(s.ref, last.has(s.ref))}`,
      last_turn: last.has(s.ref),
    });
  }
  for (const l of ti.labs) {
    const range = l.reference_min !== null || l.reference_max !== null ? ` (referans ${l.reference_min ?? '?'}–${l.reference_max ?? '?'})` : '';
    records.push({ ref: l.ref, line: `${dayLabelTr(l.day, t)} tahlil · ${quoteLine(l.parameter, 40)} ${fmtTr(l.value, 2)} ${l.unit}${range}${recent(l.ref, false)}` });
  }
  for (const e of ti.life_events) records.push({ ref: e.ref, line: `olay · ${e.event_date} · ${quoteLine(e.title, 60)} (${e.event_type})${recent(e.ref, false)}` });

  return {
    now: { today: t, local_date: ti.local.date, local_time: ti.local.time, tz: ti.local.tz },
    ed_tier: edTierOf(ti),
    profile: profilePhrases(ti.profile, ti.goal),
    gates: [],
    today,
    records,
    // A constraint added in the previous turn is "(son tur)": the one record_delete may undo (records.ts).
    constraints: ti.constraints.map((c) => ({
      ref: c.ref, line: constraintLine({ kind: c.kind, subject: c.subject, severity: c.severity, body_parts: c.body_parts, note: c.note }),
      ...(rendered[c.ref]?.last_turn ? { last_turn: true } : {}),
    })),
    pending: ti.pending.map((h) => ({
      ref: h.ref, line: `${h.op} · açıldı ${localClock(h.created_at, ti.local.tz, t)} · bitiş ${localClock(h.expires_at, ti.local.tz, t)}`,
    })),
    commitments: ti.commitments.map((k) => ({
      ref: k.ref, line: `"${quoteLine(k.commitment, 100)}"${k.follow_up_at ? ` · takip ${dayLabelTr(k.follow_up_at.slice(0, 10), t)}` : ''}`,
    })),
    drafts: ti.plans.drafts.map((d) => ({
      ref: d.ref, line: `${planTypeTr(d.plan_type)} taslağı · hafta ${d.week_start}${d.revision_count ? ` · ${d.revision_count} revizyon` : ''}`,
    })),
    active_plans: ti.plans.active.map((a) => `${planTypeTr(a.plan_type)} (hafta ${a.week_start})`),
    references: [],
    image: opts.image === true,
    last_turn_writes: ti.last_turn_action_types,
    history: ti.history.map((h) => ({ role: h.role, content: h.content })),
  };
}

/** The TurnInput block exactly as Stage A receives it (= stage-a-request.ts renderTurnInputBlock over stageAView). */
export function renderTurnInput(ti: TurnInput): string {
  return renderTurnInputBlock(stageAView(ti));
}
