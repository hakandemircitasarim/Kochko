/**
 * v2-db-types.ts — the TypeScript face of the v2 database layer (migrations 108-113).
 *
 * WHY (docs/AI_MIMARI_V2.md §3.2 T3/T5, §4, §6.1 · Faz 1): v2 writes a turn ONLY through the writer RPCs
 * (w_meal_apply, w_water_apply, w_metric_apply, w_record_delete/restore), opens/closes ASK holds through
 * v2_hold_open/v2_hold_resolve and reads the turn through v2_turn_input. This file pins those payload,
 * receipt and TurnInput shapes so commit.ts / input.ts / the eval toolPort type-check against the SQL.
 * v2-db-types.test.ts reads the migrations, so a renamed failure class, ref kind or RPC breaks CI instead
 * of drifting silently (this repo's documented failure mode).
 *
 * Division of labour (yapay zekâ anlar, kod denetler): the MODEL gives meaning, the write registry's
 * derive() does arithmetic and its validator applies the rules; these RPCs only guard DB integrity
 * (types, column bounds, ownership, ref resolution, atomicity). Turkish receipt lines live in the
 * registry (receipts.ts), never here — a DB receipt is structure, not prose.
 *
 * Zero imports, no Deno globals: usable from edge code, the eval runner and scripts.
 */

// ─── RPC names ───────────────────────────────────────────────────────────────────────────────────────

/** Every v2 RPC. All are SECURITY DEFINER and executable by service_role ONLY (072's lesson). */
export const V2_RPC = {
  mealApply: 'w_meal_apply',
  waterApply: 'w_water_apply',
  metricApply: 'w_metric_apply',
  recordDelete: 'w_record_delete',
  recordRestore: 'w_record_restore',
  ledgerAppend: 'v2_ledger_append',
  holdOpen: 'v2_hold_open',
  holdResolve: 'v2_hold_resolve',
  linkTurnMessage: 'v2_link_turn_message',
  turnInput: 'v2_turn_input',
  retentionSweep: 'v2_retention_sweep',
} as const;
export type V2RpcName = typeof V2_RPC[keyof typeof V2_RPC];

// ─── Short refs (record_refs) ────────────────────────────────────────────────────────────────────────

/**
 * Stable per-user refs. m=meal t=workout s=supplement e=life event l=lab d=metric WRITE (water/sleep/
 * mood/steps) w=weight WRITE c=constraint k=commitment p=pending hold dft=plan draft. Refs are never
 * renumbered between turns, so "⟦m12 düzeltildi → m15⟧" in history keeps pointing at the same record.
 */
export const REF_KINDS = ['m', 't', 's', 'e', 'l', 'd', 'w', 'c', 'k', 'p', 'dft'] as const;
export type RefKind = typeof REF_KINDS[number];

/** record_refs.target_table per kind (mirrors record_refs_kind_target_check in 108). */
export const REF_KIND_TABLE: Readonly<Record<RefKind, string>> = {
  m: 'meal_logs',
  t: 'workout_logs',
  s: 'supplement_logs',
  e: 'life_events',
  l: 'lab_values',
  d: 'turn_writes',
  w: 'turn_writes',
  c: 'user_constraints',
  k: 'user_commitments',
  p: 'pending_writes',
  dft: 'weekly_plans',
};

/**
 * Kinds record_ops (delete / restore / update via replaces) may target. The spine closes through
 * constraint_retract (+ two-step hold), commitments through commitment_resolve, holds through
 * discard, drafts through plan_action — the RPC answers 'not_deletable' for those.
 */
export const DELETABLE_REF_KINDS: readonly RefKind[] = ['m', 't', 's', 'e', 'l', 'd', 'w'];

export interface ParsedRef {
  ref: string;
  kind: RefKind;
  seq: number;
}

// A ref is a code-issued token the MODEL echoes back (structured output), not user text.
const REF_RE = /^(dft|[mtseldwckp])([1-9][0-9]{0,8})$/;

