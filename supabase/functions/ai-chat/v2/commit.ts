/**
 * ai-chat/v2/commit.ts — T5 COMMIT: verdicts → writes, holds, rejects and typed receipts
 * (AI_MIMARI_V2 §3.2 T5, §5.2, §6, §7.1).
 *
 * Two halves, so the decision part is unit-testable without a database:
 *
 *   planCommit(input)            PURE. validateDecision's verdicts → an ordered list of steps:
 *                                writer RPCs (w_meal_apply / w_water_apply / w_metric_apply),
 *                                record ops (w_record_delete by ref), adapter writes (ops with no
 *                                RPC yet: profile, spine, goal, workout, supplement, events, labs,
 *                                recipes, commitments, memory), hold opens (ASK → v2_hold_open),
 *                                hold answers (pending confirm → re-validated held write; discard),
 *                                plus the REJECTs and FLAGs that need no I/O at all.
 *   executeCommit(plan, ports)   I/O through injected ports, in order, never throwing: every step
 *                                ends as a typed V2Receipt whose `ok` comes from the WRITER.
 *
 * What code does here is mechanical only (yapay zekâ anlar, kod denetler): it never rewrites a
 * model value. A row is exactly the verdict's `row` (args ⊕ derive ⊕ lossless column fits); a ref
 * the model named is translated to a database target through the turn's refMap; an op v2 cannot
 * write yet is a visible REJECT, never a silent ok.
 *
 * Refs. The model's refs are TURN-scoped tokens (input.ts renders them per turn, registry grammar);
 * the writer RPCs speak the persistent record_refs grammar (m/t/s/e/l/d/w — v2-db-types.ts). The
 * translation goes through the row id, never through the token text: a record row is looked up in
 * record_refs by (table, id), a day-metric value resolves to the latest live ledger write on that
 * field. A hold stores row ids (never tokens) and is mapped back to THIS turn's tokens on confirm.
 */
import { eraseQuestion, parseEraseScope } from '../../shared/erase-hold.ts';
import { allergenTagsHit } from '../../shared/safety-invariants.ts';
import {
  type HoldOpenOptions, type HoldOpenOk, type HoldResolveOk, type MealApplyOk, type MetricApplyOk, type RecordOpOk, type RpcFailure,
  type WaterApplyOk, HOLD_DEFAULT_TTL_MIN, parseRpcReceipt, V2_RPC,
} from '../../shared/v2-db-types.ts';
import {
  collectRefs, ERASE_HOLD_OP, getOp, PROFILE_FIELD_SPECS, receiptLine, rejectLine, SCHEMA_VERSION, validateConfirmedHold, writeFailedLine,
  type DecisionValidation, type RenderedRefs, type ValidationContext, type WriteVerdict,
} from '../../shared/write-registry/mod.ts';
import { trNum } from '../../shared/write-registry/util.ts';
import type { CommitResult, V2Flag, V2Hold, V2Receipt, V2Reject } from './contracts.ts';
import { SAFETY_HOLD_OPS } from './facts.ts';
import type { RefMapTarget, TurnInput, TurnRefs } from './input.ts';

/** The ONE safety-hold classifier lives in facts.ts (facts, post-checks and guarantees read it too). */
export { isSafetyHold } from './facts.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ─── op routing ──────────────────────────────────────────────────────────────────────────────────

export type WriterRpc = 'w_meal_apply' | 'w_water_apply' | 'w_metric_apply';

/** Registry ops that have an atomic writer RPC (migration 113). */
export const RPC_OPS: Readonly<Record<string, WriterRpc>> = {
  meal_log: 'w_meal_apply',
  water_log: 'w_water_apply',
  body_weight: 'w_metric_apply',
  sleep_log: 'w_metric_apply',
  mood_log: 'w_metric_apply',
  step_log: 'w_metric_apply',
};

/** Registry ops written through adapter.ts (existing tables + shared writers + v2_ledger_append). */
export const ADAPTER_OPS: ReadonlySet<string> = new Set([
  'workout_log', 'supplement_log', 'profile_set', 'goal_set', 'constraint_add', 'constraint_retract', 'constraint_confirm',
  'food_pref', 'life_event', 'lab_value', 'recipe_save', 'periodic_state', 'commitment_add', 'commitment_resolve', 'memory_note',
]);

/**
 * Ops the v2 turn cannot write yet. They are REJECTED visibly (the coach says so) — never held
 * (a question whose "yes" could not be executed) and never acknowledged as written.
 */
export const UNSUPPORTED_OPS: Readonly<Record<string, string>> = {
  target_change: 'kalori programlarını (bakım, mini cut, plato, telafi, MVD günü) sohbetten başlatmak bu sürümde henüz açık değil; hiçbir şey değiştirmedim',
};

/** Turkish reasons for writer failure classes (v2-db-types V2_FAILURE_CLASSES + adapter classes). */
export const FAILURE_TR: Readonly<Record<string, string>> = {
  invalid_value: 'veritabanı değeri kabul etmedi',
  no_op: 'yazılacak bir değişiklik yoktu',
  unknown_ref: 'bu kaydı veritabanında bulamadım',
  wrong_ref_kind: 'gösterilen kayıt bu türden değil',
  not_deletable: 'bu kayıt bu yolla silinemez',
  not_owner: 'kayıt sana ait değil',
  row_missing: 'kayıt artık yok',
  already_undone: 'bu kayıt zaten geri alınmış',
  not_undone: 'bu kayıt geri alınmış değil',
  replaced: 'bu kaydın yerine yenisi yazılmış',
  later_write: 'aynı kayda sonradan başka bir yazma yapılmış; onu ezmemek için dokunmadım',
  too_old: '7 günden eski kayıt sohbetten değiştirilemez',
  not_reversible: 'bu yazma geri alınamaz',
  hold_not_open: 'bekleyen onay artık açık değil',
  hold_expired: 'bekleyen onayın süresi dolmuş',
  hold_op_mismatch: 'bekleyen onay başka bir işleme ait',
  not_in_ledger: 'bu değerin hangi yazmayla geldiğini defterde bulamadım',
  stale_hold: 'bekleyen onay eski bir kayıt sürümüne ait; yeniden sorulmalı',
  hold_ref_missing: 'bekleyen onaydaki kayıt artık gösterilmiyor',
  hold_persist_failed: 'onay sorusunu kaydedemedim; bu yüzden yazmadım',
  not_supported: 'bu işlem bu sürümde henüz desteklenmiyor',
  write_failed: 'kayıt sırasında veritabanı hatası oluştu',
};

