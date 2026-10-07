/**
 * ai-chat/v2/shadow.ts — the Faz 2 Stage A SHADOW (AI_MIMARI_V2 §10 Faz 2, §3.2 T0–T5 without commit).
 *
 * After v1 has answered, the same turn is understood again by Stage A on a TurnInput captured BEFORE
 * v1's own writes, checked by validateDecision, and compared with what v1 actually applied. Nothing
 * is committed, nothing is said to the user: the ONLY write is one ai_turn_log row
 * (pipeline 'v2_shadow', stage 'understand'), and that write no-ops while migration 111 is missing.
 *
 * Rollout: KOCHKO_ROLLOUT_V2_UNDERSTAND_SHADOW (default off; allowlist / pct=N; 'shadow' and 'on'
 * both run it — the step is shadow-only by nature). Rollback: set it to off.
 *
 * Guarantees towards v1 (the hook in ai-chat/index.ts):
 *   · beginShadowTurn() is synchronous, never throws, returns null when the step is off;
 *   · finish() schedules the work with EdgeRuntime.waitUntil AFTER the response exists and returns
 *     at once; every error inside is caught and logged; the v1 reply is never awaited on, read
 *     back or changed.
 *
 * What the row stores (no user text except the model's own decision, which is health data and is
 * purged after 30 days by v2_retention_sweep):
 *   decision    the raw Stage A decision (exactly what the model returned; replayable)
 *   issues      ShadowIssueEntry[] — {code, path, outcome} per 111, plus `kind`: the intent enums,
 *               one 'verdict' line per write (clean COMMITs included), each validator finding, the
 *               per-op v1↔v2 'agreement' lines, tripwire readings and safety outcomes
 *   v1_actions  V1ActionFact[] — type, model-or-net source, ok/failed, mapped v2 keys (no values)
 *   finish_reason  Stage A status: parsed | refused | invalid | incomplete:<why> | function_call |
 *               error:<class> | skipped:<why>
 *   latency_ms / tokens  the Stage A call
 * scripts/v2-shadow-diff.mjs turns these rows into the §10 daily report (shadow-report.mjs).
 */
import { ACTIVE_ROLLOUT_STEPS, rolloutMode, rolloutStamp, type RolloutMode } from '../../shared/rollout.ts';
import {
  resolveTripwires, scanTripwires,
  type StageASafetyOutcome, type StageASafetyPositive, type TripwireDecision, type TripwireLog, type TripwireReading, type TripwireScan,
} from '../../shared/safety-tripwires.ts';
import { supabaseAdmin } from '../../shared/supabase-admin.ts';
import { SCHEMA_NAMES, validateDecision, type DecisionValidation, type Verdict, type WriteVerdict } from '../../shared/write-registry/mod.ts';
import { loadTurnInput, supabaseTurnInputDb, turnRefs, validationContext, type PgClientLike, type TurnInput, type TurnInputDb, type TurnInputLoadError } from './input.ts';
import {
  buildUnderstandRequest, STAGE_A_LIVE_BUDGET_MS, understand,
  type UnderstandDeps, type UnderstandOutcome, type UnderstandRequest, type UnderstandStatus,
} from './understand.ts';

export const SHADOW_STEP = 'v2_understand_shadow';
export const SHADOW_FUNCTION_NAME = 'ai-chat-shadow';
export const SHADOW_PIPELINE = 'v2_shadow';
export const SHADOW_STAGE = 'understand';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);

// ─── v1 side: what v1 actually applied this turn ─────────────────────────────────────────────────

export interface V1ActionFact {
  /** v1 action type ('meal_log', 'profile_update', 'correction_revert' …). */
  type: string;
  /** Registry ops / agreement keys this action corresponds to (see v1AgreementKeys). */
  keys: string[];
  /** 'model' = the v1 model emitted it; 'net' = a deterministic net injected it; 'unknown' = not tracked. */
  source: 'model' | 'net' | 'unknown';
  /** The receipt's ok (null when there is no receipt: duplicate skip, side effects already applied). */
  ok: boolean | null;
  failure_class: string | null;
  /** Dropped as a duplicate (DUP_SKIP) — not an applied write. */
  dup: boolean;
  /** profile_update only: the field NAMES it carried (never values). */
  fields?: string[];
}

/** The ActionReceipt fields the shadow reads (contracts/turn-envelope.ts). */
export interface ReceiptLike {
  action_type: string;
  ok: boolean;
  failure_class: string | null;
}

