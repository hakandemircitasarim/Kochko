/**
 * shared/task-mode-hints.ts — the ONE server-side list of the client's `task_mode_hint` values
 * (AI_MIMARI_V2 §3.2 T1: "onboarding kart ipucu … yalnızca OLGU ekler").
 *
 * `task_mode_hint` is a client-controlled string. v2 puts an onboarding card hint into the coach's
 * EK OLGULAR block — facts the coach treats as true — so only a value the client really sends may get
 * there; anything else is dropped and logged (handler.ts extraFacts → ai_turn_log issue
 * 'task_mode_hint_unknown'). The client sends a hint from three places, mirrored here:
 *   ONBOARDING_TASK_HINTS  src/services/onboarding-tasks.service.ts ONBOARDING_TASKS[].taskModeHint
 *                          (v1's index.ts task-card TOPICS read the same 13 keys) — the only FACT
 *   PLAN_TASK_HINTS        the plan surfaces (src/services/chat.service.ts) — v1 answers those turns
 *                          until Faz 4 (handler.ts v1OnlyReason)
 *   OTHER_TASK_HINTS       ChatThreadScreen's repair-intent guess `repair:<RepairType>`
 *                          (src/services/repair.service.ts) and v1 turn.ts HINT_MODES' daily_log —
 *                          known values that carry no fact for v2 (Stage A reads the message itself)
 * task-mode-hints.test.ts pins these lists against the client files and v1's lists (drift = red CI).
 */

export const ONBOARDING_TASK_HINTS = [
  'onboarding_intro',
  'onboarding_goal',
  'onboarding_routine',
  'onboarding_eating',
  'onboarding_allergies',
  'onboarding_kitchen',
  'onboarding_exercise',
  'onboarding_health',
  'onboarding_weight_history',
  'onboarding_labs',
  'onboarding_sleep',
  'onboarding_stress',
  'onboarding_home',
] as const;

export type OnboardingTaskHint = typeof ONBOARDING_TASK_HINTS[number];

export const PLAN_TASK_HINTS = ['plan_diet', 'plan_workout'] as const;

export const OTHER_TASK_HINTS = [
  'daily_log',
  'repair:correction',
  'repair:undo',
  'repair:clarification',
  'repair:confirmation_yes',
  'repair:confirmation_no',
] as const;

const ONBOARDING: ReadonlySet<string> = new Set(ONBOARDING_TASK_HINTS);
const KNOWN: ReadonlySet<string> = new Set([...PLAN_TASK_HINTS, ...OTHER_TASK_HINTS]);

export type TaskModeHintCheck =
  | { kind: 'absent' }
  | { kind: 'onboarding'; hint: OnboardingTaskHint }
  /** A value the client really sends that carries no fact for v2. */
  | { kind: 'known'; hint: string }
  /** Not on any list (or not a string): dropped, never rendered anywhere. */
  | { kind: 'unknown' };

/** Exact equality against the lists — no trimming, no case folding, no prefix match. */
export function checkTaskModeHint(raw: unknown): TaskModeHintCheck {
  if (raw === undefined || raw === null || raw === '') return { kind: 'absent' };
  if (typeof raw !== 'string') return { kind: 'unknown' };
  if (ONBOARDING.has(raw)) return { kind: 'onboarding', hint: raw as OnboardingTaskHint };
  if (KNOWN.has(raw)) return { kind: 'known', hint: raw };
  return { kind: 'unknown' };
}

export function isPlanTaskHint(raw: unknown): boolean {
  return typeof raw === 'string' && (PLAN_TASK_HINTS as readonly string[]).includes(raw);
}