export function failureTr(cls: string | null | undefined): string {
  return (cls && FAILURE_TR[cls]) || FAILURE_TR.write_failed;
}

// ─── plan types ──────────────────────────────────────────────────────────────────────────────────

/** A database target the model pointed at, translated from its turn token through the refMap. */
export type TargetSpec =
  | { kind: 'row'; table: string; id: string; token: string }
  | { kind: 'metric'; table: 'daily_metrics'; id: string; field: string; op: string; token: string }
  | { kind: 'unresolvable'; token: string; reason: string };

/** What a target resolved to in the database (record_refs ref and/or a ledger write id). */
export type ResolvedTarget =
  | { ok: true; ref: string | null; write_id: string | null }
  | { ok: false; failure_class: string };

/** pending_writes.payload of a v2 hold: the frozen args, refs replaced by row ids (never tokens). */
export interface HoldPayloadV2 {
  v: 2;
  op: string;
  schema_version: string;
  args: Record<string, unknown>;
  refs: Array<{ path: string; table: string; id: string; field?: string }>;
}

interface StepBase {
  /** The verdict whose receipt this step produces (for a confirmed hold: the re-validated held write). */
  verdict: WriteVerdict;
}

export type CommitStep =
  | (StepBase & { kind: 'rpc'; rpc: WriterRpc; payload: Record<string, unknown>; replaces: TargetSpec | null; pendingId: string | null })
  | (StepBase & { kind: 'record_delete'; target: TargetSpec; reason: string })
  | (StepBase & { kind: 'adapter'; op: string; row: Record<string, unknown>; replaces: TargetSpec | null; pendingId: string | null; refRow: RefMapTarget | null })
  | (StepBase & { kind: 'hold_open'; holdOp: string; payload: HoldPayloadV2; opts: HoldOpenOptions })
  | (StepBase & { kind: 'erase_hold'; scope: 'memory' | 'account' })
  | (StepBase & { kind: 'erase_confirm'; pendingId: string })
  | (StepBase & { kind: 'hold_resolve'; pendingId: string; status: 'discarded' | 'failed'; note: string; receipt: boolean });

export interface CommitPlan {
  turnId: string;
  userId: string;
  today: string;
  /** For receipt lines that quote a rendered record ("Kayıt geri alındı: …"). */
  refs: RenderedRefs;
  /** The user's own allergen/intolerance subjects before this turn (consumption check, §7.1). */
  allergenSpine: string[];
  steps: CommitStep[];
  /** REJECT verdicts: nothing is written, the receipt says why. */
  rejects: Array<{ verdict: WriteVerdict | null; op: string; reason_code: string; reason_tr: string; receipt: V2Receipt | null }>;
  flags: V2Flag[];
  /** Declared restatements (meal status=restatement): valid, nothing to store, no receipt. */
  noops: Array<{ op: string; why: string }>;
}

export interface PlanCommitInput {
  turnId: string;
  userId: string;
  validation: DecisionValidation;
  turnInput: TurnInput;
  refs: TurnRefs;
  /** The SAME ValidationContext the decision was validated with (confirmed holds re-run against it). */
  ctx: ValidationContext;
}

// ─── small pure helpers ──────────────────────────────────────────────────────────────────────────

/** 'patch.items[0].name' → ['patch', 'items', 0, 'name'] (character scan, no pattern matching). */
export function pathKeys(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  let cur = '';
  let inIndex = false;
  const flush = () => {
    if (cur === '') return;
    out.push(inIndex ? Number(cur) : cur);
    cur = '';
  };
  for (const ch of path) {
    if (ch === '.' && !inIndex) flush();
    else if (ch === '[') { flush(); inIndex = true; }
    else if (ch === ']') { flush(); inIndex = false; }
    else cur += ch;
  }
  flush();
  return out;
}

export function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
  const keys = pathKeys(path);
  if (keys.length === 0) return false;
  let cur: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur = Array.isArray(cur) ? cur[k as number] : isRec(cur) ? cur[k as string] : undefined;
    if (cur === undefined || cur === null) return false;
  }
  const last = keys[keys.length - 1];
  if (Array.isArray(cur) && typeof last === 'number') { cur[last] = value; return true; }
  if (isRec(cur) && typeof last === 'string') { cur[last] = value; return true; }
  return false;
}

/** The turn token → its database target (refMap). Unknown/unsupported tables stay unresolvable. */
export function targetOf(token: unknown, refs: TurnRefs): TargetSpec {
  const t = typeof token === 'string' ? token : '';
  const m = refs.refMap.get(t);
  if (!m) return { kind: 'unresolvable', token: t, reason: 'unknown_ref' };
  if (m.table === 'daily_metrics') {
    if (!m.field) return { kind: 'unresolvable', token: t, reason: 'unknown_ref' };
    return { kind: 'metric', table: 'daily_metrics', id: m.id, field: m.field, op: refs.rendered[t]?.op ?? '', token: t };
  }
  if (['meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values'].includes(m.table)) {
    return { kind: 'row', table: m.table, id: m.id, token: t };
  }
  return { kind: 'unresolvable', token: t, reason: 'not_deletable' };
}

function firstIssue(v: WriteVerdict, level: 'hard' | 'ask' | 'flag') {
  return v.issues.find((i) => i.level === level) ?? null;
}