const V1_SIMPLE: Readonly<Record<string, string>> = {
  meal_log: 'meal_log', venue_log: 'meal_log', water_log: 'water_log', weight_log: 'body_weight',
  sleep_log: 'sleep_log', mood_log: 'mood_log', step_log: 'step_log', workout_log: 'workout_log',
  supplement_log: 'supplement_log', commitment: 'commitment_add', constraint_confirm: 'constraint_confirm',
  data_erase_request: 'data_erase_request', data_erase_confirm: 'pending_confirm',
  health_event: 'constraint_add', health_event_resolve: 'constraint_retract', life_event: 'life_event',
  lab_value: 'lab_value', save_recipe: 'recipe_save', periodic_state_update: 'periodic_state',
  goal_suggestion: 'goal_set', mvd_activate: 'target_change', recovery_plan: 'target_change',
  plateau_strategy_apply: 'target_change', maintenance_start: 'target_change', mini_cut_start: 'target_change',
  undo: 'record_ops', correction_revert: 'record_ops',
};
const GOAL_FIELDS = new Set(['goal_type', 'target_weight_kg', 'target_weeks', 'goal_reason', 'weekly_rate', 'restriction_mode', 'target_date', 'goal_suggestion']);

/**
 * v1 action → the registry op(s) it corresponds to (registry.ts coverage map). Structure only:
 * the action's TYPE and its field NAMES; v1's own flags decide food_preference's branch.
 * Unmapped types keep a 'v1:<type>' key so they stay visible instead of vanishing.
 */
export function v1AgreementKeys(action: Record<string, unknown>): { keys: string[]; fields?: string[] } {
  const type = typeof action.type === 'string' ? action.type : 'unknown';
  if (type === 'food_preference') {
    if (action.clear === true) return { keys: ['constraint_retract'] };
    return { keys: [action.is_allergen === true ? 'constraint_add' : 'food_pref'] };
  }
  if (type === 'profile_update') {
    const fields = Object.keys(action).filter((k) => k !== 'type').sort();
    const keys = new Set<string>();
    for (const f of fields) {
      if (GOAL_FIELDS.has(f)) keys.add('goal_set');
      else if (f === 'dietary_restriction') {
        const v = action[f];
        keys.add(v === null || v === '' || v === 'none' ? 'constraint_retract' : 'constraint_add');
      } else keys.add('profile_set');
    }
    return { keys: keys.size ? [...keys].sort() : ['profile_set'], fields };
  }
  return { keys: [V1_SIMPLE[type] ?? `v1:${type}`] };
}

/**
 * Pair v1's final actions with their receipts. `feedback` is 1:1 with `actions` (executeActions'
 * invariant); a DUP_SKIP entry has no receipt; every other entry has one receipt, in order. If the
 * counts ever disagree the pairing falls back to "first unused receipt of the same type" so a
 * drifted invariant degrades to ok:null, never to a wrong ok.
 */
export function v1ActionFacts(p: {
  actions: readonly Record<string, unknown>[];
  feedback: readonly (string | null)[];
  receipts: readonly ReceiptLike[];
  dupSkip: string;
  modelActions: ReadonlySet<object> | null;
  correctionReverted?: { type: string } | null;
}): V1ActionFact[] {
  const used = new Set<number>();
  let cursor = 0;
  const out: V1ActionFact[] = [];
  if (p.correctionReverted) {
    // The pre-LLM revert is a code path (repair regex), not a model decision.
    out.push({ type: 'correction_revert', keys: ['record_ops'], source: 'net', ok: true, failure_class: null, dup: false });
  }
  p.actions.forEach((a, i) => {
    const type = typeof a.type === 'string' ? a.type : 'unknown';
    const { keys, fields } = v1AgreementKeys(a);
    const source: V1ActionFact['source'] = p.modelActions ? (p.modelActions.has(a) ? 'model' : 'net') : 'unknown';
    const dup = p.feedback[i] === p.dupSkip;
    let receipt: ReceiptLike | null = null;
    if (!dup) {
      if (cursor < p.receipts.length && !used.has(cursor) && p.receipts[cursor].action_type === type) {
        receipt = p.receipts[cursor];
        used.add(cursor++);
      } else {
        const j = p.receipts.findIndex((r, k) => !used.has(k) && r.action_type === type);
        if (j >= 0) { receipt = p.receipts[j]; used.add(j); cursor = Math.max(cursor, j + 1); }
      }
    }
    out.push({
      type, keys, source, ok: receipt ? receipt.ok : null, failure_class: receipt?.failure_class ?? null, dup,
      ...(fields ? { fields } : {}),
    });
  });
  return out;
}

// ─── v2 side and agreement ───────────────────────────────────────────────────────────────────────

