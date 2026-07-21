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
import { safeGetJSON, safeSetJSON } from '@/lib/safe-storage';
import type { LifeEvent } from '@/components/dashboard/LifeEventCard';
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
  logged_at: string | null;
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
  // FIX (ux-ideas #6): nearest upcoming active life_event → dashboard countdown card.
  nextLifeEvent: LifeEvent | null;
  // FIX (ux-ideas #27): true once a cached snapshot (or a live fetch) has painted,
  // so the dashboard can skip the cold-load skeleton for returning users.
  hydrated: boolean;
  loading: boolean;
  // FIX (ux-pass2 #7/#10): query failures used to render a fake zeroed day; now they set
  // fetchError and KEEP the previous state. lastFetchedAt (ms) gates silent focus refetches.
  fetchError: boolean;
  lastFetchedAt: number | null;

  fetchToday: (userId: string, dayBoundaryHour?: number) => Promise<void>;
  hydrateFromCache: (userId: string, dayBoundaryHour?: number) => Promise<boolean>;
  addWater: (userId: string, amount: number, dayBoundaryHour?: number) => Promise<void>;
  deleteMeal: (mealId: string) => Promise<void>;
  deleteWorkout: (workoutId: string) => Promise<void>;
}

const todayStr = (dayBoundaryHour: number = 4) => getEffectiveDate(new Date(), dayBoundaryHour);

// FIX (ux-ideas #27): write-through cache — the dashboard's scalar snapshot (totals,
// targets, water, weight, budgets, goal, next event) is persisted per-user and re-
// hydrated instantly on open, so a returning user sees real last-known numbers
// immediately instead of a skeleton→network wait. Mirrors chat.service's cache.
// USER-SCOPED key so an account switch never paints A's numbers onto B's screen.
const DASH_CACHE_KEY = '@kochko_dash_cache_v1';
type DashSnapshot = {
  date: string;
  weightKg: number | null;
  waterLiters: number;
  waterTarget: number;
  sleepHours: number | null;
  steps: number | null;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  focusMessage: string | null;
  weeklyBudgetRemaining: number | null;
  weeklyBudgetTotal: number | null;
  weeklyBudgetConsumed: number | null;
  calorieTargetMin: number | null;
  calorieTargetMax: number | null;
  proteinTarget: number | null;
  carbsTarget: number | null;
  fatTarget: number | null;
  goalProgress: GoalProgress | null;
  activeGoal: Goal | null;
  nextLifeEvent: LifeEvent | null;
};

function writeDashCache(userId: string, snap: DashSnapshot): void {
  // best-effort, fire-and-forget
  void safeSetJSON(`${DASH_CACHE_KEY}:${userId}`, snap);
}