function rejectOf(v: WriteVerdict): { verdict: WriteVerdict; op: string; reason_code: string; reason_tr: string; receipt: V2Receipt } {
  const h = firstIssue(v, 'hard');
  return {
    verdict: v,
    op: v.op === 'unknown' ? v.envelope : v.op,
    reason_code: h?.code ?? 'reddedildi',
    reason_tr: h?.tr ?? 'denetimden geçmedi',
    receipt: {
      action_type: v.op, ok: false, rows_affected: 0, user_line: rejectLine(v),
      failure_class: h?.failure_class ?? 'invalid_value', ref: null, write_id: null, legacy_type: v.envelope,
    },
  };
}

function plainReject(v: WriteVerdict, reasonCode: string, reasonTr: string, failureClass: string) {
  return {
    verdict: v,
    op: v.op,
    reason_code: reasonCode,
    reason_tr: reasonTr,
    receipt: {
      action_type: v.op, ok: false, rows_affected: 0, user_line: `Kaydedilmedi (${getOp(v.op)?.title_tr ?? v.op}): ${reasonTr}`,
      failure_class: failureClass, ref: null, write_id: null, legacy_type: v.envelope,
    } as V2Receipt,
  };
}

/** One open hold per (op, subject): a newer question about the same thing supersedes the old. */
export function holdSubjectKey(v: WriteVerdict, refs: TurnRefs): string | null {
  const a = v.args;
  switch (v.op) {
    case 'record_update': {
      const t = refs.refMap.get(String(a.ref));
      return t ? `${v.op}:${t.id}${t.field ? `:${t.field}` : ''}` : null;
    }
    case 'constraint_retract': {
      const t = refs.refMap.get(String(a.target));
      return t ? `${v.op}:${t.id}` : null;
    }
    case 'profile_set': {
      const c = Array.isArray(a.changes) && isRec(a.changes[0]) ? a.changes[0] : null;
      return c && typeof c.field === 'string' ? `${v.op}:${c.field}` : null;
    }
    default: {
      const day = isRec(v.hold_args) && typeof v.hold_args.day === 'string' ? v.hold_args.day : null;
      return day ? `${v.op}:${day}` : null;
    }
  }
}

/**
 * 'safety' holds: the coach must ask — if it does not, code appends the question (§5.2). An identity
 * field in ANY change of a profile_set makes the hold a safety hold (not only the first change).
 */
export function holdClassOf(v: WriteVerdict): 'ask' | 'safety' {
  if (SAFETY_HOLD_OPS.has(v.hold_op ?? v.op) || v.op === ERASE_HOLD_OP) return 'safety';
  if (v.op === 'profile_set') {
    const changes = Array.isArray(v.args.changes) ? v.args.changes.filter(isRec) : [];
    if (changes.some((c) => typeof c.field === 'string' && PROFILE_FIELD_SPECS[c.field]?.identity)) return 'safety';
  }
  return 'ask';
}

/** ASK verdict → the hold payload: frozen args, every ref token replaced by its row id. */
export function holdPayloadOf(v: WriteVerdict, refs: TurnRefs): HoldPayloadV2 {
  const args = clone(v.hold_args ?? v.args);
  const held: HoldPayloadV2['refs'] = [];
  for (const r of collectRefs(v.op, args)) {
    const t: RefMapTarget | undefined = refs.refMap.get(r.ref);
    if (!t) continue;
    held.push(t.field ? { path: r.path, table: t.table, id: t.id, field: t.field } : { path: r.path, table: t.table, id: t.id });
    setAtPath(args, r.path, null);
  }
  return { v: 2, op: v.hold_op ?? v.op, schema_version: SCHEMA_VERSION, args, refs: held };
}

/**
 * A stored hold payload → args with THIS turn's tokens for its rows. A row not rendered this turn
 * gets a token no ref grammar accepts, so the validator rejects it visibly (never guesses).
 */
export function thawHoldArgs(payload: HoldPayloadV2, refs: TurnRefs): { args: Record<string, unknown>; missing: string[] } {
  const args = clone(payload.args);
  const missing: string[] = [];
  for (const r of payload.refs) {
    let token: string | null = null;
    for (const [tok, t] of refs.refMap) {
      if (t.table === r.table && t.id === r.id && (r.field === undefined || t.field === r.field)) { token = tok; break; }
    }
    if (token === null) { missing.push(r.path); token = 'yok0'; }
    setAtPath(args, r.path, token);
  }
  return { args, missing };
}

export function isHoldPayloadV2(p: unknown): p is HoldPayloadV2 {
  return isRec(p) && p.v === 2 && typeof p.op === 'string' && isRec(p.args) && Array.isArray(p.refs) && typeof p.schema_version === 'string';
}

// ─── RPC payloads (pure: verdict row → writer payload) ───────────────────────────────────────────

/** w_meal_apply payload from a meal_log row. The numbers are the row's (model or chosen reference). */
export function mealPayload(row: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(row.items) ? (row.items as unknown[]).filter(isRec) : [];
  const venue = str(row.venue);
  return {
    day: row.date,
    meal_type: row.meal_type,
    raw: typeof row.raw === 'string' ? row.raw : '',
    input_method: 'ai_chat',
    time_local: str(row.time_local),
    venue: venue && venue.trim() ? { name: venue.trim() } : null,
    pipeline: 'v2',
    items: items.map((it) => ({
      name: it.name,
      as_stated: str(it.as_stated),
      grams: num(it.grams),
      kcal: it.kcal,
      protein_g: it.protein_g,
      carbs_g: it.carbs_g,
      fat_g: it.fat_g,
      alcohol_g: num(it.alcohol_g) ?? 0,
      caffeine_mg: num(it.caffeine_mg) ?? 0,
      preparation: str(it.preparation),
      allergens: Array.isArray(it.allergens) ? it.allergens : [],
      may_contain: Array.isArray(it.may_contain) ? it.may_contain : [],
      reference_key: str(it.reference_key),
      confidence: num(it.confidence),
      data_source: str(it.data_source),
      meta: num(it.model_kcal) !== null ? { model_kcal: it.model_kcal } : null,
    })),
  };
}

export function waterPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    day: row.date, mode: row.mode, liters: row.liters, as_stated: str(row.as_stated), quantity: num(row.quantity),
    unit: str(row.unit), pipeline: 'v2',
  };
}

