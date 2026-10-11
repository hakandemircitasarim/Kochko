/**
 * ai-chat/v2/contracts.ts — the SHARED interface between the v2 commit/turn layer (commit.ts,
 * handler.ts) and the coach layer (coach.ts / postcheck / envelope). Types only, kept minimal on
 * purpose: both sides build against exactly these shapes (AI_MIMARI_V2 §3.2 T5–T8).
 *
 *   CommitResult  what T5 really did — typed receipts (ok from the WRITER), holds (ASK), rejects
 *                 (nothing written, with the Turkish reason), flags (written, with the doubt),
 *                 the refs it wrote and the allergen exposures of committed meal/supplement items.
 *   CoachInput    what Stage B is given: the turn input, the decision, the commit and the safety
 *                 resolution — the coach speaks only AFTER the writes, from these facts.
 *   CoachReply    Stage B's strict 'kochko_reply_vN' answer (suggestions before the prose, §7.1).
 *   CoachTurnFn   the ONE coach entry point the handler calls (coach.ts coachTurn): T6 Stage B + T7
 *                 post-checks. Its `text` already carries the mandatory code lines LAST; the handler
 *                 renders it (T8) and stores it with `codeNotes` — it runs no second post-check.
 */
import type { TripwireDecision } from '../../shared/safety-tripwires.ts';
import type { CodeNote } from '../../shared/v2-db-types.ts';
import type { TurnInput } from './input.ts';

/** Stage A's strict 'kochko_understand_vN' decision (shape checked by validateDecision; read loosely). */
export type UnderstandDecision = Record<string, unknown>;

/** T2 + T4: resolveTripwires' decision for the turn (canned | fallback | protective | normal). */
export type TripwireResolution = TripwireDecision;

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

/** What coachTurn returns to the handler (coach.ts CoachTurnResult adds logs and runs). */
export interface CoachTurnOutput {
  /** The reply that goes out: the model's, the regen's, or a code-authored fallback. */
  reply: CoachReply;
  /** reply.reply + the mandatory code lines, appended LAST — what T8 renders and T9 stores. */
  text: string;
  /** The appended lines, in order (chat_messages.code_notes). */
  codeNotes: CodeNote[];
}

/** The coach entry point (T6 + T7). Never throws; enforces its own end-to-end budget. */
export type CoachTurnFn = (input: CoachInput, opts: { userId: string }) => Promise<CoachTurnOutput>;