/** Parse a model-supplied ref token. Exact shape only: no trimming, no case folding, no guessing. */
export function parseRef(value: unknown): ParsedRef | null {
  if (typeof value !== 'string') return null;
  const m = REF_RE.exec(value);
  if (!m) return null;
  return { ref: value, kind: m[1] as RefKind, seq: Number(m[2]) };
}

export function isDeletableRefKind(kind: RefKind): boolean {
  return DELETABLE_REF_KINDS.includes(kind);
}

// ─── Ledger (turn_writes) ────────────────────────────────────────────────────────────────────────────

export const LEDGER_TABLES = [
  'meal_logs', 'workout_logs', 'supplement_logs', 'daily_metrics', 'weight_history',
  'profiles', 'user_venues', 'life_events', 'lab_values', 'achievements',
] as const;
export type LedgerTable = typeof LEDGER_TABLES[number];

/**
 * soft_delete      — the write inserted the row; undo = is_deleted=true.
 * restore_previous — undo writes the previous field values back (before=null → the write created the
 *                    row; after=null → the write removed it and `before` is the full snapshot).
 * revert_delta     — additive write (water 'add', venue visit); undo subtracts the delta, so a client
 *                    water-screen add in between is never clobbered.
 */
export const UNDO_MODES = ['soft_delete', 'restore_previous', 'revert_delta', 'none'] as const;
export type UndoMode = typeof UNDO_MODES[number];

export type Pipeline = 'v1' | 'v2';

/** One turn_writes row as stored (RLS: the owner may read; only service_role writes). */
export interface TurnWriteRow {
  id: string;
  seq: number;
  user_id: string;
  turn_id: string;
  chat_message_id: string | null;
  pipeline: Pipeline;
  ref: string | null;
  /** Registry op ('meal_log', 'water_log', 'sleep_log', 'mood_log', 'step_log', 'body_weight', …) or record_delete / record_restore. */
  op: string;
  table_name: LedgerTable;
  row_id: string | null;
  for_date: string | null;
  field_set: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  undo_mode: UndoMode;
  group_id: string;
  is_primary: boolean;
  reverses: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  undone_at: string | null;
  undone_by_turn: string | null;
  needs_review: boolean;
}

// ─── Failure classes ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every failure_class an RPC can return (REJECT / hold outcomes, §5.2). The client keeps reading
 * `ok:false` + `failure_class` for its red badge; the coach (Stage B) gets the class as a fact.
 */
export const V2_FAILURE_CLASSES = [
  'invalid_value',     // type / enum / DB column bound / day window — detail.path names the field
  'no_op',             // adding 0 L of water
  'unknown_ref',       // ref or write_id not this user's
  'wrong_ref_kind',    // water replacing a meal ref, sleep replacing a water write
  'not_deletable',     // c/k/p/dft refs: closed by their own ops
  'not_owner',         // defence in depth: row belongs to someone else
  'row_missing',       // row hard-deleted outside the ledger
  'already_undone',    // nothing live left to reverse
  'not_undone',        // restore of a record that is live
  'replaced',          // restore of a record a correction replaced — detail.replaced_by
  'later_write',       // noLaterWriteOnSameField: a later write owns the field now
  'too_old',           // older than max_age_days (7)
  'not_reversible',    // ledger row with undo_mode 'none'
  'hold_not_open',     // pending_id not pending (already confirmed/discarded/superseded)
  'hold_expired',      // pending_id past expires_at
  'hold_op_mismatch',  // pending_id belongs to another op
  'write_failed',      // unexpected DB error — detail.sqlstate / detail.error
] as const;
export type V2FailureClass = typeof V2_FAILURE_CLASSES[number];

export interface RpcFailure {
  ok: false;
  op: string;
  failure_class: V2FailureClass;
  detail: Record<string, unknown>;
}

