/**
 * ai-chat/v2/budgets.ts — the live v2 turn's time budgets, in ONE place (AI_MIMARI_V2 §3.3, §7.2).
 *
 * STAGE_A_LIVE_BUDGET_MS is owned by understand.ts (the shadow measures against the same value) and
 * re-exported here so every live budget is read from this module. It is the SAFETY budget: on a
 * turn with a live ambiguous tripwire, a Stage A slower than this is a timeout and today's canned
 * protection answers (§7.2). Ordinary turns get the longer turn budget — a slow understanding of
 * "2 dilim lahmacun" must not become "nothing recorded" when no safety question hangs on it.
 */
export { STAGE_A_LIVE_BUDGET_MS } from './understand.ts';

/** Stage A on an ordinary turn (no live safety trigger). */
export const STAGE_A_TURN_TIMEOUT_MS = 12_000;
/** The ONE repair call (§3.2 T5) — same prefix, cache-warm, short. */
export const STAGE_A_REPAIR_TIMEOUT_MS = 8_000;
/** Stage B on an ordinary turn. */
export const STAGE_B_TIMEOUT_MS = 20_000;
/** Stage B on a protective (crisis/ED) turn: past this the canned answer is used (§7.2: 6 s). */
export const STAGE_B_CRISIS_TIMEOUT_MS = 6_000;
