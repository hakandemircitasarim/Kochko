/**
 * Ana Sayfa (Dashboard) — Bilgi odakli, flat dark design
 * Kalori halkasi, hizli istatistikler, haftalik butce, diyet/spor planlari
 */
import { useEffect, useCallback, useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert, TextInput, Modal } from 'react-native';
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
import { getEffectiveDate } from '@/lib/day-boundary';
import { deriveNutritionTargets } from '@/lib/nutrition-targets';
// FIX (ux-pass2 #4c): tek "güncel kilo" yazım yolu — daily_metrics + profiles birlikte.
import { updateCurrentWeight } from '@/services/weight.service';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS, FONT, WATER_INCREMENT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { setupAutoSync } from '@/services/offline-queue.service';
import { getUnreadCoachingMessages, markMessageRead, type CoachingMessage } from '@/services/coaching-messages.service';
import { detectReturnLevel, type ReturnStatus } from '@/services/return-flow.service';
import { syncStepsToDailyMetrics } from '@/services/health-connect.service';
import { CoachingNudge } from '@/components/dashboard/CoachingNudge';
// FIX (audit: üç offline banner) ui/OfflineBanner inline render kaldırıldı —
// global common/OfflineBanner (app/_layout.tsx) tek kaynak.
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { usePremium } from '@/hooks/usePremium';
import { checkAndScheduleTrialReminder } from '@/services/notifications.service';

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
    loading, fetchError, lastFetchedAt, fetchToday, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, newAchievement, checkForMilestones } = useStreak();
  // FIX (audit: deneme geri-sayımı dashboard) trial state'i dashboard'da yüzeye çıkar
  const { isInTrial, trialDaysLeft } = usePremium();
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  // Distinguishes "never fetched this session" from "fetched, genuinely empty day"
  // so the very first cold load can show skeletons instead of a zeroed scaffold
  // that reads like a real (and alarming) empty day.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  // FIX (ux-pass5): tartı yazımı sürerken Kaydet ölü görünüyor, yeniden dokunuşlar
  // eşzamanlı duplike yazım tetikliyordu — in-flight durumu (log.tsx loading deseni).
  const [weightSaving, setWeightSaving] = useState(false);
  const [coachingMessages, setCoachingMessages] = useState<CoachingMessage[]>([]);
  const [returnStatus, setReturnStatus] = useState<ReturnStatus | null>(null);
  // FIX (ux-pass5): önceki veri varken başarısız pull-to-refresh tamamen sessizdi
  // (fetchToday reddetmez, fetchError yalnız lastFetchedAt==null'da tüketiliyordu) —
  // spinner normal bitip bayat sayılar kalıyordu. Hafif, geçici bir uyarı şeridi.
  const [refreshFailedToast, setRefreshFailedToast] = useState(false);
  const refreshToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshToastTimer.current) clearTimeout(refreshToastTimer.current); }, []);

  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
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

  // Mount-only setup that shouldn't re-run on every focus.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    detectReturnLevel(user.id).then((status) => { if (!cancelled) setReturnStatus(status); }).catch(() => {});
    syncStepsToDailyMetrics(user.id, dayBoundaryHour).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, dayBoundaryHour]);

  // useFocusEffect runs on first focus too, so it doubles as initial load.
  // Previously a hasMounted ref skipped the first run to avoid a duplicate
  // fetch against a parallel useEffect — now only this effect fetches, so no
  // ref gymnastics are needed.
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

  // Celebrate a freshly-unlocked milestone with a success haptic (the toast is rendered below).
  useEffect(() => {
    if (newAchievement) haptics.success();
  }, [newAchievement]);

  const handleAddWater = () => {
    if (!user?.id) return;
    const saveWater = async () => {
      try {
        await addWater(user.id, WATER_INCREMENT, dayBoundaryHour);
        haptics.success();
      } catch (err) {
        console.warn('addWater failed:', err);
        haptics.error();
        Alert.alert('Hata', 'Su kaydedilemedi. Lütfen tekrar deneyin.');
      }
    };
    const newTotal = waterLiters + WATER_INCREMENT;
    const warning = checkSuspiciousInput('water', newTotal);
    if (warning) {
      Alert.alert('Doğrulama', warning, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet', onPress: saveWater },
      ]);
    } else {
      saveWater();
    }
  };

  // FIX (ux-pass2 #4a/#4b): modal artık Kilo kartından açılır ve son bilinen kiloyla
  // önceden doldurulur (73.5 placeholder'ı yerine) — kullanıcı çoğu zaman tek haneyi düzeltir.
  const openWeightModal = () => {
    haptics.tap();
    const known = weightKg ?? (profile?.weight_kg != null ? Number(profile.weight_kg) : null);
    setWeightInput(known != null ? String(known) : '');
    setShowWeightInput(true);
  };

  const handleWeightSave = async () => {
    // FIX (ux-pass5): yazım sürerken ikinci tetikleme (buton veya klavye done) yutulur.
    if (weightSaving) return;
    const w = parseFloat(weightInput.replace(',', '.'));
    if (!user?.id) return;
    // FIX (ux-pass5): geçersiz girişte sessiz return Kaydet'i ölü buton gibi gösteriyordu —
    // log.tsx tartı akışıyla aynı geribildirim (haptics.error + Geçersiz kilo alert'i).
    if (!w || w < 20 || w > 300) { haptics.error(); return Alert.alert('Geçersiz kilo', '20–300 kg arası bir değer gir.'); }
    setWeightSaving(true);
    try {
      // FIX (ux-pass2 #4c): canlı bug — Tartı yalnız daily_metrics'e yazınca Profil 80,
      // dashboard 79.5 gösteriyordu. updateCurrentWeight iki tabloyu birlikte günceller.
      await updateCurrentWeight(user.id, w, dayBoundaryHour);
      haptics.success();
      setShowWeightInput(false);
      setWeightInput('');
      refresh({ force: true });
    } catch (err) {
      console.warn('weight save failed:', err);
      haptics.error();
      Alert.alert('Hata', 'Tartı kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setWeightSaving(false);
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
  const weeklyPct = weeklyBudgetTotal > 0 ? Math.min(1, weeklyConsumed / weeklyBudgetTotal) : 0;

  // Show skeleton placeholders only on the very first cold fetch of the session
  // so a real-but-empty day reads as itself instead of a zeroed scaffold flashing
  // like data loss. Pull-to-refresh (hasLoadedOnce=true) keeps the live content.
  const firstLoad = loading && !hasLoadedOnce;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="light" />

      {/* Weight Modal */}
      <Modal visible={showWeightInput} transparent animationType="fade" onRequestClose={() => setShowWeightInput(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1} onPress={() => setShowWeightInput(false)}
          // FIX (ux-pass5): backdrop dokunulabiliri accessible varsayılanıyla modalın
          // input/butonlarını tek a11y düğümüne düzleştiriyordu — ekran okuyucu için
          // kapsayıcı olmaktan çıkar, içerik ayrı ayrı odaklanır.
          accessible={false}
        >
          <View
            // FIX (ux-pass5): kart gövdesine (başlık, 'kg', padding) dokunuş backdrop'a
            // kabarcıklanıp modalı sessizce kapatıyor, yazılan değer kayboluyordu — kart
            // dokunuşu kendinde tutar (responder), yalnız kart DIŞI backdrop'u tetikler.
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
              width: '80%', alignItems: 'center', borderWidth: 0.5, borderColor: colors.border,
            }}>
            <View style={{
              width: 48, height: 48, borderRadius: RADIUS.sm,
              backgroundColor: METRIC_COLORS.weight + '18',
              alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
            }}>
              <Ionicons name="scale" size={24} color={METRIC_COLORS.weight} />
            </View>
            <Text
              accessibilityRole="header"
              style={{ fontSize: FONT.lg, fontWeight: '600', color: colors.text, marginBottom: SPACING.md }}
            >
              Tartı Kaydı
            </Text>
            <TextInput
              style={{
                backgroundColor: colors.inputBg, borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md,
                color: colors.text, fontSize: FONT.xxl, fontWeight: '700',
                textAlign: 'center', width: '100%', borderWidth: 0.5, borderColor: colors.border,
              }}
              placeholder="73.5"
              placeholderTextColor={colors.textMuted}
              value={weightInput}
              onChangeText={setWeightInput}
              keyboardType="decimal-pad"
              accessibilityLabel="Kilo (kg)"
              returnKeyType="done"
              onSubmitEditing={handleWeightSave}
              autoFocus
            />
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>kg</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md, width: '100%' }}>
              <TouchableOpacity
                onPress={() => { haptics.tap(); setShowWeightInput(false); }}
                accessibilityRole="button"
                accessibilityLabel="İptal"
                style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleWeightSave}
                // FIX (ux-pass5): yazım sürerken devre dışı + 'Kaydediliyor...' (log.tsx deseni).
                disabled={weightSaving}
                accessibilityRole="button"
                accessibilityLabel="Tartıyı kaydet"
                style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center', opacity: weightSaving ? 0.5 : 1 }}
              >
                <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>{weightSaving ? 'Kaydediliyor...' : 'Kaydet'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* FIX (completeness audit): the goal/milestone celebration ('HEDEFE ULAŞTIN!') was computed
          by useStreak but no screen consumed newAchievement, so the in-the-moment congrats never
          showed. Render it as a floating toast over the dashboard; the hook auto-clears it after 5s. */}
      {newAchievement && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: insets.top + SPACING.sm, left: SPACING.md, right: SPACING.md, zIndex: 50, alignItems: 'center' }}
        >
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
            backgroundColor: colors.primary, borderRadius: RADIUS.md,
            paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg,
            // FIX (ux-pass5): uygulamadaki TEK drop shadow buradaydı — tasarım sistemi gölgesiz
            // (theme.ts 'no shadows', CARD_SHADOW deprecated). Gölge kaldırıldı; kenar tanımı
            // kardeş kartlardaki 0.5 hairline border ile.
            borderWidth: 0.5, borderColor: colors.border,
            maxWidth: '100%',
          }}>
            <Ionicons name="trophy" size={20} color={getContrastColor(colors.primary)} />
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700', flexShrink: 1 }}>
              {newAchievement}
            </Text>
          </View>
        </View>
      )}

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

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={onPullRefresh} tintColor={colors.primary} />}
      >
        {/* Welcome back / re-onboarding banner (Spec 10.6) */}
        {returnStatus && returnStatus.level !== 'active' && (
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
              {returnStatus.welcomeMessage}
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
              onPress={() => { haptics.tap(); setReturnStatus(null); }}
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
        {isInTrial && trialDaysLeft <= 3 && !trialBannerDismissed && (
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
              padding: SPACING.md, marginTop: returnStatus && returnStatus.level !== 'active' ? 0 : insets.top, marginBottom: SPACING.md,
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
              onPress={() => { haptics.tap(); setTrialBannerDismissed(true); }}
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
             gün yerine kompakt hata kartı + tekrar dene (progress.tsx kalıbı). */
          <View style={{
            marginTop: insets.top + SPACING.xxl, marginHorizontal: SPACING.xl,
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            borderWidth: 0.5, borderColor: colors.border,
            padding: SPACING.xxl, alignItems: 'center',
          }}>
            <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginTop: SPACING.md }}>
              Veriler yüklenemedi
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, textAlign: 'center' }}>
              Bağlantını kontrol edip tekrar dene.
            </Text>
            <TouchableOpacity
              onPress={() => refresh({ force: true })}
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              style={{ marginTop: SPACING.lg, backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm }}
            >
              <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>Tekrar dene</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <>
        {/* 1. Hero: Greeting + Calorie Ring + Macros */}
        <HeroSection
          // FIX (ux-pass2 #12): başlık tarihi de veriyle aynı efektif-gün mantığını kullanır —
          // gece 00:00-04:00 arasında günlük hâlâ "bugün"ü sayarken başlık yarını gösteremez.
          today={new Date(`${getEffectiveDate(new Date(), dayBoundaryHour)}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
          streak={streak}
          focusMessage={focusMessage}
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

        {/* 1.5 Coaching Nudges — ONLY the newest one. The emulator pass showed 3 stacked nudge
            cards ("sessizsin" + "tartıya çıkmadın" + "günaydın") on one open: notification spam
            that buries the dashboard. Older unread nudges surface one-at-a-time as each is
            dismissed. */}
        {coachingMessages.length > 0 && (
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
                // FIX (ux-pass2 #5): prefill=msg.content KOÇUN kendi metnini KULLANICININ
                // composer'ına koyuyordu — parametresiz aç, kullanıcı kendi cevabını yazsın.
                router.push('/(tabs)/chat' as never);
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
            onWeightPress={openWeightModal}
          />
        </View>

        {/* 3. Weekly Budget Bar */}
        {weeklyBudgetTotal > 0 && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              padding: SPACING.lg, borderWidth: 0.5, borderColor: colors.border,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Haftalık bütçe
                </Text>
                <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>
                  {weeklyRemaining.toLocaleString('tr-TR')} kaldı
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
                {weeklyConsumed.toLocaleString('tr-TR')} / {weeklyBudgetTotal.toLocaleString('tr-TR')} kcal
              </Text>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`Haftalık bütçe: ${weeklyConsumed.toLocaleString('tr-TR')} / ${weeklyBudgetTotal.toLocaleString('tr-TR')} kilokalori`}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(weeklyPct * 100) }}
                style={{ height: 8, backgroundColor: colors.progressTrack, borderRadius: 4, overflow: 'hidden' }}
              >
                <View style={{
                  height: '100%', width: `${weeklyPct * 100}%`,
                  backgroundColor: colors.primary, borderRadius: 4,
                }} />
              </View>
            </View>
          </View>
        )}

        {/* 4. Profile completion donut (Phase 4) */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>
          <ProfileCompletionDonut profile={profile as Record<string, unknown> | null} />
        </View>

        {/* 5. Plan overview cards (Phase 4) — replaces the old diet/workout tab selector */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
          <PlanOverviewCards userId={user?.id} dayBoundaryHour={dayBoundaryHour} />
        </View>

        {/* Activity Timeline (meals + workouts logged today) */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>
          <ActivityTimeline
            meals={meals}
            workouts={workouts}
            onDeleteMeal={deleteMeal}
            onDeleteWorkout={deleteWorkout}
          />
        </View>
        </>
        )}

      </ScrollView>
    </View>
  );
}