/** Agreement keys of a v2 verdict: its op; record_ops are one bucket; a `replaces` also counts as one. */
export function v2AgreementKeys(v: WriteVerdict): string[] {
  if (v.channel === 'record_ops') return ['record_ops'];
  const keys = [v.op === 'unknown' ? `unknown:${v.envelope}` : v.op];
  if (v.channel === 'writes' && typeof v.args.replaces === 'string') keys.push('record_ops');
  return keys;
}

export type V1State = 'applied' | 'failed' | 'silent';
export type V2State = 'write' | 'ask' | 'reject' | 'noop' | 'silent';
export type AgreementClass = 'both' | 'v1_only' | 'v2_only' | 'neither';

export interface AgreementEntry {
  key: string;
  v1: V1State;
  v1_source: 'model' | 'net' | 'mixed' | 'unknown' | null;
  v2: V2State;
  class: AgreementClass;
}

/**
 * Per op: did v1 apply it, what would v2 have done? 'both' = v1 applied and v2 would write or ask;
 * 'v1_only' = v1 applied, v2 silent/rejected/declared a restatement; 'v2_only' = v2 would write or
 * ask, v1 applied nothing. Sorted by key (deterministic rows).
 */
export function computeAgreement(verdicts: readonly WriteVerdict[], v1: readonly V1ActionFact[]): AgreementEntry[] {
  const v2By = new Map<string, WriteVerdict[]>();
  for (const v of verdicts) {
    if (v.channel === 'memory') continue;
    for (const k of v2AgreementKeys(v)) v2By.set(k, [...(v2By.get(k) ?? []), v]);
  }
  const v1By = new Map<string, V1ActionFact[]>();
  for (const f of v1) {
    if (f.dup) continue;
    for (const k of f.keys) v1By.set(k, [...(v1By.get(k) ?? []), f]);
  }
  const keys = [...new Set([...v2By.keys(), ...v1By.keys()])].sort();
  return keys.map((key) => {
    const vs = v2By.get(key) ?? [];
    const v2: V2State = vs.some((v) => (v.verdict === 'COMMIT' || v.verdict === 'FLAG') && !v.noop) ? 'write'
      : vs.some((v) => v.verdict === 'ASK') ? 'ask'
      : vs.some((v) => v.verdict === 'REJECT') ? 'reject'
      : vs.length ? 'noop' : 'silent';
    const fs = v1By.get(key) ?? [];
    const applied = fs.filter((f) => f.ok === true);
    const v1State: V1State = applied.length ? 'applied' : fs.length ? 'failed' : 'silent';
    const srcSet = new Set((applied.length ? applied : fs).map((f) => f.source));
    const v1_source = srcSet.size === 0 ? null : srcSet.size > 1 ? 'mixed' : [...srcSet][0];
    const v2Fired = v2 === 'write' || v2 === 'ask';
    const cls: AgreementClass = v1State === 'applied' ? (v2Fired ? 'both' : 'v1_only') : v2Fired ? 'v2_only' : 'neither';
    return { key, v1: v1State, v1_source, v2, class: cls };
  });
}

// ─── safety: Stage A's reading → the §7.2 decision table (shadow: benignOverride off) ───────────

/**
 * What resolveTripwires receives from Stage A. The registry envelope carries ONE tripwire_reading
 * {benign, reason}, so it is applied to every ambiguous hit of the scan. A Stage A slower than the
 * live budget (§7.2: 4 s) counts as a timeout here — the shadow reports what LIVE v2 would do.
 */
export function stageASafetyOutcome(outcome: UnderstandOutcome | null, validation: DecisionValidation | null, scan: TripwireScan): StageASafetyOutcome | null {
  if (!outcome) return null;
  if (outcome.status === 'refused') return { status: 'refused' };
  if ((outcome.status === 'error' && outcome.error?.class === 'timeout') || outcome.meta.latencyMs > STAGE_A_LIVE_BUDGET_MS) {
    return { status: 'timeout' };
  }
  if (outcome.status !== 'parsed' || !validation || !isRec(outcome.decision)) return { status: 'error' };
  const safety = isRec(outcome.decision.safety) ? outcome.decision.safety : {};
  const tr = isRec(safety.tripwire_reading) ? safety.tripwire_reading : null;
  const readings: TripwireReading[] = [];
  if (tr && typeof tr.benign === 'boolean') {
    for (const h of scan.hits) {
      if (h.tier !== 'ambiguous') continue;
      readings.push({ hit_id: h.hit_id, reading: tr.benign ? 'benign' : 'positive', reason: typeof tr.reason === 'string' ? tr.reason : '' });
    }
  }
  const positives: StageASafetyPositive[] = [];
  if (safety.acute_medical === true) positives.push({ category: 'emergency' });
  if (safety.self_harm === true) positives.push({ category: 'self_harm' });
  const ed = validation.safety.ed_signal;
  if (ed?.accepted && ed.escalate) positives.push({ category: 'ed', ed_severity: ed.escalate });
  return { status: 'ok', readings, positives };
}

