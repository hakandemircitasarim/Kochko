/**
 * Dashboard Store
 * Manages today's live tracking data for the dashboard screen.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { calculateGoalProgress, type GoalProgress } from '@/lib/goal-progress';
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
        .eq('user_id', userId).eq('date', date).single(),
      supabase.from('daily_plans').select('focus_message, weekly_budget_remaining')
        .eq('user_id', userId).eq('date', date).order('version', { ascending: false }).limit(1).single(),
      supabase.from('goals').select('*')
        .eq('user_id', userId).eq('is_active', true).order('phase_order').limit(1).single(),
      supabase.from('profiles').select('weight_kg')
        .eq('id', userId).single(),
    ]);

    // Get calories for each meal
    const meals: MealEntry[] = [];
    for (const meal of (mealsRes.data ?? []) as { id: string; raw_input: string; meal_type: string; logged_at: string }[]) {
      const { data: items } = await supabase
        .from('meal_log_items').select('calories, protein_g, carbs_g, fat_g').eq('meal_log_id', meal.id);
      const cal = (items ?? []).reduce((s: number, i: { calories: number }) => s + i.calories, 0);
      const pro = (items ?? []).reduce((s: number, i: { protein_g: number }) => s + i.protein_g, 0);
      const carbs = (items ?? []).reduce((s: number, i: { carbs_g: number }) => s + (i.carbs_g ?? 0), 0);
      const fat = (items ?? []).reduce((s: number, i: { fat_g: number }) => s + (i.fat_g ?? 0), 0);
      meals.push({ ...meal, calories: cal, protein_g: pro, carbs_g: carbs, fat_g: fat });
    }

    const totalCalories = meals.reduce((s, m) => s + m.calories, 0);
    const totalProtein = meals.reduce((s, m) => s + m.protein_g, 0);
    const totalCarbs = meals.reduce((s, m) => s + m.carbs_g, 0);
    const totalFat = meals.reduce((s, m) => s + m.fat_g, 0);
    const metrics = metricsRes.data;

    set({
      meals,
      workouts: (workoutsRes.data ?? []) as WorkoutEntry[],
      weightKg: metrics?.weight_kg ?? null,
      waterLiters: metrics?.water_liters ?? 0,
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
      weeklyBudgetRemaining: planRes.data?.weekly_budget_remaining ?? null,
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

    await supabase.from('daily_metrics').upsert(
      { user_id: userId, date, water_liters: newTotal, synced: true },
      { onConflict: 'user_id,date' }
    );
    set({ waterLiters: newTotal });
  },

  deleteMeal: async (mealId) => {
    // Soft delete (Spec 3.2)
    await supabase.from('meal_logs').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', mealId);
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
    await supabase.from('workout_logs').delete().eq('id', workoutId);
    set(state => ({ workouts: state.workouts.filter(w => w.id !== workoutId) }));
  },
}));
