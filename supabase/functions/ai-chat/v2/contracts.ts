/**
 * ai-chat/v2/contracts.ts — the ONE shared interface between the v2 commit/turn layer (commit.ts,
 * handler.ts) and the coach layer (coach.ts, postcheck.ts, envelope.ts). Types only: both sides build
 * against exactly these shapes (AI_MIMARI_V2 §3.2 T5–T9).
 *
 *   CommitResult    what T5 really did — typed receipts (ok from the WRITER), holds (ASK), rejects
 *                   (nothing written, with the Turkish reason), flags (written, with the doubt), the
 *                   refs it wrote and the allergen exposures of committed meal/supplement items.
 *   CoachInput      what Stage B is given: the turn input, the decision, the commit and the safety
 *                   resolution — the coach speaks only AFTER the writes, from these facts. The handler
 *                   passes DATA; facts.ts renders it (never a second, pre-rendered copy).
 *   CoachReply      Stage B's strict 'kochko_reply_vN' answer (suggestions before the prose, §7.1).
 *   CoachRun        one Stage B generation (the first call or the ONE regen) and how it ended.
 *
 * The T6/T7/T8 PORTS the handler calls (V2Deps.coach / .postcheck / .envelope; production wiring in
 * ports.ts stageBPorts → coach.ts runCoach, postcheck.ts postcheckReply, envelope.ts renderEnvelope):
 *
 *   CoachPort       T6: ONE Stage B generation, bounded by the time it is given.
 *   PostcheckPort   T7 structural checks: suggestion invariant, prose judge, the ONE regen (through
 *                   the coach port), the code-authored fallbacks and its own code notes.
 *   EnvelopePort    T8: the TurnEnvelope the app reads today.
 *
 * Whatever a PostcheckPort returns, the handler then ALWAYS runs guarantees.ts applyGuarantees: the
 * suggestion invariant re-checked on structure, and the code-owned lines (112 / referral, the KVKK
 * erase outcome, the allergen-exposure acknowledgement, every safety-hold question) appended LAST,
 * append-only. A port can add lines; it can never remove one of these (§3.2 T7, §5.2, §7.1, §7.2).
 */