/** w_metric_apply payload. Only details the model actually gave are sent (NULL ≠ CLEAR, 113). */
export function metricPayload(op: string, row: Record<string, unknown>, today: string): Record<string, unknown> {
  const base = { day: row.date, as_stated: str(row.as_stated), pipeline: 'v2' };
  switch (op) {
    case 'body_weight':
      return { ...base, metric: 'weight', values: { kg: row.kg }, update_profile: row.date === today };
    case 'sleep_log': {
      const values: Record<string, unknown> = { hours: row.hours };
      if (str(row.quality)) values.quality = row.quality;
      if (str(row.bed_time)) values.sleep_time = row.bed_time;
      if (str(row.wake_time)) values.wake_time = row.wake_time;
      return { ...base, metric: 'sleep', values };
    }
    case 'mood_log': {
      const values: Record<string, unknown> = { score: row.score };
      if (str(row.note)) values.note = row.note;
      return { ...base, metric: 'mood', values };
    }
    default:
      return { ...base, metric: 'steps', values: { steps: row.steps } };
  }
}

function rpcPayloadFor(op: string, row: Record<string, unknown>, today: string): Record<string, unknown> {
  if (op === 'meal_log') return mealPayload(row);
  if (op === 'water_log') return waterPayload(row);
  return metricPayload(op, row, today);
}

// ─── planCommit (pure) ───────────────────────────────────────────────────────────────────────────

/** The user's own allergen/intolerance subjects (the loader renders active rows only). */
export function allergenSpineOf(ti: TurnInput): string[] {
  return ti.constraints.filter((c) => c.kind === 'allergen' || c.kind === 'intolerance').map((c) => c.subject).filter(Boolean);
}

/** A COMMIT/FLAG write (or a re-validated held write) → its step. */
function writeStep(v: WriteVerdict, refs: TurnRefs, today: string, pendingId: string | null): CommitStep | null {
  const row = v.row;
  if (!row) return null;
  if (v.op === 'record_update') {
    const patch = isRec(row.patch) ? row.patch : null;
    const patchOp = patch && typeof v.args.patch === 'object' && isRec(v.args.patch) ? String(v.args.patch.op) : '';
    if (!patch) return null;
    const target = targetOf(v.args.ref, refs);
    if (RPC_OPS[patchOp]) return { kind: 'rpc', rpc: RPC_OPS[patchOp], payload: rpcPayloadFor(patchOp, patch, today), replaces: target, pendingId, verdict: v };
    return { kind: 'adapter', op: patchOp, row: patch, replaces: target, pendingId, refRow: null, verdict: v };
  }
  if (v.op === 'record_delete' || v.op === 'record_restore_metric') {
    return { kind: 'record_delete', target: targetOf(v.args.ref, refs), reason: str(v.args.reason) ?? '', verdict: v };
  }
  const replaces = typeof v.args.replaces === 'string' ? targetOf(v.args.replaces, refs) : null;
  if (RPC_OPS[v.op]) return { kind: 'rpc', rpc: RPC_OPS[v.op], payload: rpcPayloadFor(v.op, row, today), replaces, pendingId, verdict: v };
  if (ADAPTER_OPS.has(v.op)) {
    // The record an adapter op acts on by ref (constraint_retract/confirm target, commitment_resolve ref).
    const token = typeof v.args.target === 'string' ? v.args.target : typeof v.args.ref === 'string' ? v.args.ref : null;
    const refRow = token ? refs.refMap.get(token) ?? null : null;
    return { kind: 'adapter', op: v.op, row, replaces, pendingId, refRow, verdict: v };
  }
  return null;
}

/**
 * The pure half. Verdict → step (or a REJECT/FLAG/noop needing no I/O). Order: answers to holds,
 * record ops, writes, commitments, then the new holds (a new hold may supersede an old one).
 */
