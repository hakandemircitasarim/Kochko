import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import {
  setPeriodicState, clearPeriodicState,
  PERIODIC_STATE_CONFIG, detectIFConflict, getTransitionInfo,
  type PeriodicState,
} from '@/services/periodic.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

export default function PeriodicStateScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const { fetch: fetchProfile } = useProfileStore();
  const [selected, setSelected] = useState<PeriodicState | null>((profile?.periodic_state as PeriodicState) ?? null);
  const [endDate, setEndDate] = useState(profile?.periodic_state_end ?? '');
  const [loading, setLoading] = useState(false);

  const currentState = profile?.periodic_state as PeriodicState | null;
  const config = selected ? PERIODIC_STATE_CONFIG[selected] : null;

  // Transition info for active state
  const transition = currentState
    ? getTransitionInfo(currentState, profile?.periodic_state_start ?? null, profile?.periodic_state_end ?? null)
    : null;

  const handleActivate = async () => {
    if (!user?.id || !selected) return;

    // Check IF conflict
    if (profile?.if_active) {
      const conflict = detectIFConflict(selected, true);
      if (conflict.conflict) {
        Alert.alert(
          'IF Çakışması',
          conflict.message_tr,
          [
            { text: 'İptal', style: 'cancel' },
            { text: 'Devam Et (IF Durdurulacak)', onPress: () => doActivate() },
          ]
        );
        return;
      }
    }
    await doActivate();
  };

  const doActivate = async () => {
    if (!user?.id || !selected) return;
    setLoading(true);
    try {
      const { ifPaused } = await setPeriodicState(user.id, selected, undefined, endDate || undefined, profile?.if_active ?? false);
      await fetchProfile(user.id);
      const label = PERIODIC_STATE_CONFIG[selected].label_tr;
      const msg = ifPaused
        ? `${label} dönemi başlatıldı. IF otomatik durduruldu.`
        : `${label} dönemi başlatıldı.`;
      haptics.success();
      Alert.alert('Aktif', msg, [{ text: 'Tamam', onPress: () => router.back() }]);
    } catch (err) {
      haptics.error();
      Alert.alert('Hata', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!user?.id) return;
    try {
      const { previousState } = await clearPeriodicState(user.id);
      await fetchProfile(user.id);
      setSelected(null);
      setEndDate('');
      const label = previousState ? PERIODIC_STATE_CONFIG[previousState as PeriodicState]?.label_tr : '';
      haptics.success();
      Alert.alert('Temizlendi', `${label || 'Dönemsel durum'} kaldırıldı. Koçun normale dönüş planı hazırlayacak.`);
    } catch (err) {
      haptics.error();
      Alert.alert('Hata', (err as Error).message);
    }
  };

  const states = Object.entries(PERIODIC_STATE_CONFIG) as [PeriodicState, typeof PERIODIC_STATE_CONFIG[PeriodicState]][];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Dönemsel Durum</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Özel bir dönemdeysen (Ramazan, tatil, hastalık, hamilelik vs.) bunu bildir. Koçun planlarını ve tavsiyelerini buna göre ayarlar.
      </Text>

      {/* Active state card */}
      {currentState && (
        <Card style={{ borderColor: COLORS.warning, borderWidth: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '600' }}>
              Aktif: {PERIODIC_STATE_CONFIG[currentState]?.label_tr ?? currentState}
            </Text>
            {transition?.daysRemaining != null && transition.daysRemaining > 0 && (
              <View style={{ backgroundColor: COLORS.warning, borderRadius: 8, paddingHorizontal: SPACING.sm, paddingVertical: 2 }}>
                <Text style={{ color: getContrastColor(COLORS.warning) === 'black' ? '#0D0D12' : '#fff', fontSize: FONT.xs, fontWeight: '700' }}>{transition.daysRemaining} gün kaldı</Text>
              </View>
            )}
          </View>
          {transition?.isExpiring && (
            <Text style={{ color: COLORS.error, fontSize: FONT.sm, marginTop: SPACING.xs }}>
              {transition.transitionMessage_tr}
            </Text>
          )}
          {transition?.isExpired && (
            <Text style={{ color: COLORS.error, fontSize: FONT.sm, marginTop: SPACING.xs }}>
              {transition.transitionMessage_tr}
            </Text>
          )}
          <Button title="Dönemi Sonlandır" variant="ghost" onPress={handleClear} style={{ marginTop: SPACING.sm }} />
        </Card>
      )}

      {/* State selection */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {states.map(([key, cfg]) => (
          <TouchableOpacity key={key} onPress={() => { haptics.tap(); setSelected(key); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: selected === key }}
            accessibilityLabel={cfg.label_tr}
            style={{
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: 12, borderWidth: 1,
              borderColor: selected === key ? COLORS.primary : COLORS.border,
              backgroundColor: selected === key ? COLORS.primary : 'transparent',
            }}>
            <Text style={{ color: selected === key ? (getContrastColor(COLORS.primary) === 'black' ? '#0D0D12' : '#fff') : COLORS.textSecondary, fontSize: FONT.sm }}>{cfg.label_tr}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Selected state description */}
      {config && (
        <Card>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>{config.label_tr}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.sm }}>{config.description_tr}</Text>
          {config.calorieAdjustment !== 0 && (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
              Kalori: {config.calorieAdjustment > 0 ? '+' : ''}{config.calorieAdjustment} kcal
            </Text>
          )}
          {!config.ifCompatible && (
            <Text style={{ color: COLORS.error, fontSize: FONT.xs }}>IF ile uyumlu değil — otomatik durdurulur</Text>
          )}
        </Card>
      )}

      {/* End date input */}
      <Input
        label="Bitiş tarihi"
        placeholder="2026-04-10"
        hint="YYYY-AA-GG (örn: 2026-04-10)"
        keyboardType="number-pad"
        value={endDate}
        onChangeText={setEndDate}
      />
      {config?.requiresEndDate && !endDate && (
        <Text style={{ color: COLORS.warning, fontSize: FONT.xs, marginTop: -SPACING.sm, marginBottom: SPACING.sm }}>
          Bu durum için bitiş tarihi önerilir.
        </Text>
      )}

      <Button title="Dönemi Başlat" onPress={handleActivate} loading={loading} size="lg" disabled={!selected} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