import type { ReasoningEffort, RespondUsage } from '../../shared/openai.ts';
import type { TripwireDecision } from '../../shared/safety-tripwires.ts';
import type { TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';
import type { CodeNote, CodeNoteKind } from '../../shared/v2-db-types.ts';
import type { TurnInput } from './input.ts';

/** Stage A's strict 'kochko_understand_vN' decision (shape checked by validateDecision; read loosely). */
export type UnderstandDecision = Record<string, unknown>;

/** T2 + T4: resolveTripwires' decision for the turn (canned | fallback | protective | normal). */
export type TripwireResolution = TripwireDecision;

// ─── T5: the commit ──────────────────────────────────────────────────────────────────────────────

/**
 * One typed receipt. `action_type` is the registry op ('meal_log', 'record_delete', …);
 * `legacy_type` is the envelope name the client's BADGE_DEFS key on ('meal_log', 'undo',
 * 'weight_log', 'profile_update' …). `ok` comes from the writer, never from the verdict alone.
 */
export interface V2Receipt {
  action_type: string;
  ok: boolean;
  rows_affected: number | null;
  user_line: string | null;
  failure_class: string | null;
  ref?: string | null;
  write_id?: string | null;
  legacy_type: string;
}

/** ASK: held in pending_writes; the coach asks ONE question in its own words. */
export interface V2Hold {
  op: string;
  reason_code: string;
  question_tr: string;
  hold_id: string | null;
  /**
   * pending_writes.hold_class (109). 'safety' (allergen/injury removal, identity, band change, goal,
   * KVKK erase — §5.2 güvenlik bekletmeleri): code appends the question unless the reply carries the
   * template itself; it never depends on a model flag or a '?' elsewhere. Absent → classified by op /
   * reason code (facts.ts isSafetyHold).
   */
  hold_class?: 'ask' | 'safety';
}

/** REJECT (or a writer failure): nothing written; the coach says why, honestly. */
export interface V2Reject {
  op: string;
  reason_code: string;
  reason_tr: string;
}

/** FLAG: written as the model gave it; the doubt is a fact for the coach. */
export interface V2Flag {
  op: string;
  code: string;
  note_tr: string;
}

export interface CommitResult {
  turnId: string;
  receipts: V2Receipt[];
  holds: V2Hold[];
  rejects: V2Reject[];
  flags: V2Flag[];
  writtenRefs: string[];
  exposures: { allergens: string[]; source: 'meal' | 'supplement'; ref: string }[];
}

// ─── T6: Stage B ─────────────────────────────────────────────────────────────────────────────────

export interface CoachInput {
  turnInput: TurnInput;
  message: string;
  decision: UnderstandDecision;
  commit: CommitResult;
  tripwire: TripwireResolution;
  /** Oldest first, WITHOUT this turn's message; assistant turns carry their receipt lines (rendered ⟦…⟧). */
  history: { role: string; content: string; receipts?: string[] }[];
  /**
   * EXTRA fact lines only, rendered by the handler from things the coach layer cannot read itself
   * (the onboarding card the user wrote from, an accepted nudge, a person note, the agenda).
   * NEVER the profile, targets, today's totals, constraints, the ED tier or the clock: facts.ts
   * renders those from `turnInput` — with this turn's committed meals/water and ONE target band
   * (§8.2 "tek hedef fonksiyonu") — so a second, pre-commit copy here would show Stage B the same
   * facts twice, possibly with conflicting numbers.
   */
  userState: string[];
  /**
   * Turn-level facts only the handler knows (data, never rendered text; facts.ts renders them).
   * Absent = all false (callers that build a CoachInput without the handler: tests, the eval).
   */
  facts?: CoachTurnFacts;
}

export interface CoachTurnFacts {
  /**
   * The adopted Stage A decision STILL has missed_write after the ONE repair (or no repair could run):
   * the user stated a new fact and nothing was written, clarified or explained. No pending_writes row
   * stands behind any "kaydedeyim mi / onaylıyor musun?" question, so the user's "evet" would have
   * nothing to resolve (first live trial: mem "yumurta alerjim yok" → "onaylıyor musun?" → dead end).
   * The coach must NOT offer a write confirmation: ask an open question or say plainly that nothing
   * was saved. commit.flags keeps its 'missed_write' flag and ai_turn_log its missed_write issue.
   */
  unanchoredQuestionForbidden: boolean;
}

export interface CoachReply {
  reply: string;
  suggested_foods: { name: string; allergens: string[]; may_contain: string[] }[];
  suggested_exercises: { name: string; loads: string[] }[];
  memory: unknown[];
  ui: unknown;
  /** The coach's own claim; logged only — code checks the reply TEXT for the 112/referral line (§7.2). */
  referral_included: boolean;
  why: string | null;
}

/** The contract a Stage B call runs under (coach.ts coachContract). */
export type CoachContract = 'emergency' | 'crisis' | 'ed_support' | 'onboarding' | 'plan' | null;

export type CoachStatus = 'ok' | 'refused' | 'invalid' | 'incomplete' | 'error' | 'timeout';

/** One Stage B generation (coach.ts runCoach). */
export interface CoachRun {
  status: CoachStatus;
  reply: CoachReply | null;
  model: string;
  effort: ReasoningEffort;
  contract: CoachContract;
  latencyMs: number;
  usage: RespondUsage | null;
  attempts: number;
  retries: string[];
  /** Refusal text / schema issues / error message (triage, never shown). */
  detail: string | null;
  regen: boolean;
}

/** What the ONE regeneration is told (§7.1 "dışlananları adıyla"; coach.ts renders it). */
export interface RegenNote {
  excluded: { name: string; why: string }[];
  /** The judge could not confirm the previous draft (fail-closed): no item names to give. */
  judgeFailed: boolean;
}

// ─── T7: post-checks ─────────────────────────────────────────────────────────────────────────────

export type PostcheckOutcome = 'first' | 'regen' | 'safe_fallback' | 'crisis_canned' | 'coach_failed';

/** What T7 did (ai_turn_log issues; §7.4 item 4: invariant hits, judge verdicts, regen count). */
export interface PostcheckLog {
  outcome: PostcheckOutcome;
  /** Names the suggestion invariant excluded, per attempt. */
  invariant_hits: string[][];
  /** Judge result per attempt ('skipped' when the user has no severe constraint). */
  judge: ('skipped' | 'clean' | 'violation' | 'failed')[];
  /** Why each failed judge call failed ('timeout', 'budget_exhausted', 'no_judge', an error class …). */
  judge_fail_reasons: string[];
  regens: number;
  /** The turn's budget ran out before a judge or the regen could start (the fallback went out). */
  budget_exhausted: boolean;
  /** The coach set referral_included but its text had no 112/referral line (code appended it). */
  referral_flag_mismatch: boolean;
  code_notes: CodeNoteKind[];
}

// ─── the ports ───────────────────────────────────────────────────────────────────────────────────

export interface CoachCall {
  /** The prefix cache key is per user (§3.2 T6). */
  userId: string;
  /** What is left of the turn's ONE Stage B budget for this call. */
  timeoutMs: number;
  /** Set on the ONE regeneration (§7.1). */
  regen: RegenNote | null;
}

/** T6: one Stage B generation. Should never throw (the handler guards it anyway: a throw = 'error'). */
export type CoachPort = (input: CoachInput, call: CoachCall) => Promise<CoachRun>;

export interface PostcheckRequest {
  input: CoachInput;
  /** Stage B's first generation. */
  first: CoachRun;
  /** The ONE regeneration, through the coach port, bounded by `timeoutMs` (default: what is left). */
  regen: (note: RegenNote, timeoutMs?: number) => Promise<CoachRun>;
  /** Milliseconds left of the turn's ONE Stage B budget (coach + judge + regen). */
  remainingMs: () => number;
}

export interface PostcheckOutput {
  /** The reply that goes out: the model's, the regen's, or a code-authored fallback. */
  reply: CoachReply;
  /** Lines the port appended after reply.reply, in order (chat_messages.code_notes). */
  codeNotes: CodeNote[];
  /** reply.reply was written by code (fallback), not by the model. */
  codeAuthored: boolean;
  log: PostcheckLog;
}

/** T7: the structural post-checks. The handler bounds it by the turn's budget and guards a throw. */
export type PostcheckPort = (p: PostcheckRequest) => Promise<PostcheckOutput>;

/** T8 input: everything the handler holds after T7 + the code-owned lines. */
export interface EnvelopeRequest {
  /** Final visible text: the reply + every code note, the code-owned lines LAST. */
  text: string;
  /** The code notes `text` ends with (required: a plan-honesty line is inserted BEFORE them). */
  codeNotes: readonly CodeNote[];
  /** Stage B's `why` → <reasoning> (the "Neden?" toggle). */
  why: string | null;
  commit: CommitResult | null;
  decision: UnderstandDecision | null;
  tripwire: TripwireResolution | null;
  /** Stage B's ui.navigate_to (the envelope validates it). */
  navigateTo: string | null;
  /** Rate-limit remaining (-1 = exempt), as v1. */
  remaining?: number;
  assistantMessageId: string | null;
}

/** T8: pure. Its `message` is exactly what T9 stores. */
export type EnvelopePort = (p: EnvelopeRequest) => TurnEnvelope;

/** What T6 + T7 + the code-owned guarantees hand T8/T9. */
export interface CoachTurnOutput {
  /** The reply that goes out (the model's, the regen's, or a code-authored fallback). */
  reply: CoachReply;
  /** reply.reply + every code note, the code-owned lines LAST — what T8 renders and T9 stores. */
  text: string;
  /** The appended lines, in order (chat_messages.code_notes). */
  codeNotes: CodeNote[];
}