// ─── the record and its ai_turn_log row ──────────────────────────────────────────────────────────

export type Outcome111 = 'commit' | 'flag' | 'ask' | 'reject';
const OUTCOME: Record<Verdict, Outcome111> = { COMMIT: 'commit', FLAG: 'flag', ASK: 'ask', REJECT: 'reject' };

/** ai_turn_log.issues entries: 111's {code, path, outcome} + a `kind` and the facts of that kind. */
export type ShadowIssueEntry =
  | { kind: 'verdict'; code: 'verdict'; path: null; outcome: Outcome111; op: string; channel: string; index: number; part: number | null; noop: boolean; codes: string[] }
  | { kind: 'issue'; code: string; path: string | null; outcome: Outcome111; op: string; channel: string; level: string; failure_class: string | null }
  | { kind: 'plan'; code: string; path: string | null; outcome: Outcome111; op: string }
  | { kind: 'envelope'; code: string; path: string | null; outcome: null; level: string }
  | { kind: 'intent'; code: 'intent'; path: null; outcome: null; primary: string; hypothetical: boolean; other_person: boolean }
  | { kind: 'agreement'; code: 'agreement'; path: null; outcome: null; op: string; v1: V1State; v1_source: AgreementEntry['v1_source']; v2: V2State; class: AgreementClass }
  | { kind: 'tripwire'; code: 'tripwire'; path: null; outcome: null; trigger: string; tier: string; category: string; negated: boolean; reading: 'positive' | 'benign' | 'missing' | 'n/a' }
  | { kind: 'safety'; code: string; path: null; outcome: null; value: string | boolean | null };

export interface CompactVerdict {
  channel: string;
  index: number;
  part: number | null;
  op: string;
  verdict: Verdict;
  noop: boolean;
  codes: string[];
  question_tr: string | null;
}

export type StageAShadowStatus = UnderstandStatus | 'skipped';

export interface ShadowRecord {
  turn_id: string;
  user_id: string;
  pipeline: typeof SHADOW_PIPELINE;
  stage: typeof SHADOW_STAGE;
  schema_version: string;
  stage_a: {
    status: StageAShadowStatus;
    /** 'turn_input' | 'explicit_tripwire' | an error class / incomplete reason / refusal / first issue. */
    detail: string | null;
    latency_ms: number;
    over_live_budget: boolean;
    effort: string | null;
    model: string | null;
    usage: { input: number; output: number; reasoning: number; cached: number; total: number };
    attempts: number;
    retries: string[];
    sizes: UnderstandRequest['sizes'] | null;
  };
  decision: unknown | null;
  validation: DecisionValidation | null;
  verdicts: CompactVerdict[];
  /** `computed` is false only when the shadow itself crashed before the §7.2 table ran. */
  tripwire: { outcome: TripwireDecision['kind']; log: TripwireLog; computed: boolean };
  agreement: AgreementEntry[];
  v1: { mode: string | null; actions: V1ActionFact[]; safety: string[] };
  turn_input: { schema: string; day: string; refs: number; load_errors: TurnInputLoadError[] } | null;
  timings: { total_ms: number };
  write: 'written' | 'no_columns' | 'failed' | 'skipped';
}

/** finish_reason for the row. */
export function stageAStatusLine(r: ShadowRecord): string {
  const s = r.stage_a;
  if (s.status === 'skipped') return `skipped:${s.detail ?? '?'}`;
  if (s.status === 'incomplete') return `incomplete:${s.detail ?? '?'}`;
  if (s.status === 'error') return `error:${s.detail ?? '?'}`;
  return s.status;
}