// ─── Writer payloads ─────────────────────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' — the user's LOCAL day, already resolved by TS (tz + day boundary). */
export type IsoDay = string;

interface WriterBase {
  day: IsoDay;
  /** Ref of the record this write corrects (same type). Old one is undone in the SAME transaction. */
  replaces?: string | null;
  /** Confirms this ASK hold in the SAME transaction; a repeated "evet" cannot write twice. */
  pending_id?: string | null;
  pipeline?: Pipeline;
  /** Structured extras copied to turn_writes.meta. Never the raw chat message. */
  meta?: Record<string, unknown> | null;
}

export interface MealItemPayload {
  name: string;
  /** The user's own words for the amount, verbatim ("6 adet", "2 çimdik"). Never parsed. */
  as_stated: string | null;
  grams: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  alcohol_g?: number | null;
  caffeine_mg?: number | null;
  preparation?: string | null;
  allergens?: string[] | null;
  may_contain?: string[] | null;
  /** Only when the MODEL picked a REFERANS ADAYLARI row. Code never picks one. */
  reference_key?: string | null;
  confidence?: number | null;
  /** Defaults: 'reference' when reference_key is set, else 'ai_estimate'. */
  data_source?: 'ai_estimate' | 'reference' | 'barcode' | 'user_correction' | 'venue_memory' | 'template' | null;
  meta?: Record<string, unknown> | null;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealApplyPayload extends WriterBase {
  meal_type: MealType;
  raw: string;
  input_method?: 'text' | 'photo' | 'barcode' | 'voice' | 'template' | 'ai_chat';
  /** 'HH:MM' local; stored in ledger meta (learnMealTime reads it in TS). */
  time_local?: string | null;
  /** Eaten out → one venue visit, undone together with the meal. */
  venue?: { name: string; type?: string | null } | null;
  items: MealItemPayload[];
}

export interface WaterApplyPayload extends WriterBase {
  mode: 'add' | 'set_day_total';
  /** The registry's derive() result (quantity × unit ml / 1000). Never the model's raw count. */
  liters: number;
  as_stated?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

export type MetricApplyPayload =
  | (WriterBase & { metric: 'sleep'; as_stated?: string | null;
      values: { hours: number; quality: 'good' | 'ok' | 'bad' | null; sleep_time?: string | null; wake_time?: string | null } })
  | (WriterBase & { metric: 'mood'; as_stated?: string | null; values: { score: 1 | 2 | 3 | 4 | 5; note?: string | null } })
  | (WriterBase & { metric: 'steps'; as_stated?: string | null; values: { steps: number; source?: 'manual' | 'phone' | 'wearable' } })
  | (WriterBase & { metric: 'weight'; as_stated?: string | null; values: { kg: number };
      /** true only when `day` is the user's local today (a backdated weigh-in never moves profiles.weight_kg). */
      update_profile?: boolean });

export type MetricName = MetricApplyPayload['metric'];

/** Registry op written for each metric (envelope types map from these). */
export const METRIC_OPS: Readonly<Record<MetricName, string>> = {
  sleep: 'sleep_log',
  mood: 'mood_log',
  steps: 'step_log',
  weight: 'body_weight',
};

/** {ref} = that record (+ its side effects); {write_id} = the WHOLE logical write (client undo button). */
export type RecordTarget = { ref: string } | { write_id: string };

export interface RecordOpOptions {
  /** Overwrite a later write (only after the user explicitly confirmed). */
  force?: boolean;
  max_age_days?: number;
  /** Comma list of accepted ref kinds, e.g. 'm' or 'd,w'. */
  expect_kind?: string;
  expect_op?: string;
  pipeline?: Pipeline;
  reason?: string | null;
}

export interface LedgerAppendEntry {
  op: string;
  table_name: LedgerTable;
  row_id: string | null;
  for_date?: IsoDay | null;
  field_set?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  undo_mode: UndoMode;
  /** Entries sharing a label are ONE logical write (meal + venue). */
  group?: string;
  is_primary?: boolean;
  meta?: Record<string, unknown>;
  pipeline?: Pipeline;
}

// ─── Receipts ────────────────────────────────────────────────────────────────────────────────────────

export interface ReversedRow {
  write_id: string;
  reverses?: string;
  table: LedgerTable;
  row_id: string;
  ref: string | null;
  field_set: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  needs_review?: boolean;
}

/** What a record op (or a writer's `replaces`) undid. */
export interface RecordOpResult {
  scope: 'record' | 'group';
  target: { ref: string | null; table: LedgerTable | string; row_id: string | null; write_id?: string | null };
  reversed: ReversedRow[];
  needs_review: boolean;
}

interface WriterOkBase {
  ok: true;
  op: string;
  turn_id: string;
  write_id: string;
  group_id: string;
  ref: string;
  day: IsoDay;
  replaced: RecordOpResult | null;
  pending_id: string | null;
}

export interface MealItemReceipt {
  id: string;
  name: string;
  as_stated: string | null;
  grams: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  alcohol_g: number;
  data_source: string;
  reference_key: string | null;
  allergen_tags: string[];
  may_contain: string[];
  confidence: number | null;
}

export interface MealApplyOk extends WriterOkBase {
  op: 'meal_log';
  row_id: string;
  meal_type: MealType;
  confidence: 'high' | 'medium' | 'low';
  total_kcal: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_alcohol_g: number;
  items: MealItemReceipt[];
  venue: { id: string; name: string; visit_count: number; created: boolean } | null;
}

export interface WaterApplyOk extends WriterOkBase {
  op: 'water_log';
  mode: 'add' | 'set_day_total';
  liters: number;
  previous_total: number | null;
  total: number;
}

export interface MetricApplyOk extends WriterOkBase {
  metric: MetricName;
  /** Stored values in the DB's own representation (time → "07:00:00"). */
  values: Record<string, unknown>;
  previous: Record<string, unknown>;
  /** Lossless normalisations (7.46 h → 7.5) — shown in the receipt, never silent. */
  normalized: { path: string; from: number; to: number }[];
  side_effects: { table: 'weight_history' | 'profiles'; row_id: string; previous: number | null }[];
}

export interface RecordOpOk extends RecordOpResult {
  ok: true;
  op: 'record_delete' | 'record_restore';
  turn_id: string;
  group_id: string;
}

export interface LedgerAppendOk {
  ok: true;
  op: 'ledger_append';
  turn_id: string;
  entries: { index: number; write_id: string; group_id: string; ref: string | null }[];
}

export interface HoldOpenOptions {
  /** One open hold per (op, subject_key): 'water_log:2026-10-06', 'constraint_retract:c3'. */
  subject_key?: string | null;
  /** 'safety' → if the coach does not ask, code appends the template question (§5.2). */
  hold_class?: 'ask' | 'safety';
  reason_code?: string | null;
  schema_version?: string | null;
  /** 1..10080, default 2880 (48 h). */
  ttl_minutes?: number;
}

export interface HoldOpenOk {
  ok: true;
  op: 'hold_open';
  pending_id: string;
  ref: string;
  expires_at: string;
  superseded_id: string | null;
  hold_class: 'ask' | 'safety';
}

export type HoldResolveStatus = 'confirmed' | 'discarded' | 'superseded' | 'expired' | 'failed';

export interface HoldResolveOk {
  ok: true;
  op: 'hold_resolve';
  pending_id: string;
  status: HoldResolveStatus;
}

export type MealApplyReceipt = MealApplyOk | RpcFailure;
export type WaterApplyReceipt = WaterApplyOk | RpcFailure;
export type MetricApplyReceipt = MetricApplyOk | RpcFailure;
export type RecordOpReceipt = RecordOpOk | RpcFailure;
export type LedgerAppendReceipt = LedgerAppendOk | RpcFailure;
export type HoldOpenReceipt = HoldOpenOk | RpcFailure;
export type HoldResolveReceipt = HoldResolveOk | RpcFailure;

export function isRpcFailure(r: { ok: boolean }): r is RpcFailure {
  return r.ok === false;
}

const FAILURE_SET: ReadonlySet<string> = new Set(V2_FAILURE_CLASSES);

/**
 * RPC JSON → typed receipt, defensively. The RPCs always answer with {ok:…}, but a transport error,
 * a null body or a class this build does not know must NEVER read as success (v1's "pushFb defaults
 * ok:true" lie). Anything off-contract becomes write_failed with the original kept in detail.
 * `expectOps` guards against wiring the wrong RPC's receipt into a reply.
 */
export function parseRpcReceipt<T extends { ok: true; op: string }>(
  raw: unknown,
  expectOps: readonly string[],
): T | RpcFailure {
  const op = expectOps[0] ?? 'unknown';
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, op, failure_class: 'write_failed', detail: { reason: 'not_an_object' } };
  }
  const r = raw as Record<string, unknown>;
  const gotOp = typeof r.op === 'string' ? r.op : op;
  if (r.ok === true) {
    if (!expectOps.includes(gotOp)) {
      return { ok: false, op, failure_class: 'write_failed', detail: { reason: 'unexpected_op', op: r.op } };
    }
    return r as unknown as T;
  }
  if (r.ok === false) {
    const cls = typeof r.failure_class === 'string' && FAILURE_SET.has(r.failure_class)
      ? r.failure_class as V2FailureClass
      : 'write_failed';
    const detail = r.detail !== null && typeof r.detail === 'object' && !Array.isArray(r.detail)
      ? { ...(r.detail as Record<string, unknown>) }
      : {};
    if (cls !== r.failure_class) detail.original_class = r.failure_class ?? null;
    return { ok: false, op: gotOp, failure_class: cls, detail };
  }
  return { ok: false, op, failure_class: 'write_failed', detail: { reason: 'missing_ok' } };
}

