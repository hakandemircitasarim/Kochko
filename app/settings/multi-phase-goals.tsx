/**
 * Multi-Phase Goal Planning Screen
 * Spec 6.7: Cut/bulk/maintain döngüsü
 */
import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getGoalPhases, addPhase, deletePhase, advanceToNextPhase, getTimelineData, type GoalPhase } from '@/services/goals.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PhaseTimeline } from '@/components/plan/PhaseTimeline';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { goalLabelTR } from '@/lib/labels';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { usePremium } from '@/hooks/usePremium';
import { useProfileStore } from '@/stores/profile.store';
import { formatDecimal } from '@/lib/units';

// FIX (tema): modül seviyesinde COLORS okumak koyu paleti her temaya donduruyordu —
// fabrika fonksiyonu + bileşen içinde useMemo ile aktif temadan çözülüyor.
const makePhaseLabels = (c: ThemeColors): Record<string, { label: string; color: string }> => ({
  cut: { label: 'Cut (Kilo Ver)', color: c.error },
  bulk: { label: 'Bulk (Kilo Al)', color: c.success },
  maintain: { label: 'Bakım', color: c.primary },
  mini_cut: { label: 'Mini Cut', color: c.warning },
  recomp: { label: 'Recomp', color: c.purple },
});

export default function MultiPhaseGoalsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  // FIX (audit UX-PRM-06): ekranın kendisi premium-koruması yapsın — menü ternary'sine güvenme
  // (deep link / chat navigate / deneme bitişi free kullanıcıyı içeride bırakıyordu).
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [phases, setPhases] = useState<GoalPhase[]>([]);
  const [timelineData, setTimelineData] = useState<{ phases: { id: string; label: string; goalType: string; targetWeeks: number; isActive: boolean; isCompleted: boolean }[]; currentWeek: number } | null>(null);
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar veri olan kullanıcıya boş ekran/yanlış durum gösterilmiyordu.
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newPhaseLabel, setNewPhaseLabel] = useState('cut');
  const [newTarget, setNewTarget] = useState('');
  const [newWeeks, setNewWeeks] = useState('12');

  const PHASE_LABELS = useMemo(() => makePhaseLabels(colors), [colors]);

  // FIX (audit UX-PRM-06): profil çözüldükten sonra premium değilse paywall'a yönlendir
  // (profil null/yükleniyorken yönlendirme yok — geçici null premium kullanıcıyı atmasın).
  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  useEffect(() => { if (user?.id) load(); }, [user?.id]);
  const load = async () => {
    if (!user?.id) return;
    try {
      const [p, t] = await Promise.all([getGoalPhases(user.id), getTimelineData(user.id)]);
      setPhases(p);
      setTimelineData(t);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!user?.id) return;
    const goalType = newPhaseLabel === 'cut' || newPhaseLabel === 'mini_cut' ? 'lose_weight' : newPhaseLabel === 'bulk' ? 'gain_weight' : 'maintain';
    try {
      // FIX (audit UX-FRM-03): virgül normalizasyonu — '77,5' tr-TR/Android'de sessizce 77'ye düşüyordu.
      await addPhase(user.id, goalType, newTarget ? parseFloat(newTarget.replace(',', '.')) : null, parseInt(newWeeks) || 12, newPhaseLabel);
    } catch (e) {
      // FIX (audit UX-FBK-05): async onPress'ten throw yakalanmamış reddetme olur, kullanıcıya mesaj çıkmazdı.
      haptics.error();
      Alert.alert('İşlem başarısız', 'Faz eklenemedi, tekrar dene.');
      return;
    }
    haptics.success();
    setShowAdd(false); setNewTarget(''); setNewWeeks('12');
    load();
  };

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Bu fazı silmek istediğine emin misin?', [
      { text: 'İptal' },
      // FIX (audit UX-FBK-04): silmeyi await + try/catch ile sar; başarıda haptics.success,
      // başarısızlıkta haptics.error + Alert — uygulamadaki tek geri-bildirimsiz silme idi.
      { text: 'Sil', style: 'destructive', onPress: async () => {
        try {
          await deletePhase(id);
        } catch {
          haptics.error();
          Alert.alert('Silinemedi', 'Faz silinemedi. Aktif bir faz olabilir veya bağlantı sorunu yaşanıyor olabilir, lütfen tekrar dene.');
          return;
        }
        haptics.success();
        await load();
      } },
    ]);
  };

  const handleAdvance = async () => {
    if (!user?.id) return;
    let next;
    try {
      next = await advanceToNextPhase(user.id);
    } catch (e) {
      // FIX (audit UX-FBK-05): async onPress'ten throw yakalanmamış reddetme olur, kullanıcıya mesaj çıkmazdı.
      haptics.error();
      Alert.alert('İşlem başarısız', 'Faza geçilemedi, tekrar dene.');
      return;
    }
    if (next) {
      haptics.success();
      Alert.alert('Faz Geçişi', `"${next.phase_label}" fazına geçildi.`);
      load();
    } else {
      haptics.success();
      Alert.alert('Bitti', 'Tüm fazlar tamamlandı!');
    }
  };

  const activePhase = phases.find(p => p.is_active);

  // FIX (audit UX-PRM-06): premium olmayan kullanıcıya içerik gösterme — yönlendirme efekti devredeyken boş ekran.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    // FIX (audit UI-LAY-04): KeyboardAvoidingView + keyboardShouldPersistTaps — 'Yeni Faz Ekle' formu en altta, klavye altında kalıyordu (lab-values.tsx kalıbı).
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* Native Stack header (settings/_layout.tsx) already shows the Turkish title "Çok Fazlı Hedef" — body heading removed to avoid double-title */}
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginBottom: SPACING.lg }}>
        Sıralı fazlar tanımla: örneğin "75 kg'a in (cut) → 3 ay bulk 80 kg → 77 kg'a in (mini cut)". Fazlar sırayla aktif olur.
      </Text>

      {/* FIX (audit UI-STA-03): ilk fetch sürerken boş ekran yerine yükleniyor göstergesi. */}
      {loading && (
        <View style={{ gap: SPACING.md, paddingTop: SPACING.md }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      )}

      {/* Horizontal timeline bar (Spec 6.7) */}
      {!loading && timelineData && timelineData.phases.length > 1 && (
        <View style={{ marginBottom: SPACING.md }}>
          <PhaseTimeline phases={timelineData.phases} currentWeek={timelineData.currentWeek} />
        </View>
      )}

      {/* Phase timeline */}
      {!loading && phases.length > 0 && (
        <Card title="Faz Zaman Çizelgesi">
          {phases.map((phase, i) => {
            // Cihazda görüldü: bu satır listede "lose_weight" yazıyordu. phase_label boşsa
            // geri düşüş ham DB enum'una gidiyordu; uygulamanın zaten güvenli bir çevirisi
            // var (labels.ts/goalLabelTR, bilinmeyen anahtarı da tolere eder).
            const info = PHASE_LABELS[phase.phase_label ?? ''] ?? { label: phase.phase_label ?? goalLabelTR(phase.goal_type), color: colors.textMuted };
            return (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={phase.id} onLongPress={() => handleDelete(phase.id)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: i < phases.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                {/* Phase indicator */}
                <View style={{ width: 24, alignItems: 'center', marginRight: SPACING.sm }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: phase.is_active ? info.color : colors.surfaceLight, borderWidth: phase.is_active ? 0 : 1, borderColor: colors.border }} />
                  {i < phases.length - 1 && <View style={{ width: 2, height: 20, backgroundColor: colors.border, marginTop: 2 }} />}
                </View>
                {/* Phase info */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                    <Text style={{ color: phase.is_active ? info.color : colors.text, ...TYPE.body, fontWeight: phase.is_active ? '700' : '400' }}>{info.label}</Text>
                    {phase.is_active && (
                      <View style={{ backgroundColor: info.color, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ ...TYPE.overline, color: getContrastColor(info.color) }}>AKTİF</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: colors.textMuted, ...TYPE.caption, marginTop: 1 }}>
                    {phase.target_weight_kg ? `Hedef: ${formatDecimal(phase.target_weight_kg)}kg` : 'Koru'} · {phase.target_weeks ?? '?'} hafta
                  </Text>
                </View>
                <Text style={{ color: colors.textMuted, ...TYPE.body, marginRight: SPACING.sm }}>#{phase.phase_order}</Text>
                {/* FIX (audit ui-destructive-delete): görünür/erişilebilir sil butonu; long-press kısayolu korundu. */}
                <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                  onPress={() => handleDelete(phase.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${info.label} fazını sil`}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={{ padding: SPACING.xs }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </Card>
      )}

      {/* Advance to next phase */}
      {activePhase && phases.length > 1 && (
        <Button title="Sonraki Faza Geç" variant="outline" onPress={handleAdvance} style={{ marginBottom: SPACING.md }} />
      )}

      {/* Add new phase */}
      <Button title={showAdd ? 'İptal' : 'Yeni Faz Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: colors.textSecondary, ...TYPE.body, marginBottom: SPACING.sm }}>Faz Tipi</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {Object.entries(PHASE_LABELS).map(([key, info]) => (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={key} onPress={() => { haptics.tap(); setNewPhaseLabel(key); }}
                style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
                  borderColor: newPhaseLabel === key ? info.color : colors.border,
                  backgroundColor: newPhaseLabel === key ? info.color : 'transparent' }}>
                <Text style={{ color: newPhaseLabel === key ? getContrastColor(info.color) : colors.textSecondary, ...TYPE.body }}>{info.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Hedef Kilo (opsiyonel)" placeholder="75" value={newTarget} onChangeText={setNewTarget} keyboardType="decimal-pad" />
          <Input label="Süre (hafta)" placeholder="12" value={newWeeks} onChangeText={setNewWeeks} keyboardType="numeric" />
          <Button title="Faz Ekle" onPress={handleAdd} />
        </Card>
      )}

      <Text style={{ ...TYPE.caption, color: colors.textMuted, textAlign: 'center', marginTop: SPACING.md }}>Uzun bas: fazı sil</Text>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