/** The issues column (pure, deterministic order). */
export function shadowIssueEntries(r: ShadowRecord, scan: TripwireScan | null): ShadowIssueEntry[] {
  const out: ShadowIssueEntry[] = [];
  const v = r.validation;
  // The intent enum/flags (never text): lets the report split writes/flags by "question or
  // hypothetical" turns — the A′ class, and the review's koruyucu_beyan_teyidi co-occurrence watch.
  const intent = isRec(r.decision) && isRec(r.decision.intent) ? r.decision.intent : null;
  if (v && intent) {
    out.push({
      kind: 'intent', code: 'intent', path: null, outcome: null, primary: typeof intent.primary === 'string' ? intent.primary : '?',
      hypothetical: intent.is_hypothetical === true, other_person: intent.about_other_person === true,
    });
  }
  if (v) {
    for (const w of v.verdicts) {
      const outcome = OUTCOME[w.verdict];
      out.push({
        kind: 'verdict', code: 'verdict', path: null, outcome, op: w.op, channel: w.channel, index: w.index, part: w.part,
        noop: w.noop !== null, codes: w.issues.map((i) => i.code),
      });
      for (const i of w.issues) {
        out.push({ kind: 'issue', code: i.code, path: i.path ?? null, outcome, op: w.op, channel: w.channel, level: i.level, failure_class: i.failure_class ?? null });
      }
    }
    if (v.plan) {
      out.push({ kind: 'plan', code: 'plan_action', path: null, outcome: OUTCOME[v.plan.verdict], op: v.plan.op });
      for (const i of v.plan.issues) out.push({ kind: 'plan', code: i.code, path: i.path ?? null, outcome: OUTCOME[v.plan.verdict], op: v.plan.op });
    }
    for (const i of v.decision_issues) out.push({ kind: 'envelope', code: i.code, path: i.path ?? null, outcome: null, level: i.level });
    if (v.missed_write) out.push({ kind: 'envelope', code: 'missed_write', path: null, outcome: null, level: 'flag' });
    // A reported fact the model consciously did not write (reason in decision.self_check): counted, not a miss.
    if (v.not_written_reason !== null) out.push({ kind: 'envelope', code: 'not_written_explained', path: null, outcome: null, level: 'info' });
    if (v.safety.ed_signal) {
      out.push({ kind: 'safety', code: 'ed_signal', path: null, outcome: null, value: v.safety.ed_signal.accepted ? (v.safety.ed_signal.escalate ?? 'accepted') : 'rejected' });
    }
  }
  for (const a of r.agreement) {
    out.push({ kind: 'agreement', code: 'agreement', path: null, outcome: null, op: a.key, v1: a.v1, v1_source: a.v1_source, v2: a.v2, class: a.class });
  }
  for (const h of scan?.hits ?? []) {
    const read = r.tripwire.log.readings.find((x) => x.trigger === h.trigger);
    out.push({
      kind: 'tripwire', code: 'tripwire', path: null, outcome: null, trigger: h.trigger, tier: h.tier, category: h.category,
      negated: h.negated, reading: read ? read.reading : 'n/a',
    });
  }
  if (r.tripwire.computed) out.push({ kind: 'safety', code: 'tripwire_outcome', path: null, outcome: null, value: r.tripwire.outcome });
  if (r.tripwire.log.benign_suppressed) out.push({ kind: 'safety', code: 'benign_suppressed', path: null, outcome: null, value: true });
  for (const s of r.v1.safety) out.push({ kind: 'safety', code: 'v1_safety', path: null, outcome: null, value: s });
  return out;
}

/** The ai_turn_log row (111 columns + the base ledger columns). */
export function shadowTurnLogRow(r: ShadowRecord, scan: TripwireScan | null, extra: { rolloutStamp?: string | null } = {}): Record<string, unknown> {
  const s = r.stage_a;
  return {
    user_id: r.user_id,
    // NOT 'ai-chat': scenarios.mjs S5 pairs each block message with its NEAREST 'ai-chat' row; a
    // shadow row landing a few seconds later must never be that row.
    function_name: SHADOW_FUNCTION_NAME,
    system_mode: r.v1.mode,
    model_requested: s.model ?? 'none',
    model_served: s.model ?? 'none',
    prompt_tokens: s.usage.input,
    completion_tokens: s.usage.output,
    total_tokens: s.usage.total,
    reasoning_tokens: s.usage.reasoning,
    cached_tokens: s.usage.cached,
    latency_ms: s.latency_ms,
    finish_reason: stageAStatusLine(r),
    fallback_reason: s.retries.length ? s.retries.join(',') : null,
    attempts: s.attempts,
    guard_verdict: null,
    rollout_stamp: extra.rolloutStamp ?? null,
    pipeline: r.pipeline,
    stage: r.stage,
    turn_id: r.turn_id,
    schema_version: r.schema_version,
    decision: r.decision ?? null,
    issues: shadowIssueEntries(r, scan),
    repaired: false,
    v1_actions: r.v1.actions,
  };
}