// ─── Pending holds (pending_writes, 106 + 109) ───────────────────────────────────────────────────────

export const PENDING_STATUSES = ['pending', 'confirmed', 'discarded', 'superseded', 'expired', 'failed'] as const;
export type PendingStatus = typeof PENDING_STATUSES[number];
export const HOLD_CLASSES = ['ask', 'safety'] as const;
export type HoldClass = typeof HOLD_CLASSES[number];
/** §5.2: an ASK hold lives 48 h. (The KVKK erase hold keeps its own 30 min — erase-hold.ts.) */
export const HOLD_DEFAULT_TTL_MIN = 48 * 60;

// ─── ai_turn_log v2 (111) ────────────────────────────────────────────────────────────────────────────

export const TURN_LOG_PIPELINES = ['v1', 'v2', 'v2_shadow'] as const;
export type TurnLogPipeline = typeof TURN_LOG_PIPELINES[number];
/** No DB CHECK on stage (a new stage must not need a migration) — this union is the guard. */
export const TURN_LOG_STAGES = [
  'understand', 'repair', 'coach', 'plan', 'classifier', 'judge', 'tripwire', 'undo_fast', 'commit',
] as const;
export type TurnLogStage = typeof TURN_LOG_STAGES[number];

/** Columns 111 adds to ai_turn_log (every one nullable / defaulted; v1 rows leave them empty). */
export interface TurnLogV2Fields {
  pipeline: TurnLogPipeline | null;
  stage: TurnLogStage | null;
  turn_id: string | null;
  schema_version: string | null;
  /** Stage A decision. Health data: purged after DECISION_RETENTION_DAYS. */
  decision: unknown | null;
  /** Validator findings. */
  issues: { code: string; path?: string; outcome: 'commit' | 'flag' | 'ask' | 'reject' }[] | null;
  repaired: boolean;
  /** Shadow: what v1 actually applied this turn. */
  v1_actions: unknown[] | null;
  /** ONLY allowlisted test accounts / consent: the TurnInput snapshot (eval fixture candidate). */
  turn_input: TurnInputRow | null;
  payload_purged_at: string | null;
}

