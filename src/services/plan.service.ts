/**
 * Plan service — Phase 2/3 / MASTER_PLAN §4.2-4.3.
 *
 * Draft / active / archived lifecycle:
 *   - Only ONE draft per (user, plan_type) at a time — enforced by partial
 *     unique index (migration 030).
 *   - Only ONE active per (user, plan_type).
 *   - Approving a draft archives the previous active (reason: superseded).
 *   - Discarded drafts are archived with reason: user_discarded.
 *   - "Alternatif gör" temporarily creates a second candidate in-memory via
 *     the AI, but persistence stays single-draft. Rejected alternatives
 *     don't hit the DB.
 *
 * Snapshot protocol: plan_data is always a full week (7 days). Patch-style
 * edits are NOT persisted — every AI modification re-emits a complete
 * snapshot which this service writes via applySnapshot().
 */
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────

export type PlanType = 'diet' | 'workout';
export type PlanStatus = 'draft' | 'active' | 'archived';
export type ArchivedReason = 'superseded' | 'user_discarded' | 'alternative_rejected' | 'plan_drift';

export interface MealItem {
  name: string;
  grams?: number;
  portion?: string; // "1 dilim", "1 bardak"
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DietMeal {
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  time?: string; // "08:00"
  name: string;  // "Yulaf ve yumurta"
  items: MealItem[];
  total_kcal: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  notes?: string;
}

export interface DietDay {
  day_index: number; // 0=Mon ... 6=Sun
  day_label: string; // "Pazartesi"
  meals: DietMeal[];
  total_kcal: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  notes?: string;
}

export interface DietPlanData {
  plan_type: 'diet';
  week_start: string; // ISO date
  days: DietDay[];
  targets: { kcal: number; protein: number; carbs: number; fat: number };
  reasoning?: string;
  version?: number; // increments on each snapshot update
}

export interface WorkoutExercise {
  name: string;
  sets: number;
  reps: number | string; // "8-10" allowed
  weight_kg?: number;
  rpe?: number;
  rest_sec?: number;
  notes?: string;
  muscle_groups?: string[];
}

export interface WorkoutDay {
  day_index: number;
  day_label: string;
  rest_day: boolean;
  focus?: string; // "Push", "Pull", "Legs", "Full body"
  exercises: WorkoutExercise[];
  estimated_duration_min?: number;
  notes?: string;
}

export interface WorkoutPlanData {
  plan_type: 'workout';
  week_start: string;
  days: WorkoutDay[];
  reasoning?: string;
  version?: number;
}

export type PlanData = DietPlanData | WorkoutPlanData;

export interface PlanRow {
  id: string;
  user_id: string;
  plan_type: PlanType;
  status: PlanStatus;
  week_start: string;
  plan_data: PlanData;
  approved_at: string | null;
  archived_reason: ArchivedReason | null;
  user_revisions: Revision[];
  approval_snapshot: Record<string, unknown> | null;
  superseded_by: string | null;
  created_at: string;
  generated_at: string;
}

export interface Revision {
  at: string;
  from: string;
  to: string;
  reason?: string;
  saved_preference?: { field: string; value: unknown };
}

// ─── Reads ───────────────────────────────────────────────────────────────

export async function getActive(userId: string, planType: PlanType): Promise<PlanRow | null> {
  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_type', planType)
    .eq('status', 'active')
    .limit(1);
  return (data as PlanRow[] | null)?.[0] ?? null;
}

export async function getDraft(userId: string, planType: PlanType): Promise<PlanRow | null> {
  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_type', planType)
    .eq('status', 'draft')
    .limit(1);
  return (data as PlanRow[] | null)?.[0] ?? null;
}

export async function getHistory(userId: string, planType: PlanType, limit = 20): Promise<PlanRow[]> {
  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_type', planType)
    .eq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as PlanRow[] | null) ?? [];
}

// ─── Writes ──────────────────────────────────────────────────────────────

/**
 * Create a new draft. Fails if one already exists (partial unique index).
 * Caller should first check getDraft() and either resume or discard the
 * existing draft before creating a new one.
 */
export async function createDraft(
  userId: string,
  planType: PlanType,
  initialSnapshot: PlanData,
): Promise<PlanRow | null> {
  const weekStart = initialSnapshot.week_start || isoDateMondayOfWeek(new Date());
  const { data, error } = await supabase
    .from('weekly_plans')
    .insert({
      user_id: userId,
      plan_type: planType,
      status: 'draft',
      week_start: weekStart,
      plan_data: { ...initialSnapshot, version: 1 },
      user_revisions: [],
    })
    .select('*')
    .limit(1);
  if (error) {
    console.warn('[plan.service] createDraft failed:', error.message);
    return null;
  }
  return (data as PlanRow[] | null)?.[0] ?? null;
}

/**
 * Replace the entire plan_data of the current draft with a new snapshot
 * from the AI. Bumps version, optionally appends a revision entry.
 */
