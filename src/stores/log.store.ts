import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type {
  MealLog,
  MealLogItem,
  WorkoutLog,
  DailyMetrics,
} from '@/types/database';

interface DayLogs {
  meals: (MealLog & { items: MealLogItem[] })[];
  workouts: WorkoutLog[];
  metrics: DailyMetrics | null;
}

interface LogState {
  today: DayLogs;
  loading: boolean;

  fetchTodayLogs: (userId: string) => Promise<void>;

  addMealLog: (
    userId: string,
    rawInput: string,
    mealType: MealLog['meal_type']
  ) => Promise<{ data: MealLog | null; error: string | null }>;

  addWorkoutLog: (
    userId: string,
    rawInput: string
  ) => Promise<{ data: WorkoutLog | null; error: string | null }>;

  updateDailyMetrics: (
    userId: string,
    date: string,
    updates: Partial<DailyMetrics>
  ) => Promise<{ error: string | null }>;

  addWater: (userId: string, date: string, amount: number) => Promise<void>;
}

const todayStr = () => new Date().toISOString().split('T')[0];

export const useLogStore = create<LogState>((set, get) => ({
  today: {
    meals: [],
    workouts: [],
    metrics: null,
  },
  loading: false,

  fetchTodayLogs: async (userId) => {
    set({ loading: true });
    const date = todayStr();

    const [mealsRes, workoutsRes, metricsRes] = await Promise.all([
      supabase
        .from('meal_logs')
        .select('*, meal_log_items(*)')
        .eq('user_id', userId)
        .gte('logged_at', `${date}T00:00:00`)
        .lte('logged_at', `${date}T23:59:59`)
        .order('logged_at', { ascending: true }),
      supabase
        .from('workout_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('logged_at', `${date}T00:00:00`)
        .lte('logged_at', `${date}T23:59:59`),
      supabase
        .from('daily_metrics')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .single(),
    ]);

    set({
      today: {
        meals: (mealsRes.data as (MealLog & { items: MealLogItem[] })[]) ?? [],
        workouts: (workoutsRes.data as WorkoutLog[]) ?? [],
        metrics: (metricsRes.data as DailyMetrics) ?? null,
      },
      loading: false,
    });
  },

  addMealLog: async (userId, rawInput, mealType) => {
    const { data, error } = await supabase
      .from('meal_logs')
      .insert({
        user_id: userId,
        raw_input: rawInput,
        meal_type: mealType,
        logged_at: new Date().toISOString(),
        synced: true,
      })
      .select()
      .single();

    if (data) {
      const mealWithItems = { ...data, items: [] } as MealLog & { items: MealLogItem[] };
      set((state) => ({
        today: {
          ...state.today,
          meals: [...state.today.meals, mealWithItems],
        },
      }));
    }

    return { data: data as MealLog | null, error: error?.message ?? null };
  },

  addWorkoutLog: async (userId, rawInput) => {
    const { data, error } = await supabase
      .from('workout_logs')
      .insert({
        user_id: userId,
        raw_input: rawInput,
        workout_type: '',
        duration_min: 0,
        intensity: 'moderate',
        calories_burned: 0,
        logged_at: new Date().toISOString(),
        synced: true,
      })
      .select()
      .single();

    if (data) {
      set((state) => ({
        today: {
          ...state.today,
          workouts: [...state.today.workouts, data as WorkoutLog],
        },
      }));
    }

    return { data: data as WorkoutLog | null, error: error?.message ?? null };
  },

  updateDailyMetrics: async (userId, date, updates) => {
    const existing = get().today.metrics;

    if (existing) {
      const { error } = await supabase
        .from('daily_metrics')
        .update({ ...updates, synced: true })
        .eq('id', existing.id);
      if (!error) {
        set((state) => ({
          today: {
            ...state.today,
            metrics: state.today.metrics
              ? { ...state.today.metrics, ...updates }
              : null,
          },
        }));
      }
      return { error: error?.message ?? null };
    } else {
      const { data, error } = await supabase
        .from('daily_metrics')
        .insert({
          user_id: userId,
          date,
          water_liters: 0,
          synced: true,
          ...updates,
        })
        .select()
        .single();
      if (data) {
        set((state) => ({
          today: { ...state.today, metrics: data as DailyMetrics },
        }));
      }
      return { error: error?.message ?? null };
    }
  },

  addWater: async (userId, date, amount) => {
    const current = get().today.metrics?.water_liters ?? 0;
    await get().updateDailyMetrics(userId, date, {
      water_liters: current + amount,
    });
  },
}));
