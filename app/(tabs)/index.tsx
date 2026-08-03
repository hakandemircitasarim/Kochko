/**
 * Ana Sayfa (Dashboard) — Bilgi odakli, flat dark design
 * Kalori halkasi, hizli istatistikler, haftalik butce, diyet/spor planlari
 */
import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert, TextInput, Modal, Animated, AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useStreak } from '@/hooks/useStreak';
import { HeroSection } from '@/components/dashboard/HeroSection';
import { StatStrip } from '@/components/dashboard/StatStrip';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { ProfileCompletionDonut } from '@/components/dashboard/ProfileCompletionDonut';
import { PlanOverviewCards } from '@/components/dashboard/PlanOverviewCards';
import { GoalProgressCard } from '@/components/dashboard/GoalProgressCard';
import { LifeEventCard } from '@/components/dashboard/LifeEventCard';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { getEffectiveDate } from '@/lib/day-boundary';
import { deriveNutritionTargets } from '@/lib/nutrition-targets';
// FIX (ux-pass2 #4c): tek "güncel kilo" yazım yolu — daily_metrics + profiles birlikte.
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS, FONT, WATER_INCREMENT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { setupAutoSync } from '@/services/offline-queue.service';
import { getUnreadCoachingMessages, markMessageRead, type CoachingMessage } from '@/services/coaching-messages.service';
import { shareMilestoneCard } from '@/services/share-card.service';
import { supabase } from '@/lib/supabase';
import { safeGetString, safeSetString } from '@/lib/safe-storage';
import { detectReturnLevel, generateWelcomeBack, type ReturnStatus } from '@/services/return-flow.service';
import { nextStreakMilestone } from '@/services/achievements.service';
import { syncStepsToDailyMetrics } from '@/services/health-connect.service';
import { CoachingNudge } from '@/components/dashboard/CoachingNudge';
import { isDismissed, markDismissed } from '@/lib/dismissals';
// FIX (audit: üç offline banner) ui/OfflineBanner inline render kaldırıldı —
// global common/OfflineBanner (app/_layout.tsx) tek kaynak.
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { showToast } from '@/components/ui/Toast';
import { usePremium } from '@/hooks/usePremium';
import { checkAndScheduleTrialReminder, routeForNotificationType } from '@/services/notifications.service';
import { trace } from '@/lib/uiTrace';

// FIX (ux-pass2 #2): "Uzun süredir yemek yememişsin" nudge'ı, kullanıcı 18:12'de öğün
// logladıktan sonra da 332 kcal gösteren halkanın altında asılı kalıyordu. Deterministik
// trigger_type'lar önce; LLM nudge'ları serbest trigger taşıdığından içerik eşleşmesi yedek.
const MEAL_NUDGE_TRIGGERS = new Set(['snack_hour_nudge', 'night_eating_risk', 'meal_gap', 'no_meals']);
// Review fix (ux-pass2): iki seviye — typed trigger eşleşmesi KALICI okundu-işaretlemeye
// yetkili; içerik regex'i yalnız GİZLEMEYE yetkili. Regex "yemek" geçen herhangi bir
// motivasyon nudge'ını da yakalayabilir; onu kalıcı silmek kullanıcının hiç görmediği
// bir mesajı yok eder.
function isMealNudgeTyped(msg: CoachingMessage): boolean {
  return MEAL_NUDGE_TRIGGERS.has(msg.trigger_type);
}
function looksLikeMealNudge(msg: CoachingMessage): boolean {
  const txt = `${msg.trigger_type} ${msg.content}`.toLocaleLowerCase('tr-TR');
  return /yeme|yemek|öğün|atıştır|açlık|kahvaltı|meal|snack/.test(txt);
}

// FIX (ux-ideas #11): the hero's single personal line (focus_message) is gated so
// tightly it's usually null, leaving the coach-first surface silent on open. When
// there's no server line, derive ONE most-relevant sentence, fully client-side,
// from the same live numbers the ring already uses — so the coach always says
// something. First matching rule wins (ordered by actionability).
function deriveCoachLine(a: {
  hour: number; consumed: number; targetMid: number;
  protein: number; proteinTarget: number;
  weighedToday: boolean; hasGoal: boolean;
  water: number; waterTarget: number;
}): string | null {
  const remaining = a.targetMid - a.consumed;
  if (a.consumed <= 0 && a.hour >= 10) {
    return 'Bugün henüz bir şey loglamadın — ilk öğününü eklemek ister misin?';
  }
  if (a.hour >= 17 && a.targetMid > 0 && remaining > 200) {
    return `Akşam için ~${remaining} kcal bütçen kaldı.`;
  }
  if (a.proteinTarget > 0 && a.hour >= 14) {
    const pr = Math.round(a.proteinTarget - a.protein);
    if (pr >= 25) return `Proteinin ${pr}g gerisinde — bir ara öğünle kapatabilirsin.`;
  }
  if (!a.weighedToday && a.hasGoal && a.hour >= 6 && a.hour < 14) {
    return 'Bugün henüz tartılmadın — sabah tartısı en tutarlısıdır.';
  }
  if (a.waterTarget > 0 && a.hour >= 12 && a.water < a.waterTarget * 0.5) {
    return `Su ${a.water.toFixed(1).replace('.', ',')}/${a.waterTarget.toFixed(1).replace('.', ',')} L — biraz geridesin.`;
  }
  // Deliberately NO generic calorie fallback here. It used to return
  // `Bugün ~${remaining} kcal bütçen var.` — driven on a device, that put the same number on
  // screen three times in the first viewport: the ring shows it huge ("1827 / kcal kaldı"), the
  // sub-label repeats it as a fraction ("0 / 1827 kcal"), and then this strip said it a third
  // time in its own card. A hint strip earns its space only by saying something the screen does
  // NOT already show; every branch above does that (protein gap, unweighed, water behind).
  // Showing nothing is better than restating the largest number on the page.
  return null;
}

