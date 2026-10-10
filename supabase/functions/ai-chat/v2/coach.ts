/**
 * ai-chat/v2/coach.ts — PLACEHOLDER for T6 Stage B (the coach builder owns this file).
 *
 * The coach builder's coach.ts (runCoach over coach-constitution.ts + exemplars.ts, strict
 * 'kochko_reply_vN') REPLACES this file at integration; on an add/add merge conflict take theirs.
 * Until then the v2 turn treats Stage B as unavailable and answers from the receipts alone
 * (handler.ts honestFallbackText) — v2_turn is off by default, so no user reaches this.
 */
import type { CoachInput, CoachReply } from './contracts.ts';

export class CoachUnavailableError extends Error {
  constructor() {
    super('coach_unavailable: Stage B (coach.ts runCoach) is not merged into this build');
    this.name = 'CoachUnavailableError';
  }
}

export function runCoach(_input: CoachInput, _deps?: unknown): Promise<CoachReply> {
  return Promise.reject(new CoachUnavailableError());
}
