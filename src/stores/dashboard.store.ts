/**
 * Dashboard Store
 * Manages today's live tracking data for the dashboard screen.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { calculateGoalProgress, type GoalProgress } from '@/lib/goal-progress';
import { calculateWaterTarget } from '@/lib/tdee';
// FIX (audit UX-OFF-03) offline kuyruğu — su/öğün/antrenman yazımları çevrimdışıyken
// doğrudan supabase'e gidip patlıyordu; artık yapısal kuyruğa düşüp reconnect'te
// setupAutoSync ile işlenir.
import { enqueue, isOnline } from '@/services/offline-queue.service';
import type { Goal } from '@/types/database';

interface MealEntry {
  id: string;
  raw_input: string;
  meal_type: string;
  logged_at: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface WorkoutEntry {
  id: string;
  raw_input: string;
  duration_min: number;
  workout_type: string;
}

interface TodayState {
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  weightKg: number | null;
  waterLiters: number;
  waterTarget: number;          // Dynamic: from today's plan, or computed from weight/training/season
  sleepHours: number | null;
  sleepTime: string | null;   // U4: "HH:MM" yatis saati
  wakeTime: string | null;    // U4: "HH:MM" kalkis saati
  steps: number | null;
  moodScore: number | null;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  focusMessage: string | null;
  weeklyBudgetRemaining: number | null;
  weeklyBudgetTotal: number | null;
  weeklyBudgetConsumed: number | null;
  calorieTargetMin: number | null;   // from today's daily_plans projection
  calorieTargetMax: number | null;
  proteinTarget: number | null;
  carbsTarget: number | null;
  fatTarget: number | null;
  goalProgress: GoalProgress | null;
  activeGoal: Goal | null;
  loading: boolean;

  fetchToday: (userId: string, dayBoundaryHour?: number) => Promise<void>;
  addWater: (userId: string, amount: number, dayBoundaryHour?: number) => Promise<void>;
  deleteMeal: (mealId: string) => Promise<void>;
  deleteWorkout: (workoutId: string) => Promise<void>;
}

const todayStr = (dayBoundaryHour: number = 4) => getEffectiveDate(new Date(), dayBoundaryHour);

export const useDashboardStore = create<TodayState>((set, get) => ({
  meals: [],
  workouts: [],
  weightKg: null,
  waterLiters: 0,
  waterTarget: 2.5,
  sleepHours: null,
  sleepTime: null,
  wakeTime: null,
  steps: null,
  moodScore: null,
  totalCalories: 0,
  totalProtein: 0,
  totalCarbs: 0,
  totalFat: 0,
  focusMessage: null,
  weeklyBudgetRemaining: null,
  weeklyBudgetTotal: null,
  weeklyBudgetConsumed: null,
  calorieTargetMin: null,
  calorieTargetMax: null,
  proteinTarget: null,
  carbsTarget: null,
  fatTarget: null,
  goalProgress: null,
  activeGoal: null,
  loading: false,

  fetchToday: async (userId, dayBoundaryHour = 4) => {
    set({ loading: true });
    const date = todayStr(dayBoundaryHour);

    const [mealsRes, workoutsRes, metricsRes, planRes, goalRes, profileRes] = await Promise.all([
      supabase.from('meal_logs').select('id, raw_input, meal_type, logged_at')
        .eq('user_id', userId).eq('logged_for_date', date).eq('is_deleted', false).order('logged_at'),
      supabase.from('workout_logs').select('id, raw_input, duration_min, workout_type')
        .eq('user_id', userId).eq('logged_for_date', date).order('logged_at'),
      supabase.from('daily_metrics').select('*')
        .eq('user_id', userId).eq('date', date).maybeSingle(),
      supabase.from('daily_plans').select('focus_message, weekly_budget_total, weekly_budget_consumed, weekly_budget_remaining, water_target_liters, plan_type, calorie_target_min, calorie_target_max, protein_target_g, carbs_target_g, fat_target_g')
        .eq('user_id', userId).eq('date', date).order('version', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('goals').select('*')
        .eq('user_id', userId).eq('is_active', true).order('phase_order').limit(1).maybeSingle(),
      supabase.from('profiles').select('weight_kg, water_target_liters, weekly_calorie_budget')
        .eq('id', userId).maybeSingle(),
    ]);

    // #journey HIGH: weekly-budget CONSUMED must be LIVE — sum this week's logged calories — not
    // the frozen daily_plans.weekly_budget_consumed snapshot that never moved as the user logged
    // meals during the day/week (the "bank calories across the week" UI was effectively dead).
    const weekStart = (() => {
      const d = new Date(`${date}T00:00:00Z`);
      const dow = d.getUTCDay(); // 0=Sun
      d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // Monday-based
      return d.toISOString().slice(0, 10);
    })();
    let liveWeekConsumed: number | null = null;
    try {
      const { data: weekItems } = await supabase
        .from('meal_log_items')
        .select('calories, meal_logs!inner(user_id, logged_for_date, is_deleted)')
        .eq('meal_logs.user_id', userId)
        .gte('meal_logs.logged_for_date', weekStart)
        .lte('meal_logs.logged_for_date', date)
        .eq('meal_logs.is_deleted', false);
      if (weekItems) liveWeekConsumed = (weekItems as { calories: number | null }[]).reduce((s, m) => s + (m.calories ?? 0), 0);
    } catch { /* live budget is best-effort; fall back to the stored snapshot below */ }
    const weeklyBudgetTotalResolved = (planRes.data?.weekly_budget_total as number | null)
      ?? (profileRes.data?.weekly_calorie_budget as number | null) ?? null;

    // Single IN query instead of N+1 — for 5 meals this is 1 round-trip instead of 5.
    const mealRows = (mealsRes.data ?? []) as { id: string; raw_input: string; meal_type: string; logged_at: string }[];
    const mealIds = mealRows.map(m => m.id);
    type ItemRow = { meal_log_id: string; calories: number; protein_g: number; carbs_g: number | null; fat_g: number | null };
    const itemsByMeal = new Map<string, ItemRow[]>();
    if (mealIds.length > 0) {
      const { data: allItems } = await supabase
        .from('meal_log_items')
        .select('meal_log_id, calories, protein_g, carbs_g, fat_g')
        .in('meal_log_id', mealIds);
      for (const item of (allItems ?? []) as ItemRow[]) {
        const bucket = itemsByMeal.get(item.meal_log_id) ?? [];
        bucket.push(item);
        itemsByMeal.set(item.meal_log_id, bucket);
      }
    }
    const meals: MealEntry[] = mealRows.map(meal => {
      const items = itemsByMeal.get(meal.id) ?? [];
      return {
        ...meal,
        calories: items.reduce((s, i) => s + i.calories, 0),
        protein_g: items.reduce((s, i) => s + i.protein_g, 0),
        carbs_g: items.reduce((s, i) => s + (i.carbs_g ?? 0), 0),
        fat_g: items.reduce((s, i) => s + (i.fat_g ?? 0), 0),
      };
    });

    const totalCalories = meals.reduce((s, m) => s + m.calories, 0);
    const totalProtein = meals.reduce((s, m) => s + m.protein_g, 0);
    const totalCarbs = meals.reduce((s, m) => s + m.carbs_g, 0);
    const totalFat = meals.reduce((s, m) => s + m.fat_g, 0);
    const metrics = metricsRes.data;

    // Water target: prefer today's plan (dynamic per training day/season) →
    // fallback to profile static → last resort compute from weight+date.
    const planWater = (planRes.data?.water_target_liters as number | null) ?? null;
    const profileWater = (profileRes.data?.water_target_liters as number | null) ?? null;
    const weight = (profileRes.data?.weight_kg as number | null) ?? null;
    const isTrainingDay = (planRes.data?.plan_type as string | undefined) === 'training';
    const month = new Date().getMonth() + 1;
    const isSummer = month >= 6 && month <= 8;
    const computedWater = weight ? calculateWaterTarget(weight, isTrainingDay, isSummer) : 2.5;
    const waterTarget = planWater ?? profileWater ?? computedWater;

    set({
      meals,
      workouts: (workoutsRes.data ?? []) as WorkoutEntry[],
      weightKg: metrics?.weight_kg ?? null,
      waterLiters: metrics?.water_liters ?? 0,
      waterTarget,
      sleepHours: metrics?.sleep_hours ?? null,
      sleepTime: metrics?.sleep_time ?? null,
      wakeTime: metrics?.wake_time ?? null,
      steps: metrics?.steps ?? null,
      moodScore: metrics?.mood_score ?? null,
      totalCalories,
      totalProtein: Math.round(totalProtein),
      totalCarbs: Math.round(totalCarbs),
      totalFat: Math.round(totalFat),
      focusMessage: planRes.data?.focus_message ?? null,
      weeklyBudgetConsumed: liveWeekConsumed != null ? Math.round(liveWeekConsumed) : (planRes.data?.weekly_budget_consumed ?? null),
      weeklyBudgetTotal: weeklyBudgetTotalResolved,
      weeklyBudgetRemaining: (weeklyBudgetTotalResolved != null && liveWeekConsumed != null)
        ? Math.round(weeklyBudgetTotalResolved - liveWeekConsumed)
        : (planRes.data?.weekly_budget_remaining ?? null),
      calorieTargetMin: (planRes.data?.calorie_target_min as number | null) ?? null,
      calorieTargetMax: (planRes.data?.calorie_target_max as number | null) ?? null,
      proteinTarget: (planRes.data?.protein_target_g as number | null) ?? null,
      carbsTarget: (planRes.data?.carbs_target_g as number | null) ?? null,
      fatTarget: (planRes.data?.fat_target_g as number | null) ?? null,
      activeGoal: goalRes.data as Goal | null,
      goalProgress: (() => {
        const goal = goalRes.data as Goal | null;
        if (!goal) return null;
        const startWeight = goal.start_weight_kg ?? (profileRes.data?.weight_kg as number | null);
        const curWeight = (metrics?.weight_kg as number | null) ?? (profileRes.data?.weight_kg as number | null);
        if (!curWeight || !startWeight) return null;
        return calculateGoalProgress(goal, curWeight, startWeight);
      })(),
      loading: false,
    });
  },

  addWater: async (userId, amount, dayBoundaryHour = 4) => {
    const date = todayStr(dayBoundaryHour);
    const current = get().waterLiters;
    const newTotal = Math.round((current + amount) * 100) / 100;

    // FIX (audit UX-OFF-03) çevrimdışıyken doğrudan upsert reddedilir ve artış
    // kaybolurdu. Bağlantı yoksa yapısal offline kuyruğa düş (water_log → daily_metrics
    // dalı, onConflict:'user_id,date'); reconnect'te setupAutoSync drenajı yapar.
    // Optimistik UI'yi yine güncelle ki kullanıcı artışı görsün.
    if (!(await isOnline())) {
      await enqueue({
        type: 'water_log',
        table: 'daily_metrics',
        data: { user_id: userId, date, water_liters: newTotal },
        userId,
      });
      set({ waterLiters: newTotal });
      return;
    }

    const { error } = await supabase.from('daily_metrics').upsert(
      { user_id: userId, date, water_liters: newTotal, synced: true },
      { onConflict: 'user_id,date' }
    );
    if (error) throw error;
    set({ waterLiters: newTotal });
  },

  deleteMeal: async (mealId) => {
    // FIX (audit UX-OFF-03) yapısal offline kuyruğu yalnız upsert/update-by-key destekler;
    // DELETE/soft-delete'i güvenli kuyruğa alamayız (meal_logs upsert'ü eksik NOT-NULL
    // sütunlar yüzünden patlayabilir). Çevrimdışıyken sessizce kaybetmek yerine net bir
    // hatayla başarısız ol — UI zaten "Silinemedi" gösterir, kayıt korunur.
    if (!(await isOnline())) {
      throw new Error('offline: silme işlemi internet bağlantısı gerektirir');
    }
    // Soft delete (Spec 3.2)
    const { error } = await supabase.from('meal_logs').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', mealId);
    if (error) throw error;
    set(state => {
      const deleted = state.meals.find(m => m.id === mealId);
      return {
        meals: state.meals.filter(m => m.id !== mealId),
        totalCalories: state.totalCalories - (deleted?.calories ?? 0),
        totalProtein: state.totalProtein - Math.round(deleted?.protein_g ?? 0),
        totalCarbs: state.totalCarbs - Math.round(deleted?.carbs_g ?? 0),
        totalFat: state.totalFat - Math.round(deleted?.fat_g ?? 0),
      };
    });
  },

  deleteWorkout: async (workoutId) => {
    // FIX (audit UX-OFF-03) hard DELETE yapısal kuyruğa alınamaz (queue yalnız upsert
    // çalıştırır). Çevrimdışıyken net hatayla başarısız ol; UI "Silinemedi" gösterir.
    if (!(await isOnline())) {
      throw new Error('offline: silme işlemi internet bağlantısı gerektirir');
    }
    const { error } = await supabase.from('workout_logs').delete().eq('id', workoutId);
    if (error) throw error;
    set(state => ({ workouts: state.workouts.filter(w => w.id !== workoutId) }));
  },
}));
