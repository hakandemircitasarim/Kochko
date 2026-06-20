/**
 * Menstrual Cycle Settings Screen
 * Spec 2.1: Kadınlara özel döngü takibi
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
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
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

const PHASE_LABELS: Record<CyclePhase, string> = {
  follicular: 'Foliküler Faz', ovulation: 'Ovülasyon', luteal: 'Luteal Faz', menstrual: 'Menstruel Faz',
};
const PHASE_COLORS: Record<CyclePhase, string> = {
  follicular: COLORS.success, ovulation: COLORS.primary, luteal: COLORS.warning, menstrual: COLORS.pink,
};

export default function MenstrualScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [tracking, setTracking] = useState(Boolean(profile?.menstrual_tracking));
  const [cycleLength, setCycleLength] = useState(String(profile?.menstrual_cycle_length ?? 28));
  const [lastPeriod, setLastPeriod] = useState(String(profile?.menstrual_last_period_start ?? ''));
  // FIX (audit settings-save-guards): çift-gönderim + kalıcı kilit önlemek için saving state.
  const [saving, setSaving] = useState(false);

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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Regl Döngüsü</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
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
                <Text style={{ color: PHASE_COLORS[status.currentPhase], fontSize: FONT.md, fontWeight: '700' }}>
                  {PHASE_LABELS[status.currentPhase]}
                </Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Gün {status.dayOfCycle}/{status.cycleLength}</Text>
              </View>
              {status.phaseAdvice && (
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{status.phaseAdvice}</Text>
              )}
              {status.nextPeriodEstimate && (
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.sm }}>
                  Tahmini sonraki regl: {status.nextPeriodEstimate}
                </Text>
              )}
            </Card>
          )}

          {/* Phase explanation */}
          <Card title="Faz Açıklamaları">
            {(['menstrual', 'follicular', 'ovulation', 'luteal'] as CyclePhase[]).map(phase => (
              <View key={phase} style={{ flexDirection: 'row', paddingVertical: SPACING.xs, gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <View style={{ width: 3, backgroundColor: PHASE_COLORS[phase], borderRadius: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{PHASE_LABELS[phase]}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 1 }}>
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
