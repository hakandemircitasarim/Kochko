/**
 * Plan readiness checker — Phase 0 / MASTER_PLAN §4.5.
 *
 * Two-tier model:
 *   - missingCore:  hard block. No plan can be generated without these 5 fields.
 *   - weakSpots:    soft nudge. Plan can run with sane defaults; chips surface
 *                   these as "Plan daha iyi olabilir — {task}'ı da konuşalım".
 *
 * The readiness result is consumed by:
 *   - app/plan/diet.tsx and app/plan/workout.tsx empty state (CTA disabled if
 *     missingCore.length > 0)
 *   - weak-spot suggestion chips beside the "Plan oluştur" button
 *   - "Tamamla" deep links that route to the onboarding task chat for that field
 *
 * Keep task keys in sync with src/services/onboarding-tasks.service.ts.
 */

import type { Profile } from '@/types/database';

export type PlanType = 'diet' | 'workout';

export interface Goal {
  goal_type?: string | null;
  target_weight_kg?: number | null;
  is_active?: boolean | null;
}

export interface MissingField {
  field: string;       // human label, e.g. "Boy"
  taskKey: string;     // onboarding task to route to, e.g. "introduce_yourself"
  taskTitle: string;   // task card title, e.g. "Kendini tanıt"
}

export interface ReadinessResult {
  ready: boolean;
  missingCore: MissingField[];
  weakSpots: MissingField[];
}

// ─── Core fields (all must be present — §4.5) ─────────────────────────────

const coreFor = (_planType: PlanType): MissingField[] => [
  { field: 'Boy',        taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' },
  { field: 'Kilo',       taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' },
  { field: 'Yaş',        taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' },
  { field: 'Cinsiyet',   taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' },
  { field: 'Ana hedef',  taskKey: 'set_goal',           taskTitle: 'Hedefini belirle' },
];

// ─── Weak spots (plan still generates with defaults — §4.5) ───────────────

const DIET_WEAK_SPOTS: MissingField[] = [
  { field: 'Aktivite düzeyi',        taskKey: 'daily_routine',       taskTitle: 'Günlük rutinini anlat' },
  { field: 'Alerjenler',             taskKey: 'allergies',           taskTitle: 'Alerji ve hassasiyetlerini bildir' },
  { field: 'Beslenme tercihi',       taskKey: 'eating_habits',       taskTitle: 'Beslenme alışkanlıklarını anlat' },
  { field: 'Sağlık durumu',          taskKey: 'health_history',      taskTitle: 'Sağlık geçmişini anlat' },
  { field: 'Bütçe',                  taskKey: 'kitchen_logistics',   taskTitle: 'Mutfak imkânlarını anlat' },
  { field: 'Pişirme becerisi',       taskKey: 'kitchen_logistics',   taskTitle: 'Mutfak imkânlarını anlat' },
];

const WORKOUT_WEAK_SPOTS: MissingField[] = [
  { field: 'Spor deneyimi',          taskKey: 'exercise_history',    taskTitle: 'Spor geçmişini anlat' },
  { field: 'Ekipman erişimi',        taskKey: 'exercise_history',    taskTitle: 'Spor geçmişini anlat' },
  { field: 'Müsait antrenman saatleri', taskKey: 'exercise_history', taskTitle: 'Spor geçmişini anlat' },
  { field: 'Sağlık/yaralanma geçmişi', taskKey: 'health_history',    taskTitle: 'Sağlık geçmişini anlat' },
];

// ─── Checks ───────────────────────────────────────────────────────────────

function hasCore(profile: Profile | null, goal: Goal | null): { missing: MissingField[] } {
  const missing: MissingField[] = [];
  if (!profile?.height_cm)   missing.push({ field: 'Boy',       taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' });
  if (!profile?.weight_kg)   missing.push({ field: 'Kilo',      taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' });
  if (!profile?.birth_year)  missing.push({ field: 'Yaş',       taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' });
  if (!profile?.gender)      missing.push({ field: 'Cinsiyet',  taskKey: 'introduce_yourself', taskTitle: 'Kendini tanıt' });
  if (!goal?.goal_type)      missing.push({ field: 'Ana hedef', taskKey: 'set_goal',           taskTitle: 'Hedefini belirle' });
  return { missing };
}

function computeWeakSpots(profile: Profile | null, planType: PlanType): MissingField[] {
  const spots: MissingField[] = [];
  const p = profile as unknown as Record<string, unknown> | null;
  if (!p) return planType === 'diet' ? DIET_WEAK_SPOTS : WORKOUT_WEAK_SPOTS;

  if (planType === 'diet') {
    if (!p.activity_level)       spots.push(DIET_WEAK_SPOTS[0]);
    // Allergies: weak-spot unless user has explicitly been through that task.
    // Phase 1 will surface a task-completed flag; for now we treat "no profile
    // signal" as a weak spot, which is the safer default.
    if (!p.food_allergies)       spots.push(DIET_WEAK_SPOTS[1]);
    if (!p.diet_mode)            spots.push(DIET_WEAK_SPOTS[2]);
    // health_history weak-spot only if user hasn't confirmed (same caveat).
    spots.push(DIET_WEAK_SPOTS[3]);
    if (!p.budget_level)         spots.push(DIET_WEAK_SPOTS[4]);
    if (!p.cooking_skill)        spots.push(DIET_WEAK_SPOTS[5]);
  } else {
    if (!p.training_experience)            spots.push(WORKOUT_WEAK_SPOTS[0]);
    if (!p.equipment_access)               spots.push(WORKOUT_WEAK_SPOTS[1]);
    if (!p.available_training_times)       spots.push(WORKOUT_WEAK_SPOTS[2]);
    spots.push(WORKOUT_WEAK_SPOTS[3]);
  }
  return spots;
}

// ─── Public API ───────────────────────────────────────────────────────────

export function isPlanReady(
  profile: Profile | null,
  goal: Goal | null,
  planType: PlanType,
): ReadinessResult {
  const { missing: missingCore } = hasCore(profile, goal);
  const weakSpots = computeWeakSpots(profile, planType);
  return {
    ready: missingCore.length === 0,
    missingCore,
    weakSpots,
  };
}

export function getMissingCore(profile: Profile | null, goal: Goal | null): MissingField[] {
  return hasCore(profile, goal).missing;
}

export function getWeakSpots(profile: Profile | null, planType: PlanType): MissingField[] {
  return computeWeakSpots(profile, planType);
}

/** Sanity check — returns true on empty/null inputs too. Used for defensive
 *  render before profile is hydrated. */
export function canAttemptPlan(profile: Profile | null, goal: Goal | null): boolean {
  return hasCore(profile, goal).missing.length === 0;
}

// ─── Available for quick coreFor introspection (debug / future UI) ────────
export { coreFor };