export function planCommit(input: PlanCommitInput): CommitPlan {
  const { validation, refs, turnInput: ti, ctx } = input;
  const plan: CommitPlan = {
    turnId: input.turnId, userId: input.userId, today: ctx.today, refs: refs.rendered, allergenSpine: allergenSpineOf(ti),
    steps: [], rejects: [], flags: [], noops: [],
  };
  const holdSteps: CommitStep[] = [];
  const order: Record<string, number> = { pending_ops: 0, record_ops: 1, writes: 2, commitment_ops: 3, memory: 4 };
  const verdicts = [...validation.verdicts].sort((a, b) => (order[a.channel] ?? 9) - (order[b.channel] ?? 9));

  for (const v of verdicts) {
    if (v.channel === 'memory') continue; // the coach stage writes memory (after Stage B)
    if (v.noop) { plan.noops.push({ op: v.op, why: v.noop }); continue; }
    if (v.verdict === 'REJECT') { plan.rejects.push(rejectOf(v)); continue; }
    if (UNSUPPORTED_OPS[v.op]) {
      plan.rejects.push(plainReject(v, 'v2_desteklenmiyor', UNSUPPORTED_OPS[v.op], 'not_supported'));
      continue;
    }

    if (v.op === 'pending_confirm' || v.op === 'pending_discard') {
      const token = String(v.args.ref);
      const target = refs.refMap.get(token);
      const hold = target ? ti.pending.find((p) => p.id === target.id) : undefined;
      if (!target || !hold) {
        plan.rejects.push(plainReject(v, 'bekletme_yok', failureTr('hold_not_open'), 'hold_not_open'));
        continue;
      }
      if (v.op === 'pending_discard') {
        plan.steps.push({ kind: 'hold_resolve', pendingId: hold.id, status: 'discarded', note: 'user_discarded', receipt: true, verdict: v });
        continue;
      }
      if (hold.op === ERASE_HOLD_OP) {
        plan.steps.push({ kind: 'erase_confirm', pendingId: hold.id, verdict: v });
        continue;
      }
      if (!isHoldPayloadV2(hold.payload) || hold.payload.schema_version !== SCHEMA_VERSION || hold.payload.op !== hold.op) {
        plan.rejects.push(plainReject(v, 'eski_bekletme', failureTr('stale_hold'), 'stale_hold'));
        plan.steps.push({ kind: 'hold_resolve', pendingId: hold.id, status: 'failed', note: 'stale_hold', receipt: false, verdict: v });
        continue;
      }
      const { args, missing } = thawHoldArgs(hold.payload, refs);
      const held = validateConfirmedHold(hold.op, args, ctx);
      if (!held) {
        plan.rejects.push(plainReject(v, 'bekletme_turu', failureTr('hold_op_mismatch'), 'hold_op_mismatch'));
        continue;
      }
      if (missing.length > 0 || held.verdict === 'REJECT' || UNSUPPORTED_OPS[held.op]) {
        const r = missing.length > 0
          ? plainReject(held, 'bekletme_kaydi_yok', failureTr('hold_ref_missing'), 'hold_ref_missing')
          : UNSUPPORTED_OPS[held.op] ? plainReject(held, 'v2_desteklenmiyor', UNSUPPORTED_OPS[held.op], 'not_supported') : rejectOf(held);
        plan.rejects.push(r);
        plan.steps.push({ kind: 'hold_resolve', pendingId: hold.id, status: 'failed', note: r.reason_code, receipt: false, verdict: held });
        continue;
      }
      for (const i of held.issues) if (i.level === 'flag') plan.flags.push({ op: held.op, code: i.code, note_tr: i.tr });
      const step = writeStep(held, refs, ctx.today, hold.id);
      if (step) plan.steps.push(step);
      else {
        plan.rejects.push(plainReject(held, 'yazici_yok', failureTr('not_supported'), 'not_supported'));
        plan.steps.push({ kind: 'hold_resolve', pendingId: hold.id, status: 'failed', note: 'no_writer', receipt: false, verdict: held });
      }
      continue;
    }

    if (v.verdict === 'ASK') {
      if (v.op === 'data_erase_request') {
        const scope = parseEraseScope(v.args.scope);
        if (scope) holdSteps.push({ kind: 'erase_hold', scope, verdict: v });
        else plan.rejects.push(plainReject(v, 'kapsam_belirsiz', 'neyi silmemi istediğin belirsiz', 'invalid_value'));
        continue;
      }
      holdSteps.push({
        kind: 'hold_open',
        holdOp: v.hold_op ?? v.op,
        payload: holdPayloadOf(v, refs),
        opts: {
          subject_key: holdSubjectKey(v, refs),
          hold_class: holdClassOf(v),
          reason_code: firstIssue(v, 'ask')?.code ?? null,
          schema_version: SCHEMA_VERSION,
          ttl_minutes: HOLD_DEFAULT_TTL_MIN,
        },
        verdict: v,
      });
      continue;
    }

    // COMMIT / FLAG
    if (v.verdict === 'FLAG') for (const i of v.issues) if (i.level === 'flag') plan.flags.push({ op: v.op, code: i.code, note_tr: i.tr });
    const step = writeStep(v, refs, ctx.today, null);
    if (step) plan.steps.push(step);
    else plan.rejects.push(plainReject(v, 'yazici_yok', failureTr('not_supported'), 'not_supported'));
  }

  // §5.1.10: the turn-level facts the coach needs (reported but not written / declared reason).
  if (validation.missed_write) {
    plan.flags.push({ op: 'turn', code: 'missed_write', note_tr: 'kullanıcı yeni bir şey bildirdi ama hiçbir şey yazılmadı ve gerekçe verilmedi — kısaca sor' });
  }
  if (validation.not_written_reason) {
    plan.flags.push({ op: 'turn', code: `not_written:${validation.not_written_reason}`, note_tr: 'bildirilen şey bilinçli olarak yazılmadı (gerekçe karar içinde)' });
  }
  plan.steps.push(...holdSteps);
  return plan;
}

// ─── execution ports ─────────────────────────────────────────────────────────────────────────────

export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** What an adapter write reports back (adapter.ts). `ok` is the writer's own truth. */
export interface AdapterOutcome {
  ok: boolean;
  rows_affected: number | null;
  failure_class: string | null;
  /** Persistent ref (record_refs) of the written row, when the ledger gave one. */
  ref: string | null;
  write_id: string | null;
  /** Extra Turkish note appended to the receipt line (e.g. "set ayrıntıları kaydedilemedi"). */
  note_tr?: string | null;
  /** The write landed but its undoable ledger row did not (best-effort append failed). */
  ledger_missing?: boolean;
}

/** Receipt note / coach fact when an adapter write's ledger row is missing (never a silent ok). */
export const LEDGER_MISSING_NOTE = 'bu kayıt sohbetten geri alınamaz';
export const LEDGER_MISSING_FLAG = 'kaydedildi ama geri alma defterine yazılamadı: sohbetten geri alınamaz ya da düzeltilemez — kullanıcıya dürüstçe söyle, gerekirse Günlük ekranından silebilir';

export interface AdapterRequest {
  userId: string;
  turnId: string;
  today: string;
  op: string;
  row: Record<string, unknown>;
  verdict: WriteVerdict;
  /** record_update on an adapter op: the old record to undo first (already resolved). */
  replaces: { ref: string | null; write_id: string | null } | null;
  /** The row a ref-taking op acts on (c# → user_constraints row, k# → user_commitments row). */
  refRow: RefMapTarget | null;
}

export interface EraseConfirmOutcome {
  ok: boolean;
  scope: 'memory' | 'account' | null;
  line: string | null;
  failureClass: string | null;
}

export interface AdapterPort {
  apply(req: AdapterRequest): Promise<AdapterOutcome>;
  createEraseHold(userId: string, scope: 'memory' | 'account'): Promise<{ ok: boolean; id?: string }>;
  confirmEraseHold(userId: string): Promise<EraseConfirmOutcome>;
}

export interface CommitPorts {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** Translate a turn target into the database's own handle (record_refs ref / ledger write). */
  resolveTarget(userId: string, today: string, target: TargetSpec): Promise<ResolvedTarget>;
  adapter: AdapterPort;
  /** Called once, right before the first write leaves (the route's "no v1 fallback after a write"). */
  onWrite?: () => void;
  /** Called after each step whose writer reported ok (post-commit hooks: TDEE, onboarding). */
  onApplied?: (step: CommitStep) => void;
  log?: (line: string, data: Record<string, unknown>) => void;
}