/** Owner decision 2026-10-06: decision/shadow payloads are kept 30 days (v2_retention_sweep, nightly). */
export const DECISION_RETENTION_DAYS = 30;

// ─── chat_messages (112) ─────────────────────────────────────────────────────────────────────────────

/**
 * Decided at T5 from what was ACTUALLY committed, never guessed before the LLM:
 * record = the turn wrote ≥1 log and nothing else · conversation = everything else ·
 * exempt = client undo button / explicit emergency path (no LLM). NULL = v1 row.
 */
export const QUOTA_CLASSES = ['conversation', 'record', 'exempt'] as const;
export type QuotaClass = typeof QUOTA_CLASSES[number];

export const CODE_NOTE_KINDS = ['emergency', 'referral', 'allergen_exposure', 'safety_hold', 'plan_honesty', 'other'] as const;
export type CodeNoteKind = typeof CODE_NOTE_KINDS[number];
/** A line CODE appended to the reply (last, never removing anything). content = model text + these, in order. */
export interface CodeNote {
  kind: CodeNoteKind;
  text: string;
}

export interface ChatMessageV2Fields {
  turn_id: string | null;
  pipeline: Pipeline | null;
  quota_class: QuotaClass | null;
  code_notes: CodeNote[] | null;
}

// ─── v2_turn_input (113) ─────────────────────────────────────────────────────────────────────────────

