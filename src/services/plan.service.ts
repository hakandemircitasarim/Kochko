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

// FIX (audit DB-PHC-01/HIGH): the "core" chat-approved diet/workout plan is plan_subtype NULL;
// the weekly menu is a SEPARATE weekly_plans row with plan_subtype='weekly_menu' (loaded by
// weekly-plan.service). Without the subtype filter, getActive/getDraft('diet') could return the
// weekly_menu row — a structurally different plan — and the diet screen would render garbage.
// Restrict these core-plan reads to plan_subtype IS NULL. (.is(null), NOT .neq — .neq would
// drop the NULL core rows since NULL <> x is NULL/false in SQL.)
// FIX (fix-pass 07-12, error≠empty): these reads used to swallow res.error and return
// null/[] exactly like "no plan" — a network/RLS failure rendered the EMPTY state over a
// perfectly good plan. They now THROW on error; the plan screens' load() already run inside
// try/catch and route to their existing view='error' branch (retry button), and
// app/plan/history.tsx has its own catch + retry state.
export async function getActive(userId: string, planType: PlanType): Promise<PlanRow | null> {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_type', planType)
    .is('plan_subtype', null)
    .eq('status', 'active')
    .limit(1);
  if (error) throw new Error(`getActive(${planType}) failed: ${error.message}`);
  return (data as PlanRow[] | null)?.[0] ?? null;
}

export async function getDraft(userId: string, planType: PlanType): Promise<PlanRow | null> {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_type', planType)
    .is('plan_subtype', null)
    .eq('status', 'draft')
    .limit(1);
  if (error) throw new Error(`getDraft(${planType}) failed: ${error.message}`);
  return (data as PlanRow[] | null)?.[0] ?? null;
}

export async function getHistory(userId: string, planType: PlanType, limit = 20): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_type', planType)
    .is('plan_subtype', null) // FIX (audit DB-PHC-01): core-plan history only, not weekly_menu rows
    .eq('status', 'archived')
    .order('generated_at', { ascending: false })
    .limit(limit);
  if (error) {
    // FIX (fix-pass 07-12): error ≠ empty — don't let the screen render "arşiv boş" over a failure.
    throw new Error(`getHistory(${planType}) failed: ${error.message}`);
  }
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
  // Step 1 — archive current active. getActive now THROWS on fetch error (error ≠
  // empty); keep this function's documented no-throw {activated, error} contract.
  let previousActive: PlanRow | null = null;
  try {
    previousActive = await getActive(userId, planType);
  } catch {
    return { activated: null, error: 'Mevcut plan okunamadı — bağlantını kontrol edip tekrar dene.' };
  }
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
  // Review fix (ux-pass2): format in LOCAL time. toISOString() shifted local
  // Monday 00:00 back to Sunday's UTC date in UTC+ timezones (Türkiye), skewing
  // every week_start write/comparison by a day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse an ISO date ('YYYY-MM-DD' or full timestamp) in the DEVICE timezone.
 *  `new Date('YYYY-MM-DD')` parses as UTC midnight, which shifts the calendar
 *  day for UTC+ users — append a local-time suffix for date-only strings. */
function parseIsoDateLocal(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * FIX (fix-pass 07-12, stale-plan lifecycle): a "weekly" plan whose week is over —
 * week_start + 7 days <= today — is STALE. Nothing rolls plans over automatically,
 * so a 4-week-old plan silently stayed "active"; the plan screens now surface a
 * banner with a fresh-plan CTA when this returns true.
 */
export function isPlanStale(weekStart: string): boolean {
  const start = parseIsoDateLocal(weekStart);
  if (!start) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end.getTime() <= today.getTime();
}

/** Whole weeks elapsed since week_start (>= 1 whenever isPlanStale is true). */
export function planWeeksAgo(weekStart: string): number {
  const start = parseIsoDateLocal(weekStart);
  if (!start) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / (7 * 86400000)));
}