// ─── executeCommit ───────────────────────────────────────────────────────────────────────────────

interface StepResult {
  receipt: V2Receipt | null;
  hold?: V2Hold;
  reject?: V2Reject;
  flags?: V2Flag[];
  ref?: string | null;
  exposureItems?: Array<{ name: unknown; allergens: unknown; may_contain: unknown }>;
  exposureSource?: 'meal' | 'supplement';
  spineAdds?: string[];
}

const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);

function okReceipt(v: WriteVerdict, plan: CommitPlan, r: { rows_affected: number | null; ref: string | null; write_id: string | null }, extra?: string | null): V2Receipt {
  const line = receiptLine(v, { today: plan.today, refs: plan.refs });
  return {
    action_type: v.op, ok: true, rows_affected: r.rows_affected, user_line: line && extra ? `${line} · ${extra}` : line ?? extra ?? null,
    failure_class: null, ref: r.ref, write_id: r.write_id, legacy_type: v.envelope,
  };
}

function failResult(v: WriteVerdict, failureClass: string): StepResult {
  const why = failureTr(failureClass);
  return {
    receipt: {
      action_type: v.op, ok: false, rows_affected: 0, user_line: `${writeFailedLine(v)}: ${why}`, failure_class: failureClass,
      ref: null, write_id: null, legacy_type: v.envelope,
    },
    reject: { op: v.op, reason_code: failureClass, reason_tr: why },
  };
}

async function callRpc<T extends { ok: true; op: string }>(ports: CommitPorts, name: string, args: Record<string, unknown>, expect: readonly string[]): Promise<T | RpcFailure> {
  try {
    const r = await ports.rpc(name, args);
    if (r.error) return { ok: false, op: expect[0] ?? name, failure_class: 'write_failed', detail: { error: r.error.message.slice(0, 300) } };
    return parseRpcReceipt<T>(r.data, expect);
  } catch (e) {
    return { ok: false, op: expect[0] ?? name, failure_class: 'write_failed', detail: { error: errMsg(e) } };
  }
}

async function resolveOrFail(ports: CommitPorts, plan: CommitPlan, target: TargetSpec): Promise<ResolvedTarget> {
  if (target.kind === 'unresolvable') return { ok: false, failure_class: target.reason };
  try {
    return await ports.resolveTarget(plan.userId, plan.today, target);
  } catch (e) {
    ports.log?.('[v2_commit] resolveTarget threw', { error: errMsg(e) });
    return { ok: false, failure_class: 'write_failed' };
  }
}

/** Failures that mean the hold itself is no longer open — nothing left to close. */
const HOLD_STATE_FAILURES: ReadonlySet<string> = new Set(['hold_not_open', 'hold_expired', 'hold_op_mismatch']);

/** Close a confirmed hold whose write ran outside the writer's own transaction. Never throws. */
async function closeHold(ports: CommitPorts, plan: CommitPlan, pendingId: string, ok: boolean, ref: string | null, failureClass: string | null): Promise<void> {
  const r = await callRpc<HoldResolveOk>(ports, V2_RPC.holdResolve, {
    p_user: plan.userId, p_turn_id: plan.turnId, p_pending_id: pendingId, p_status: ok ? 'confirmed' : 'failed',
    p_result: { ok, ref, failure_class: failureClass }, p_note: ok ? 'confirmed' : (failureClass ?? 'failed'),
  }, ['hold_resolve']);
  if (!r.ok) ports.log?.('[v2_commit] hold close failed', { pending_id: pendingId, failure_class: r.failure_class });
}

const EXPECT: Record<WriterRpc, string[]> = {
  w_meal_apply: ['meal_log'],
  w_water_apply: ['water_log'],
  w_metric_apply: ['body_weight', 'sleep_log', 'mood_log', 'step_log'],
};