// FIX (ux-pass2 #8a): rapid su tapları için yazım zinciri — her halka store'daki EN GÜNCEL
// toplamı yazar; N hızlı artış yarışan upsert'ler yerine sıralı yazımlara dönüşür.
let waterWriteChain: Promise<void> = Promise.resolve();

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
  nextLifeEvent: null,
  hydrated: false,
  loading: false,
  fetchError: false,
  lastFetchedAt: null,

  fetchToday: async (userId, dayBoundaryHour = 4) => {
    set({ loading: true });
    const date = todayStr(dayBoundaryHour);

    try {
    const [mealsRes, workoutsRes, metricsRes, planRes, goalRes, profileRes, lifeEventRes] = await Promise.all([
      supabase.from('meal_logs').select('id, raw_input, meal_type, logged_at')
        .eq('user_id', userId).eq('logged_for_date', date).eq('is_deleted', false).order('logged_at'),
      supabase.from('workout_logs').select('id, raw_input, duration_min, workout_type, logged_at')
        .eq('user_id', userId).eq('logged_for_date', date).order('logged_at'),
      supabase.from('daily_metrics').select('*')
        .eq('user_id', userId).eq('date', date).maybeSingle(),
      supabase.from('daily_plans').select('focus_message, generated_at, weekly_budget_total, weekly_budget_consumed, weekly_budget_remaining, water_target_liters, plan_type, calorie_target_min, calorie_target_max, protein_target_g, carbs_target_g, fat_target_g')
        .eq('user_id', userId).eq('date', date).order('version', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('goals').select('*')
        .eq('user_id', userId).eq('is_active', true).order('phase_order').limit(1).maybeSingle(),
      supabase.from('profiles').select('weight_kg, water_target_liters, weekly_calorie_budget')
        .eq('id', userId).maybeSingle(),
      // FIX (ux-ideas #6): nearest upcoming active life event → dashboard countdown.
      supabase.from('life_events').select('id, title, event_type, event_date')
        .eq('user_id', userId).eq('is_active', true).gte('event_date', date)
        .order('event_date', { ascending: true }).limit(1).maybeSingle(),
    ]);

    // FIX (ux-pass2 #7): any failed query used to fall through as `data ?? []` / null and the
    // dashboard rendered a convincing fake zeroed day. Flag the failure and keep prior state.
    // (life_events excluded — it's a best-effort enhancement; a failure there must not blank
    //  the whole day.)
    const failed = [mealsRes, workoutsRes, metricsRes, planRes, goalRes, profileRes].find(r => r.error);
    if (failed?.error) {
      console.warn('fetchToday query failed:', failed.error.message);
      set({ loading: false, fetchError: true });
      return;
    }

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
      const { data: allItems, error: itemsErr } = await supabase
        .from('meal_log_items')
        .select('meal_log_id, calories, protein_g, carbs_g, fat_g')
        .in('meal_log_id', mealIds);
      // FIX (ux-pass2 #7): a failed items read used to zero every meal's calories silently.
      if (itemsErr) {
        console.warn('fetchToday items query failed:', itemsErr.message);
        set({ loading: false, fetchError: true });
        return;
      }
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

    // FIX (ux-pass2 #3): frozen focus_message split-brain — a stale projection ("1900 kcal
    // önerdim...", 19.06'da yazılmış) halkanın 2076 hedefiyle aynı ekranda çelişiyordu.
    // İki kapı: (1) satır bu haftadan önce üretildiyse bayat; (2) mesajın içindeki herhangi
    // bir "N kcal" rakamı bu satırın hedef orta noktasından >%10 sapıyorsa çelişkili.
    // İkisinde de mesajı hiç gösterme — kullanıcı asla iki çelişen kcal hedefi görmemeli.
    const focusMessage = (() => {
      const raw = (planRes.data?.focus_message as string | null) ?? null;
      if (!raw) return null;
      const genAtRaw = planRes.data?.generated_at as string | null | undefined;
      const genAt = genAtRaw ? new Date(genAtRaw).getTime() : NaN;
      const weekStartMs = new Date(`${weekStart}T00:00:00Z`).getTime();
      if (Number.isFinite(genAt) && genAt < weekStartMs) return null;
      const calMin = Number(planRes.data?.calorie_target_min ?? NaN);
      const calMax = Number(planRes.data?.calorie_target_max ?? NaN);
      const mid = (calMin + calMax) / 2;
      // Review fix (ux-pass2): yalnız GÜNLÜK TOPLAM iddialarını (≥800 kcal) hedefe karşı
      // doğrula — "kahvaltıya ~500 kcal ayır" gibi öğün-düzeyi rakamlar meşru ve hedef
      // orta noktasından sapması doğal. Hedef yoksa da bastırma: doğrulanamamak ≠ çelişki.
      if (!(mid > 0)) return raw;
      const kcalRe = /(\d[\d.,]*)\s*kcal/gi;
      let m: RegExpExecArray | null;
      while ((m = kcalRe.exec(raw)) != null) {
        const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
        if (!Number.isFinite(n) || n < 800) continue;
        if (Math.abs(n - mid) / mid > 0.10) return null;
      }
      return raw;
    })();

    const nextLifeEvent = (lifeEventRes.error ? null : (lifeEventRes.data as LifeEvent | null)) ?? null;

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
      focusMessage,
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
      nextLifeEvent,
      hydrated: true,
      loading: false,
      fetchError: false,
      lastFetchedAt: Date.now(),
    });

    // FIX (ux-ideas #27): persist the freshly-set scalar snapshot for instant repaint
    // on the next open. Read back from state so the cache can never diverge from what
    // was just rendered.
    const s = get();
    writeDashCache(userId, {
      date,
      weightKg: s.weightKg, waterLiters: s.waterLiters, waterTarget: s.waterTarget,
      sleepHours: s.sleepHours, steps: s.steps,
      totalCalories: s.totalCalories, totalProtein: s.totalProtein, totalCarbs: s.totalCarbs, totalFat: s.totalFat,
      focusMessage: s.focusMessage,
      weeklyBudgetRemaining: s.weeklyBudgetRemaining, weeklyBudgetTotal: s.weeklyBudgetTotal, weeklyBudgetConsumed: s.weeklyBudgetConsumed,
      calorieTargetMin: s.calorieTargetMin, calorieTargetMax: s.calorieTargetMax,
      proteinTarget: s.proteinTarget, carbsTarget: s.carbsTarget, fatTarget: s.fatTarget,
      goalProgress: s.goalProgress, activeGoal: s.activeGoal, nextLifeEvent: s.nextLifeEvent,
    });
    } catch (err) {
      // FIX (ux-pass2 #7): network/unexpected failure — keep previous state, surface the flag.
      console.warn('fetchToday failed:', err);
      set({ loading: false, fetchError: true });
    }
  },

  hydrateFromCache: async (userId, dayBoundaryHour = 4) => {
    // Only paint from cache before any live data has landed this session.
    if (get().lastFetchedAt != null) return false;
    const snap = await safeGetJSON<DashSnapshot>(`${DASH_CACHE_KEY}:${userId}`);
    // Ignore a snapshot from a previous day, and re-check the race after the await.
    if (!snap || snap.date !== todayStr(dayBoundaryHour) || get().lastFetchedAt != null) return false;
    set({
      weightKg: snap.weightKg,
      waterLiters: snap.waterLiters,
      waterTarget: snap.waterTarget,
      sleepHours: snap.sleepHours,
      steps: snap.steps,
      totalCalories: snap.totalCalories,
      totalProtein: snap.totalProtein,
      totalCarbs: snap.totalCarbs,
      totalFat: snap.totalFat,
      focusMessage: snap.focusMessage,
      weeklyBudgetRemaining: snap.weeklyBudgetRemaining,
      weeklyBudgetTotal: snap.weeklyBudgetTotal,
      weeklyBudgetConsumed: snap.weeklyBudgetConsumed,
      calorieTargetMin: snap.calorieTargetMin,
      calorieTargetMax: snap.calorieTargetMax,
      proteinTarget: snap.proteinTarget,
      carbsTarget: snap.carbsTarget,
      fatTarget: snap.fatTarget,
      goalProgress: snap.goalProgress,
      activeGoal: snap.activeGoal,
      nextLifeEvent: snap.nextLifeEvent,
      hydrated: true,
    });
    return true;
  },

  addWater: async (userId, amount, dayBoundaryHour = 4) => {
    const date = todayStr(dayBoundaryHour);
    // FIX (ux-pass2 #8a): optimistik — UI ağı beklemeden anında artar; hata olursa
    // yalnız BU tapın artışı geri alınır (eşzamanlı taplar kendi paylarını geri alır).
    // FIX (ux-ideas #9): clamp at 0 so an "undo" (negative amount) can never drive
    // the displayed total below zero.
    const newTotal = Math.max(0, Math.round((get().waterLiters + amount) * 100) / 100);
    set({ waterLiters: newTotal });

    // FIX (audit UX-OFF-03) çevrimdışıyken doğrudan upsert reddedilir ve artış
    // kaybolurdu. Bağlantı yoksa yapısal offline kuyruğa düş (water_log → daily_metrics
    // dalı, onConflict:'user_id,date'); reconnect'te setupAutoSync drenajı yapar.
    if (!(await isOnline())) {
      await enqueue({
        type: 'water_log',
        table: 'daily_metrics',
        data: { user_id: userId, date, water_liters: get().waterLiters },
        userId,
      });
      return;
    }

    // Hızlı ardışık tapları zincir üzerinden serileştir: her halka store'daki EN GÜNCEL
    // toplamı yazar, böylece N tap yarışan eski değerler yerine nihai değere yakınsar.
    const link = waterWriteChain.then(async () => {
      const { error } = await supabase.from('daily_metrics').upsert(
        { user_id: userId, date, water_liters: get().waterLiters, synced: true },
        { onConflict: 'user_id,date' }
      );
      if (error) throw error;
    });
    waterWriteChain = link;
    try {
      await link;
    } catch (err) {
      set({ waterLiters: Math.max(0, Math.round((get().waterLiters - amount) * 100) / 100) });
      waterWriteChain = Promise.resolve(); // zinciri sıfırla ki sonraki tap zehirlenmesin
      throw err;
    }
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
      const cal = deleted?.calories ?? 0;
      // FIX (ux-pass2 #9): haftalık bütçe kartı da aynı silmeyi yansıtmalı — yoksa aynı
      // ekranda halka düşerken bütçe kartı eski tüketimi göstermeye devam ediyordu.
      const newConsumed = state.weeklyBudgetConsumed != null
        ? Math.max(0, state.weeklyBudgetConsumed - cal)
        : null;
      const newRemaining = state.weeklyBudgetTotal != null && newConsumed != null
        ? Math.min(state.weeklyBudgetTotal, Math.max(0, state.weeklyBudgetTotal - newConsumed))
        : state.weeklyBudgetRemaining != null
          ? Math.max(0, state.weeklyBudgetRemaining + cal)
          : state.weeklyBudgetRemaining;
      return {
        meals: state.meals.filter(m => m.id !== mealId),
        totalCalories: Math.max(0, state.totalCalories - cal),
        totalProtein: Math.max(0, state.totalProtein - Math.round(deleted?.protein_g ?? 0)),
        totalCarbs: Math.max(0, state.totalCarbs - Math.round(deleted?.carbs_g ?? 0)),
        totalFat: Math.max(0, state.totalFat - Math.round(deleted?.fat_g ?? 0)),
        weeklyBudgetConsumed: newConsumed ?? state.weeklyBudgetConsumed,
        weeklyBudgetRemaining: newRemaining,
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
