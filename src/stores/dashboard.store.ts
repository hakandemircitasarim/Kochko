/**
 * Dashboard Store
 * Manages today's live tracking data for the dashboard screen.
 * Spec 3.1: All daily log types aggregated in real-time.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface MealEntry {
  id: string;
  raw_input: string;
  meal_type: string;
  logged_at: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  alcohol_g: number;
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
  steps: number | null;
  moodScore: number | null;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalAlcohol: number;
  loading: boolean;

  fetchToday: (userId: string) => Promise<void>;
  addWater: (userId: string, amount: number) => Promise<void>;
  deleteMeal: (mealId: string) => Promise<void>;
  deleteWorkout: (workoutId: string) => Promise<void>;
}

const todayStr = () => new Date().toISOString().split('T')[0];

export const useDashboardStore = create<TodayState>((set, get) => ({
  meals: [],
  workouts: [],
  weightKg: null,
  waterLiters: 0,
  sleepHours: null,
  steps: null,
  moodScore: null,
  totalCalories: 0,
  totalProtein: 0,
  totalCarbs: 0,
  totalFat: 0,
  totalAlcohol: 0,
  loading: false,

  fetchToday: async (userId) => {
    set({ loading: true });
    const date = todayStr();

    const [mealsRes, workoutsRes, metricsRes] = await Promise.all([
      supabase.from('meal_logs').select('id, raw_input, meal_type, logged_at')
        .eq('user_id', userId).eq('logged_for_date', date).eq('is_deleted', false).order('logged_at'),
      supabase.from('workout_logs').select('id, raw_input, duration_min, workout_type')
        .eq('user_id', userId).eq('logged_for_date', date).order('logged_at'),
      supabase.from('daily_metrics').select('*')
        .eq('user_id', userId).eq('date', date).single(),
    ]);

    // Get full macros for each meal
    const meals: MealEntry[] = [];
    for (const meal of (mealsRes.data ?? []) as { id: string; raw_input: string; meal_type: string; logged_at: string }[]) {
      const { data: items } = await supabase
        .from('meal_log_items')
        .select('calories, protein_g, carbs_g, fat_g, alcohol_g')
        .eq('meal_log_id', meal.id);

      const cal = (items ?? []).reduce((s: number, i: { calories: number }) => s + (i.calories ?? 0), 0);
      const pro = (items ?? []).reduce((s: number, i: { protein_g: number }) => s + (i.protein_g ?? 0), 0);
      const carb = (items ?? []).reduce((s: number, i: { carbs_g: number }) => s + (i.carbs_g ?? 0), 0);
      const fat = (items ?? []).reduce((s: number, i: { fat_g: number }) => s + (i.fat_g ?? 0), 0);
      const alc = (items ?? []).reduce((s: number, i: { alcohol_g: number }) => s + (i.alcohol_g ?? 0), 0);

      meals.push({ ...meal, calories: cal, protein_g: pro, carbs_g: carb, fat_g: fat, alcohol_g: alc });
    }

    const totalCalories = meals.reduce((s, m) => s + m.calories, 0);
    const totalProtein = meals.reduce((s, m) => s + m.protein_g, 0);
    const totalCarbs = meals.reduce((s, m) => s + m.carbs_g, 0);
    const totalFat = meals.reduce((s, m) => s + m.fat_g, 0);
    const totalAlcohol = meals.reduce((s, m) => s + m.alcohol_g, 0);
    const metrics = metricsRes.data;

    set({
      meals,
      workouts: (workoutsRes.data ?? []) as WorkoutEntry[],
      weightKg: metrics?.weight_kg ?? null,
      waterLiters: metrics?.water_liters ?? 0,
      sleepHours: metrics?.sleep_hours ?? null,
      steps: metrics?.steps ?? null,
      moodScore: metrics?.mood_score ?? null,
      totalCalories,
      totalProtein: Math.round(totalProtein),
      totalCarbs: Math.round(totalCarbs),
      totalFat: Math.round(totalFat),
      totalAlcohol: Math.round(totalAlcohol),
      loading: false,
    });
  },

  addWater: async (userId, amount) => {
    const date = todayStr();
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
        totalAlcohol: state.totalAlcohol - Math.round(deleted?.alcohol_g ?? 0),
      };
    });
  },

  deleteWorkout: async (workoutId) => {
    await supabase.from('workout_logs').delete().eq('id', workoutId);
    set(state => ({ workouts: state.workouts.filter(w => w.id !== workoutId) }));
  },
}));