async function runStep(step: CommitStep, plan: CommitPlan, ports: CommitPorts, markWrite: () => void): Promise<StepResult> {
  const v = step.verdict;
  switch (step.kind) {
    case 'rpc': {
      let replaces: string | null = null;
      if (step.replaces) {
        const res = await resolveOrFail(ports, plan, step.replaces);
        if (!res.ok) return failResult(v, res.failure_class);
        if (!res.ref) return failResult(v, 'not_in_ledger');
        replaces = res.ref;
      }
      markWrite();
      // The writer claims a hold atomically only when the hold IS its own op (_v2_hold_claim checks
      // pending_writes.op = the writer's op). A held correction (op record_update) is written by the
      // patch's writer and its hold is closed right after, through v2_hold_resolve.
      const atomicHold = step.pendingId !== null && v.op !== 'record_update';
      const payload = { ...step.payload, replaces, pending_id: atomicHold ? step.pendingId : null };
      const r = await callRpc<MealApplyOk | WaterApplyOk | MetricApplyOk>(ports, step.rpc, { p_user: plan.userId, p_turn_id: plan.turnId, p_payload: payload }, EXPECT[step.rpc]);
      if (step.pendingId && (!atomicHold || (!r.ok && !HOLD_STATE_FAILURES.has(r.failure_class) && r.failure_class !== 'write_failed'))) {
        // Non-atomic close (correction hold), or an atomic write refused for a reason a repeated "evet"
        // cannot fix (invalid_value, later_write…): the hold must not stay open for a stray "yes".
        await closeHold(ports, plan, step.pendingId, r.ok, r.ok ? r.ref ?? null : null, r.ok ? null : r.failure_class);
      }
      if (!r.ok) return failResult(v, r.failure_class);
      let extra: string | null = null;
      if (r.op === 'water_log') {
        const total = num((r as WaterApplyOk).total);
        if (total !== null && v.op === 'water_log' && step.payload.mode === 'add') extra = `gün toplamı ${trNum(total, 2)} L`;
      }
      const out: StepResult = { receipt: okReceipt(v, plan, { rows_affected: 1, ref: r.ref ?? null, write_id: r.write_id ?? null }, extra), ref: r.ref ?? null };
      if (r.op === 'meal_log') {
        out.exposureSource = 'meal';
        out.exposureItems = ((r as MealApplyOk).items ?? []).map((it) => ({ name: it.name, allergens: it.allergen_tags, may_contain: it.may_contain }));
        if (out.exposureItems.length === 0) out.exposureItems = (Array.isArray(step.payload.items) ? step.payload.items as Record<string, unknown>[] : []).map((it) => ({ name: it.name, allergens: it.allergens, may_contain: it.may_contain }));
      }
      return out;
    }
    case 'record_delete': {
      const res = await resolveOrFail(ports, plan, step.target);
      if (!res.ok) return failResult(v, res.failure_class);
      const target = res.ref ? { ref: res.ref } : res.write_id ? { write_id: res.write_id } : null;
      if (!target) return failResult(v, 'not_in_ledger');
      markWrite();
      const r = await callRpc<RecordOpOk>(ports, V2_RPC.recordDelete, {
        p_user: plan.userId, p_turn_id: plan.turnId, p_target: target,
        p_opts: { max_age_days: 7, pipeline: 'v2', reason: step.reason.slice(0, 120) || null },
      }, ['record_delete']);
      if (!r.ok) return failResult(v, r.failure_class);
      return { receipt: okReceipt(v, plan, { rows_affected: Array.isArray(r.reversed) ? r.reversed.length : 1, ref: res.ref, write_id: null }) };
    }
    case 'adapter': {
      let replaces: AdapterRequest['replaces'] = null;
      if (step.replaces) {
        const res = await resolveOrFail(ports, plan, step.replaces);
        if (!res.ok) return failResult(v, res.failure_class);
        replaces = { ref: res.ref, write_id: res.write_id };
      }
      markWrite();
      let out: AdapterOutcome;
      try {
        out = await ports.adapter.apply({ userId: plan.userId, turnId: plan.turnId, today: plan.today, op: step.op, row: step.row, verdict: v, replaces, refRow: step.refRow });
      } catch (e) {
        ports.log?.('[v2_commit] adapter threw', { op: step.op, error: errMsg(e) });
        out = { ok: false, rows_affected: 0, failure_class: 'write_failed', ref: null, write_id: null };
      }
      if (step.pendingId) await closeHold(ports, plan, step.pendingId, out.ok, out.ref, out.failure_class);
      if (!out.ok) return failResult(v, out.failure_class ?? 'write_failed');
      // The write stands but its ledger row did not land (adapter writes are two statements until
      // their atomic RPCs exist): say so — on the receipt and to the coach — instead of a silent ok
      // that a later "geri al" / correction would contradict with not_in_ledger.
      const notes = [out.note_tr ?? null, out.ledger_missing ? LEDGER_MISSING_NOTE : null].filter((x): x is string => !!x);
      const res: StepResult = { receipt: okReceipt(v, plan, out, notes.length ? notes.join(' · ') : null), ref: out.ref };
      if (out.ledger_missing) res.flags = [{ op: step.op, code: 'ledger_missing', note_tr: LEDGER_MISSING_FLAG }];
      if (step.op === 'supplement_log') {
        res.exposureSource = 'supplement';
        res.exposureItems = [{ name: step.row.name, allergens: step.row.allergens, may_contain: step.row.may_contain }];
      }
      if (step.op === 'constraint_add' && step.row.spine === true && (step.row.kind === 'allergen' || step.row.kind === 'intolerance')) {
        res.spineAdds = [str(step.row.subject_id), str(step.row.display_tr)].filter((s): s is string => !!s);
      }
      return res;
    }
    case 'hold_open': {
      markWrite();
      const r = await callRpc<HoldOpenOk>(ports, V2_RPC.holdOpen, {
        p_user: plan.userId, p_turn_id: plan.turnId, p_op: step.holdOp, p_payload: step.payload, p_opts: step.opts,
      }, ['hold_open']);
      const ask = firstIssue(v, 'ask');
      if (!r.ok) {
        return { receipt: null, reject: { op: v.op, reason_code: 'hold_persist_failed', reason_tr: failureTr('hold_persist_failed') } };
      }
      return {
        receipt: null,
        hold: {
          op: step.holdOp, reason_code: ask?.code ?? 'onay', question_tr: v.question_tr ?? ask?.question_tr ?? ask?.tr ?? 'Bunu kaydetmemi onaylıyor musun?', hold_id: r.pending_id,
          hold_class: step.opts.hold_class ?? holdClassOf(v),
        },
      };
    }
    case 'erase_hold': {
      markWrite();
      let res: { ok: boolean; id?: string };
      try { res = await ports.adapter.createEraseHold(plan.userId, step.scope); } catch (e) {
        ports.log?.('[v2_commit] erase hold threw', { error: errMsg(e) });
        res = { ok: false };
      }
      if (!res.ok) return { receipt: null, reject: { op: v.op, reason_code: 'hold_persist_failed', reason_tr: failureTr('hold_persist_failed') } };
      return { receipt: null, hold: { op: ERASE_HOLD_OP, reason_code: 'kvkk_onay', question_tr: eraseQuestion(step.scope), hold_id: res.id ?? null, hold_class: 'safety' } };
    }
    case 'erase_confirm': {
      markWrite();
      let out: EraseConfirmOutcome;
      try { out = await ports.adapter.confirmEraseHold(plan.userId); } catch (e) {
        ports.log?.('[v2_commit] erase confirm threw', { error: errMsg(e) });
        out = { ok: false, scope: null, line: null, failureClass: 'erase_exec_failed' };
      }
      const receipt: V2Receipt = {
        action_type: 'pending_confirm', ok: out.ok, rows_affected: out.ok ? 1 : 0, user_line: out.line, failure_class: out.ok ? null : out.failureClass,
        ref: null, write_id: null, legacy_type: 'data_erase_confirm',
      };
      return out.ok ? { receipt } : { receipt, reject: { op: 'pending_confirm', reason_code: out.failureClass ?? 'erase_failed', reason_tr: out.line ?? 'silme onayı uygulanmadı' } };
    }
    case 'hold_resolve': {
      markWrite();
      const r = await callRpc<HoldResolveOk>(ports, V2_RPC.holdResolve, {
        p_user: plan.userId, p_turn_id: plan.turnId, p_pending_id: step.pendingId, p_status: step.status, p_result: null, p_note: step.note,
      }, ['hold_resolve']);
      if (!step.receipt) return { receipt: null };
      if (!r.ok) return failResult(v, r.failure_class);
      return { receipt: okReceipt(v, plan, { rows_affected: 1, ref: null, write_id: null }) };
    }
  }
}

