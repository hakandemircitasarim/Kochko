/**
 * ai-chat/v2/handler.ts — the v2 turn, T0–T9 (AI_MIMARI_V2 §3.2 "Anla → Denetle → Konuş").
 *
 *   T0  shell — the SAME helpers v1 uses (auth, request validation, request journal, rate-limit
 *       reservation), injected so nothing is forked; anything v2 does not own yet (photo, voice,
 *       plan chips, the approval button, an unreadable request) goes to v1 BEFORE any side effect.
 *   T1  fixed client protocols (exact equality, no language parsing): the 10-second undo button
 *       literal → the last turn's write of that type is undone through the ledger, no LLM. A last
 *       turn the ledger cannot answer for (pre-ledger v1 history, a failed v1 ledger append) goes to
 *       v1's handleUndo before any side effect (undoTargetOf) — never "nothing to undo" for a write
 *       that is still there.
 *   T2  safety tripwires (shared/safety-tripwires.ts): an explicit hit → today's canned reply at
 *       once; ambiguous hits → facts for Stage A, resolved by the §7.2 table after it.
 *   T3  loadTurnInput (input.ts).
 *   T4  Stage A (understand.ts, the ONE composer stage-a-request.ts) on the turn's §7.2 budget class
 *       (stage-a-request.ts STAGE_A_LIVE_BUDGETS_MS — an ordinary turn, or a turn T2 handed a tripwire
 *       fact). Fail-closed: on a turn with a live trigger a failed/late Stage A → today's canned reply;
 *       on an ordinary turn → a short honest line that nothing was recorded.
 *   T5  validateDecision → at most ONE repair call → commit.ts (writes, holds, rejects, receipts).
 *       A plan action (generate/revise/approve…) is Faz 4: the turn goes to v1 before any write.
 *   T6  Stage B through the coach PORT, from the receipts — the coach speaks after the writes.
 *   T7  the post-check PORT (suggestion invariant, prose judge, the ONE regen, fallbacks) — both under
 *       ONE end-to-end budget (ports.ts runStageB) — and then, owned HERE and always last,
 *       guarantees.ts applyGuarantees: the suggestion invariant on structure and the code-owned lines
 *       (112 / referral, the KVKK erase outcome, the allergen-exposure acknowledgement, every safety-hold
 *       question), append-only. No port can drop them.
 *   T8  the envelope PORT: the TurnEnvelope the app reads today.
 *   T9  chat_messages (model text + code notes, full receipts, turn_id, pipeline, quota_class) and
 *       one ai_turn_log row per stage; memory / hooks in the background.
 *
 * The ports' production implementations are the coach builder's modules (ports.ts stageBPorts:
 * coach.ts runCoach, postcheck.ts postcheckReply, envelope.ts renderEnvelope), wired in live.ts.
 *
 * The handler never decides alone whether v1 takes over after a failure: it reports `fallback_v1`
 * only before any side effect, and it marks TurnState.sideEffects the moment one may have happened
 * (route.ts then refuses a v1 re-run and answers honestly instead).
 */