/** "2026-06-15" → "15 Haziran haftası". Falls back to the raw string when unparseable. */
export function formatWeekStartTR(weekStart: string): string {
  const d = parseIsoDateLocal(weekStart);
  if (!d) return weekStart;
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} haftası`;
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
export const DAY_SHORT_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** ASCII-fold Turkish letters for tolerant day-name matching ('Sali' ≈ 'Salı'). */
const foldTr = (s: string) =>
  s.toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ğ/g, 'g');

/**
 * FIX (fix-pass 07-12, Turkish day names): plan day_label is LLM-authored JSON and
 * came back ASCII-mangled live ('Sali', 'Carsamba', 'Persembe'). Resolve every render
 * through this: a label that matches a canonical day after Turkish folding snaps to
 * the canonical spelling; otherwise fall back to DAY_LABELS_TR[day_index]; only an
 * unrecognizable label with an invalid index passes through raw.
 */
export function dayLabelTR(dayIndex: number, rawLabel?: string | null): string {
  if (rawLabel) {
    const folded = foldTr(rawLabel.trim());
    const hit = DAY_LABELS_TR.find(l => foldTr(l) === folded);
    if (hit) return hit;
  }
  if (Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex <= 6) return DAY_LABELS_TR[dayIndex];
  return rawLabel ?? '';
}

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

// ─── 'Bunu yedim' — plan → diary (fix-pass 07-12, item 9) ────────────────

/**
 * Deterministically log a planned meal into the diary (meal_logs +
 * meal_log_items) with NO LLM round-trip. Mirrors templates.service
 * useTemplate(): same NOT-NULL columns, RLS (auth.uid()=user_id), CHECK
 * constraints (meal_type enum matches DietMeal.meal_type; calories SMALLINT
 * → rounded; data_source='template' is in the migration-084 allow-list).
 */
export async function logPlannedMeal(
  meal: DietMeal,
  loggedForDate: string,
): Promise<{ mealLogId: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { mealLogId: null, error: 'Oturum bulunamadı.' };

  const { data: log, error: logErr } = await supabase
    .from('meal_logs')
    .insert({
      user_id: user.id,
      raw_input: `[Plan] ${meal.name}`,
      meal_type: meal.meal_type,
      input_method: 'text',
      logged_for_date: loggedForDate,
      synced: true,
    })
    .select('id')
    .limit(1);
  const logId = (log as { id: string }[] | null)?.[0]?.id ?? null;
  if (logErr || !logId) {
    return { mealLogId: null, error: logErr?.message ?? 'Kayıt oluşturulamadı.' };
  }

  // Plan meals always carry items in practice; if an LLM snapshot dropped them,
  // fall back to a single roll-up item so the diary still gets the meal totals.
  const items: MealItem[] = (Array.isArray(meal.items) && meal.items.length > 0)
    ? meal.items
    : [{
        name: meal.name,
        kcal: meal.total_kcal ?? 0,
        protein: meal.total_protein ?? 0,
        carbs: meal.total_carbs ?? 0,
        fat: meal.total_fat ?? 0,
      }];
  const rows = items.map(it => ({
    meal_log_id: logId,
    food_name: it.name,
    portion_text: it.grams ? `${it.grams} g` : (it.portion ?? '1 porsiyon'),
    portion_grams: it.grams ?? null,
    calories: Math.round(it.kcal ?? 0),
    protein_g: Math.round((it.protein ?? 0) * 10) / 10,
    carbs_g: Math.round((it.carbs ?? 0) * 10) / 10,
    fat_g: Math.round((it.fat ?? 0) * 10) / 10,
    data_source: 'template',
  }));
  const { error: itemsErr } = await supabase.from('meal_log_items').insert(rows);
  if (itemsErr) {
    // Roll the empty log back so the user doesn't see a phantom 0 kcal entry.
    await supabase.from('meal_logs').delete().eq('id', logId);
    return { mealLogId: null, error: itemsErr.message };
  }
  return { mealLogId: logId, error: null };
}

/** Undo for logPlannedMeal — soft delete, same pattern as the dashboard's deleteMeal. */
export async function undoPlannedMealLog(mealLogId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('meal_logs')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', mealLogId);
  return { error: error?.message ?? null };
}
