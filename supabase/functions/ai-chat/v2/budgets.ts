/**
 * ai-chat/v2/budgets.ts — the live v2 turn's time budgets, read from ONE module (AI_MIMARI_V2 §3.3,
 * §7.2), and the helper that enforces them.
 *
 * Stage A's §7.2 fail-closed budgets are owned by stage-a-request.ts (STAGE_A_LIVE_BUDGETS_MS, the
 * owner's numbers: an ordinary turn and a turn T2 hands a tripwire fact) and re-exported here — the
 * live turn, the shadow and the eval read the same constant; nothing in the handler hard-codes them.
 * Past the budget on a turn with a live safety trigger, today's canned protection answers (§7.2); on
 * a turn naming one of the user's own allergens, an honest "nothing recorded" line plus the code-owned
 * exposure guidance; on an ordinary turn (nothing understood, nothing written) v1 answers the original
 * request (handler.ts T4).
 *
 * Stage B has ONE end-to-end budget per turn (coach + prose judge + the ONE regen + its judge):
 * CRISIS_TIMEOUT_MS on the protective path (§7.2: "6 sn'yi aşarsa hazır cevap"), COACH_TIMEOUT_MS
 * otherwise. Every call gets only what is left of it (ports.ts runStageB).
 */
import type { CoachInput } from './contracts.ts';

export { STAGE_A_LIVE_BUDGETS_MS, stageABudgetClass, stageALiveBudgetMs, type StageABudgetClass } from './stage-a-request.ts';

/**
 * The ONE repair call (§3.2 T5) on an ordinary turn — same prefix, cache-warm, short. It re-emits a
 * decision the first call already reasoned through, so it never gets more than the first call's own
 * budget (pinned: ≤ STAGE_A_LIVE_BUDGETS_MS.normal); a repair that misses it leaves the original
 * decision standing (never a fail-closed turn).
 */
export const STAGE_A_REPAIR_TIMEOUT_MS = 8_000;
/** Below this much of a tripwire turn's Stage A budget no repair is started (the original decision stands). */
export const STAGE_A_MIN_REPAIR_MS = 1_000;
/** The background Stage A read after an explicit tripwire's canned reply (facts salvage, never on the reply path). */
export const STAGE_A_SALVAGE_TIMEOUT_MS = 12_000;

/** A normal turn's Stage B budget — the whole T6+T7 (coach + judge + regen + judge). */
export const COACH_TIMEOUT_MS = 25_000;
/**
 * §7.2: on the protective path the ready-made reply goes out if Stage B is slower than this — the
 * whole T6+T7 run (coach, judge, regen), not each call.
 */
export const CRISIS_TIMEOUT_MS = 6_000;
/** A T7 port that has not answered this long after the Stage B budget ran out is abandoned (code fallback). */
export const POSTCHECK_GRACE_MS = 1_000;
/** Do not start a (re)generation with less than this left of the turn's budget: it could not finish. */
export const MIN_COACH_CALL_MS = 2_000;
/** Do not start a judge call with less than this left: the reply then counts as unconfirmed (fail-closed). */
export const MIN_JUDGE_CALL_MS = 750;

/** The turn's end-to-end Stage B budget (a caller's outer guard must not be shorter). */
export function coachTurnBudgetMs(input: Pick<CoachInput, 'tripwire'>): number {
  return input.tripwire.kind === 'protective' ? CRISIS_TIMEOUT_MS : COACH_TIMEOUT_MS;
}

/**
 * `p`, or `late()` once `ms` have passed — whichever comes first — so a callee that ignores its own
 * timeout still cannot stretch the turn. An infinite `ms` means no bound. The timer is always cleared.
 */
export async function withinBudget<T>(p: Promise<T>, ms: number, late: () => T): Promise<T> {
  if (!Number.isFinite(ms)) return await p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(late()), Math.max(0, ms)); });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}
