/**
 * CROSS-RUNTIME CONTRACT — the ai-chat response envelope (plan v2, F1 · B3).
 *
 * ONE type, read by BOTH sides. Until now the server built an anonymous object literal and the
 * client kept a hand-written copy (`ChatResponse` in chat.service.ts) — and they drifted exactly
 * the way this repo always drifts: the server shipped `plan_snapshot` for three releases while the
 * chat screen only ever STRIPPED it from the text, and shipped `simulation` as a structured field
 * while the client re-parsed the same data out of the message TEXT with a regex (SEAM-03).
 *
 * Same rules as every file in contracts/ (enforced by seam-check checker #4):
 *   TYPE-ONLY — no runtime exports. ZERO imports. Readable by tsc AND deno.
 *
 * THE RULE THIS FILE EXISTS TO CARRY: a field without a reader is not merged. Adding a field here
 * without a consumer in src/ makes the seam-check envelope checker red.
 */

/** One executed (or intentionally surfaced) action, as the client renders it. */
export interface EnvelopeAction {
  type: string;
  /** Human receipt line ('Ogun kaydedildi — …'), or null for silent success. */
  feedback: string | null;
  /** Meal-parse confidence bucket driving the ConfidenceBadge. */
  confidence?: 'high' | 'medium' | 'low';
}

/** The <simulation> block, structured. The client must read THIS, not re-parse the text. */
export interface EnvelopeSimulation {
  foodName: string;
  calories: number;
  remaining: number;
  weeklyImpact: string;
}

export interface TaskCompletionEnvelope {
  completed: string;
  summary: string;
  next_suggestions: string[];
}

/** What ai-chat returns for a normal turn. */
export interface TurnEnvelope {
  message: string;
  actions: EnvelopeAction[];
  /** CANONICAL turn mode (client contract — raw detection lives only in the ledger). */
  task_mode: string;
  task_completion?: TaskCompletionEnvelope | null;
  plan_snapshot?: Record<string, unknown> | null;
  /** weekly_plans row id of the persisted draft — the identity Onayla carries back (C1). */
  plan_draft_id?: string | null;
  /** Which plan contract this turn ran ('diet' | 'workout') — drives the preview + approve hint. */
  plan_type?: string | null;
  plan_reasoning?: string | null;
  plan_persist_error?: string | null;
  plan_approved?: { id: string } | null;
  navigate_to?: string | null;
  simulation?: EnvelopeSimulation | null;
  rate_limited?: boolean;
  remaining?: number;
  /** Persisted chat_messages row id of the assistant reply (feedback votes key to it). */
  assistant_message_id?: string | null;
}