// ─── sink (defensive: no-op until migration 111 exists) ─────────────────────────────────────────

export interface ShadowSink {
  insert(row: Record<string, unknown>): Promise<{ error: { message: string; code?: string } | null }>;
}

export function supabaseShadowSink(client: { from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> } }): ShadowSink {
  return { insert: (row) => Promise.resolve(client.from('ai_turn_log').insert(row)).then((r) => ({ error: r.error })) };
}

/** PostgREST PGRST204 (column not in schema cache) / Postgres 42703 (undefined column). */
export function isMissingColumnError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST204' || err.code === '42703') return true;
  const m = (err.message ?? '').toLowerCase();
  return m.includes('column') && (m.includes('schema cache') || m.includes('does not exist'));
}

const NO_COLUMNS_BACKOFF_MS = 10 * 60_000;
let noColumnsUntil = 0;

/** Test seam: forget the "111 not applied" memo. */
export function resetShadowSinkState(): void {
  noColumnsUntil = 0;
}

/**
 * Insert the row. A missing-column error (111 not applied) is remembered for 10 minutes so the
 * shadow stops paying for doomed inserts; every other error is logged and reported as 'failed'.
 */
export async function writeShadowRow(sink: ShadowSink, row: Record<string, unknown>, nowMs = Date.now()): Promise<'written' | 'no_columns' | 'failed'> {
  if (nowMs < noColumnsUntil) return 'no_columns';
  try {
    const { error } = await sink.insert(row);
    if (!error) return 'written';
    if (isMissingColumnError(error)) {
      noColumnsUntil = nowMs + NO_COLUMNS_BACKOFF_MS;
      console.warn('[v2_shadow] ai_turn_log v2 columns missing (migration 111 not applied) — shadow rows skipped for 10 min');
      return 'no_columns';
    }
    console.error('[v2_shadow] ai_turn_log insert failed:', error.message);
    return 'failed';
  } catch (e) {
    console.error('[v2_shadow] ai_turn_log insert threw:', errMsg(e));
    return 'failed';
  }
}

// ─── runShadow ───────────────────────────────────────────────────────────────────────────────────

export interface RunShadowInput {
  userId: string;
  message: string;
  /** Captured BEFORE v1's writes; null when the loader failed. */
  turnInput: TurnInput | null;
  turnInputError?: string | null;
  v1Actions: V1ActionFact[];
  v1Mode: string | null;
  /** v1's safety outcomes on this turn ('ed_medium_referral' …). */
  v1Safety?: string[];
  turnId?: string;
  now?: Date;
  hasImage?: boolean;
}

export interface RunShadowDeps {
  /** Stage A call (tests inject a fake); defaults to understand() with `understandDeps`. */
  understand?: (req: UnderstandRequest) => Promise<UnderstandOutcome>;
  understandDeps?: UnderstandDeps;
  /** null/undefined = do not write (tests, dry runs). */
  sink?: ShadowSink | null;
  rolloutStamp?: string | null;
  clock?: () => number;
  log?: (line: string, data: Record<string, unknown>) => void;
}

const ZERO_USAGE = { input: 0, output: 0, reasoning: 0, cached: 0, total: 0 };

/**
 * One shadow turn: tripwire scan → Stage A → validateDecision → §7.2 table (benign override off)
 * → agreement with v1 → one ai_turn_log row. No other write, no reply. Never throws.
 */
