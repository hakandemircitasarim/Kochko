/**
 * Menstrual Cycle Settings Screen
 * Spec 2.1: Kadınlara özel döngü takibi
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { calculateCycleStatus, updateMenstrualSettings, type CyclePhase } from '@/services/menstrual.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { ToggleRow } from '@/components/settings/ToggleRow';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const PHASE_LABELS: Record<CyclePhase, string> = {
  follicular: 'Folikuler Faz', ovulation: 'Ovulasyon', luteal: 'Luteal Faz', menstrual: 'Menstruel Faz',
};
const PHASE_COLORS: Record<CyclePhase, string> = {
  follicular: COLORS.success, ovulation: COLORS.primary, luteal: COLORS.warning, menstrual: '#E91E63',
};

export default function MenstrualScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [tracking, setTracking] = useState(Boolean(profile?.menstrual_tracking));
  const [cycleLength, setCycleLength] = useState(String(profile?.menstrual_cycle_length ?? 28));
  const [lastPeriod, setLastPeriod] = useState(String(profile?.menstrual_last_period_start ?? ''));

  const status = tracking && lastPeriod
    ? calculateCycleStatus(lastPeriod, parseInt(cycleLength) || 28)
    : null;

  const handleSave = async () => {
    if (!user?.id) return;
    await updateMenstrualSettings(user.id, tracking, parseInt(cycleLength) || 28, lastPeriod || undefined);
    Alert.alert('Kaydedildi', tracking ? 'Dongü takibi aktif.' : 'Dongü takibi kapatildi.', [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Regl Dongusu</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Dongu takibi aktif oldugunda kocun beslenme ve antrenman planlarini dongu fazina gore otomatik ayarlar.
      </Text>

      <ToggleRow
        label="Dongu Takibi"
        description="Aktif oldugunda AI beslenme/antrenman planlarini fazlara gore ayarlar"
        value={tracking}
        onToggle={setTracking}
      />

      {tracking && (
        <>
          <View style={{ marginTop: SPACING.lg }}>
            <Input label="Dongu Suresi (gun)" value={cycleLength} onChangeText={setCycleLength} keyboardType="numeric" placeholder="28" />
            <Input label="Son Regl Baslangici" value={lastPeriod} onChangeText={setLastPeriod} placeholder="2024-03-15" />
          </View>

          {/* Current phase display */}
          {status?.active && status.currentPhase && (
            <Card style={{ borderLeftWidth: 4, borderLeftColor: PHASE_COLORS[status.currentPhase] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: PHASE_COLORS[status.currentPhase], fontSize: FONT.md, fontWeight: '700' }}>
                  {PHASE_LABELS[status.currentPhase]}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Gun {status.dayOfCycle}/{status.cycleLength}</Text>
              </View>
              {status.phaseAdvice && (
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{status.phaseAdvice}</Text>
              )}
              {status.nextPeriodEstimate && (
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>
                  Tahmini sonraki regl: {status.nextPeriodEstimate}
                </Text>
              )}
            </Card>
          )}

          {/* Phase explanation */}
          <Card title="Faz Aciklamalari">
            {(['menstrual', 'follicular', 'ovulation', 'luteal'] as CyclePhase[]).map(phase => (
              <View key={phase} style={{ flexDirection: 'row', paddingVertical: SPACING.xs, gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <View style={{ width: 3, backgroundColor: PHASE_COLORS[phase], borderRadius: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{PHASE_LABELS[phase]}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 1 }}>
                    {phase === 'menstrual' && 'Dusuk enerji. Hafif aktivite.'}
                    {phase === 'follicular' && 'Enerji yukseliyor. Yogun antrenman uygun.'}
                    {phase === 'ovulation' && 'Guc zirvesi. PR denemesi icin uygun.'}
                    {phase === 'luteal' && 'Istah artar, su tutulumu olabilir. Kalori +100-200.'}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      <Button title="Kaydet" onPress={handleSave} size="lg" style={{ marginTop: SPACING.md }} />
    </ScrollView>
  );
}