export async function applySnapshot(
  draftId: string,
  snapshot: PlanData,
  revision?: Omit<Revision, 'at'>,
): Promise<PlanRow | null> {
  // Read current to bump version + append revision.
  const { data: current } = await supabase
    .from('weekly_plans')
    .select('plan_data, user_revisions')
    .eq('id', draftId)
    .limit(1);
  const cur = (current as { plan_data: PlanData; user_revisions: Revision[] }[] | null)?.[0];
  const nextVersion = (cur?.plan_data?.version ?? 0) + 1;
  const nextRevisions = revision
    ? [...(cur?.user_revisions ?? []), { ...revision, at: new Date().toISOString() }]
    : cur?.user_revisions ?? [];

  const { data } = await supabase
    .from('weekly_plans')
    .update({
      plan_data: { ...snapshot, version: nextVersion },
      user_revisions: nextRevisions,
    })
    .eq('id', draftId)
    .select('*')
    .limit(1);
  return (data as PlanRow[] | null)?.[0] ?? null;
}

/**
 * Promote draft → active. Archives the previous active (superseded) atomically
 * as far as the client can manage; the partial unique index would reject a
 * collision, so we sequence: archive old → promote new. If the network drops
 * between steps the user ends up with 0 active plans; next approve retries.
 */
export async function approveDraft(
  userId: string,
  planType: PlanType,
  draftId: string,
  profileSnapshot: Record<string, unknown>,
): Promise<{ activated: PlanRow | null; error?: string }> {
  // Step 1 — archive current active.
  const previousActive = await getActive(userId, planType);
  if (previousActive) {
    await supabase
      .from('weekly_plans')
      .update({ status: 'archived', archived_reason: 'superseded', superseded_by: draftId })
      .eq('id', previousActive.id);
  }

  // Step 2 — promote draft.
  const { data, error } = await supabase
    .from('weekly_plans')
    .update({
      status: 'active',
      approved_at: new Date().toISOString(),
      approval_snapshot: profileSnapshot,
    })
    .eq('id', draftId)
    .select('*')
    .limit(1);

  if (error) {
    return { activated: null, error: error.message };
  }
  return { activated: (data as PlanRow[] | null)?.[0] ?? null };
}

/**
 * User discards the current draft. Archives with reason 'user_discarded' so
 * the negotiation history stays reviewable.
 */
export async function discardDraft(draftId: string): Promise<void> {
  await supabase
    .from('weekly_plans')
    .update({ status: 'archived', archived_reason: 'user_discarded' })
    .eq('id', draftId);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Return the Monday of the week containing `date` as an ISO date string.
 * Used for weekly plan `week_start`.
 */
export function isoDateMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // Sun=0, Mon=1, ...
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

/** Quick macros roll-up for a diet day. Kept in sync with DietDay totals. */
export function computeDayTotals(day: DietDay): Pick<DietDay, 'total_kcal' | 'total_protein' | 'total_carbs' | 'total_fat'> {
  return day.meals.reduce(
    (acc, m) => ({
      total_kcal: acc.total_kcal + m.total_kcal,
      total_protein: acc.total_protein + m.total_protein,
      total_carbs: acc.total_carbs + m.total_carbs,
      total_fat: acc.total_fat + m.total_fat,
    }),
    { total_kcal: 0, total_protein: 0, total_carbs: 0, total_fat: 0 },
  );
}

/** Compare two diet plans; return meal cells that changed (for UI highlight). */
export function dietPlanDiff(prev: DietPlanData | null, next: DietPlanData): Array<{ dayIndex: number; mealType: string }> {
  if (!prev) return [];
  const changed: Array<{ dayIndex: number; mealType: string }> = [];
  for (const d of next.days) {
    const prevDay = prev.days.find(x => x.day_index === d.day_index);
    if (!prevDay) {
      d.meals.forEach(m => changed.push({ dayIndex: d.day_index, mealType: m.meal_type }));
      continue;
    }
    for (const m of d.meals) {
      const prevMeal = prevDay.meals.find(x => x.meal_type === m.meal_type);
      if (!prevMeal || JSON.stringify(prevMeal) !== JSON.stringify(m)) {
        changed.push({ dayIndex: d.day_index, mealType: m.meal_type });
      }
    }
  }
  return changed;
}

export const DAY_LABELS_TR = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const MEAL_LABELS_TR: Record<DietMeal['meal_type'], string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Atıştırma',
};

/** Build a skeleton empty diet plan (7 rest days) for the initial draft
 *  placeholder before the AI returns the first snapshot. */
export function emptyDietPlan(targets: DietPlanData['targets']): DietPlanData {
  return {
    plan_type: 'diet',
    week_start: isoDateMondayOfWeek(new Date()),
    days: DAY_LABELS_TR.map((label, i) => ({
      day_index: i,
      day_label: label,
      meals: [],
      total_kcal: 0,
      total_protein: 0,
      total_carbs: 0,
      total_fat: 0,
    })),
    targets,
    version: 0,
  };
}

export function emptyWorkoutPlan(): WorkoutPlanData {
  return {
    plan_type: 'workout',
    week_start: isoDateMondayOfWeek(new Date()),
    days: DAY_LABELS_TR.map((label, i) => ({
      day_index: i,
      day_label: label,
      rest_day: i === 5 || i === 6, // Cumartesi, Pazar rest default
      exercises: [],
    })),
    version: 0,
  };
}