export async function runShadow(input: RunShadowInput, deps: RunShadowDeps = {}): Promise<ShadowRecord> {
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const now = input.now ?? new Date();
  const log = deps.log ?? ((line, data) => console.log(line, JSON.stringify(data)));
  const record: ShadowRecord = {
    turn_id: input.turnId ?? crypto.randomUUID(),
    user_id: input.userId,
    pipeline: SHADOW_PIPELINE,
    stage: SHADOW_STAGE,
    schema_version: SCHEMA_NAMES.understand,
    stage_a: {
      status: 'skipped', detail: null, latency_ms: 0, over_live_budget: false, effort: null, model: null,
      usage: { ...ZERO_USAGE }, attempts: 0, retries: [], sizes: null,
    },
    decision: null,
    validation: null,
    verdicts: [],
    tripwire: { outcome: 'normal', log: emptyTripwireLog(), computed: false },
    agreement: [],
    v1: { mode: input.v1Mode, actions: input.v1Actions, safety: input.v1Safety ?? [] },
    turn_input: null,
    timings: { total_ms: 0 },
    write: 'skipped',
  };
  let scan: TripwireScan | null = null;
  try {
    scan = scanTripwires(input.message);
    const ti = input.turnInput;
    let outcome: UnderstandOutcome | null = null;
    if (ti) {
      const refs = turnRefs(ti);
      record.turn_input = { schema: ti.schema, day: ti.day, refs: refs.refMap.size, load_errors: ti.load_errors };
      if (scan.explicit && (scan.explicit.category === 'emergency' || scan.explicit.category === 'self_harm')) {
        // v2 answers an explicit hit with the canned reply and never asks Stage A (§3.2 T2).
        record.stage_a.detail = 'explicit_tripwire';
      } else {
        const req = buildUnderstandRequest({ turnInput: ti, message: input.message, scan, hasImage: input.hasImage });
        record.stage_a.effort = req.effort;
        record.stage_a.model = req.model;
        record.stage_a.sizes = req.sizes;
        outcome = await (deps.understand ?? ((r: UnderstandRequest) => understand(r, deps.understandDeps)))(req);
        const m = outcome.meta;
        record.stage_a.status = outcome.status;
        record.stage_a.latency_ms = m.latencyMs;
        record.stage_a.over_live_budget = m.latencyMs > STAGE_A_LIVE_BUDGET_MS;
        record.stage_a.attempts = m.attempts;
        record.stage_a.retries = m.retries;
        record.stage_a.usage = {
          input: m.usage.inputTokens, output: m.usage.outputTokens, reasoning: m.usage.reasoningTokens,
          cached: m.usage.cachedTokens, total: m.usage.totalTokens,
        };
        record.stage_a.detail = outcome.status === 'error' ? (outcome.error?.class ?? 'error')
          : outcome.status === 'incomplete' ? (outcome.reason ?? 'incomplete')
          : outcome.status === 'refused' ? (outcome.refusal ?? '').slice(0, 120)
          : outcome.status === 'invalid' ? (outcome.issues[0] ?? 'invalid').slice(0, 120)
          : outcome.status === 'function_call' ? 'function_call'
          : null;
        if (outcome.status === 'parsed') {
          record.decision = outcome.decision;
          record.validation = validateDecision(outcome.decision, validationContext(ti, input.message, now, refs));
          record.verdicts = record.validation.verdicts.map((v) => ({
            channel: v.channel, index: v.index, part: v.part, op: v.op, verdict: v.verdict, noop: v.noop !== null,
            codes: v.issues.map((i) => i.code), question_tr: v.question_tr,
          }));
          record.agreement = computeAgreement(record.validation.verdicts, input.v1Actions);
        }
      }
    } else {
      record.stage_a.detail = 'turn_input';
    }
    // Only a Stage A that was asked feeds the table; an explicit hit is decided without it.
    const decision = resolveTripwires({
      scan, stageA: stageASafetyOutcome(outcome, record.validation, scan), classifier: null, benignOverride: false,
    });
    record.tripwire = { outcome: decision.kind, log: decision.log, computed: true };
  } catch (e) {
    record.stage_a.status = 'error';
    record.stage_a.detail = `shadow_crash: ${errMsg(e)}`;
  }
  record.timings.total_ms = clock() - t0;
  if (deps.sink) {
    try {
      record.write = await writeShadowRow(deps.sink, shadowTurnLogRow(record, scan, { rolloutStamp: deps.rolloutStamp ?? null }));
    } catch (e) {
      record.write = 'failed';
      console.error('[v2_shadow] row build failed:', errMsg(e));
    }
  }
  try {
    log('[v2_shadow]', {
      turn_id: record.turn_id,
      status: stageAStatusLine(record),
      latency_ms: record.stage_a.latency_ms,
      effort: record.stage_a.effort,
      counts: record.validation?.counts ?? null,
      disagree: record.agreement.filter((a) => a.class === 'v1_only' || a.class === 'v2_only').map((a) => `${a.key}:${a.class}`),
      tripwire: record.tripwire.outcome,
      load_errors: record.turn_input?.load_errors.map((l) => l.section) ?? null,
      turn_input_error: input.turnInputError ?? null,
      write: record.write,
    });
  } catch { /* logging must never break the shadow */ }
  return record;
}

function emptyTripwireLog(): TripwireLog {
  return {
    version: '', explicit: null, ambiguous: [], negated: [], signals: [], injection: [], stage_a: 'not_run', readings: [],
    classifier: 'skipped', outcome: 'normal', benign_suppressed: false, contexts: [],
  };
}

// ─── the v1 hook ─────────────────────────────────────────────────────────────────────────────────

