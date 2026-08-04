/**
 * Menstrual Cycle Settings Screen
 * Spec 2.1: Kadınlara özel döngü takibi
 */
import { useState, useMemo } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { calculateCycleStatus, updateMenstrualSettings, type CyclePhase } from '@/services/menstrual.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { Card } from '@/components/ui/Card';
import { ToggleRow } from '@/components/settings/ToggleRow';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

const PHASE_LABELS: Record<CyclePhase, string> = {
  follicular: 'Foliküler Faz', ovulation: 'Ovülasyon', luteal: 'Luteal Faz', menstrual: 'Menstruel Faz',
};
// FIX (tema): modül seviyesinde COLORS okumak koyu paleti her temaya donduruyordu —
// fabrika fonksiyonu + bileşen içinde useMemo ile aktif temadan çözülüyor.
const makePhaseColors = (c: ThemeColors): Record<CyclePhase, string> => ({
  follicular: c.success, ovulation: c.primary, luteal: c.warning, menstrual: c.pink,
});

export default function MenstrualScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [tracking, setTracking] = useState(Boolean(profile?.menstrual_tracking));
  const [cycleLength, setCycleLength] = useState(String(profile?.menstrual_cycle_length ?? 28));
  const [lastPeriod, setLastPeriod] = useState(String(profile?.menstrual_last_period_start ?? ''));
  // FIX (audit settings-save-guards): çift-gönderim + kalıcı kilit önlemek için saving state.
  const [saving, setSaving] = useState(false);

  const PHASE_COLORS = useMemo(() => makePhaseColors(colors), [colors]);

  const status = tracking && lastPeriod
    ? calculateCycleStatus(lastPeriod, parseInt(cycleLength) || 28)
    : null;

  const handleSave = async () => {
    if (!user?.id) return;
    // FIX (audit inline-validation): döngü süresi 21–45 gün aralığı doğrulaması.
    const cl = parseInt(cycleLength);
    if (tracking && (!Number.isFinite(cl) || cl < 21 || cl > 45)) {
      haptics.error();
      Alert.alert('Geçersiz süre', 'Döngü süresi 21–45 gün olmalı.');
      return;
    }
    // ux-sweep (MN-01): takip açıkken tarihsiz kayıt faz hesabını sessizce imkânsız bırakıyordu.
    if (tracking && !lastPeriod) {
      haptics.error();
      Alert.alert('Tarih eksik', 'Faz hesaplanabilmesi için son regl başlangıç tarihini seç.');
      return;
    }
    try {
      setSaving(true);
      await updateMenstrualSettings(user.id, tracking, cl || 28, lastPeriod || undefined);
      haptics.success();
      Alert.alert('Kaydedildi', tracking ? 'Döngü takibi aktif.' : 'Döngü takibi kapatıldı.', [
        { text: 'Tamam', onPress: () => router.back() },
      ]);
    } catch (e) {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Ayarlar kaydedilemedi, lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): native header (settings/_layout.tsx) zaten "Regl Döngüsü"
          başlığını gösteriyor; gövdedeki H1 çift başlıktı, kaldırıldı. */}
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginBottom: SPACING.lg }}>
        Döngü takibi aktif olduğunda koçun beslenme ve antrenman planlarını döngü fazına göre otomatik ayarlar.
      </Text>

      <ToggleRow
        label="Döngü Takibi"
        description="Aktif olduğunda AI beslenme/antrenman planlarını fazlara göre ayarlar"
        value={tracking}
        onToggle={(newValue) => { haptics.tap(); setTracking(newValue); }}
      />

      {tracking && (
        <>
          <View style={{ marginTop: SPACING.lg }}>
            <Input label="Döngü Süresi (gün)" value={cycleLength} onChangeText={setCycleLength} keyboardType="number-pad" placeholder="28" hint="Genelde 21–35 gün" />
            {/* FIX (audit ui-datetimefield): son regl gelecekte olamaz — picker'ı bugüne sınırla. */}
            <DateTimeField label="Son Regl Başlangıcı" mode="date" value={lastPeriod} onChange={setLastPeriod} placeholder="Tarih seç" maximumDate={new Date()} />
          </View>

          {/* Current phase display */}
          {status?.active && status.currentPhase && (
            <Card style={{ borderLeftWidth: 4, borderLeftColor: PHASE_COLORS[status.currentPhase] }}>
              <View
                accessible
                accessibilityLabel={`Mevcut faz: ${PHASE_LABELS[status.currentPhase]}, döngünün ${status.dayOfCycle}. günü, toplam ${status.cycleLength} gün`}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}
              >
                <Text style={{ color: PHASE_COLORS[status.currentPhase], ...TYPE.headline }}>
                  {PHASE_LABELS[status.currentPhase]}
                </Text>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Gün {status.dayOfCycle}/{status.cycleLength}</Text>
              </View>
              {status.phaseAdvice && (
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{status.phaseAdvice}</Text>
              )}
              {status.nextPeriodEstimate && (
                <Text style={{ color: colors.textSecondary, ...TYPE.body, marginTop: SPACING.sm }}>
                  Tahmini sonraki regl: {status.nextPeriodEstimate}
                </Text>
              )}
            </Card>
          )}

          {/* Phase explanation */}
          <Card title="Faz Açıklamaları">
            {(['menstrual', 'follicular', 'ovulation', 'luteal'] as CyclePhase[]).map(phase => (
              <View key={phase} style={{ flexDirection: 'row', paddingVertical: SPACING.xs, gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ width: 3, backgroundColor: PHASE_COLORS[phase], borderRadius: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, ...TYPE.bodyStrong }}>{PHASE_LABELS[phase]}</Text>
                  <Text style={{ color: colors.textMuted, ...TYPE.caption, marginTop: 1 }}>
                    {phase === 'menstrual' && 'Düşük enerji. Hafif aktivite.'}
                    {phase === 'follicular' && 'Enerji yükseliyor. Yoğun antrenman uygun.'}
                    {phase === 'ovulation' && 'Güç zirvesi. PR denemesi için uygun.'}
                    {phase === 'luteal' && 'İştah artar, su tutulumu olabilir. Kalori +100-200.'}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
