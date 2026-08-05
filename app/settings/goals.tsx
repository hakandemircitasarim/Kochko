import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { validateWeeklyRate, calculateTargets } from '@/lib/tdee';
import { calculateGoalProgress, getGoalSummaryText, validateGoalSafety } from '@/lib/goal-progress';
import {
  getGoalPhases, addPhase, getAIGoalSuggestions, checkGoalCompatibility,
  checkAggressiveGoal,
  type GoalSuggestion, type GoalPhase,
} from '@/services/goals.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { TempoChart } from '@/components/plan/TempoChart';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { GOAL_LABELS_TR, goalLabelTR } from '@/lib/labels';
import type { Goal } from '@/types/database';
import { formatDecimal } from '@/lib/units';

type GoalType = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'health' | 'maintain' | 'conditioning';

export default function GoalsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [goalType, setGoalType] = useState<GoalType>('lose_weight');
  const [targetWeight, setTargetWeight] = useState('');
  const [targetWeeks, setTargetWeeks] = useState('12');
  const [saving, setSaving] = useState(false);
  const [existingGoal, setExistingGoal] = useState<Goal | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<GoalSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [compatWarning, setCompatWarning] = useState<string | null>(null);
  const [phaseTransitionInfo, setPhaseTransitionInfo] = useState<string | null>(null);
  const [allPhases, setAllPhases] = useState<GoalPhase[]>([]);
  const [aggressiveWarning, setAggressiveWarning] = useState<string | null>(null);
  const [tempoData, setTempoData] = useState<{ points: { date: string; kg: number }[]; startWeight: number; goalStartDate: string } | null>(null);

  // ux-sweep (GO-01): fetch'in yükleme/hata durumu yoktu — ağ hatasında ekran 'hedefin yok'
  // varsayılan haliyle açılıp kullanıcıyı YENİ hedef yazmaya itiyordu (mevcut hedefin üstüne).
  const [goalLoadError, setGoalLoadError] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    setGoalLoadError(false);
    getGoalPhases(user.id).catch(() => { setGoalLoadError(true); return [] as Awaited<ReturnType<typeof getGoalPhases>>; }).then(async phases => {
      setAllPhases(phases);
      const active = phases.find(p => p.is_active);
      if (active) {
        setExistingGoal(active as unknown as Goal);
        setGoalType(active.goal_type as GoalType);
        setTargetWeight(active.target_weight_kg != null ? formatDecimal(active.target_weight_kg as number) : '');
        setTargetWeeks(String(active.target_weeks ?? 12));

        // Load tempo data: weight points since goal creation
        const goalStartDate = (active as unknown as { created_at: string; start_weight_kg: number | null }).created_at.split('T')[0];
        const { data: weights } = await supabase
          .from('daily_metrics')
          .select('date, weight_kg')
          .eq('user_id', user.id)
          .not('weight_kg', 'is', null)
          .gte('date', goalStartDate)
          .order('date');
        const startWeight = (active as unknown as { start_weight_kg: number | null }).start_weight_kg ?? (weights?.[0]?.weight_kg as number) ?? (profile?.weight_kg ?? 70);
        const points = (weights ?? []).map((w: { date: string; weight_kg: number }) => ({ date: w.date, kg: w.weight_kg }));
        setTempoData({ points, startWeight, goalStartDate });
      }
    });
  }, [user?.id]);

  // D19: Check goal compatibility when type changes
  useEffect(() => {
    if (existingGoal && goalType !== existingGoal.goal_type) {
      const compat = checkGoalCompatibility(goalType, existingGoal.goal_type as string);
      if (!compat.compatible || compat.level === 'warning') {
        setCompatWarning(compat.message_tr);
      } else {
        setCompatWarning(null);
      }

      // Burada bir zamanlar "7 gün içinde kademeli olarak X kcal'den Y kcal'e geçilecek"
      // yazıyordu. İKİ AYRI yanlış vardı:
      //  (1) Kademeli geçiş bu yolda HİÇ çalışmıyordu. Rampayı yürüten kod (ai-plan) tamamen
      //      `profiles.phase_transition_start_date` dolu olmasına bağlı; o sütunu yazan TEK
      //      yer ai-proactive'in faz OTOMATİK-İLERLEME dalı. Ayarlardan hedef türü değiştirmek
      //      o dala hiç uğramıyor — kaydettiğin anda bant yeni değere SIÇRIYOR.
      //  (2) Gösterilen sayılar da uydurmaydı: tdee×0.8 gibi kaba tahminlerdi, oysa kaydederken
      //      yazılan gerçek bant calculateTargets'tan (zaman-çizelgesi duyarlı) geliyor —
      //      tipik olarak 100-300 kcal farklıydı. Yani kullanıcıya hiç görmeyeceği sayılar
      //      vaat ediliyordu.
      // Kademeli geçiş faz otomatik-ilerlemesinde gerçekten çalışıyor; burada olan bu değil.
      // Kart artık olanı söylüyor, sayı vermiyor (gerçek bant kaydedildiğinde hesaplanır).
      if (profile?.calorie_range_rest_min && profile?.calorie_range_rest_max) {
        setPhaseTransitionInfo(
          'Hedef türünü değiştiriyorsun: kaydettiğinde kalori ve makro hedeflerin yeni hedefe göre yeniden hesaplanır ve hemen geçerli olur.'
        );
      }
    } else {
      setCompatWarning(null);
      setPhaseTransitionInfo(null);
    }
  }, [goalType, existingGoal, profile]);

  // D18: Fetch AI goal suggestions
  const handleFetchAISuggestions = async () => {
    if (!user?.id) return;
    setLoadingSuggestions(true);
    const suggestions = await getAIGoalSuggestions(
      user.id,
      (profile?.weight_kg as number) ?? null,
      existingGoal?.target_weight_kg ?? null,
    );
    setAiSuggestions(suggestions);
    setLoadingSuggestions(false);
    // FIX (ux-pass5): boş öneri listesi meşru bir sonuç (su/uyku iyi + hedefe uzak) ama ekranda
    // HİÇBİR ŞEY değişmiyordu — spinner bitiyor, buton "bozuk" gibi okunuyordu. Söyle.
    if (suggestions.length === 0) {
      Alert.alert('Öneri yok', 'Şu an için yeni bir hedef önerim yok — su, uyku ve kilo verilerin bir hedef değişikliği gerektirmiyor.');
    }
  };

  // FIX (audit UX-FRM-02): decimal-pad tr-TR Android'de virgül üretir ('70,5'); çıplak
  // parseFloat virgülde kesip 70 döndürür. Tek noktada normalize + makul aralık (30-300 kg)
  // koruması; aynı değer tempo gösterimi, agresif kontrol ve handleSave'de tekrar kullanılır.
  const parsedTargetWeight = (() => {
    const n = parseFloat(targetWeight.replace(',', '.'));
    return Number.isFinite(n) && n >= 30 && n <= 300 ? n : null;
  })();

  // Safety check for weekly rate
  const weeklyRate = parsedTargetWeight && profile?.weight_kg
    ? Math.abs((profile.weight_kg as number) - parsedTargetWeight) / (parseInt(targetWeeks) || 12)
    : 0;
  const safety = validateGoalSafety(goalType, weeklyRate, profile?.weight_kg as number ?? 70, profile?.height_cm as number | null);

  // Progress for existing goal
  const progress = existingGoal && profile?.weight_kg
    ? calculateGoalProgress(existingGoal, profile.weight_kg as number, existingGoal.start_weight_kg ?? (profile.weight_kg as number))
    : null;
  const summaryText = progress ? getGoalSummaryText(progress, goalType) : null;

  // Check aggressive goal rate when target weight or weeks change
  useEffect(() => {
    // FIX (audit UX-FRM-02): virgül-normalize edilmiş tek değeri kullan (çıplak parseFloat değil).
    const tw = parsedTargetWeight;
    const weeks = parseInt(targetWeeks) || 12;
    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const rate = Math.abs((profile.weight_kg as number) - tw) / weeks;
      const aggressive = checkAggressiveGoal(rate, profile.weight_kg as number, profile?.gender as string ?? null);
      setAggressiveWarning(aggressive.warning);
    } else {
      setAggressiveWarning(null);
    }
  }, [parsedTargetWeight, targetWeeks, goalType, profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    // FIX (audit UX-FRM-02): virgül-normalize + aralık-korumalı tek değer; validateWeeklyRate
    // ve addPhase artık bozuk sayı yerine doğru kiloyu (ya da geçersizse null) alır.
    const tw = parsedTargetWeight;
    const weeks = parseInt(targetWeeks) || 12;

    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const check = validateWeeklyRate(profile.weight_kg, tw, weeks);
      if (!check.valid) { Alert.alert('Dikkat', check.message); return; }
    }

    // Check compatibility with existing active goals
    if (existingGoal && goalType !== existingGoal.goal_type) {
      const compat = checkGoalCompatibility(goalType, existingGoal.goal_type as string);
      if (!compat.compatible) {
        Alert.alert('Hedef Çelişkisi', compat.message_tr);
        return;
      }
    }

    setSaving(true);
    // FIX (audit settings-save-guards): iki ardışık await try/catch'siz çalışıyordu —
    // biri throw ederse setSaving(false) hiç çalışmaz, Button kalıcı spinner'da kilitlenir
    // ve kullanıcıya hata gösterilmezdi. finally + Türkçe hata Alert ekle.
    // FIX (ux-pass5): supabase-js reddetmez, {error} ile RESOLVE eder — üç yazma da (deactivate,
    // addPhase insert, kalori bandı) hatasını yutuyordu; her şey başarısızken bile "Hedef
    // kaydedildi" + router.back() çalışıyordu. Artık her yazmanın error'u kontrol edilip throw
    // ediliyor; deactivate başarılı olup insert patlarsa kullanıcı SIFIR aktif hedefle
    // kalmasın diye önceki hedef best-effort geri açılıyor (stage takibi).
    let stage: 'deactivate' | 'insert' | 'band' = 'deactivate';
    try {
      // Deactivate existing active goals before creating new phase
      const { error: deactivateError } = await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
      if (deactivateError) throw deactivateError;
      stage = 'insert';
      // Bilinçli lokal: bu, ekrana çizilen bir etiket değil, goals.phase_label olarak
      // KALICI yazılan faz adı — labels.ts'in dar-segment kısaltmasından ('Kas') bilinçli
      // olarak daha dolu bir ad ('Kas Geliştirme') kullanır.
      const phaseLabel = goalType === 'lose_weight' ? 'Yağ Yakımı'
        : goalType === 'gain_weight' ? 'Kilo Alma'
        : goalType === 'gain_muscle' ? 'Kas Geliştirme'
        : goalType === 'maintain' ? 'Koruma'
        : goalType === 'conditioning' ? 'Kondisyon'
        : 'Sağlık';
      // Single-goal "replace" intent: the deactivate above cleared the old active
      // goal, so this new one must be active (else the user is left with ZERO active
      // goals and the dashboard / plan-gen / streak / progress all read nothing).
      await addPhase(user.id, goalType, tw || null, weeks, phaseLabel, true); // throws on insert error (ux-pass5)
      stage = 'band';

      // #journey MEDIUM: editing the goal/timeline must RE-CUT the actual calorie band, not just
      // the displayed ETA. Recompute timeline-aware targets and persist so the plan the user eats
      // from matches the deadline they just set.
      const tdeeVal = (profile as unknown as { tdee_calculated?: number | null })?.tdee_calculated ?? null;
      if (tdeeVal && profile?.weight_kg) {
        const t = calculateTargets({
          tdee: tdeeVal,
          goalType: goalType as 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'maintain' | 'health' | 'conditioning',
          restrictionMode: 'sustainable',
          weeksSinceStart: 0, complianceAvg: 0,
          weightKg: profile.weight_kg as number,
          gender: (profile as unknown as { gender?: 'male' | 'female' | 'other' })?.gender,
          macroPct: { protein: 30, carb: 40, fat: 30 },
          targetWeightKg: tw || null,
          targetWeeks: weeks,
        });
        // FIX (ux-pass5): kalori bandı yazması da hatasını yutuyordu — kontrol et.
        const { error: bandError } = await supabase.from('profiles').update({
          calorie_range_training_min: t.trainingDay.min,
          calorie_range_training_max: t.trainingDay.max,
          calorie_range_rest_min: t.restDay.min,
          calorie_range_rest_max: t.restDay.max,
          weekly_calorie_budget: t.weeklyBudget,
        }).eq('id', user.id);
        if (bandError) throw bandError;
      }
      haptics.success();
      Alert.alert('Başarılı', 'Hedef kaydedildi.', [{ text: 'Tamam', onPress: () => router.back() }]);
    } catch (e) {
      haptics.error();
      console.warn('[goals] save failed at stage', stage, e);
      // FIX (ux-pass5): aşamaya göre dürüst hata mesajı; insert aşamasında patladıysa
      // deactivate çoktan geçti demektir → önceki hedefi geri açmayı dene ki kullanıcı
      // sıfır aktif hedefle (boş dashboard/plan) kalmasın.
      if (stage === 'insert' && existingGoal?.id) {
        const { error: reactivateError } = await supabase.from('goals').update({ is_active: true }).eq('id', existingGoal.id);
        Alert.alert('Kaydedilemedi', !reactivateError
          ? 'Yeni hedef kaydedilemedi; önceki hedefin geri açıldı. Lütfen tekrar dene.'
          : 'Hedef kaydedilemedi ve önceki hedefin geri açılamadı. Bağlantını kontrol edip hedefini yeniden kaydet.');
      } else if (stage === 'band') {
        Alert.alert('Kısmen kaydedildi', 'Hedef oluşturuldu ama kalori hedefleri güncellenemedi. Lütfen tekrar "Kaydet"e bas.');
      } else {
        Alert.alert('Kaydedilemedi', 'Hedef kaydedilemedi, lütfen tekrar dene.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (goalLoadError) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md }}>
        <Card><LoadErrorState embedded title="Hedef bilgisi yüklenemedi" onRetry={() => { setGoalLoadError(false); if (user?.id) getGoalPhases(user.id).then(p => setAllPhases(p)).catch(() => setGoalLoadError(true)); }} /></Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* FIX (audit duplicate-title): native header (settings/_layout.tsx) zaten "Hedef Ayarları"
            başlığını gösteriyor; gövdedeki H1 çift başlıktı, kaldırıldı. */}

        {profile?.weight_kg && (
          <Text style={{ ...TYPE.title3, color: colors.primary, marginBottom: SPACING.md }}>Mevcut: {formatDecimal(profile.weight_kg as number)} kg</Text>
        )}

        {/* Existing goal progress */}
        {existingGoal && progress && (
          <Card style={{ marginBottom: SPACING.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
              <Text style={{ ...TYPE.headline, color: colors.text }}>Mevcut Hedef</Text>
              <Text style={{ ...TYPE.bodyStrong, fontWeight: '700', color: colors.primary }}>%{progress.percentComplete}</Text>
            </View>
            <View style={{ height: 8, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.full, overflow: 'hidden', marginBottom: SPACING.sm }}>
              <View style={{ height: '100%', width: `${progress.percentComplete}%`, backgroundColor: colors.primary, borderRadius: RADIUS.full }} />
            </View>
            <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{summaryText}</Text>
            {progress.estimatedCompletionDate && (
              <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: SPACING.xs }}>
                Tahmini tamamlanma: {progress.estimatedCompletionDate}
              </Text>
            )}
          </Card>
        )}

        {/* Tempo chart — planned vs actual weight trajectory (Spec 6.3) */}
        {existingGoal?.target_weight_kg && tempoData && tempoData.points.length >= 1 && (
          <View style={{ marginBottom: SPACING.md }}>
            <TempoChart
              startWeight={tempoData.startWeight}
              targetWeight={existingGoal.target_weight_kg}
              targetWeeks={existingGoal.target_weeks ?? 12}
              actualPoints={tempoData.points}
              goalStartDate={tempoData.goalStartDate}
            />
          </View>
        )}

        {/* Phase timeline */}
        {allPhases.length > 1 && (
          <Card style={{ marginBottom: SPACING.md }}>
            <Text style={{ ...TYPE.overline, color: colors.textSecondary, marginBottom: SPACING.sm }}>FAZ PLANI</Text>
            {allPhases.map((phase, i) => (
              <View key={phase.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i < allPhases.length - 1 ? SPACING.sm : 0 }}>
                <View style={{
                  width: 24, height: 24, borderRadius: 12, marginRight: SPACING.sm,
                  backgroundColor: phase.is_active ? colors.primary : colors.surfaceLight,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ ...TYPE.caption, fontWeight: '700', color: phase.is_active ? getContrastColor(colors.primary) : colors.textMuted }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...TYPE.body, fontWeight: phase.is_active ? '600' : '400', color: phase.is_active ? colors.text : colors.textMuted }}>
                    {phase.phase_label ?? phase.goal_type}
                  </Text>
                  <Text style={{ ...TYPE.caption, color: colors.textMuted }}>{phase.target_weeks ?? '?'} hafta{phase.target_weight_kg ? ` - ${formatDecimal(phase.target_weight_kg)}kg` : ''}</Text>
                </View>
                {phase.is_active && <Text style={{ ...TYPE.overline, color: colors.primary }}>AKTİF</Text>}
              </View>
            ))}
          </Card>
        )}

        {/* Goal type selector */}
        {/* Hemen altindaki alanlarin etiketleri paylasilan Input'tan geliyor (TYPE.callout/w500);
            bu elle yazilmis etiket 13'te kalinca ayni formda iki farkli etiket spec'i olusuyordu. */}
        <Text style={{ ...TYPE.callout, color: colors.textSecondary, fontWeight: '500', marginBottom: SPACING.sm }}>Hedef Türü</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {(Object.keys(GOAL_LABELS_TR) as GoalType[]).map(g => (
            <Button key={g} title={GOAL_LABELS_TR[g]} variant={goalType === g ? 'primary' : 'outline'} size="sm" onPress={() => setGoalType(g)} />
          ))}
        </View>

        <Input label="Hedef Kilo (kg)" placeholder="70" value={targetWeight} onChangeText={setTargetWeight} keyboardType="decimal-pad" />
        <Input label="Hedef Süre (hafta)" placeholder="12" value={targetWeeks} onChangeText={setTargetWeeks} keyboardType="numeric" />

        {/* D19: Goal compatibility warning */}
        {compatWarning && (
          <View style={{ backgroundColor: colors.warning + '15', borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.warning }}>
            <Text style={{ color: colors.warning, ...TYPE.bodyStrong, marginBottom: 4 }}>Hedef Uyumsuzluğu</Text>
            <Text style={{ color: colors.text, ...TYPE.body }}>{compatWarning}</Text>
          </View>
        )}

        {/* D5: Phase transition info */}
        {phaseTransitionInfo && (
          <View style={{ backgroundColor: colors.primary + '10', borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.primary + '40' }}>
            <Text style={{ color: colors.primary, ...TYPE.bodyStrong, marginBottom: 4 }}>Kademeli Geçiş</Text>
            <Text style={{ color: colors.text, ...TYPE.body }}>{phaseTransitionInfo}</Text>
          </View>
        )}

        {/* Aggressive rate warning from goals service */}
        {aggressiveWarning && (
          <View style={{ backgroundColor: colors.warning + '15', borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.warning }}>
            <Text style={{ color: colors.warning, ...TYPE.bodyStrong, marginBottom: 4 }}>Agresif Tempo</Text>
            <Text style={{ color: colors.text, ...TYPE.body }}>{aggressiveWarning}</Text>
          </View>
        )}

        {/* Safety warnings */}
        {!safety.safe && (
          <View style={{ marginBottom: SPACING.md }}>
            {safety.warnings.map((w, i) => (
              <Text key={i} style={{ ...TYPE.body, color: colors.error, marginBottom: SPACING.xs }}>{w}</Text>
            ))}
          </View>
        )}

        {/* Weekly rate display */}
        {weeklyRate > 0 && (
          <Text style={{ ...TYPE.caption, color: colors.textMuted, marginBottom: SPACING.md }}>
            {/* FIX (ux-pass5): TR virgül ondalık — aynı ekran virgüllü girdi kabul edip ('70,5')
                noktalı çıktı ('0.54') gösteriyordu. */}
            Haftalık tempo: {weeklyRate.toFixed(2).replace('.', ',')} kg/hafta
          </Text>
        )}

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" />

        {/* D18: AI Goal Suggestions */}
        <Button
          title={loadingSuggestions ? 'Yükleniyor...' : 'AI Hedef Önerisi Al'}
          variant="outline"
          onPress={handleFetchAISuggestions}
          style={{ marginTop: SPACING.md }}
          disabled={loadingSuggestions}
        />

        {/* AI Suggestion results */}
        {aiSuggestions.length > 0 && (
          <View style={{ marginTop: SPACING.md }}>
            <Text style={{ ...TYPE.overline, color: colors.textSecondary, marginBottom: SPACING.sm }}>AI ÖNERİLERİ</Text>
            {aiSuggestions.map((s, i) => (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={i}
                onPress={() => {
                  setGoalType(s.goalType as GoalType);
                  setAiSuggestions([]);
                }}
                style={{
                  backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
                  borderWidth: 1, borderColor: s.priority === 'high' ? colors.primary : colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ ...TYPE.headline, color: colors.text }}>
                    {goalLabelTR(s.goalType)}
                  </Text>
                  <View style={{
                    paddingVertical: 2, paddingHorizontal: 8, borderRadius: RADIUS.sm,
                    backgroundColor: s.priority === 'high' ? colors.primary + '20' : s.priority === 'medium' ? colors.warning + '20' : colors.surfaceLight,
                  }}>
                    <Text style={{
                      color: s.priority === 'high' ? colors.primary : s.priority === 'medium' ? colors.warning : colors.textMuted,
                      ...TYPE.caption, fontWeight: '600',
                    }}>
                      {s.priority === 'high' ? 'Yüksek' : s.priority === 'medium' ? 'Orta' : 'Düşük'}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{s.reasoning}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
