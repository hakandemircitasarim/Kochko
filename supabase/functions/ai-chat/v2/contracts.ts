/**
 * ai-chat/v2/contracts.ts — the seam between the v2 turn builders (AI_MIMARI_V2 §3.2 T5 → T6 → T8).
 *
 *   commit (T5)  produces CommitResult   — what really happened to every write this turn
 *   coach  (T6)  consumes CoachInput     — Stage B speaks only after the writes, from these facts
 *   coach  (T6)  produces CoachReply     — the strict 'kochko_reply_vN' fields, normalised
 *
 * Type-only and minimal on purpose: both builders implement exactly these shapes.
 */
import type { TripwireDecision } from '../../shared/safety-tripwires.ts';
import type { TurnInput } from './input.ts';

/** The §7.2 resolution of this turn's tripwires (shared/safety-tripwires.ts resolveTripwires). */
export type TripwireResolution = TripwireDecision;

/** Stage A's parsed decision ('kochko_understand_vN'); fields read loosely, validateDecision owns meaning. */
export interface UnderstandDecision {
  intent?: { primary?: string; is_hypothetical?: boolean; about_other_person?: boolean } | null;
  safety?: unknown;
  writes?: unknown[];
  record_ops?: unknown[];
  pending_ops?: unknown[];
  commitment_ops?: unknown[];
  plan_action?: { op?: string; plan_type?: string | null; draft_ref?: string | null } | null;
  simulation?: { food?: string; kcal_estimate?: number; target_day?: string } | null;
  clarify?: { topic?: string; candidate_refs?: string[] } | null;
  reply_route?: { contract?: string; effort_hint?: string } | null;
  self_check?: { reported_new_facts?: boolean; not_written_reason?: string | null } | null;
  [key: string]: unknown;
}

/** One write outcome. `legacy_type` is the client's BADGE_DEFS name (body_weight → weight_log). */
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

/** ASK: held in pending_writes; Stage B asks the ONE question. */
export interface V2Hold {
  op: string;
  reason_code: string;
  question_tr: string;
  hold_id: string | null;
}

/** REJECT: not stored, with the reason Stage B tells honestly. */
export interface V2Reject {
  op: string;
  reason_code: string;
  reason_tr: string;
}

/** FLAG: stored as is, with a doubt Stage B may mention. */
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
  /** Logged items ∩ the user's allergen spine (§7.1 tüketim denetimi): written, must be acknowledged. */
  exposures: { allergens: string[]; source: 'meal' | 'supplement'; ref: string }[];
}

export interface CoachInput {
  turnInput: TurnInput;
  message: string;
  decision: UnderstandDecision;
  commit: CommitResult;
  tripwire: TripwireResolution;
  /** Oldest first, without this turn's message; assistant turns carry their receipt lines (rendered as ⟦…⟧). */
  history: { role: string; content: string; receipts?: string[] }[];
  /** Extra user-state fact lines the handler rendered (person note, agenda, post-commit snapshot). */
  userState: string[];
}

export interface CoachReply {
  reply: string;
  suggested_foods: { name: string; allergens: string[]; may_contain: string[] }[];
  suggested_exercises: { name: string; loads: string[] }[];
  memory: unknown[];
  ui: unknown;
  referral_included: boolean;
  why: string | null;
}