export const TURN_INPUT_SCHEMA = 'v2_turn_input/1';
/** Window: the user's local today and the 6 days before (§4.2.3 "son 7 gün"). */
export const TURN_INPUT_WINDOW_DAYS = 7;
/** record_ops may not reach further back (§4.4 (3) withinDays(7)). */
export const MAX_RECORD_AGE_DAYS = 7;

export interface TurnInputMealItem {
  name: string;
  as_stated: string | null;
  portion_text: string;
  grams: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  alcohol_g: number | null;
  data_source: string | null;
  reference_key: string | null;
  allergen_tags: string[];
  may_contain: string[];
  confidence: number | null;
}

export interface TurnInputMeal {
  ref: string;
  id: string;
  day: IsoDay;
  meal_type: MealType;
  logged_at: string;
  raw_input: string;
  input_method: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  supersedes_ref: string | null;
  /** 'app' = never seen by the ledger (app screen, pre-v2 history such as the 1708 kcal nugget). */
  source: 'app' | 'ledger_v1' | 'ledger_v2';
  turn_id: string | null;
  last_turn: boolean;
  total_kcal: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_alcohol_g: number;
  items: TurnInputMealItem[];
}

export interface TurnInputMetricWrite {
  ref: string | null;
  write_id: string;
  op: string;
  day: IsoDay;
  field_set: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  mode: 'add' | 'set_day_total' | null;
  as_stated: string | null;
  pipeline: Pipeline;
  turn_id: string;
  last_turn: boolean;
  created_at: string;
}

export interface TurnInputDay {
  day: IsoDay;
  meal_count: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_liters: number | null;
  sleep_hours: number | null;
  sleep_quality: 'good' | 'ok' | 'bad' | null;
  mood_score: number | null;
  steps: number | null;
  weight_kg: number | null;
}

export interface TurnInputRecentWrite {
  write_id: string;
  ref: string | null;
  op: string;
  table: LedgerTable;
  day: IsoDay | null;
  field_set: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  is_primary: boolean;
  pipeline: Pipeline;
  turn_id: string;
  last_turn: boolean;
  reverses: string | null;
  undone_at: string | null;
  created_at: string;
}

