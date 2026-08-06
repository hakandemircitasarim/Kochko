/**
 * Meal Prep Plan Screen
 * Package 9: Displays generated meal prep plans with prep order, storage info, and timing.
 */
import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
import { generateMealPrepPlan, getMealPrepPrefs, setMealPrepPrefs, type MealPrepPlan } from '@/services/meal-prep.service';
import { getCurrentWeeklyPlan } from '@/services/weekly-plan.service';

const PREP_DAY_OPTIONS = [
  { value: 0, label: 'Paz' }, { value: 1, label: 'Pzt' }, { value: 2, label: 'Sal' },
  { value: 3, label: 'Çar' }, { value: 4, label: 'Per' }, { value: 5, label: 'Cum' }, { value: 6, label: 'Cmt' },
];

export default function MealPrepPlanScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  // FIX (audit UX-PRM-06): ekranın kendisi premium-koruması yapsın — menü ternary'sine güvenme
  // (deep link / chat navigate / deneme bitişi free kullanıcıyı içeride bırakıyordu).
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [plan, setPlan] = useState<MealPrepPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [active, setActive] = useState(false);
  const [prepDay, setPrepDay] = useState(0);

  // FIX (audit UX-PRM-06): profil çözüldükten sonra premium değilse paywall'a yönlendir
  // (profil null/yükleniyorken yönlendirme yok — geçici null premium kullanıcıyı atmasın).
  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  useEffect(() => {
    if (!user?.id) return;
    getMealPrepPrefs(user.id)
      .then(p => { setActive(p.active); setPrepDay(p.prepDays[0] ?? 0); })
      .finally(() => setPrefsLoaded(true));
  }, [user?.id]);

  const handleActivate = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { error: err } = await setMealPrepPrefs(user.id, true, [prepDay]);
    if (err) { setError('Tercihin kaydedilemedi, lütfen tekrar dene.'); haptics.error(); }
    else { setActive(true); setError(null); haptics.success(); }
    setLoading(false);
  };

  // Aktivasyon TEK YONLU bir kapiydi: handleActivate yalnizca `true` yaziyor ve aktif
  // olunca aktivasyon karti bir daha hic cizilmiyordu. Sonuc: kullanici toplu hazirligi
  // KAPATAMIYOR ve sectigi hazirlik gununu bir daha DEGISTIREMIYORDU — servis ikisini de
  // destekledigi halde. (setMealPrepPrefs zaten active=false aliyor.)
  const handleChangeDay = async (day: number) => {
    if (!user?.id) return;
    const prev = prepDay;
    setPrepDay(day);
    haptics.tap();
    const { error: err } = await setMealPrepPrefs(user.id, true, [day]);
    if (err) {
      setPrepDay(prev); // yazim basarisizsa secimi geri al — sessizce yalan soyleme
      setError('Hazırlık günü kaydedilemedi, tekrar dene.');
      haptics.error();
      return;
    }
    setError(null);
    // Hazirlik gunu planin uzerinde yaziyor; yeni gunle yeniden turet.
    if (plan) void handleGenerate();
  };

  const handleDeactivate = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { error: err } = await setMealPrepPrefs(user.id, false, [prepDay]);
    if (err) { setError('Kapatılamadı, tekrar dene.'); haptics.error(); }
    else { setActive(false); setPlan(null); setError(null); haptics.success(); }
    setLoading(false);
  };

  const handleGenerate = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const weeklyPlan = await getCurrentWeeklyPlan();
      if (!weeklyPlan) {
        setError('Önce haftalık menünü oluştur, sonra meal prep planı yapabiliriz.');
        haptics.error();
        return;
      }
      const result = await generateMealPrepPlan(user.id, weeklyPlan.id);
      if (!result) {
        setError('Bu haftanın menüsünde toplu hazırlamaya uygun yemek bulunamadı.');
        haptics.error();
        return;
      }
      setPlan(result);
      haptics.success();
    } catch {
      setError('Bir şeyler ters gitti, lütfen tekrar dene.');
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  // Plan yalnizca yerel state'te yasiyordu: ekrandan cikip donunce kayboluyor ve kullanici
  // her seferinde "Plan Olustur"a basiyordu. Uretim saf bir turetme (LLM yok, iki DB okumasi),
  // bu yuzden kalici depolama (= migration, kullanicinin alani) gerekmiyor: acilista uret.
  const autoGenRef = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || !active || plan || loading || autoGenRef.current) return;
    autoGenRef.current = true;
    void handleGenerate();
    // handleGenerate kasitli olarak deps disinda: bu yalnizca mount-ani bir yoklama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, active]);

  // FIX (audit UX-PRM-06): premium olmayan kullanıcıya içerik gösterme — yönlendirme efekti devredeyken boş ekran.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  // Activation gate: meal_prep_active was previously impossible to enable from
  // ANY screen (the feature was a permanent dead-end) — this is the toggle.
  if (prefsLoaded && !active) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
        {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
        <Card>
          <Text style={{ color: colors.textSecondary, ...TYPE.body, marginBottom: SPACING.md }}>
            Toplu hazırlık modunu aktif et ve hazırlık gününü seç — haftalık menünden otomatik prep planı çıkaralım.
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: SPACING.lg, flexWrap: 'wrap' }}>
            {PREP_DAY_OPTIONS.map(d => (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={d.value} onPress={() => { haptics.tap(); setPrepDay(d.value); }}
                accessibilityRole="button"
                accessibilityLabel={`Hazırlık günü: ${d.label}`}
                accessibilityState={{ selected: prepDay === d.value }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: 8, backgroundColor: prepDay === d.value ? colors.primary : colors.surfaceLight }}>
                <Text style={{ color: prepDay === d.value ? getContrastColor(colors.primary) : colors.textSecondary, ...TYPE.caption, fontWeight: '600' }}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {error && <Text style={{ color: colors.error, ...TYPE.body, marginBottom: SPACING.sm }}>{error}</Text>}
          <Button title="Meal Prep Modunu Aktif Et" onPress={handleActivate} loading={loading} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>
        Haftanın yemeklerini önceden hazırla, zamandan ve paradan tasarruf et.
      </Text>

      {/* Tercih seridi — aktivasyondan SONRA da erisilebilir olmasi gereken tek yer. */}
      <Card>
        <Text style={{ color: colors.textSecondary, ...TYPE.callout, fontWeight: '500', marginBottom: SPACING.sm }}>Hazırlık günü</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {PREP_DAY_OPTIONS.map(d => (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={d.value} onPress={() => handleChangeDay(d.value)}
              accessibilityRole="button"
              accessibilityLabel={`Hazırlık günü: ${d.label}`}
              accessibilityState={{ selected: prepDay === d.value }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: 8, backgroundColor: prepDay === d.value ? colors.primary : colors.surfaceLight }}>
              <Text style={{ color: prepDay === d.value ? getContrastColor(colors.primary) : colors.textSecondary, ...TYPE.caption, fontWeight: '600' }}>{d.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={handleDeactivate}
          accessibilityRole="button" accessibilityLabel="Toplu hazırlığı kapat"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ marginTop: SPACING.md, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.textMuted, ...TYPE.caption, fontWeight: '600' }}>Toplu hazırlığı kapat</Text>
        </TouchableOpacity>
      </Card>

      {!plan ? (
        <View style={{ alignItems: 'center', paddingVertical: SPACING.xl }}>
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <>
              {error && (
                <Text style={{ color: colors.error, ...TYPE.body, textAlign: 'center', marginBottom: SPACING.md }}>
                  {error}
                </Text>
              )}
              <Text style={{ color: colors.textMuted, ...TYPE.body, textAlign: 'center', marginBottom: SPACING.lg }}>
                Kayıtlı tariflerine ve haftalık planına göre bir meal prep planı oluşturalım.
              </Text>
              <Button title="Plan Oluştur" onPress={handleGenerate} />
            </>
          )}
        </View>
      ) : (
        <>
          {/* Total Prep Time */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Hazırlama</Text>
              <Text style={{ color: colors.primary, ...TYPE.title3 }}>{plan.totalPrepTime} dk</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xs }}>
              <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Pişirme</Text>
              <Text style={{ color: colors.primary, ...TYPE.title3 }}>{plan.totalCookTime} dk</Text>
            </View>
          </Card>

          {/* Prep Items */}
          <Text style={{ color: colors.textSecondary, ...TYPE.caption, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLANACAKLAR</Text>
          {plan.items.map((item, i) => (
            <Card key={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, ...TYPE.headline }}>{item.recipeName}</Text>
                  <Text style={{ color: colors.textMuted, ...TYPE.caption, marginTop: 2 }}>{item.quantity}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.success, ...TYPE.bodyStrong }}>{item.storageDays} gün</Text>
                </View>
              </View>
              <Text style={{ color: colors.textSecondary, ...TYPE.caption, marginTop: SPACING.xs }}>Saklama: {item.storageInstructions}</Text>
            </Card>
          ))}

          {/* Prep Order */}
          <Text style={{ color: colors.textSecondary, ...TYPE.caption, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLAMA SIRASI</Text>
          <Card>
            {plan.prepOrder.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: i < plan.prepOrder.length - 1 ? SPACING.sm : 0, alignItems: 'flex-start' }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: getContrastColor(colors.primary), ...TYPE.caption, fontWeight: '700' }}>{step.order}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, ...TYPE.body }}>{step.action}</Text>
                  <Text style={{ color: colors.textMuted, ...TYPE.caption }}>{step.durationMin} dk — {step.reason_tr}</Text>
                </View>
              </View>
            ))}
          </Card>

          {/* Regenerate */}
          <View style={{ marginTop: SPACING.md }}>
            <Button title="Yeni Plan Oluştur" onPress={handleGenerate} variant="outline" loading={loading} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