/**
 * The I/O half. Never throws; one step's failure never stops the next (each write is atomic and
 * independent, §5.2). Steps run in plan order, one at a time: deterministic receipts, and two
 * writes to the same day row never race.
 */
export async function executeCommit(plan: CommitPlan, ports: CommitPorts): Promise<CommitResult> {
  const result: CommitResult = { turnId: plan.turnId, receipts: [], holds: [], rejects: [], flags: [...plan.flags], writtenRefs: [], exposures: [] };
  for (const r of plan.rejects) {
    result.rejects.push({ op: r.op, reason_code: r.reason_code, reason_tr: r.reason_tr });
    if (r.receipt) result.receipts.push(r.receipt);
  }
  let wrote = false;
  const markWrite = () => {
    if (wrote) return;
    wrote = true;
    try { ports.onWrite?.(); } catch { /* the hook is a flag setter; it must not break a commit */ }
  };
  const exposureCandidates: Array<{ source: 'meal' | 'supplement'; ref: string; items: NonNullable<StepResult['exposureItems']> }> = [];
  const spine = new Set(plan.allergenSpine);
  for (const step of plan.steps) {
    let out: StepResult;
    try {
      out = await runStep(step, plan, ports, markWrite);
    } catch (e) {
      ports.log?.('[v2_commit] step threw', { kind: step.kind, op: step.verdict.op, error: errMsg(e) });
      out = failResult(step.verdict, 'write_failed');
    }
    if (out.receipt) result.receipts.push(out.receipt);
    if (out.receipt?.ok && (step.kind === 'rpc' || step.kind === 'adapter' || step.kind === 'record_delete')) {
      try { ports.onApplied?.(step); } catch (e) { ports.log?.('[v2_commit] onApplied threw', { error: errMsg(e) }); }
    }
    if (out.hold) result.holds.push(out.hold);
    if (out.reject) result.rejects.push(out.reject);
    if (out.flags) result.flags.push(...out.flags);
    if (out.receipt?.ok && out.ref) result.writtenRefs.push(out.ref);
    if (out.receipt?.ok && out.exposureItems && out.exposureSource) {
      exposureCandidates.push({ source: out.exposureSource, ref: out.ref ?? '', items: out.exposureItems });
    }
    for (const s of out.spineAdds ?? []) spine.add(s);
  }
  // §7.1 consumption check: only what was REALLY written this turn, against the spine as it now stands.
  result.exposures = exposuresOf(exposureCandidates, [...spine]);
  return result;
}

/** (tags ∪ may_contain ∪ name dictionary) ∩ the user's allergen/intolerance subjects (pure). */
export function exposuresOf(
  written: ReadonlyArray<{ source: 'meal' | 'supplement'; ref: string; items: ReadonlyArray<{ name: unknown; allergens: unknown; may_contain: unknown }> }>,
  spine: readonly string[],
): CommitResult['exposures'] {
  if (spine.length === 0) return [];
  const out: CommitResult['exposures'] = [];
  for (const w of written) {
    const hit = new Set<string>();
    for (const it of w.items) {
      const tags = {
        name: typeof it.name === 'string' ? it.name : null,
        allergens: Array.isArray(it.allergens) ? it.allergens.filter((x): x is string => typeof x === 'string') : [],
        may_contain: Array.isArray(it.may_contain) ? it.may_contain.filter((x): x is string => typeof x === 'string') : [],
      };
      for (const h of allergenTagsHit(tags, spine)) hit.add(h.allergen);
    }
    if (hit.size > 0) out.push({ allergens: [...hit], source: w.source, ref: w.ref });
  }
  return out;
}

/**
 * The ONE turn quota class (migration 112), from what the commit REALLY did — never a pre-LLM guess.
 * The spec decides the hold-only case: 'record' = "tur en az bir kayıt yazdı" (112_chat_receipts.sql)
 * and the class follows "T5'te gerçekten yazılana göre" (AI_MIMARI_V2 §3.2 T0). A hold writes no
 * record — it stores a pending decision (pending_writes) that becomes a record only on the user's
 * yes, and THAT confirming turn is the record turn. So:
 *   a write that landed (ok receipt)       → 'record'
 *   holds only, failed writes, no writes   → 'conversation'
 * An answer to a hold that wrote nothing is not a record either: a pending_discard receipt ("Vazgeçildi"
 * — the hold row is closed, no log is written; first live trial: "hayır vazgeçtim, kalsın" was charged
 * as a record turn) and a pending_confirm receipt that reports no affected row. A confirm that DID
 * something (the KVKK erase executed, rows_affected ≥ 1) and every write a confirmed hold landed (its
 * own typed receipt) still count.
 * (The handler adds 'exempt' for protective and fail-closed turns, and never lets the conversation cap
 * stop a turn after a side effect — an opened hold, a closed one: handler.ts answers that turn.)
 */
export function quotaClassOf(commit: CommitResult | null): 'record' | 'conversation' {
  return commit && commit.receipts.some(isRecordReceipt) ? 'record' : 'conversation';
}

/** A landed receipt that wrote something (quotaClassOf). */
function isRecordReceipt(r: V2Receipt): boolean {
  if (!r.ok) return false;
  if (r.action_type === 'pending_discard') return false;
  if (r.action_type === 'pending_confirm') return (r.rows_affected ?? 0) > 0;
  return true;
}