export default function TodayScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const {
    meals, workouts, weightKg, waterLiters, sleepHours, steps,
    totalCalories, totalProtein, totalCarbs, totalFat, focusMessage,
    weeklyBudgetRemaining,
    weeklyBudgetTotal: storeBudgetTotal, weeklyBudgetConsumed: storeBudgetConsumed,
    calorieTargetMin: planCalMin, calorieTargetMax: planCalMax,
    proteinTarget: planProtein, carbsTarget: planCarbs, fatTarget: planFat,
    goalProgress, activeGoal, nextLifeEvent, hydrated,
    loading, fetchError, lastFetchedAt, fetchToday, hydrateFromCache, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, newAchievement, checkForMilestones } = useStreak();
  // FIX (audit: deneme geri-sayımı dashboard) trial state'i dashboard'da yüzeye çıkar
  const { isInTrial, trialDaysLeft } = usePremium();
  const [trialBannerDismissed, setTrialBannerDismissed] = useState<boolean | null>(null);
  // FIX (ux-ideas #25): milestone celebration modal state (persists past the hook's 5s auto-clear).
  const [celebration, setCelebration] = useState<string | null>(null);
  // FIX (ux-ideas #26): "Haftan hazır" weekly recap entry-point.
  const [weeklyRecap, setWeeklyRecap] = useState<{ weekStart: string; avgCompliance: number | null; strategy: string | null } | null>(null);
  // FIX (ux-ideas #15): in-app streak-at-risk nudge (the evening push is a deeper, deploy-gated follow-up).
  // ux-defect pass 2026-07-29: dismissals are PERSISTED (day-scope) — useState alone resurrected
  // every closed card on each app restart. null = hydrating; cards render only when === false so
  // a dismissed card never flashes during load.
  const [streakRiskDismissed, setStreakRiskDismissed] = useState<boolean | null>(null);
  // FIX (ux-round2 #2): non-guilt streak-recovery card dismissal.
  const [streakResetDismissed, setStreakResetDismissed] = useState<boolean | null>(null);
  // FIX (ux-round2 #10): enriched return message ("daha önce X/Y gün tutturmuştun") — activates
  // the previously-dead generateWelcomeBack. Falls back to the plain welcomeMessage.
  const [welcomeBackMsg, setWelcomeBackMsg] = useState<string | null>(null);
  // FIX (ux-round2 #2 — adversarial-review): the return level is async; until it resolves, treating
  // null as 'active' flashed the streak-recovery card at lapsed users (and persisted it if the
  // query failed). Gate R2 on this flag — set ONLY on success, so a failure fail-safes to hidden.
  const [returnResolved, setReturnResolved] = useState(false);
  // FIX (ux-round2 #2 — adversarial-review): dismiss the return banner WITHOUT nulling returnStatus,
  // so its non-active level keeps the R2 streak-recovery card excluded ('return banner owns that').
  const [returnBannerDismissed, setReturnBannerDismissed] = useState<boolean | null>(null);
  // Distinguishes "never fetched this session" from "fetched, genuinely empty day"
  // so the very first cold load can show skeletons instead of a zeroed scaffold
  // that reads like a real (and alarming) empty day.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // ux-defect pass: bespoke tartı modalının state'leri silindi — tartı girişi tek sahipte (/log?to=weight).
  const [coachingMessages, setCoachingMessages] = useState<CoachingMessage[]>([]);
  const [returnStatus, setReturnStatus] = useState<ReturnStatus | null>(null);
  // FIX (ux-ideas #20): a genuinely brand-new user (never logged a meal OR workout) gets a
  // "buradan başla" card instead of a wall of zeros that reads like data loss / a locked
  // screen. null = undetermined (card hidden); computed once on mount from two cheap HEAD
  // counts, then flipped to false the instant anything is logged this session (no re-query).
  // Gating on real history — not just streak===0 — avoids showing it to a lapsed returning user.
  const [isBrandNew, setIsBrandNew] = useState<boolean | null>(null);
  // FIX (ux-pass5): önceki veri varken başarısız pull-to-refresh tamamen sessizdi
  // (fetchToday reddetmez, fetchError yalnız lastFetchedAt==null'da tüketiliyordu) —
  // spinner normal bitip bayat sayılar kalıyordu. Hafif, geçici bir uyarı şeridi.
  const [refreshFailedToast, setRefreshFailedToast] = useState(false);
  const refreshToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshToastTimer.current) clearTimeout(refreshToastTimer.current); }, []);
  // FIX (ux-ideas #9): water quick-amount menu (long-press) + undo-after-add.
  const [waterMenu, setWaterMenu] = useState(false);
  const [waterUndo, setWaterUndo] = useState<{ amount: number } | null>(null);
  const waterUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (waterUndoTimer.current) clearTimeout(waterUndoTimer.current); }, []);

  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;

  // ux-defect pass (TIME-C1): pano yalnız navigasyon odaklanmasında tazeleniyordu — akşam
  // arka plana atılan uygulama sabah AÇILINCA dünün panosunu (selamlama, bayat nudge, dünkü
  // sayılar) gösteriyordu. Ön plana dönüşte tazele.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refreshRef.current?.();
    });
    return () => sub.remove();
  }, []);

  // ux-defect pass: hydrate persisted dismissals once per user. Storage failure → treat as
  // not-dismissed (cards show; worst case is the old behavior, never a stuck-hidden card).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const [risk, reset, ret, trial] = await Promise.all([
        isDismissed(user.id, 'streak_risk', 'day', dayBoundaryHour),
        isDismissed(user.id, 'streak_reset', 'day', dayBoundaryHour),
        isDismissed(user.id, 'return_banner', 'day', dayBoundaryHour),
        isDismissed(user.id, 'trial_countdown', 'day', dayBoundaryHour),
      ]);
      if (cancelled) return;
      setStreakRiskDismissed(risk);
      setStreakResetDismissed(reset);
      setReturnBannerDismissed(ret);
      setTrialBannerDismissed(trial);
    })().catch(() => {
      if (!cancelled) { setStreakRiskDismissed(false); setStreakResetDismissed(false); setReturnBannerDismissed(false); setTrialBannerDismissed(false); }
    });
    return () => { cancelled = true; };
  }, [user?.id, dayBoundaryHour]);
  // Prefer dynamic water target from dashboard store (respects today's training
  // day + summer adjustment via calculateWaterTarget). Profile value is a static
  // user preference / fallback.
  const storeWaterTarget = useDashboardStore(s => s.waterTarget);
  const waterTarget = storeWaterTarget || ((profile?.water_target_liters ?? 2.5) as number);
  const ifActive = !!profile?.if_active;
  const ifEatingStart = profile?.if_eating_start as string | null;
  const ifEatingEnd = profile?.if_eating_end as string | null;
  // Single source of truth for targets (ux-pass2 split-brain fix): the same
  // deriveNutritionTargets the chat receipt uses — plan-projected daily_plans
  // targets first, profile derivation as fallback.
  const derivedTargets = deriveNutritionTargets(profile, {
    calorieMin: planCalMin, calorieMax: planCalMax,
    proteinG: planProtein, carbsG: planCarbs, fatG: planFat,
  });
  const calorieTargetMin = derivedTargets.calorieTargetMin;
  const calorieTargetMax = derivedTargets.calorieTargetMax;
  const proteinTarget = derivedTargets.proteinG;
  const carbsTarget = derivedTargets.carbsG;
  const fatTarget = derivedTargets.fatG;
  const userName = profile?.display_name as string | undefined;

  // FIX (ux-ideas #11): real server focus_message wins; otherwise a derived coach
  // line so the hero is never silent. new Date() is fine — recomputed each focus.
  const coachTargetMid = calorieTargetMax > 0 ? Math.round((calorieTargetMin + calorieTargetMax) / 2) : 0;
  const coachLine = useMemo(
    () => focusMessage ?? deriveCoachLine({
      hour: new Date().getHours(),
      consumed: totalCalories,
      targetMid: coachTargetMid,
      protein: totalProtein,
      proteinTarget,
      weighedToday: weightKg != null,
      hasGoal: !!activeGoal,
      water: waterLiters,
      waterTarget,
    }),
    [focusMessage, totalCalories, coachTargetMid, totalProtein, proteinTarget, weightKg, activeGoal, waterLiters, waterTarget],
  );

  // Mount-only setup that shouldn't re-run on every focus.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    detectReturnLevel(user.id).then((status) => {
      if (cancelled) return;
      setReturnStatus(status);
      setReturnResolved(true);
      // FIX (ux-round2 #10): enrich the welcome-back with past-success evidence at the most
      // churn-prone moment. Best-effort; the banner falls back to status.welcomeMessage.
      if (status.level !== 'active' && user.id) {
        generateWelcomeBack(user.id, status).then((msg) => { if (!cancelled && msg) setWelcomeBackMsg(msg); }).catch(() => {});
      }
    }).catch(() => {}); // on failure returnResolved stays false → R2 fail-safes to hidden
    syncStepsToDailyMetrics(user.id, dayBoundaryHour).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, dayBoundaryHour]);

  // FIX (ux-ideas #20): determine brand-new status once with two cheap HEAD count queries
  // (no rows fetched). A user with zero meal AND zero workout logs ever = never started the
  // core loop → show the first-run card.
  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;
    let cancelled = false;
    (async () => {
      const [mealRes, woRes] = await Promise.all([
        supabase.from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('is_deleted', false),
        supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      ]);
      // FIX (ux-ideas #20, adversarial-review): supabase-js RESOLVES (doesn't reject) on a query
      // error with count:null — so `?? 0` would misread a transient failure (network blip / RLS
      // hiccup) as "never logged" and flash the first-run card at an established user. On error,
      // leave isBrandNew as null so the card stays hidden (fail-safe); a later focus can retry.
      if (!cancelled && !mealRes.error && !woRes.error) {
        setIsBrandNew((mealRes.count ?? 0) === 0 && (woRes.count ?? 0) === 0);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  // Drop the first-run card the moment anything is logged this session — no re-query needed.
  useEffect(() => {
    if (isBrandNew && (meals.length > 0 || workouts.length > 0)) setIsBrandNew(false);
  }, [meals.length, workouts.length, isBrandNew]);

  // FIX (ux-ideas #27): paint last-known numbers from the write-through cache the
  // instant the screen mounts (before the network fetch resolves). On a cache hit
  // we mark hasLoadedOnce so the cold-load skeleton is skipped — the returning user
  // sees real data immediately and the live fetch reconciles silently underneath.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    hydrateFromCache(user.id, dayBoundaryHour)
      .then((hit) => { if (hit && !cancelled) setHasLoadedOnce(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, dayBoundaryHour, hydrateFromCache]);

  // useFocusEffect runs on first focus too, so it doubles as initial load.
  // Previously a hasMounted ref skipped the first run to avoid a duplicate
  // fetch against a parallel useEffect — now only this effect fetches, so no
  // ref gymnastics are needed.
  const refreshRef = useRef<(() => void) | null>(null);
  const refresh = useCallback((opts?: { force?: boolean }) => {
    if (!user?.id) return;
    // FIX (ux-pass2 #10): sekme değişiminde her focus yeniden fetch tetikliyordu; veri
    // <60 sn tazeyse sessizce atla (pull-to-refresh ve veri yazımları force geçer).
    const { lastFetchedAt: fetchedAt } = useDashboardStore.getState();
    if (!opts?.force && fetchedAt != null && Date.now() - fetchedAt < 60_000) return;
    fetchToday(user.id, dayBoundaryHour)
      .catch((err) => console.warn('fetchToday failed:', err))
      .finally(() => setHasLoadedOnce(true));
    checkForMilestones();
    getUnreadCoachingMessages(user.id).then(setCoachingMessages).catch(() => {});
  }, [user?.id, fetchToday, checkForMilestones, dayBoundaryHour]);
  refreshRef.current = () => refresh();

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // FIX (ux-pass2 #10): spinner yalnız gerçek pull hareketinde döner — focus refetch'leri
  // sessizdir (eskiden refreshing={loading} her sekme geçişinde spinner çakıyordu).
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    if (!user?.id) return;
    setIsPullRefreshing(true);
    try {
      await Promise.all([
        fetchToday(user.id, dayBoundaryHour).finally(() => setHasLoadedOnce(true)),
        checkForMilestones(),
        getUnreadCoachingMessages(user.id).then(setCoachingMessages).catch(() => {}),
      ]);
      // FIX (ux-pass5): fetchToday hatayı içeride yutar ve store.fetchError'a yazar —
      // elde önceki veri varken (lastFetchedAt != null) başarısız yenilemeyi sessiz
      // bırakma; 4 sn'lik engellemeyen bir uyarı göster.
      const { fetchError: refreshErr, lastFetchedAt: fetchedTs } = useDashboardStore.getState();
      if (refreshErr && fetchedTs != null) {
        if (refreshToastTimer.current) clearTimeout(refreshToastTimer.current);
        setRefreshFailedToast(true);
        refreshToastTimer.current = setTimeout(() => setRefreshFailedToast(false), 4000);
      } else {
        setRefreshFailedToast(false);
      }
    } catch (err) {
      console.warn('pull refresh failed:', err);
    } finally {
      setIsPullRefreshing(false);
    }
  }, [user?.id, fetchToday, checkForMilestones, dayBoundaryHour]);

  // FIX (ux-pass2 #2): bugün yemek loglandıysa, son öğünden ÖNCE yazılmış yeme/öğün
  // nudge'ları bayattır — halka 332 kcal gösterirken "uzun süredir yememişsin" diyemez.
  // Bayat olanları okundu işaretleyip listeden düşür (son öğünden SONRA gelen nudge kalır).
  useEffect(() => {
    if (totalCalories <= 0 || coachingMessages.length === 0) return;
    const mealTimes = meals.map(m => new Date(m.logged_at).getTime()).filter(Number.isFinite);
    // Review fix: default 0, NOT Infinity — unparseable logged_at values must not
    // classify every nudge (including post-meal ones) as stale.
    const lastMealMs = mealTimes.length > 0 ? Math.max(...mealTimes) : 0;
    const olderThanLastMeal = (m: CoachingMessage) => new Date(m.created_at).getTime() <= lastMealMs;
    const staleTyped = coachingMessages.filter(m => isMealNudgeTyped(m) && olderThanLastMeal(m));
    const staleLoose = coachingMessages.filter(m => !isMealNudgeTyped(m) && looksLikeMealNudge(m) && olderThanLastMeal(m));
    if (staleTyped.length === 0 && staleLoose.length === 0) return;
    // Typed matches: safe to persist as read. Loose content matches: hide only —
    // a false positive must not permanently destroy an unseen message.
    for (const m of staleTyped) markMessageRead(m.id);
    const hideIds = new Set([...staleTyped, ...staleLoose].map(m => m.id));
    setCoachingMessages(prev => prev.filter(m => !hideIds.has(m.id)));
  }, [totalCalories, meals, coachingMessages]);

  // ── TEK BİLDİRİM YUVASI bayrakları (ux-defect pass): dismissable bildirimler tek yuvada,
  // öncelik: streak-risk (bugün kritik) > streak-reset > haftalık özet > koç nudge'ı.
  // Kapatmalar güne-kalıcı (src/lib/dismissals.ts); biri kapanınca sıradaki görünür.
  const showStreakRisk = streak >= 3 && meals.length === 0 && new Date().getHours() >= 19 && streakRiskDismissed === false;
  const showStreakReset = streak === 0 && isBrandNew === false && meals.length === 0 && workouts.length === 0
    && returnResolved && (!returnStatus || returnStatus.level === 'active') && streakResetDismissed === false;
  const showWeeklyRecap = !!weeklyRecap && !showStreakRisk && !showStreakReset;
  const showCoachNudge = coachingMessages.length > 0 && !showStreakRisk && !showStreakReset && !showWeeklyRecap;

  // FIX (audit: üç offline banner) inline isOffline state kaldırıldı; offline
  // göstergesi global common/OfflineBanner'a bırakıldı. NetInfo dinleyici yalnız
  // otomatik senkron kurulumu için kalıyor.
  useEffect(() => {
    const unsub = setupAutoSync();
    return () => { unsub(); };
  }, []);

  // FIX (audit: ölü trial reminder) deneme bildirimini dashboard focus'ta bağla
  // (best-effort; izin reddedilirse sessizce yutulur).
  useEffect(() => {
    checkAndScheduleTrialReminder(isInTrial, trialDaysLeft).catch(() => {});
  }, [isInTrial, trialDaysLeft]);

  // FIX (ux-ideas #26): surface the auto-generated weekly report as a dashboard "recap"
  // entry point (it otherwise sat behind five chevrons, discovered only manually). Show
  // when a report exists for a recent week and hasn't been dismissed for that week.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('weekly_reports')
        .select('week_start, avg_compliance, next_week_strategy')
        .eq('user_id', user.id).order('week_start', { ascending: false }).limit(1).maybeSingle();
      if (cancelled || !data) return;
      const ws = data.week_start as string;
      const days = Math.floor((Date.now() - new Date(`${ws}T00:00:00Z`).getTime()) / 86400000);
      if (!Number.isFinite(days) || days < 0 || days > 10) return; // only a fresh report
      const dismissed = await safeGetString(`@kochko_weekly_recap_dismissed:${user.id}`);
      if (cancelled || dismissed === ws) return;
      const strat = (data.next_week_strategy as string | null) ?? null;
      setWeeklyRecap({
        weekStart: ws,
        avgCompliance: (data.avg_compliance as number | null) ?? null,
        strategy: strat ? strat.split(/\n|(?<=\.)\s/)[0].slice(0, 120) : null,
      });
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // FIX (ux-ideas #25): a lifetime milestone ('HEDEFE ULAŞTIN!', '100 GÜN') deserves more
  // than a 5s toast identical to saving a setting. Capture it into a celebration modal that
  // springs in, pulses, fires a heavy haptic, and offers instant sharing at peak intent.
  const celebrationScale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (!newAchievement) return;
    setCelebration(newAchievement);
    haptics.heavy();
    celebrationScale.setValue(0.6);
    Animated.spring(celebrationScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
  }, [newAchievement, celebrationScale]);

  // FIX (ux-round2 #12): celebrate a reachable DAILY win (first time today's protein target is met)
  // — the weight goal takes weeks, so without this there's no "aferin" in between. Idempotent per
  // day via a persisted flag; uses the shared toast, not the full celebration modal.
  useEffect(() => {
    if (!user?.id || proteinTarget <= 0 || totalProtein < proteinTarget) return;
    const uid = user.id;
    let cancelled = false;
    const key = `@kochko_micro:${uid}:${getEffectiveDate(new Date(), dayBoundaryHour)}:protein`;
    safeGetString(key).then((done) => {
      if (cancelled || done === '1') return;
      void safeSetString(key, '1');
      showToast('Günün protein hedefini tuttun 💪', { variant: 'success' });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [totalProtein, proteinTarget, user?.id, dayBoundaryHour]);

  // FIX (ux-ideas #7 — adversarial-review): goal-reach ALREADY fires the celebration modal via the
  // achievement path — checkForMilestones()→checkMilestones() earns the 'goal_reached' achievement
  // ('HEDEFE ULAŞTIN!', achievements.service), which sets newAchievement and drives the effect
  // above. A second effect keyed on goalProgress.isGoalReached double-fired the haptic + raced the
  // modal title on the first reach, so it was removed. The audit's premise (celebration only on
  // streak milestones) was wrong — goal_reached is one of those milestones.

  // FIX (ux-ideas #9): the most-repeated micro-action was locked to a single +250 ml
  // tap with no way to fix a mis-tap. addWaterAmount takes any increment (the
  // long-press menu offers 250/500/750) and, on success, shows a 4s "Geri al" toast
  // that reverses exactly this add.
  const showWaterUndo = (amount: number) => {
    if (waterUndoTimer.current) clearTimeout(waterUndoTimer.current);
    setWaterUndo({ amount });
    waterUndoTimer.current = setTimeout(() => setWaterUndo(null), 4000);
  };
  const addWaterAmount = (liters: number) => {
    haptics.tap(); // FIX (ux-polish): immediate press feedback (the async success/error haptic stays as the outcome cue).
    if (!user?.id) return;
    const uid = user.id;
    const saveWater = async () => {
      try {
        await addWater(uid, liters, dayBoundaryHour);
        haptics.success();
        showWaterUndo(liters);
      } catch (err) {
        console.warn('addWater failed:', err);
        haptics.error();
        Alert.alert('Hata', 'Su kaydedilemedi. Lütfen tekrar deneyin.');
      }
    };
    const newTotal = waterLiters + liters;
    const warning = checkSuspiciousInput('water', newTotal);
    if (warning) {
      Alert.alert('Emin misin?', warning, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet', onPress: saveWater },
      ]);
    } else {
      saveWater();
    }
  };
  const handleAddWater = () => addWaterAmount(WATER_INCREMENT);
  const undoWater = async () => {
    if (!user?.id || !waterUndo) return;
    const amt = waterUndo.amount;
    if (waterUndoTimer.current) clearTimeout(waterUndoTimer.current);
    setWaterUndo(null);
    try {
      await addWater(user.id, -amt, dayBoundaryHour);
      haptics.tap();
    } catch (err) {
      console.warn('undo water failed:', err);
    }
  };

  // Weekly budget — prefer the projection's STORED weighted total/consumed (4 training +
  // 3 rest days, rest 250 lower) over the old flat calorie_target_max*7, which overstated
  // both total and consumed by the train/rest gap. Fall back to the flat estimate only when
  // the stored fields are absent (legacy rows). Guard against NaN / null / undefined.
  const flatTotal = calorieTargetMax > 0 ? calorieTargetMax * 7 : 0;
  const weeklyBudgetTotal = (storeBudgetTotal != null && storeBudgetTotal > 0) ? storeBudgetTotal : flatTotal;
  const rawConsumed = (storeBudgetConsumed != null)
    ? storeBudgetConsumed
    : weeklyBudgetTotal - (weeklyBudgetRemaining ?? 0);
  const weeklyConsumed = Math.max(0, isNaN(rawConsumed) ? 0 : rawConsumed);
  const rawRemaining = weeklyBudgetRemaining ?? Math.max(0, weeklyBudgetTotal - weeklyConsumed);
  const weeklyRemaining = isNaN(rawRemaining) ? 0 : rawRemaining;
  // FIX (ux-audit major): over budget → show "+N fazla" in a warning tint, not a nonsensical
  // "-320 kaldı" in positive teal. Mirrors the hero ring's amber/red over-target state.
  const weeklyOver = weeklyRemaining < 0;
  const weeklyPct = weeklyBudgetTotal > 0 ? Math.min(1, weeklyConsumed / weeklyBudgetTotal) : 0;
  // FIX (ux-round2 #7): turn the raw "X kaldı" into an actionable per-remaining-day pace so the
  // user can decide tonight's meal. Monday-based week, includes today.
  const weekDowMon = (() => {
    const d = new Date(`${getEffectiveDate(new Date(), dayBoundaryHour)}T00:00:00`);
    const g = d.getDay();
    return g === 0 ? 6 : g - 1;
  })();
  const daysLeftInWeek = 7 - weekDowMon;
  const dailyPace = daysLeftInWeek > 0 ? Math.round(weeklyRemaining / daysLeftInWeek) : 0;

  // Show skeleton placeholders only on the very first cold fetch of the session
  // so a real-but-empty day reads as itself instead of a zeroed scaffold flashing
  // like data loss. Pull-to-refresh (hasLoadedOnce=true) keeps the live content.
  // FIX (ux-ideas #27): a cache hit (hydrated) also suppresses the cold-load skeleton
  // so a returning user never sees it flash over real last-known numbers.
  const firstLoad = loading && !hasLoadedOnce && !hydrated;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="light" />

      {/* Water quick-amount menu (ux-ideas #9) — long-press the water tile */}
      <Modal visible={waterMenu} transparent animationType="fade" onRequestClose={() => setWaterMenu(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1} onPress={() => setWaterMenu(false)}
          accessible={false}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
              width: '80%', borderWidth: 0.5, borderColor: colors.border,
            }}
          >
            <Text accessibilityRole="header" style={{ fontSize: FONT.lg, fontWeight: '600', color: colors.text, marginBottom: SPACING.lg, textAlign: 'center' }}>
              Su Ekle
            </Text>
            {[250, 500, 750].map((ml) => (
              <TouchableOpacity
                key={ml}
                onPress={() => { setWaterMenu(false); addWaterAmount(ml / 1000); }}
                accessibilityRole="button"
                accessibilityLabel={`${ml} mililitre ekle`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
                  paddingVertical: SPACING.md, paddingHorizontal: SPACING.md,
                  borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, marginBottom: SPACING.sm,
                }}
              >
                <Ionicons name="water" size={18} color={METRIC_COLORS.water} />
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>{ml} ml</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => { haptics.tap(); setWaterMenu(false); }}
              accessibilityRole="button" accessibilityLabel="İptal"
              style={{ paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.xs }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>İptal</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* FIX (ux-ideas #25): milestone celebration modal — the biggest reward moment gets a
          real "an" (spring-in trophy + share) instead of a toast identical to saving a setting. */}
      <Modal visible={!!celebration} transparent animationType="fade" onRequestClose={() => setCelebration(null)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setCelebration(null)}
          accessible={false}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: SPACING.xxl }}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 0.5, borderColor: colors.border,
              padding: SPACING.xxl, alignItems: 'center', width: '100%', maxWidth: 360,
            }}
          >
            <Animated.View style={{
              transform: [{ scale: celebrationScale }],
              width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primary + '20',
              alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg,
            }}>
              <Ionicons name="trophy" size={44} color={colors.primary} />
            </Animated.View>
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: FONT.xl, fontWeight: '800', textAlign: 'center' }}>
              {celebration}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs }}>
              Bu anı hak ettin — paylaşmak ister misin?
            </Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xl, width: '100%' }}>
              <TouchableOpacity
                onPress={() => { haptics.tap(); setCelebration(null); }}
                accessibilityRole="button" accessibilityLabel="Kapat"
                style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Kapat</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  haptics.tap();
                  const t = celebration ?? 'Kochko';
                  setCelebration(null);
                  // FIX (ux-round2 #20): the share card was always blank-valued + wrong theme +
                  // impersonal. Derive the big number + correct theme from the milestone text and
                  // sign it with the user's name.
                  const lower = t.toLocaleLowerCase('tr-TR');
                  const theme: 'streak' | 'success' | 'milestone' =
                    /seri|gün/.test(lower) ? 'streak' : /kilo|hedef/.test(lower) ? 'success' : 'milestone';
                  const m = t.match(/(\d+\s*[^\d!?.]+)/);
                  const value = m ? m[1].trim().replace(/[!?.]+$/, '') : undefined;
                  shareMilestoneCard({
                    title: value ? 'Tebrikler! 🎉' : t,
                    value,
                    theme,
                    footer: userName ? `${userName} · Kochko` : 'Kochko ile',
                  }).catch(() => {});
                }}
                accessibilityRole="button" accessibilityLabel="Paylaş"
                style={{ flex: 1, flexDirection: 'row', gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="share-social-outline" size={16} color={getContrastColor(colors.primary)} />
                <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>Paylaş</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* FIX (ux-pass5): başarısız pull-to-refresh + eldeki veri bayat — sessiz kalma;
          achievement toast'ın görsel dilinde hafif, engellemeyen, 4 sn'lik uyarı. */}
      {refreshFailedToast && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: insets.top + SPACING.sm, left: SPACING.md, right: SPACING.md, zIndex: 49, alignItems: 'center' }}
        >
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            borderWidth: 0.5, borderColor: colors.border,
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            maxWidth: '100%',
          }}>
            <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, flexShrink: 1 }}>
              Yenilenemedi — son kaydedilen veriler gösteriliyor
            </Text>
          </View>
        </View>
      )}

      {/* Water undo toast (ux-ideas #9) — interactive, bottom-anchored above the tab bar */}
      {waterUndo && (
        <View style={{ position: 'absolute', bottom: insets.bottom + 84, left: SPACING.md, right: SPACING.md, zIndex: 51, alignItems: 'center' }}>
          <View
            // FIX (ux-polish): announce this frequent micro-action to screen readers (mirrors the shared Toast).
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${Math.round(waterUndo.amount * 1000)} mililitre eklendi. Geri al.`}
            style={{
            flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
            backgroundColor: colors.cardElevated, borderRadius: RADIUS.md,
            borderWidth: 0.5, borderColor: colors.border,
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, maxWidth: '100%',
          }}>
            <Ionicons name="water" size={16} color={METRIC_COLORS.water} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, flexShrink: 1 }}>
              {Math.round(waterUndo.amount * 1000)} ml eklendi
            </Text>
            <TouchableOpacity
              onPress={undoWater}
              accessibilityRole="button"
              accessibilityLabel="Su eklemeyi geri al"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>Geri al</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView
        // ux-defect pass: tab bar absolute konumlu DEĞİL (kendi yüksekliğini tüketiyor) — eski
        // 100px'lik pay panonun sonunda saf ölü boşluktu.
        contentContainerStyle={{ paddingBottom: SPACING.xl }}
        refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={onPullRefresh} tintColor={colors.primary} />}
      >
        {/* Welcome back / re-onboarding banner (Spec 10.6) */}
        {returnStatus && returnStatus.level !== 'active' && returnBannerDismissed === false && (
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            // FIX (audit UI-LAY-02) bu banner HeroSection'ın üstünde, ScrollView'ın
            // ilk çocuğu olarak render olur; üst güvenli-alan inset'i HeroSection'a
            // ait olduğundan burada kendi inset'ini eklemezse çentik altına kayar.
            padding: SPACING.md, marginTop: insets.top, marginBottom: SPACING.md,
            borderLeftWidth: 3, borderLeftColor: colors.primary,
          }}>
            <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '600', marginBottom: 4 }}>
              {returnStatus.level === 'very_long_break' ? 'TEKRAR HOŞ GELDİN' : 'HOŞ GELDİN'}
            </Text>
            <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 18 }}>
              {welcomeBackMsg ?? returnStatus.welcomeMessage}
            </Text>
            {returnStatus.needsReOnboarding && (
              <TouchableOpacity
                onPress={() => router.push('/onboarding?mode=re_onboarding')}
                accessibilityRole="button"
                accessibilityLabel="Güncelleme yap"
                style={{
                  marginTop: SPACING.sm, paddingVertical: SPACING.sm,
                  borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center',
                }}
              >
                <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>Güncelleme yap</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => { haptics.tap(); setReturnBannerDismissed(true); if (user?.id) markDismissed(user.id, 'return_banner', 'day', dayBoundaryHour); }}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ position: 'absolute', top: 8, right: 8, padding: 4 }}
            >
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* FIX (audit: deneme geri-sayımı dashboard'da yüzeye çıkmıyor) — trial
            countdown banner, returnStatus kalıbını yeniden kullanır */}
        {isInTrial && trialDaysLeft <= 3 && trialBannerDismissed === false && (
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/settings/premium'); }}
            activeOpacity={0.8}
            // FIX (ux-pass5): dış dokunulabilir accessible varsayılanıyla alt öğeleri tek a11y
            // düğümüne düzleştiriyordu — 'Kapat' ekran okuyucuya çıkmıyor, banner kapatılamayan
            // bir upsell'e dönüyordu. Dış katman kapsayıcı değil; gövde ve Kapat ayrı düğmeler.
            accessible={false}
            style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              // FIX (audit UI-LAY-02) return banner yoksa bu banner ScrollView'ın
              // ilk çocuğu olabilir; üst inset'i kendi içinde uygular ki çentik
              // altına kaymasın (marginTop sadece return banner gizliyken devreye girer).
              padding: SPACING.md, marginTop: (returnStatus && returnStatus.level !== 'active' && returnBannerDismissed === false) ? 0 : insets.top, marginBottom: SPACING.md,
              borderLeftWidth: 3, borderLeftColor: colors.warning,
            }}
          >
            <TouchableOpacity
              onPress={() => { haptics.tap(); router.push('/settings/premium'); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Denemen ${trialDaysLeft} gün sonra bitiyor. Premium'a geçmek için dokun`}
            >
              <Text style={{ color: colors.warning, fontSize: FONT.xs, fontWeight: '600', marginBottom: 4 }}>
                DENEME SÜRESİ
              </Text>
              <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 18, paddingRight: 24 }}>
                Denemen {trialDaysLeft} gün sonra bitiyor — Premium'a geç
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { haptics.tap(); setTrialBannerDismissed(true); if (user?.id) markDismissed(user.id, 'trial_countdown', 'day', dayBoundaryHour); }}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ position: 'absolute', top: 8, right: 8, padding: 4 }}
            >
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {firstLoad ? (
          /* First cold load — skeleton placeholders so a zeroed scaffold never
             flashes like a real (and alarming) empty day. */
          <View
            accessibilityLabel="Bugünün verileri yükleniyor"
            // FIX (audit UI-LAY-02) cold-load skeleton HeroSection'ın yerine geçer
            // ve banner'lar genelde yokken ScrollView'ın ilk çocuğudur; üst güvenli-
            // alan inset'ini ekleyerek çentik altına kaymasını önler.
            style={{ paddingHorizontal: SPACING.xl, marginTop: insets.top + SPACING.xxl }}
          >
            <SkeletonBlock height={210} radius={RADIUS.lg} />
            <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg }}>
              <SkeletonBlock height={84} width={'48%'} radius={RADIUS.md} />
              <SkeletonBlock height={84} width={'48%'} radius={RADIUS.md} />
            </View>
            <SkeletonBlock height={96} radius={RADIUS.md} style={{ marginTop: SPACING.lg }} />
            <SkeletonBlock height={60} radius={RADIUS.md} style={{ marginTop: SPACING.lg }} />
            <SkeletonBlock height={60} radius={RADIUS.md} style={{ marginTop: SPACING.md }} />
          </View>
        ) : fetchError && lastFetchedAt == null ? (
          /* FIX (ux-pass2 #7): fetch başarısız ve elde hiç veri yok — sahte sıfırlanmış
             gün yerine kompakt hata kartı + tekrar dene (progress.tsx kalıbı).
             (refactor: shared LoadErrorState, embedded) */
          <View style={{
            marginTop: insets.top + SPACING.xxl, marginHorizontal: SPACING.xl,
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            borderWidth: 0.5, borderColor: colors.border,
            paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl,
          }}>
            <LoadErrorState embedded onRetry={() => refresh({ force: true })} />
          </View>
        ) : (
        <>
        {/* 1. Hero: Greeting + Calorie Ring + Macros */}
        <HeroSection
          // FIX (ux-pass2 #12): başlık tarihi de veriyle aynı efektif-gün mantığını kullanır —
          // gece 00:00-04:00 arasında günlük hâlâ "bugün"ü sayarken başlık yarını gösteremez.
          today={new Date(`${getEffectiveDate(new Date(), dayBoundaryHour)}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
          streak={streak}
          focusMessage={coachLine}
          consumed={totalCalories}
          targetMin={calorieTargetMin}
          targetMax={calorieTargetMax}
          protein={totalProtein}
          proteinTarget={proteinTarget}
          carbs={totalCarbs}
          carbsTarget={carbsTarget}
          fat={totalFat}
          fatTarget={fatTarget}
          ifActive={ifActive}
          ifEatingStart={ifEatingStart}
          ifEatingEnd={ifEatingEnd}
          userName={userName}
        />

        {/* 1.02 First-run "buradan başla" card (ux-ideas #20) — ONLY for a genuinely brand-new
            user (never logged). A wall of zeros reads as data loss + a locked screen; one clear
            first action shortens time-to-value. Vanishes the moment anything is logged. */}
        {isBrandNew === true && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              borderWidth: 0.5, borderColor: colors.border,
              borderLeftWidth: 3, borderLeftColor: colors.primary, padding: SPACING.lg,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Ionicons name="sparkles" size={16} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '800', flex: 1 }}>
                  {userName ? `Hoş geldin, ${userName}!` : 'Kochko\'ya hoş geldin!'}
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 18 }}>
                İlk adımın: bugünkü ilk kaydını ekle ya da koçunla konuşarak başla. Kaydettikçe burası sana özel hâle gelecek.
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); router.push('/log'); }}
                  accessibilityRole="button"
                  accessibilityLabel="İlk kaydını ekle"
                  style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary }}
                >
                  <Ionicons name="add-circle-outline" size={16} color={getContrastColor(colors.primary)} />
                  <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>İlk kaydını ekle</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); router.push('/(tabs)/chat' as never); }}
                  accessibilityRole="button"
                  accessibilityLabel="Koçla konuş"
                  style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight }}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>Koçla konuş</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* R19 (ux-round2): next streak milestone — glanceable "sıradaki" anticipation on the
            most-viewed screen (nextStreakMilestone was profile-only). */}
        {streak > 0 && (() => {
          const nb = nextStreakMilestone(streak);
          if (!nb) return null;
          return (
            <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              <Ionicons name="ribbon-outline" size={13} color={colors.warning} />
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, flex: 1 }} numberOfLines={1}>
                Sıradaki rozet: {nb.label} · {nb.remaining} gün kaldı
              </Text>
              <View style={{ width: 56, height: 5, backgroundColor: colors.progressTrack, borderRadius: 3, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${Math.round(nb.progress * 100)}%`, backgroundColor: colors.warning, borderRadius: 3 }} />
              </View>
            </View>
          );
        })()}

        {/* ── TEK BİLDİRİM YUVASI (ux-defect pass 2026-07-29) ─────────────────────────
            Sahibin yaşadığı kusur: kapatılabilir kartlar sayfaya dağılmıştı (üstte banner,
            HEDEF'İN ALTINDA ayrı bir nudge kartı) — üsttekini kapatınca "aynı kart aşağıda
            hâlâ duruyor" hissi. Artık dismissable bildirimler TEK yuvada, öncelik sırasıyla,
            AYNI ANDA YALNIZ BİR TANE gösterilir: risk (bugün kritik) > seri-sıfırlandı >
            haftalık özet > koç nudge'ı. Biri kapanınca sıradaki görünür. */}
        {/* R2 (ux-round2): non-guilt streak recovery — a broken streak is the highest-churn moment;
            reframe the zero as a gentle restart. Distinct from the streak-at-risk nudge (needs an
            active run). Not for brand-new (isBrandNew) or lapsed (return banner owns that). */}
        {showStreakReset && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <TouchableOpacity
              onPress={() => { haptics.tap(); router.push('/log'); }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Serin sıfırlandı. Yeniden başlamak için kayıt ekle"
              style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md,
                borderWidth: 0.5, borderColor: colors.border,
                borderLeftWidth: 3, borderLeftColor: colors.warning, padding: SPACING.lg,
                flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
              }}
            >
              <Ionicons name="refresh" size={20} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>Yeniden başlayalım</Text>
                <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 1 }}>Serin sıfırlandı — sorun değil. Bugün tek kayıtla yeni seriyi başlat.</Text>
              </View>
              <TouchableOpacity
                onPress={() => { haptics.tap(); setStreakResetDismissed(true); if (user?.id) markDismissed(user.id, 'streak_reset', 'day', dayBoundaryHour); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button" accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        )}

        {/* 1.05 Streak-at-risk nudge (ux-ideas #15) — evening, an unbroken run, nothing logged
            yet today: one log saves it. */}
        {showStreakRisk && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <TouchableOpacity
              onPress={() => { haptics.tap(); router.push('/log'); }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${streak} günlük serin bugün risk altında. Kayıt eklemek için dokun`}
              style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md,
                borderWidth: 0.5, borderColor: colors.border,
                borderLeftWidth: 3, borderLeftColor: colors.warning, padding: SPACING.lg,
                flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
              }}
            >
              <Ionicons name="flame" size={20} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>{streak} günlük serin risk altında</Text>
                <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 1 }}>Bugün henüz kayıt yok — tek öğün yeter, seriyi koru.</Text>
              </View>
              <TouchableOpacity
                onPress={() => { haptics.tap(); setStreakRiskDismissed(true); if (user?.id) markDismissed(user.id, 'streak_risk', 'day', dayBoundaryHour); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button" accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        )}

        {/* 1.1 Weekly recap entry-point (ux-ideas #26) — the auto-generated weekly report,
            made discoverable + a return ritual. Yields to time-critical streak cards (one-slot rule). */}
        {showWeeklyRecap && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <TouchableOpacity
              onPress={() => { haptics.tap(); router.push('/reports/weekly'); }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Haftalık raporun hazır. Açmak için dokun"
              style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md,
                borderWidth: 0.5, borderColor: colors.border,
                borderLeftWidth: 3, borderLeftColor: colors.primary, padding: SPACING.lg,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Ionicons name="sparkles" size={16} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', flex: 1 }}>Haftan hazır</Text>
                <TouchableOpacity
                  onPress={() => {
                    haptics.tap();
                    if (user?.id) safeSetString(`@kochko_weekly_recap_dismissed:${user.id}`, weeklyRecap.weekStart);
                    setWeeklyRecap(null);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button" accessibilityLabel="Kapat"
                >
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {weeklyRecap.avgCompliance != null && (
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4 }}>
                  Geçen hafta uyum: %{Math.round(weeklyRecap.avgCompliance)}
                </Text>
              )}
              {weeklyRecap.strategy && (
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }} numberOfLines={2}>
                  {weeklyRecap.strategy}
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.sm }}>
                <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>Haftalık raporu aç</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* 1.5 Coaching Nudges — ONLY the newest one. The emulator pass showed 3 stacked nudge
            cards ("sessizsin" + "tartıya çıkmadın" + "günaydın") on one open: notification spam
            that buries the dashboard. Older unread nudges surface one-at-a-time as each is
            dismissed. */}
        {showCoachNudge && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <CoachingNudge
              messages={coachingMessages.slice(0, 1)}
              onDismiss={(id) => {
                // FIX (ux-pass5): iki kart üstteki görsel ikizi (return/trial banner Kapat)
                // haptics.tap() veriyor — nudge kapatma aynı dokunsal onayı verir.
                haptics.tap();
                markMessageRead(id);
                setCoachingMessages(prev => prev.filter(m => m.id !== id));
              }}
              onTap={(msg) => {
                haptics.tap(); // FIX (ux-pass5): kardeş dokunuşlarla tutarlı dokunsal onay.
                markMessageRead(msg.id);
                setCoachingMessages(prev => prev.filter(m => m.id !== msg.id));
                // FIX (ux-ideas #4): route by the nudge's trigger_type — a weigh-in reminder
                // lands on /log, a weekly recap on /reports/weekly, a challenge on its screen,
                // instead of dumping every nudge into a cold chat thread. Reuses the same
                // routeForNotificationType map the push-response listener uses. Conversational
                // nudges (and unmapped types) still open the coach thread.
                // FIX (ux-pass2 #5): open parameterless — never prefill the coach's own line into
                // the user's composer.
                const route = routeForNotificationType(msg.trigger_type) ?? '/(tabs)/chat';
                router.push(route as never);
              }}
              onAccept={(msg) => {
                // FIX (ux-ideas #17) + F3/C5: accept an offer in one tap — and CARRY THE OFFER'S
                // IDENTITY. The old anonymous "Evet, önerini uygulayalım." reached a coach who had
                // no idea which offer existed ("Neyi uygulayalım?"), and nothing ever recorded the
                // acceptance. The prefill now NAMES the offer (a truncated quote of the nudge) and
                // accepted_nudge_id rides along so the server stamps accepted_at deterministically
                // — acceptance no longer depends on the LLM understanding the reference.
                haptics.tap();
                markMessageRead(msg.id);
                setCoachingMessages(prev => prev.filter(m => m.id !== msg.id));
                const offerRef = (msg.content ?? '').replace(/\s+/g, ' ').slice(0, 80);
                trace('nudge_accept_sent');
                router.push({ pathname: '/(tabs)/chat', params: {
                  prefill: `Evet, şu önerini uygulayalım: "${offerRef}"`,
                  acceptedNudgeId: msg.id,
                  taskNonce: String(Date.now()),
                } });
              }}
            />
          </View>
        )}

        {/* 1.2 Goal north-star card (ux-ideas #10) — the user's actual motivation,
            surfaced from goalProgress the store already computes. */}
        {/* FIX (ux-readiness): require a target weight — a gain_muscle goal saved without one has no
            distance to track, so the %-bar/"N kg kaldı" card is meaningless (and was contradictory). */}
        {goalProgress && activeGoal && activeGoal.target_weight_kg != null
          && (activeGoal.goal_type === 'lose_weight' || activeGoal.goal_type === 'gain_weight' || activeGoal.goal_type === 'gain_muscle') && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <GoalProgressCard
              progress={goalProgress}
              goalType={activeGoal.goal_type}
              onPress={() => { haptics.tap(); router.push('/settings/goals'); }}
            />
          </View>
        )}

        {/* 1.3 Life-event countdown (ux-ideas #6) — the coach's most personal memory,
            made visible. Tap → chat, prefilled about the event. */}
        {nextLifeEvent && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <LifeEventCard
              event={nextLifeEvent}
              todayISO={getEffectiveDate(new Date(), dayBoundaryHour)}
              onPress={() => {
                haptics.tap();
                router.push({
                  pathname: '/(tabs)/chat',
                  params: {
                    prefill: `"${nextLifeEvent.title}" için planım nasıl gidiyor?`,
                    taskNonce: String(Date.now()),
                  },
                });
              }}
            />
          </View>
        )}

        {/* 2. Quick Stats: Su + Adım / Uyku + Kilo (2x2) */}
        <View style={{ marginTop: SPACING.md }}>
          <StatStrip
            waterLiters={waterLiters}
            waterTarget={waterTarget}
            steps={steps}
            sleepHours={sleepHours}
            weightKg={weightKg}
            lastKnownWeightKg={Number.isFinite(Number(profile?.weight_kg)) ? Number(profile?.weight_kg) : null}
            onAddWater={handleAddWater}
            onWaterLongPress={() => { haptics.tap(); setWaterMenu(true); }}
            // ux-defect pass: bespoke tartı modalı silindi — log.tsx'teki üstün akış tek sahip
            // (stepper, ön-doğrulama, son-kilo prefill). Uyku hücresi de artık ölü değil.
            onWeightPress={() => { haptics.tap(); router.push('/log?to=weight'); }}
            onSleepPress={() => { haptics.tap(); router.push('/log?to=sleep'); }}
            onStepsPress={() => { haptics.tap(); router.push('/log?to=steps'); }}
          />
        </View>

        {/* 3. Weekly Budget Bar — ux-defect pass: ilk kayıttan önce '0 / 17.045' gibi dev ve
            anlamsız sayılar basıyordu; hafta içinde tüketim başlayınca görünür. */}
        {weeklyBudgetTotal > 0 && weeklyConsumed > 0 && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              padding: SPACING.lg, borderWidth: 0.5, borderColor: colors.border,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Haftalık bütçe
                </Text>
                <Text style={{ color: weeklyOver ? colors.warning : colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>
                  {weeklyOver
                    ? `${Math.abs(weeklyRemaining).toLocaleString('tr-TR')} fazla`
                    : `${weeklyRemaining.toLocaleString('tr-TR')} kaldı`}
                </Text>
              </View>
              {/* ux-defect pass: '122 / 17.045 kcal' satırı düştü — dört sayılı kart sayı
                  bombardımanıydı; oranı bar taşıyor (a11y etiketi tam değerleri korur),
                  eylenebilir bilgi aşağıdaki günlük tempo satırı. */}
              {/* FIX (ux-round2 #7): actionable daily pace from the weekly remaining. */}
              {weeklyRemaining > 0 && daysLeftInWeek > 0 && (
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
                  Kalan {daysLeftInWeek} gün · günde ~{dailyPace.toLocaleString('tr-TR')} kcal
                </Text>
              )}
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`Haftalık bütçe: ${weeklyConsumed.toLocaleString('tr-TR')} / ${weeklyBudgetTotal.toLocaleString('tr-TR')} kilokalori`}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(weeklyPct * 100) }}
                style={{ height: 8, backgroundColor: colors.progressTrack, borderRadius: 4, overflow: 'hidden' }}
              >
                <View style={{
                  height: '100%', width: `${weeklyPct * 100}%`,
                  backgroundColor: weeklyOver ? colors.warning : colors.primary, borderRadius: 4,
                }} />
              </View>
            </View>
          </View>
        )}

        {/* FIX (ux-ideas #1): today's plan + what-you-logged now sit ABOVE the profile
            completion donut. The donut is an onboarding artefact that hides itself at 100%;
            the most actionable content ("bugün ne yapmalıyım / ne logladım") shouldn't be
            buried beneath it for active, returning users. */}
        {/* Plan overview cards (Phase 4) — replaces the old diet/workout tab selector */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>
          <PlanOverviewCards userId={user?.id} dayBoundaryHour={dayBoundaryHour} />
        </View>

        {/* Activity Timeline (meals + workouts logged today) */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>
          <ActivityTimeline
            meals={meals}
            workouts={workouts}
            onDeleteMeal={deleteMeal}
            onDeleteWorkout={deleteWorkout}
            // ux-defect pass (B1): yepyeni kullanıcı aynı iki CTA'yı ÜÇ kartta görüyordu
            // (hero satırı + hoş-geldin kartı + bu boş-durum) — hoş-geldin görünürken teki yeter.
            hideEmptyCta={isBrandNew === true}
          />
        </View>

        {/* Profile completion donut (Phase 4) — self-hides at 100%. ux-defect pass: sarmalayıcı
            View kaldırıldı — donut %100'de null dönerken marginTop'lu sarmalayıcı ekranın dibinde
            ölü boşluk bırakıyordu; boşluklar artık komponentin kendi kökünde. */}
        <ProfileCompletionDonut profile={profile as Record<string, unknown> | null} />
        </>
        )}

      </ScrollView>
    </View>
  );
}