import { liveAmbiguousHits, resolveTripwires, scanTripwires, type SafetyCategory, type TripwireScan } from '../../shared/safety-tripwires.ts';
import { checkTaskModeHint, isPlanTaskHint } from '../../shared/task-mode-hints.ts';
import { guardVerdictOf, type GuardFlag } from '../../shared/turn-failures.ts';
import type { ActionReceipt, TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';
import type { RespondUsage } from '../../shared/openai.ts';
import type { CodeNote, QuotaClass } from '../../shared/v2-db-types.ts';
import {
  SCHEMA_VERSION, validateChannelItems, validateDecision, type DecisionValidation, type ValidationContext, type Verdict,
} from '../../shared/write-registry/mod.ts';
import { STAGE_A_MIN_REPAIR_MS, STAGE_A_REPAIR_TIMEOUT_MS, STAGE_A_SALVAGE_TIMEOUT_MS, stageALiveBudgetMs } from './budgets.ts';
import {
  executeCommit, failureTr, planCommit, quotaClassOf, type AdapterPort, type CommitPorts, type CommitStep,
} from './commit.ts';
import type {
  CoachInput, CoachPort, CommitResult, EnvelopePort, PostcheckPort, TripwireResolution, UnderstandDecision, V2Receipt,
} from './contracts.ts';
import { navigateOf } from './envelope.ts';
import { applyGuarantees, exposureLine, safetyLines, type GuaranteedReply } from './guarantees.ts';
import { turnRefs, validationContext, type TurnInput } from './input.ts';
import { runStageB, type StageBRun } from './ports.ts';
import { stageASafetyOutcome } from './shadow.ts';
import { buildUnderstandRequest, type UnderstandOutcome, type UnderstandRequest } from './understand.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);

export const V2_PIPELINE = 'v2';
/** The coach (final) stage keeps 'ai-chat' (it is THE reply row); other stages use their own name. */
export const V2_FUNCTION_NAME = 'ai-chat';
export const V2_STAGE_FUNCTION_NAME = 'ai-chat-v2';

// ─── code-owned lines (facts about what the code did) ────────────────────────────────────────────

/** Stage A failed on an ordinary turn: nothing was understood, so nothing was written. */
export const STAGE_A_FAILED_LINE = 'Mesajını şu an tam işleyemedim, bu yüzden hiçbir şey kaydetmedim. Birkaç saniye sonra tekrar yazar mısın?';
/** The turn crashed after the writes (honestCrashResponse): say what was stored, honestly, and nothing more. */
export const STAGE_B_FAILED_LINE = 'Şu an cevabımı tamamlayamadım; yukarıdakiler kaydedildi. Birazdan devam edelim mi?';
export const STAGE_B_FAILED_NOTHING_LINE = 'Şu an cevabımı tamamlayamadım ve bu mesajdan bir şey kaydetmedim. Birkaç saniye sonra tekrar yazar mısın?';
/** Crash on a turn that only opened holds: nothing is saved yet — the question below decides. */
export const STAGE_B_FAILED_HELD_LINE = 'Şu an cevabımı tamamlayamadım; bu mesajdan henüz bir şey kaydetmedim — önce aşağıdaki soruyu netleştirelim.';
/** Crash on a turn that wrote AND opened holds. */
export const STAGE_B_FAILED_WRITTEN_HELD_LINE = 'Şu an cevabımı tamamlayamadım; yukarıdakiler kaydedildi, kalanı için aşağıdaki soruyu netleştirelim.';
export const NOTHING_TO_UNDO_LINE = 'Geri alınacak bir kayıt bulunamadı.';
export const BUSY_LINE = 'Mesajını işliyorum, birazdan hazır olacak — bir saniye sonra tekrar dener misin?';

/** T1: the client's undo button literals (ChatThreadScreen handleUndo), by exact equality. */
export const UNDO_LITERALS: Readonly<Record<string, { op: string; label: string }>> = {
  'Son öğün kaydını geri al': { op: 'meal_log', label: 'öğün' },
  'Son antrenman kaydını geri al': { op: 'workout_log', label: 'antrenman' },
  'Son supplement kaydını geri al': { op: 'supplement_log', label: 'takviye' },
};

// ─── ports ───────────────────────────────────────────────────────────────────────────────────────

export type ClaimResult = { mode: 'owner' } | { mode: 'replay'; envelope: unknown } | { mode: 'busy' };

export interface JournalPort {
  claim(userId: string, key: string): Promise<ClaimResult>;
  commit(userId: string, key: string, envelope: unknown): Promise<void>;
  fail(userId: string, key: string): Promise<void>;
  /** Exactly-once side effects for a reclaimed key (v1's side_effects_at claim). true = we may write. */
  claimSideEffects(userId: string, key: string): Promise<boolean>;
}

export interface QuotaPort {
  /** Insert the user row and check the hard daily ceiling (v1 reserveRateLimitSlot, record-parse cap). */
  reserve(userId: string, message: string): Promise<{ allowed: boolean; remaining: number; message?: string; reservedMessageId: string | null }>;
  release(reservedMessageId: string): Promise<void>;
  /** The conversation cap for a turn that wrote nothing (v1 checkRateLimit, non-record). */
  conversationCap(userId: string, alreadyCounted: boolean): Promise<{ allowed: boolean; remaining: number; message?: string }>;
}

export interface PersistTurnInput {
  userId: string;
  userMessage: string;
  assistantMessage: string;
  taskMode: string;
  model: string | null;
  sessionId: string | null;
  reservedUserMessageId: string | null;
  turnId: string;
  quotaClass: QuotaClass;
  codeNotes: CodeNote[] | null;
  /** chat_messages.actions_executed: full receipts; a landed write also carries the legacy `type` v1 readers key on. */
  actionsExecuted: Record<string, unknown>[] | null;
}

export interface StorePort {
  /** Returns the assistant chat_messages id. Throws SESSION_NOT_FOUND like v1's storeMessages. */
  persist(p: PersistTurnInput): Promise<string | null>;
  linkTurnMessage(userId: string, turnId: string, chatMessageId: string): Promise<void>;
}

/** One turn_writes row of the last turn, as the undo lookup needs it. */
export interface LastTurnLedgerRow {
  id: string;
  ref: string | null;
  op: string;
  is_primary: boolean;
  undone_at: string | null;
  reverses: string | null;
}

export interface UndoPort {
  /**
   * The user's LAST turn (newest assistant chat row): its turn_id (null = a turn the ledger never
   * saw — pre-ledger v1 history) and that turn's ledger rows, newest first. Rejects on a read error
   * (the handler then hands the button to v1, before any side effect).
   */
  lastTurnLedger(userId: string): Promise<{ turnId: string | null; rows: LastTurnLedgerRow[] }>;
}

export interface NudgePort {
  read(userId: string, nudgeId: string): Promise<{ content: string } | null>;
  stamp(userId: string, nudgeId: string): Promise<void>;
}

export interface AppliedWrite {
  op: string;
  row: Record<string, unknown>;
}

export interface V2Deps {
  now(): Date;
  newId(): string;
  log(line: string, data?: Record<string, unknown>): void;
  mark?(stage: string): void;
  getUserId(req: Request): Promise<string>;
  checkPayloadSize(contentLength: string | null): { valid: boolean; error?: string };
  validateChatRequest(body: unknown): { valid: boolean; error?: string };
  respond(data: unknown, status?: number): Response;
  journal: JournalPort;
  quota: QuotaPort;
  loadTurnInput(userId: string, now: Date, clientTimezone: string | null): Promise<TurnInput>;
  understand(req: UnderstandRequest): Promise<UnderstandOutcome>;
  commitPorts: Omit<CommitPorts, 'onWrite'>;
  adapter: AdapterPort;
  recordEdSignal(userId: string, severity: 'medium' | 'high'): Promise<unknown>;
  /** T6 / T7 / T8 (contracts.ts; production: ports.ts stageBPorts). The code-owned lines are never theirs. */
  coach: CoachPort;
  postcheck: PostcheckPort;
  envelope: EnvelopePort;
  undo: UndoPort;
  store: StorePort;
  turnLog(rows: Record<string, unknown>[]): Promise<void>;
  nudge?: NudgePort;
  /** Background work after the reply (EdgeRuntime.waitUntil in production). */
  schedule(job: () => Promise<unknown>): void;
  /** After the commit (background): TDEE recalc, onboarding completion — index.ts owns these. */
  afterCommit?(p: { userId: string; turnInput: TurnInput; applied: AppliedWrite[] }): Promise<void>;
  rolloutStamp(userId: string): string;
}

/** Shared between the route and the handler: what happened so far, and what to undo on a v1 handover. */
export interface TurnState {
  /** A user-visible side effect may have happened (a write, a hold, a stored reply). No v1 re-run after this. */
  sideEffects: boolean;
  /** Release the journal claim / the quota reservation (run by the route on a v1 handover). */
  cleanup: Array<() => Promise<void>>;
  userId: string | null;
  turnId: string | null;
  journalKey: string | null;
  commit: CommitResult | null;
  /**
   * The turn's §7.2 resolution as it stands: T2's (an unread live trigger already resolves to the
   * fail-closed fallback), then the one after Stage A. honestCrashResponse reads it: a protective turn
   * that crashes still carries its code-owned 112 / referral line.
   */
  tripwire: TripwireResolution | null;
  /** Set when the journal claim must NOT be released (side effects exist): the route commits instead. */
  journalOwned: boolean;
}

export function newTurnState(): TurnState {
  return { sideEffects: false, cleanup: [], userId: null, turnId: null, journalKey: null, commit: null, tripwire: null, journalOwned: false };
}

export type V2Outcome =
  | { kind: 'response'; response: Response }
  | { kind: 'fallback_v1'; reason: string };

interface ChatBody {
  message?: unknown;
  image_base64?: unknown;
  audio_base64?: unknown;
  transcribe_only?: unknown;
  session_id?: unknown;
  task_mode_hint?: unknown;
  client_timezone?: unknown;
  plan_type?: unknown;
  user_approved?: unknown;
  draft_id?: unknown;
  idempotency_key?: unknown;
  accepted_nudge_id?: unknown;
}

// ─── pure helpers ────────────────────────────────────────────────────────────────────────────────

/** T1/T0 routing: the client protocols v2 does not own yet → v1, before any side effect. */
export function v1OnlyReason(body: ChatBody): string | null {
  if (typeof body.image_base64 === 'string' && body.image_base64) return 'image';
  if (body.audio_base64) return 'audio';
  if (typeof body.message !== 'string' || body.message.trim() === '') return 'no_text';
  if (body.user_approved === true) return 'plan_approval';
  if (typeof body.plan_type === 'string' && body.plan_type) return 'plan_type';
  // Plan chips belong to v1 until Faz 4 (plan pipeline); the list's one owner is shared/task-mode-hints.ts.
  if (isPlanTaskHint(body.task_mode_hint)) return 'plan_hint';
  return null;
}

/**
 * T1 undo button → what the ledger can say about the last turn's write of `op`:
 *   write          a live primary write of that op → undo it by write_id (its whole group);
 *   already_undone the turn wrote that op and every such write is already undone → nothing_to_undo;
 *   not_in_ledger  no turn_id, or the turn has no ledger row of that op (pre-ledger v1 history, a v1
 *                  write whose best-effort ledger append failed, a turn that wrote something else) →
 *                  the ledger cannot answer, so v1's handleUndo answers exactly as before (§6.1
 *                  mixed period: v2 never regresses below v1 here).
 */
export type UndoTarget =
  | { kind: 'write'; write_id: string; ref: string | null }
  | { kind: 'already_undone' }
  | { kind: 'not_in_ledger' };

export function undoTargetOf(last: { turnId: string | null; rows: readonly LastTurnLedgerRow[] }, op: string): UndoTarget {
  if (!last.turnId) return { kind: 'not_in_ledger' };
  const ofOp = last.rows.filter((r) => r.op === op && r.is_primary && !r.reverses);
  if (ofOp.length === 0) return { kind: 'not_in_ledger' };
  const live = ofOp.find((r) => !r.undone_at);
  return live ? { kind: 'write', write_id: live.id, ref: live.ref } : { kind: 'already_undone' };
}

/** The ONE repair call (§3.2 T5): same system prefix (cache-warm), the rejected parts as a user note. */
export function buildRepairRequest(req: UnderstandRequest, decision: unknown, v: DecisionValidation, timeoutMs: number): UnderstandRequest {
  const lines: string[] = [];
  for (const it of v.repair.items) {
    lines.push(`- ${it.channel}[${it.index}] ${it.op}: ${it.issues.map((i) => `${i.path ? `${i.path}: ` : ''}${i.tr}`).join('; ')}`);
  }
  for (const i of v.decision_issues) if (i.level === 'hard' && i.repairable) lines.push(`- karar: ${i.path ? `${i.path}: ` : ''}${i.tr}`);
  for (const i of v.plan?.issues ?? []) if (i.level === 'hard' && i.repairable) lines.push(`- plan_action: ${i.tr}`);
  const note = [
    'ONARIM: Önceki kararının aşağıdaki kısımları kodun denetiminden geçmedi. Aynı mesaj için kararı TAM olarak yeniden yaz:',
    'yalnız bu hataları düzelt; düzeltemiyorsan o yazmayı çıkar ya da clarify kullan. Diğer kısımları değiştirme.',
    `ÖNCEKİ KARAR: ${JSON.stringify(decision)}`,
    'HATALAR:',
    ...lines,
  ].join('\n');
  return { ...req, input: [...req.input, { role: 'user', content: note }], timeoutMs };
}

/** Keep the repaired decision only when it is not worse than the original. */
export function betterOf(a: DecisionValidation, b: DecisionValidation): 'original' | 'repaired' {
  const rejectsA = a.counts.REJECT + a.decision_issues.filter((i) => i.level === 'hard').length;
  const rejectsB = b.counts.REJECT + b.decision_issues.filter((i) => i.level === 'hard').length;
  return rejectsB <= rejectsA ? 'repaired' : 'original';
}

/** ai_turn_log issue code: the client's task_mode_hint was on no list (shared/task-mode-hints.ts) and was dropped. */
export const TASK_MODE_HINT_UNKNOWN = 'task_mode_hint_unknown';

/**
 * CoachInput.userState: the EXTRA facts only the handler can see (the onboarding card the user wrote
 * from, an accepted nudge). Never the profile, targets, today, constraints, ED tier or clock — facts.ts
 * renders those from the TurnInput itself, once (contracts.ts).
 * The raw task_mode_hint is client text: it reaches the trusted EK OLGULAR block ONLY as one of the
 * client registry's onboarding hints (shared/task-mode-hints.ts, exact equality). A known non-fact
 * hint (repair guess, daily_log) adds nothing; any other value is dropped and reported as an issue.
 */
export function extraFacts(p: { taskModeHint: unknown; nudge: string | null }): { lines: string[]; issues: string[] } {
  const lines: string[] = [];
  const issues: string[] = [];
  const hint = checkTaskModeHint(p.taskModeHint);
  if (hint.kind === 'onboarding') lines.push(`TANIŞMA KARTI: kullanıcı "${hint.hint}" kartından yazıyor`);
  else if (hint.kind === 'unknown') issues.push(TASK_MODE_HINT_UNKNOWN);
  if (p.nudge) lines.push(`KABUL EDİLEN TEKLİF (bu turda): "${p.nudge.slice(0, 200)}"`);
  return { lines, issues };
}

/**
 * chat_messages.actions_executed: the full receipt; `type` (the legacy name v1 readers and the
 * client's badge row key on) ONLY on a write that landed. A history reload reads actions_executed
 * without receipts, so a failed write carrying `type` would come back as a green "kaydedildi" badge
 * (v1's DUP_SKIP rule: a write that did not happen never reaches actions_executed as a type).
 */
export function actionsExecutedOf(receipts: readonly V2Receipt[]): Record<string, unknown>[] | null {
  if (receipts.length === 0) return null;
  return receipts.map((r) => (r.ok ? { type: r.legacy_type, ...r } : { ...r }));
}

/** The protective path's category, when the turn is on it. */
export function protectiveCategory(t: TripwireResolution): SafetyCategory | null {
  if (t.kind === 'protective' || t.kind === 'canned' || t.kind === 'fallback') return t.category;
  return null;
}

function guardVerdict(tripwire: TripwireResolution, commit: CommitResult | null): string {
  const flags: GuardFlag[] = [];
  const cat = protectiveCategory(tripwire);
  if (cat === 'emergency') flags.push('emergency');
  else if (cat === 'self_harm') flags.push('crisis');
  else if (cat === 'ed') flags.push('ed_referral');
  if (commit && commit.exposures.length > 0) flags.push('allergen_warned');
  return guardVerdictOf(flags);
}

function outcomeCode(v: Verdict): 'commit' | 'flag' | 'ask' | 'reject' {
  return v === 'COMMIT' ? 'commit' : v === 'FLAG' ? 'flag' : v === 'ASK' ? 'ask' : 'reject';
}

/** ai_turn_log.issues for a v2 stage: 111's {code, path, outcome} per verdict/finding. */
export function issueEntries(v: DecisionValidation | null): Record<string, unknown>[] {
  if (!v) return [];
  const out: Record<string, unknown>[] = [];
  for (const w of v.verdicts) {
    out.push({ code: 'verdict', path: null, outcome: outcomeCode(w.verdict), op: w.op, channel: w.channel });
    for (const i of w.issues) out.push({ code: i.code, path: i.path ?? null, outcome: outcomeCode(w.verdict), op: w.op, level: i.level });
  }
  for (const i of v.decision_issues) out.push({ code: i.code, path: i.path ?? null, outcome: null, level: i.level });
  if (v.missed_write) out.push({ code: 'missed_write', path: null, outcome: null });
  return out;
}

function hasLiveSafetyHit(scan: TripwireScan): boolean {
  return liveAmbiguousHits(scan).some((h) => h.category !== 'declaration');
}

function appliedOf(step: CommitStep): AppliedWrite {
  if (step.kind === 'rpc' && step.verdict.op === 'record_update') {
    const patch = isRec(step.verdict.row?.patch) ? step.verdict.row!.patch as Record<string, unknown> : {};
    const op = isRec(step.verdict.args.patch) ? String(step.verdict.args.patch.op) : 'record_update';
    return { op, row: patch };
  }
  if (step.kind === 'adapter') return { op: step.op, row: step.row };
  return { op: step.verdict.op, row: step.verdict.row ?? {} };
}

// ─── the turn ────────────────────────────────────────────────────────────────────────────────────

interface TurnCtx {
  deps: V2Deps;
  state: TurnState;
  userId: string;
  turnId: string;
  message: string;
  body: ChatBody;
  sessionId: string | null;
  idemKey: string;
  startedMs: number;
}

/**
 * Run one v2 turn. `routedUserId` is the id the route decided on (unverified JWT claim); the
 * handler verifies it and hands a mismatch to v1. Throws only on an unexpected crash; the route
 * decides from TurnState whether v1 may still answer.
 */
export async function handleV2Turn(req: Request, routedUserId: string, deps: V2Deps, state: TurnState): Promise<V2Outcome> {
  const startedMs = Date.now();
  // ── T0 shell ──
  const size = deps.checkPayloadSize(req.headers.get('content-length'));
  if (!size.valid) return { kind: 'fallback_v1', reason: 'payload_size' };
  let userId: string;
  try {
    userId = await deps.getUserId(req);
  } catch {
    return { kind: 'fallback_v1', reason: 'auth' };
  }
  if (userId !== routedUserId) return { kind: 'fallback_v1', reason: 'routed_user_mismatch' };
  let body: ChatBody;
  try {
    body = await req.json() as ChatBody;
  } catch {
    return { kind: 'fallback_v1', reason: 'body' };
  }
  if (!isRec(body) || !deps.validateChatRequest(body).valid) return { kind: 'fallback_v1', reason: 'invalid_request' };
  const v1Reason = v1OnlyReason(body);
  if (v1Reason) return { kind: 'fallback_v1', reason: v1Reason };
  deps.mark?.('auth');

  const message = String(body.message);
  const turnId = deps.newId();
  state.userId = userId;
  state.turnId = turnId;
  const tc: TurnCtx = {
    deps, state, userId, turnId, message, body, startedMs,
    sessionId: typeof body.session_id === 'string' && body.session_id ? body.session_id : null,
    idemKey: typeof body.idempotency_key === 'string' && body.idempotency_key ? body.idempotency_key : '',
  };

  // ── T2 explicit tripwire: canned at once (before the journal, like v1's safety early returns) ──
  const scan = scanTripwires(message);
  const pre = resolveTripwires({ scan, stageA: null });
  state.tripwire = pre;
  if (pre.kind === 'canned') return { kind: 'response', response: await cannedTurn(tc, scan, pre) };

  // ── request journal (exactly-once) ──
  if (tc.idemKey) {
    const claim = await deps.journal.claim(userId, tc.idemKey);
    if (claim.mode === 'replay') return { kind: 'response', response: deps.respond(claim.envelope) };
    if (claim.mode === 'busy') return { kind: 'response', response: deps.respond({ message: BUSY_LINE, actions: [], task_mode: 'coaching', busy: true }) };
    state.journalKey = tc.idemKey;
    state.journalOwned = true;
    state.cleanup.push(async () => {
      if (!state.sideEffects) await deps.journal.fail(userId, tc.idemKey);
    });
  }

  // ── T1 undo button literal ──
  const undo = UNDO_LITERALS[message.trim()];
  if (undo) return await undoTurn(tc, undo);

  // ── T3 TurnInput (read BEFORE the reservation inserts this turn's user row) ──
  const now = deps.now();
  const clientTz = typeof body.client_timezone === 'string' && body.client_timezone ? body.client_timezone : null;
  const ti = await deps.loadTurnInput(userId, now, clientTz);
  deps.mark?.('turn_input');

  // ── T0 quota reservation (inserts the user row; the record-parse ceiling caps cost) ──
  const reservation = await deps.quota.reserve(userId, message);
  if (!reservation.allowed) {
    // §7.2 "belirsiz = varsayılan koruyucu": a live safety trigger is never answered with the
    // rate-limit text (v1 answers its safety early returns before its rate limit too). At the cap
    // there is no Stage A to read the trigger, so it resolves exactly like an unread trigger:
    // today's canned reply, no LLM call, quota-exempt.
    const atCap = resolveTripwires({ scan, stageA: null });
    if (atCap.kind === 'fallback') {
      return { kind: 'response', response: await failClosedTurn(tc, atCap, null, [], { capMessage: reservation.message ?? '' }) };
    }
    await releaseJournal(tc);
    return { kind: 'response', response: deps.respond({ message: reservation.message, actions: [], task_mode: 'rate_limited', rate_limited: true, remaining: 0 }) };
  }
  const reservedId = reservation.reservedMessageId;
  if (reservedId) {
    state.cleanup.push(async () => {
      if (!state.sideEffects) await deps.quota.release(reservedId);
    });
  }
  deps.mark?.('reserve');

  // ── T4 Stage A, on the turn's §7.2 budget class (stage-a-request.ts owns the numbers) ──
  const liveSafety = hasLiveSafetyHit(scan);
  const stageABudgetMs = stageALiveBudgetMs(scan);
  const req4 = buildUnderstandRequest({ turnInput: ti, message, scan, timeoutMs: stageABudgetMs });
  const outcome = await deps.understand(req4);
  deps.mark?.('stage_a');
  const stageARows: Record<string, unknown>[] = [stageRow(tc, 'understand', outcome, null, null, false)];

  if (outcome.status !== 'parsed') {
    const status = outcome.status === 'refused' ? 'refused' : outcome.status === 'error' && outcome.error?.class === 'timeout' ? 'timeout' : 'error';
    const fallback = resolveTripwires({ scan, stageA: { status } });
    return { kind: 'response', response: await failClosedTurn(tc, fallback, reservedId, stageARows) };
  }

  // ── T5 validate (+ one repair) ──
  const refs = turnRefs(ti);
  const ctx: ValidationContext = validationContext(ti, message, now, refs);
  let decision = outcome.decision as UnderstandDecision;
  let validation = validateDecision(decision, ctx);
  let repaired = false;
  if (validation.repair.needed) {
    // On a turn with a live trigger the repair shares the class budget with the first call (the whole
    // Stage A reading stays inside §7.2's wait); on an ordinary turn it gets its own short budget.
    const repairMs = liveSafety ? stageABudgetMs - outcome.meta.latencyMs : STAGE_A_REPAIR_TIMEOUT_MS;
    if (repairMs >= STAGE_A_MIN_REPAIR_MS) {
      const repReq = buildRepairRequest(req4, decision, validation, repairMs);
      const rep = await deps.understand(repReq);
      stageARows.push(stageRow(tc, 'repair', rep, null, null, true));
      if (rep.status === 'parsed') {
        const rv = validateDecision(rep.decision, ctx);
        if (betterOf(validation, rv) === 'repaired') {
          decision = rep.decision as UnderstandDecision;
          validation = rv;
          repaired = true;
        }
      }
    } else {
      deps.log('[v2_turn] repair skipped: the tripwire turn\'s Stage A budget is spent', { turn_id: turnId, left_ms: repairMs });
    }
  }
  stageARows[0] = stageRow(tc, 'understand', outcome, decision, validation, repaired);

  // §7.2: on a turn with a live trigger, a reading that arrived after the class budget counts as a
  // timeout (fail-closed: today's canned protection); a positive reading always counts. The readings
  // are the ADOPTED decision's (after a repair); the latency is the first call's.
  const late = liveSafety && outcome.meta.latencyMs > stageABudgetMs;
  const safetyIn = late
    ? { status: 'timeout' as const }
    : stageASafetyOutcome({ ...outcome, decision }, validation, scan, { ignoreBudget: true });
  const tripwire = resolveTripwires({ scan, stageA: safetyIn, classifier: null, benignOverride: false });
  state.tripwire = tripwire;
  if (tripwire.kind === 'fallback') {
    return { kind: 'response', response: await failClosedTurn(tc, tripwire, reservedId, stageARows) };
  }

  // Faz 4 owns plan actions: hand the whole turn to v1 before anything is written.
  if (validation.plan && validation.plan.op !== 'none') {
    deps.log('[v2_turn] plan action → v1', { op: validation.plan.op, turn_id: turnId });
    await logRows(tc, stageARows);
    return { kind: 'fallback_v1', reason: `plan_action:${validation.plan.op}` };
  }

  // ── T5 commit ──
  const applied: AppliedWrite[] = [];
  let commit: CommitResult;
  const mayWrite = tc.idemKey ? await deps.journal.claimSideEffects(userId, tc.idemKey) : true;
  const plan = planCommit({ turnId, userId, validation, turnInput: ti, refs, ctx });
  if (mayWrite) {
    commit = await executeCommit(plan, {
      ...deps.commitPorts,
      onWrite: () => { state.sideEffects = true; },
      onApplied: (step) => applied.push(appliedOf(step)),
    });
  } else {
    commit = {
      turnId, receipts: [], holds: [], rejects: [], writtenRefs: [], exposures: [],
      flags: [{ op: 'turn', code: 'retry_side_effects_skipped', note_tr: 'bu mesajın kayıtları önceki denemede yazılmıştı; tekrar yazılmadı' }],
    };
  }
  state.commit = commit;
  deps.mark?.('commit');
  if (validation.safety.ed_signal?.accepted && validation.safety.ed_signal.escalate) {
    try { await deps.recordEdSignal(userId, validation.safety.ed_signal.escalate); } catch (e) { deps.log('[v2_turn] recordEdSignal failed', { error: errMsg(e) }); }
  }

  // ── quota class from what was written; a capped conversation turn stops before Stage B ──
  // A protective turn (ambiguous trigger read as real, or a Stage A positive) is exempt from the
  // conversation cap: the user at the cap gets the protective reply, never the rate-limit text.
  const writtenClass = quotaClassOf(commit);
  const quotaClass: QuotaClass = writtenClass === 'conversation' && tripwire.kind === 'protective' ? 'exempt' : writtenClass;
  let remaining: number | undefined = -1;
  if (quotaClass === 'conversation') {
    const cap = await deps.quota.conversationCap(userId, reservedId !== null);
    // A turn that opened a hold (pending_writes: a KVKK erase, an allergy removal, a suspicious amount)
    // counts as conversation (commit.ts quotaClassOf) but is never stopped here: the stored decision
    // waits for the user's answer, and only this reply asks the question. Stopping it would strand the
    // hold behind the rate-limit text and release the journal after a side effect.
    if (!cap.allowed && commit.holds.length === 0) {
      if (reservedId) await deps.quota.release(reservedId);
      await releaseJournal(tc);
      await logRows(tc, stageARows);
      return { kind: 'response', response: deps.respond({ message: cap.message, actions: [], task_mode: 'rate_limited', rate_limited: true, remaining: 0 }) };
    }
    remaining = cap.allowed ? cap.remaining : 0;
  }

  // ── T6 Stage B + T7 post-checks, through the ports, under ONE end-to-end budget ──
  const nudgeId = typeof body.accepted_nudge_id === 'string' && body.accepted_nudge_id ? body.accepted_nudge_id : null;
  let nudgeText: string | null = null;
  if (nudgeId && deps.nudge) {
    try {
      nudgeText = (await deps.nudge.read(userId, nudgeId))?.content ?? null;
    } catch (e) { deps.log('[v2_turn] nudge read failed', { error: errMsg(e) }); }
  }
  const extra = extraFacts({ taskModeHint: body.task_mode_hint, nudge: nudgeText });
  if (extra.issues.length) deps.log('[v2_turn] task_mode_hint dropped (not a known client hint)', { turn_id: turnId, issues: extra.issues });
  const coachInput: CoachInput = {
    turnInput: ti, message, decision, commit, tripwire,
    history: ti.history.map((h) => ({ role: h.role, content: h.content, ...(h.action_types.length ? { receipts: h.action_types } : {}) })),
    userState: extra.lines,
  };
  const stage = await runStageB(coachInput, { coach: deps.coach, postcheck: deps.postcheck }, { userId, log: deps.log });

  // ── T7, owned HERE and LAST, whatever the post-check port did: the suggestion invariant on
  //    structure and the code-owned lines (112 / referral, the KVKK erase outcome, the exposure
  //    acknowledgement, every safety-hold question). Append-only. ──
  const final = applyGuarantees(coachInput, stage.out);
  deps.mark?.('stage_b');

  // ── T8 envelope (its message — in-message <reasoning> etc. included — is exactly what is stored) ──
  const envelope = deps.envelope({
    text: final.text, codeNotes: final.codeNotes, why: final.reply.why, commit, decision, tripwire,
    navigateTo: navigateOf(final.reply.ui), remaining, assistantMessageId: null,
  });
  const taskMode = envelope.task_mode;

  // ── T9 persist; the stored row id rides back in the envelope ──
  const assistantId = await persist(tc, {
    assistantMessage: envelope.message, taskMode, quotaClass, codeNotes: final.codeNotes, receipts: commit.receipts, reservedId,
    model: stage.runs[0]?.model ?? outcome.meta.model,
  });
  if (assistantId === 'SESSION_NOT_FOUND') {
    return { kind: 'response', response: deps.respond({ error: 'Oturum bulunamadi. Lutfen sohbeti yeniden ac.', code: 'SESSION_NOT_FOUND' }, 404) };
  }
  envelope.assistant_message_id = assistantId;
  await logRows(tc, [...stageARows, commitRow(tc, commit, validation), coachRow(tc, stage, final, tripwire, commit, taskMode, extra.issues)]);
  if (tc.idemKey) await deps.journal.commit(userId, tc.idemKey, envelope);

  // ── background: memory notes, nudge stamp, hooks ──
  const memory = final.reply.memory;
  deps.schedule(async () => {
    if (Array.isArray(memory) && memory.length > 0) await commitMemory(tc, memory, ctx);
    if (nudgeId && deps.nudge) await deps.nudge.stamp(userId, nudgeId);
    if (deps.afterCommit && applied.length > 0) await deps.afterCommit({ userId, turnInput: ti, applied });
  });
  deps.log('[v2_turn]', {
    turn_id: turnId, ms: Date.now() - startedMs, counts: validation.counts, repaired, tripwire: tripwire.kind,
    receipts: commit.receipts.length, holds: commit.holds.length, rejects: commit.rejects.length,
    coach: stage.out.log.outcome, guarantee_lines: final.added.length,
  });
  return { kind: 'response', response: deps.respond(envelope) };
}

/**
 * The route's answer when v2 crashed AFTER a side effect: v1 must not run again (double write).
 * The receipts of what was really written are returned; the journal stores this envelope so a
 * client retry replays it instead of re-running the writes. No T7 ran on this path, so the code-owned
 * lines it can still state are appended here, in mandatoryLines' order: the 112 / referral line of a
 * protective turn (guarantees.ts safetyLines — the same single source T7 uses, from the resolution
 * the handler recorded in TurnState), the exposure acknowledgement (severity unknown on this path →
 * worded as severe, §7.1) and, on a normal turn only, every open hold's question (on a safety turn the
 * hold waits and expires unconfirmed — no allergy-removal question next to a crisis line, as in T7).
 */
export async function honestCrashResponse(state: TurnState, deps: Pick<V2Deps, 'respond' | 'journal' | 'log'>): Promise<Response> {
  const commit = state.commit;
  const t = state.tripwire;
  const asksHolds = !t || t.kind === 'normal';
  const lead = commit ? honestFallbackText(commit, { holdsAsked: asksHolds }) : STAGE_B_FAILED_NOTHING_LINE;
  const safety = t ? safetyLines(t, lead).map((n) => n.text) : [];
  const exposures = (commit?.exposures ?? []).map((e) => exposureLine(e, true));
  const questions = asksHolds ? (commit?.holds ?? []).map((h) => h.question_tr).filter((q) => !!q) : [];
  const message = [lead, ...safety, ...exposures, ...questions].join('\n\n');
  const envelope: TurnEnvelope = {
    message,
    actions: (commit?.receipts ?? []).filter((r) => r.ok).map((r) => ({ type: r.legacy_type, feedback: r.user_line })),
    receipts: commit && commit.receipts.length
      ? commit.receipts.map((r) => ({ action_type: r.legacy_type, ok: r.ok, rows_affected: r.rows_affected, user_line: r.user_line, failure_class: r.failure_class }))
      : null,
    task_mode: 'coaching',
  };
  if (state.userId && state.journalKey) {
    try { await deps.journal.commit(state.userId, state.journalKey, envelope); } catch (e) { deps.log('[v2_turn] journal commit failed', { error: errMsg(e) }); }
  }
  return deps.respond(envelope);
}

/**
 * The commit's facts as Turkish lines: what was written, what failed, and every reject no failed
 * receipt already explains (a hold that could not be stored has no receipt — it must not vanish).
 */
export function receiptFactLines(commit: CommitResult): { written: string[]; failed: string[] } {
  const written = commit.receipts.filter((r) => r.ok && r.user_line).map((r) => r.user_line as string);
  const failedReceipts = commit.receipts.filter((r) => !r.ok);
  const failed = failedReceipts.filter((r) => r.user_line).map((r) => r.user_line as string);
  const unmatched = [...failedReceipts];
  for (const rj of commit.rejects) {
    const i = unmatched.findIndex((r) => r.action_type === rj.op || r.legacy_type === rj.op);
    if (i >= 0) {
      unmatched.splice(i, 1);
      continue;
    }
    failed.push(`Kaydedilmedi: ${rj.reason_tr}`);
  }
  return { written, failed };
}

/**
 * The turn crashed after the commit (honestCrashResponse): the receipts are the truth, said plainly.
 * "Kaydedildi" only when something WAS written; a holds-only turn says nothing is saved yet and points
 * at its question — only when that question is asked below (`holdsAsked`: not on a safety turn).
 */
export function honestFallbackText(commit: CommitResult, opts: { holdsAsked?: boolean } = {}): string {
  const { written, failed } = receiptFactLines(commit);
  const held = opts.holdsAsked !== false && commit.holds.length > 0;
  const tail = written.length > 0
    ? (held ? STAGE_B_FAILED_WRITTEN_HELD_LINE : STAGE_B_FAILED_LINE)
    : (held ? STAGE_B_FAILED_HELD_LINE : STAGE_B_FAILED_NOTHING_LINE);
  return [...written, ...failed, tail].join('\n');
}

async function releaseJournal(tc: TurnCtx): Promise<void> {
  if (!tc.idemKey || !tc.state.journalOwned) return;
  tc.state.journalOwned = false;
  try { await tc.deps.journal.fail(tc.userId, tc.idemKey); } catch (e) { tc.deps.log('[v2_turn] journal release failed', { error: errMsg(e) }); }
}

/** T9 chat_messages. Returns the assistant row id, null on a non-session failure, or 'SESSION_NOT_FOUND'. */
async function persist(
  tc: TurnCtx,
  p: { assistantMessage: string; taskMode: string; quotaClass: QuotaClass; codeNotes: CodeNote[] | null; receipts: readonly V2Receipt[]; reservedId: string | null; model: string | null },
): Promise<string | null> {
  tc.state.sideEffects = true;
  try {
    const id = await tc.deps.store.persist({
      userId: tc.userId, userMessage: tc.message, assistantMessage: p.assistantMessage, taskMode: p.taskMode, model: p.model,
      sessionId: tc.sessionId, reservedUserMessageId: p.reservedId, turnId: tc.turnId, quotaClass: p.quotaClass,
      codeNotes: p.codeNotes && p.codeNotes.length ? p.codeNotes : null, actionsExecuted: actionsExecutedOf(p.receipts),
    });
    if (id) {
      try { await tc.deps.store.linkTurnMessage(tc.userId, tc.turnId, id); } catch (e) { tc.deps.log('[v2_turn] link failed', { error: errMsg(e) }); }
    }
    return id;
  } catch (e) {
    const msg = errMsg(e);
    tc.deps.log('[v2_turn] persist failed', { error: msg, turn_id: tc.turnId });
    if (msg.startsWith('SESSION_NOT_FOUND')) {
      if (p.reservedId) await tc.deps.quota.release(p.reservedId).catch(() => {});
      return 'SESSION_NOT_FOUND';
    }
    return null;
  }
}

// ─── T2 canned path ──────────────────────────────────────────────────────────────────────────────

async function cannedTurn(tc: TurnCtx, scan: TripwireScan, pre: Extract<TripwireResolution, { kind: 'canned' }>): Promise<Response> {
  const { deps } = tc;
  const reply = pre.response.message;
  const taskMode = pre.response.task_mode;
  // Persistence must never gate an acute-safety reply (v1 safeStore): best effort, reply always sent.
  await persist(tc, { assistantMessage: reply, taskMode, quotaClass: 'exempt', codeNotes: [{ kind: 'emergency', text: reply }], receipts: [], reservedId: null, model: null })
    .catch(() => null);
  await logRows(tc, [{
    ...baseRow(tc, 'tripwire', V2_FUNCTION_NAME),
    system_mode: taskMode, model_requested: 'none', model_served: 'none', finish_reason: `canned:${pre.category}`,
    guard_verdict: guardVerdictOf([pre.category === 'emergency' ? 'emergency' : 'crisis']),
    issues: [{ code: 'tripwire', path: null, outcome: null, trigger: pre.log.explicit, category: pre.category }],
  }]);
  if (pre.response.salvage_facts) deps.schedule(() => salvageFacts(tc, scan));
  return deps.respond({ message: reply, actions: [], task_mode: taskMode });
}

/**
 * §7.1 "Mesajdaki olgular kurtarılır": after a canned reply, Stage A reads the message in the
 * background and ONLY protective spine facts (the user's own allergy/injury, constraint_add with
 * effect activate) are committed — never a meal, never a removal. No regex extraction.
 */
async function salvageFacts(tc: TurnCtx, scan: TripwireScan): Promise<void> {
  const { deps } = tc;
  try {
    const now = deps.now();
    const ti = await deps.loadTurnInput(tc.userId, now, typeof tc.body.client_timezone === 'string' ? tc.body.client_timezone : null);
    const outcome = await deps.understand(buildUnderstandRequest({ turnInput: ti, message: tc.message, scan, timeoutMs: STAGE_A_SALVAGE_TIMEOUT_MS }));
    if (outcome.status !== 'parsed') return;
    const refs = turnRefs(ti);
    const ctx = validationContext(ti, tc.message, now, refs);
    const v = validateDecision(outcome.decision, ctx);
    const keep = v.verdicts.filter((w) => w.op === 'constraint_add' && (w.verdict === 'COMMIT' || w.verdict === 'FLAG') && w.row?.effect === 'activate');
    if (keep.length === 0) return;
    const plan = planCommit({ turnId: tc.turnId, userId: tc.userId, validation: { ...v, verdicts: keep, missed_write: false, not_written_reason: null }, turnInput: ti, refs, ctx });
    const commit = await executeCommit(plan, deps.commitPorts);
    deps.log('[v2_turn] safety salvage', { turn_id: tc.turnId, written: commit.receipts.filter((r) => r.ok).length, failed: commit.receipts.filter((r) => !r.ok).length });
  } catch (e) {
    deps.log('[v2_turn] safety salvage failed', { error: errMsg(e) });
  }
}

// ─── T4 fail-closed path ─────────────────────────────────────────────────────────────────────────

async function failClosedTurn(
  tc: TurnCtx, t: TripwireResolution, reservedId: string | null, rows: Record<string, unknown>[],
  opts: { capMessage?: string } = {},
): Promise<Response> {
  const { deps } = tc;
  tc.state.tripwire = t;
  // At the daily cap (opts.capMessage): the turn was never processed — the cap text replaces the
  // "could not process" line, and the safety reply is quota-exempt.
  const atCap = opts.capMessage !== undefined;
  const lead = atCap ? opts.capMessage!.trim() : STAGE_A_FAILED_LINE;
  let text: string;
  let taskMode = 'coaching';
  if (t.kind === 'fallback') {
    text = t.mode === 'replace' || !lead ? t.response.message : `${lead}\n\n${t.response.message}`;
    taskMode = t.response.task_mode;
    if (t.ed_signal) {
      try { await deps.recordEdSignal(tc.userId, t.ed_signal); } catch (e) { deps.log('[v2_turn] recordEdSignal failed', { error: errMsg(e) }); }
    }
  } else {
    text = STAGE_A_FAILED_LINE;
  }
  const notes: CodeNote[] = [{ kind: t.kind === 'fallback' ? (t.category === 'ed' ? 'referral' : 'emergency') : 'other', text }];
  const id = await persist(tc, { assistantMessage: text, taskMode, quotaClass: atCap ? 'exempt' : 'conversation', codeNotes: notes, receipts: [], reservedId, model: null });
  if (id === 'SESSION_NOT_FOUND') return deps.respond({ error: 'Oturum bulunamadi. Lutfen sohbeti yeniden ac.', code: 'SESSION_NOT_FOUND' }, 404);
  await logRows(tc, [...rows, {
    ...baseRow(tc, 'tripwire', V2_FUNCTION_NAME),
    system_mode: taskMode, model_requested: 'none', model_served: 'none',
    finish_reason: t.kind === 'fallback' ? `${atCap ? 'cap_protective' : 'fallback'}:${t.category}` : 'stage_a_failed',
    guard_verdict: guardVerdict(t, null),
    issues: [{ code: 'tripwire_outcome', path: null, outcome: null, value: t.kind, stage_a: t.log.stage_a }],
  }]);
  const envelope: TurnEnvelope = { message: text, actions: [], receipts: null, task_mode: taskMode, assistant_message_id: id };
  if (tc.idemKey) await deps.journal.commit(tc.userId, tc.idemKey, envelope);
  return deps.respond(envelope);
}

// ─── T1 undo fast path ───────────────────────────────────────────────────────────────────────────

async function undoTurn(tc: TurnCtx, undo: { op: string; label: string }): Promise<V2Outcome> {
  const { deps } = tc;
  let receipt: ActionReceipt;
  let line: string;
  let found: UndoTarget;
  try {
    found = undoTargetOf(await deps.undo.lastTurnLedger(tc.userId), undo.op);
  } catch (e) {
    deps.log('[v2_turn] undo lookup failed → v1', { error: errMsg(e), turn_id: tc.turnId });
    found = { kind: 'not_in_ledger' };
  }
  if (found.kind === 'not_in_ledger') {
    // Nothing written, nothing persisted yet: the route releases the journal claim and v1's
    // handleUndo answers the ORIGINAL request, exactly as it does for every v1 user.
    deps.log('[v2_turn] undo: last turn not in the ledger → v1 handleUndo', { op: undo.op, turn_id: tc.turnId });
    return { kind: 'fallback_v1', reason: 'undo_not_in_ledger' };
  }
  const target = found.kind === 'write' ? found : null;
  if (!target) {
    line = NOTHING_TO_UNDO_LINE;
    receipt = { action_type: 'undo', ok: false, rows_affected: 0, user_line: line, failure_class: 'nothing_to_undo' };
  } else {
    tc.state.sideEffects = true;
    let res: { ok: boolean; failure_class: string | null; rows: number };
    try {
      const r = await deps.commitPorts.rpc('w_record_delete', {
        p_user: tc.userId, p_turn_id: tc.turnId, p_target: { write_id: target.write_id }, p_opts: { max_age_days: 7, pipeline: 'v2', reason: 'undo_button' },
      });
      const data = isRec(r.data) ? r.data : null;
      res = r.error || !data
        ? { ok: false, failure_class: 'write_failed', rows: 0 }
        : data.ok === true
          ? { ok: true, failure_class: null, rows: Array.isArray(data.reversed) ? data.reversed.length : 1 }
          : { ok: false, failure_class: typeof data.failure_class === 'string' ? data.failure_class : 'write_failed', rows: 0 };
    } catch (e) {
      deps.log('[v2_turn] undo rpc threw', { error: errMsg(e) });
      res = { ok: false, failure_class: 'write_failed', rows: 0 };
    }
    if (res.ok) {
      line = `Son ${undo.label} kaydını geri aldım.`;
      receipt = { action_type: 'undo', ok: true, rows_affected: res.rows, user_line: line, failure_class: null };
    } else if (res.failure_class === 'already_undone') {
      line = NOTHING_TO_UNDO_LINE;
      receipt = { action_type: 'undo', ok: false, rows_affected: 0, user_line: line, failure_class: 'nothing_to_undo' };
    } else {
      line = `Kaydı geri alamadım: ${failureTr(res.failure_class)}.`;
      receipt = { action_type: 'undo', ok: false, rows_affected: 0, user_line: line, failure_class: res.failure_class };
    }
  }
  const v2Receipt: V2Receipt = { ...receipt, ref: target?.ref ?? null, write_id: target?.write_id ?? null, legacy_type: 'undo' };
  const id = await persist(tc, { assistantMessage: line, taskMode: 'repair', quotaClass: 'exempt', codeNotes: null, receipts: [v2Receipt], reservedId: null, model: null });
  if (id === 'SESSION_NOT_FOUND') return { kind: 'response', response: deps.respond({ error: 'Oturum bulunamadi. Lutfen sohbeti yeniden ac.', code: 'SESSION_NOT_FOUND' }, 404) };
  await logRows(tc, [{
    ...baseRow(tc, 'undo_fast', V2_FUNCTION_NAME),
    system_mode: 'repair', model_requested: 'none', model_served: 'none', finish_reason: receipt.ok ? 'undone' : (receipt.failure_class ?? 'failed'),
    guard_verdict: 'clean', issues: [{ code: 'undo', path: null, outcome: receipt.ok ? 'commit' : 'reject', op: undo.op }],
  }]);
  const envelope: TurnEnvelope = {
    message: line,
    actions: receipt.ok ? [{ type: 'undo', feedback: line }] : [],
    receipts: [receipt],
    task_mode: 'repair',
    assistant_message_id: id,
  };
  if (tc.idemKey) await deps.journal.commit(tc.userId, tc.idemKey, envelope);
  return { kind: 'response', response: deps.respond(envelope) };
}

// ─── background memory (Stage B memory[]) ────────────────────────────────────────────────────────

async function commitMemory(tc: TurnCtx, memory: unknown[], ctx: ValidationContext): Promise<void> {
  const { deps } = tc;
  try {
    const verdicts = validateChannelItems('memory', memory, ctx).filter((v) => (v.verdict === 'COMMIT' || v.verdict === 'FLAG') && v.row);
    for (const v of verdicts) {
      const out = await deps.adapter.apply({ userId: tc.userId, turnId: tc.turnId, today: ctx.today, op: 'memory_note', row: v.row!, verdict: v, replaces: null, refRow: null });
      if (!out.ok) deps.log('[v2_turn] memory note not written', { kind: v.row?.kind, failure_class: out.failure_class });
    }
  } catch (e) {
    deps.log('[v2_turn] memory commit failed', { error: errMsg(e) });
  }
}

// ─── ai_turn_log rows (111) ──────────────────────────────────────────────────────────────────────

function baseRow(tc: TurnCtx, stage: string, functionName: string): Record<string, unknown> {
  return {
    user_id: tc.userId, function_name: functionName, pipeline: V2_PIPELINE, stage, turn_id: tc.turnId, schema_version: SCHEMA_VERSION,
    rollout_stamp: tc.deps.rolloutStamp(tc.userId), prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0,
    cached_tokens: 0, latency_ms: 0, attempts: 1, repaired: false,
  };
}

function stageRow(tc: TurnCtx, stage: 'understand' | 'repair', o: UnderstandOutcome, decision: unknown, v: DecisionValidation | null, repaired: boolean): Record<string, unknown> {
  const m = o.meta;
  return {
    ...baseRow(tc, stage, V2_STAGE_FUNCTION_NAME),
    model_requested: m.model, model_served: m.providerModel ?? m.model,
    prompt_tokens: m.usage.inputTokens, completion_tokens: m.usage.outputTokens, total_tokens: m.usage.totalTokens,
    reasoning_tokens: m.usage.reasoningTokens, cached_tokens: m.usage.cachedTokens, latency_ms: m.latencyMs, attempts: m.attempts,
    finish_reason: o.status === 'parsed' ? 'parsed' : `${o.status}:${o.error?.class ?? o.reason ?? o.issues[0] ?? ''}`.slice(0, 120),
    fallback_reason: m.retries.length ? m.retries.join(',') : null,
    decision: decision ?? null, issues: issueEntries(v), repaired, guard_verdict: null,
  };
}

function commitRow(tc: TurnCtx, commit: CommitResult, v: DecisionValidation): Record<string, unknown> {
  return {
    ...baseRow(tc, 'commit', V2_STAGE_FUNCTION_NAME),
    model_requested: 'none', model_served: 'none',
    finish_reason: `receipts:${commit.receipts.filter((r) => r.ok).length}/${commit.receipts.length} holds:${commit.holds.length} rejects:${commit.rejects.length}`,
    issues: [
      ...commit.receipts.map((r) => ({ code: r.action_type, path: r.ref ?? null, outcome: r.ok ? 'commit' : 'reject', failure_class: r.failure_class })),
      ...commit.holds.map((h) => ({ code: h.reason_code, path: null, outcome: 'ask', op: h.op })),
      ...commit.exposures.map((e) => ({ code: 'allergen_exposure', path: e.ref, outcome: null, allergens: e.allergens })),
    ],
    guard_verdict: commit.exposures.length ? 'allergen_warned' : null,
    decision: null, repaired: false, schema_version: v.schema_version,
  };
}

/**
 * The coach row = THE reply row (function_name 'ai-chat'): the Stage B calls' models/tokens, T7's
 * outcome, judge verdicts, regen count and invariant hits (§7.4 item 4), and every line the code-owned
 * step had to add (a port that kept its contract leaves none).
 */
function coachRow(
  tc: TurnCtx, stage: StageBRun, final: GuaranteedReply, t: TripwireResolution, commit: CommitResult, taskMode: string, turnIssues: readonly string[],
): Record<string, unknown> {
  const runs = stage.runs;
  const sum = (k: keyof RespondUsage) => runs.reduce((a, r) => a + (r.usage?.[k] ?? 0), 0);
  const log = stage.out.log;
  return {
    ...baseRow(tc, 'coach', V2_FUNCTION_NAME),
    system_mode: taskMode, mode: taskMode,
    model_requested: runs[0]?.model ?? 'none', model_served: runs.at(-1)?.model ?? 'none',
    prompt_tokens: sum('inputTokens'), completion_tokens: sum('outputTokens'), total_tokens: sum('totalTokens'),
    reasoning_tokens: sum('reasoningTokens'), cached_tokens: sum('cachedTokens'),
    latency_ms: stage.ms, attempts: Math.max(1, runs.reduce((a, r) => a + (r.attempts || 0), 0)),
    finish_reason: log.outcome,
    fallback_reason: runs.filter((r) => r.status !== 'ok').map((r) => `${r.regen ? 'regen' : 'first'}:${r.status}`).join(',') || null,
    guard_verdict: guardVerdict(t, commit),
    issues: [
      { code: 'tripwire_outcome', path: null, outcome: null, value: t.kind },
      {
        code: 'postcheck', path: null, outcome: null, value: log.outcome, judge: log.judge, judge_fail_reasons: log.judge_fail_reasons,
        regens: log.regens, invariant_hits: log.invariant_hits, budget_exhausted: log.budget_exhausted,
        referral_flag_mismatch: log.referral_flag_mismatch, code_notes: final.codeNotes.map((n) => n.kind),
      },
      ...[...stage.issues, ...final.issues, ...turnIssues].map((code) => ({ code, path: null, outcome: null })),
    ],
  };
}

async function logRows(tc: TurnCtx, rows: Record<string, unknown>[]): Promise<void> {
  try {
    await tc.deps.turnLog(rows);
  } catch (e) {
    tc.deps.log('[v2_turn] ai_turn_log write failed', { error: errMsg(e) });
  }
}