/** The serialisable TurnInput core the RPC returns (history + REFERANS ADAYLARI are added in TS). */
export interface TurnInputRow {
  schema: typeof TURN_INPUT_SCHEMA;
  day: IsoDay;
  window: { from: IsoDay; to: IsoDay };
  generated_at: string;
  last_turn: { turn_id: string | null; at: string | null };
  /** Picked profile columns; a column missing in the DB is a missing key, not an error. */
  profile: Record<string, unknown>;
  goal: Record<string, unknown> | null;
  /** Raw user_safety_state row (null = no row). Time decay / fail-closed policy stays in safety-state.ts. */
  safety: {
    ed_tier: 'none' | 'watch' | 'amber' | 'red';
    ed_signal_count: number;
    ed_last_signal_at: string | null;
    ed_escalated_at: string | null;
    overtraining_tier: 'none' | 'watch' | 'amber';
    updated_at: string;
  } | null;
  /** Today's daily_plans row (highest version) — raw; the ONE targets function lives in TS. */
  targets_today: Record<string, unknown> | null;
  constraints: {
    ref: string; id: string; kind: string; subject: string; severity: 'mild' | 'moderate' | 'severe' | null;
    body_parts: string[]; note: string | null; source: string; confidence: number; confirmed_at: string | null; stated_at: string;
  }[];
  meals: TurnInputMeal[];
  days: TurnInputDay[];
  metric_writes: TurnInputMetricWrite[];
  workouts: {
    ref: string; id: string; day: IsoDay; workout_type: string | null; duration_min: number; intensity: string | null;
    calories_burned: number | null; raw_input: string; set_count: number;
  }[];
  supplements: {
    ref: string; id: string; day: IsoDay; name: string; amount: string | null; calories: number | null;
    protein_g: number | null; logged_at: string | null;
  }[];
  labs: {
    ref: string; id: string; day: IsoDay; parameter: string; value: number; unit: string;
    reference_min: number | null; reference_max: number | null; is_out_of_range: boolean | null; notes: string | null;
  }[];
  life_events: { ref: string; id: string; title: string; event_type: string; event_date: IsoDay; note: string | null }[];
  weights_recent: { day: IsoDay; kg: number }[];
  recent_writes: TurnInputRecentWrite[];
  pending: {
    ref: string; id: string; op: string; payload: Record<string, unknown>; subject_key: string | null;
    hold_class: HoldClass; reason_code: string | null; schema_version: string | null; turn_id: string | null;
    created_at: string; expires_at: string;
  }[];
  commitments: { ref: string; id: string; commitment: string; follow_up_at: string | null; status: string | null; created_at: string }[];
  plans: {
    active: { id: string; plan_type: string; plan_subtype: string | null; week_start: IsoDay; approved_at: string | null; stale_reason: string | null }[];
    drafts: { ref: string; id: string; plan_type: string; plan_subtype: string | null; week_start: IsoDay; generated_at: string; revision_count: number }[];
  };
  portion_calibration: Record<string, unknown>;
  active_intent: Record<string, unknown> | null;
}

/** Top-level keys v2_turn_input returns, in order (parity-tested against migration 113). */
export const TURN_INPUT_KEYS = [
  'schema', 'day', 'window', 'generated_at', 'last_turn', 'profile', 'goal', 'safety', 'targets_today',
  'constraints', 'meals', 'days', 'metric_writes', 'workouts', 'supplements', 'labs', 'life_events',
  'weights_recent', 'recent_writes', 'pending', 'commitments', 'plans', 'portion_calibration', 'active_intent',
] as const satisfies readonly (keyof TurnInputRow)[];

// ─── refMap ──────────────────────────────────────────────────────────────────────────────────────────

export interface RefTarget {
  kind: RefKind;
  table: string;
  /** Row id, or the turn_writes id for d/w refs. */
  id: string;
}