/** EdgeRuntime.waitUntil when present (Supabase edge), else a detached promise. Starts on the next macrotask. */
export function scheduleBackground(job: () => Promise<unknown>): void {
  const started = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(job).catch((e) => {
    console.error('[v2_shadow] background job failed:', errMsg(e));
  });
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try {
    if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(started);
  } catch (e) {
    console.error('[v2_shadow] waitUntil failed:', errMsg(e));
  }
}

export interface ShadowFinishParams {
  /** v1's FINAL action list (after the nets), as passed to executeActions. */
  actions: readonly Record<string, unknown>[];
  feedback: readonly (string | null)[];
  receipts: readonly ReceiptLike[];
  dupSkip: string;
  v1Mode: string | null;
  correctionReverted?: { type: string } | null;
  v1Safety?: string[];
}

export interface ShadowTurn {
  readonly turnId: string;
  readonly mode: RolloutMode;
  /** Call right after the model's actions are parsed (before any net touches the list). */
  markModelActions(actions: readonly object[]): void;
  /** Call once the v1 response exists. Returns immediately; the shadow runs in the background. */
  finish(p: ShadowFinishParams): void;
}

export interface ShadowTurnDeps {
  mode?: (step: string, userId: string) => RolloutMode;
  db?: TurnInputDb;
  sink?: ShadowSink | null;
  schedule?: (job: () => Promise<unknown>) => void;
  now?: () => Date;
  run?: (input: RunShadowInput, deps: RunShadowDeps) => Promise<unknown>;
  runDeps?: Omit<RunShadowDeps, 'sink' | 'rolloutStamp'>;
}

export interface BeginShadowParams {
  userId: string;
  message: unknown;
  hasImage: boolean;
  transcribeOnly?: boolean;
  clientTimezone?: unknown;
}

/**
 * The v1 hook, part 1 — call at the top of the turn. Returns null (and does nothing else) when the
 * step is off, the turn has no text, or carries an image (the shadow sends no image to Stage A yet).
 * Otherwise it STARTS the TurnInput read immediately — before this turn's own writes — and hands
 * back the handle whose finish() runs the shadow after the reply. Never throws.
 */
export function beginShadowTurn(p: BeginShadowParams, deps: ShadowTurnDeps = {}): ShadowTurn | null {
  try {
    if (typeof p.message !== 'string' || p.message.trim() === '' || p.hasImage || p.transcribeOnly) return null;
    const mode = (deps.mode ?? rolloutMode)(SHADOW_STEP, p.userId);
    if (mode === 'off') return null;
    const message = p.message;
    const userId = p.userId;
    const now = (deps.now ?? (() => new Date()))();
    const turnId = crypto.randomUUID();
    const db = deps.db ?? supabaseTurnInputDb(supabaseAdmin as unknown as PgClientLike);
    const tz = typeof p.clientTimezone === 'string' && p.clientTimezone ? p.clientTimezone : null;
    const tiP: Promise<{ ti: TurnInput | null; error: string | null }> = loadTurnInput(db, { userId, now, clientTimezone: tz })
      .then((ti) => ({ ti, error: null }), (e) => ({ ti: null, error: errMsg(e) }));
    let modelActions: Set<object> | null = null;
    let finished = false;
    return {
      turnId,
      mode,
      markModelActions(actions) {
        try { modelActions = new Set(actions); } catch (e) { console.error('[v2_shadow] markModelActions failed:', errMsg(e)); }
      },
      finish(f) {
        if (finished) return;
        finished = true;
        try {
          const facts = v1ActionFacts({
            actions: f.actions, feedback: f.feedback, receipts: f.receipts, dupSkip: f.dupSkip, modelActions,
            correctionReverted: f.correctionReverted ?? null,
          });
          const stamp = rolloutStamp(ACTIVE_ROLLOUT_STEPS, userId);
          const sink = deps.sink === undefined ? supabaseShadowSink(supabaseAdmin as unknown as Parameters<typeof supabaseShadowSink>[0]) : deps.sink;
          (deps.schedule ?? scheduleBackground)(async () => {
            const { ti, error } = await tiP;
            await (deps.run ?? runShadow)(
              { userId, message, turnInput: ti, turnInputError: error, v1Actions: facts, v1Mode: f.v1Mode, v1Safety: f.v1Safety ?? [], turnId, now },
              { ...(deps.runDeps ?? {}), sink, rolloutStamp: stamp },
            );
          });
        } catch (e) {
          console.error('[v2_shadow] finish failed (v1 reply unaffected):', errMsg(e));
        }
      },
    };
  } catch (e) {
    console.error('[v2_shadow] begin failed (v1 turn unaffected):', errMsg(e));
    return null;
  }
}