export interface RefMapResult {
  /** ref → target for every ref RENDERED this turn (the refInRenderedSet rule's set). */
  map: Map<string, RefTarget>;
  /** Malformed / mis-kinded / duplicated refs. Non-empty = a DB↔TS contract bug; log loud, never guess. */
  problems: string[];
}

/**
 * §3.2 T3: the server-side refMap {m#, d#, w#, t#, p#, c#, k#, dft# → uuid}. The model only ever sees
 * short refs; a ref it emits resolves ONLY through this map (refInRenderedSet), and the RPCs resolve it
 * again per user (refOwned) — so a model cannot "invent" another user's row.
 */
export function buildRefMap(input: Pick<TurnInputRow,
  'meals' | 'metric_writes' | 'workouts' | 'supplements' | 'labs' | 'life_events' | 'constraints' | 'commitments' | 'pending' | 'plans'>,
): RefMapResult {
  const map = new Map<string, RefTarget>();
  const problems: string[] = [];
  const add = (section: string, ref: unknown, id: unknown, kinds: readonly RefKind[]) => {
    const parsed = parseRef(ref);
    if (!parsed) { problems.push(`${section}: malformed ref ${JSON.stringify(ref)}`); return; }
    if (!kinds.includes(parsed.kind)) { problems.push(`${section}: ref ${parsed.ref} has kind ${parsed.kind}`); return; }
    if (typeof id !== 'string' || id.length === 0) { problems.push(`${section}: ref ${parsed.ref} without id`); return; }
    const prev = map.get(parsed.ref);
    if (prev && prev.id !== id) { problems.push(`${section}: ref ${parsed.ref} points at two rows`); return; }
    map.set(parsed.ref, { kind: parsed.kind, table: REF_KIND_TABLE[parsed.kind], id });
  };
  for (const m of input.meals) add('meals', m.ref, m.id, ['m']);
  // A metric write may legitimately lack a ref only if it was written outside the writers; skip quietly.
  for (const w of input.metric_writes) if (w.ref !== null) add('metric_writes', w.ref, w.write_id, ['d', 'w']);
  for (const t of input.workouts) add('workouts', t.ref, t.id, ['t']);
  for (const s of input.supplements) add('supplements', s.ref, s.id, ['s']);
  for (const l of input.labs) add('labs', l.ref, l.id, ['l']);
  for (const e of input.life_events) add('life_events', e.ref, e.id, ['e']);
  for (const c of input.constraints) add('constraints', c.ref, c.id, ['c']);
  for (const k of input.commitments) add('commitments', k.ref, k.id, ['k']);
  for (const p of input.pending) add('pending', p.ref, p.id, ['p']);
  for (const d of input.plans.drafts) add('drafts', d.ref, d.id, ['dft']);
  return { map, problems };
}

// ─── DB integrity bounds (the RPCs' own guards — the registry's hard ranges are stricter) ────────────

export const DB_BOUNDS = {
  /** w_water_apply liters per write (= registry litersIn(0, 8) = water-intent WATER_MAX_LITERS_PER_WRITE). */
  waterLitersPerWrite: 8,
  /** daily_metrics.water_liters NUMERIC(4,2). */
  waterDayTotalMax: 99.99,
  /** meal_log_items.calories SMALLINT. */
  itemKcalMax: 32767,
  /** protein/carbs/fat/alcohol DECIMAL(5,1). */
  itemMacroGramsMax: 9999.9,
  /** portion_grams DECIMAL(7,1). */
  itemGramsMax: 999999.9,
  mealItemsMin: 1,
  mealItemsMax: 20,
  /** Exclusive bounds (DECIMAL(3,1); 0 h and 24 h are not a night's sleep). */
  sleepHoursExclusive: [0, 24],
  moodScore: [1, 5],
  stepsMax: 100000,
  weightKg: [20, 300],
  /** Server sanity window for `day` (UTC date); the 7-day / no-future rule is the registry's, in user tz. */
  dayWindowPastDays: 14,
  dayWindowFutureDays: 1,
} as const;
