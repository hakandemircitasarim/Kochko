import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/settings/ToggleRow'; // FIX (audit UI-DS-03): shared toggle primitive
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';
import { a11ySwitch } from '@/lib/accessibility'; // FIX (audit UI-DS-03): getContrastColor moved into shared <Toggle/>
import { PERIODIC_STATE_CONFIG, type PeriodicState } from '@/services/periodic.service';

const IF_WINDOWS = [
  { label: '16:8', eating: '8 saat yeme, 16 saat oruç', start: '12:00', end: '20:00' },
  { label: '18:6', eating: '6 saat yeme, 18 saat oruç', start: '12:00', end: '18:00' },
  { label: '20:4', eating: '4 saat yeme, 20 saat oruç', start: '14:00', end: '18:00' },
  // label is persisted to profile.if_window and self-compared (selected === w.label),
  // so it stays ASCII; titleTr carries the user-facing diacritics.
  { label: 'Ozel', titleTr: 'Özel', eating: 'Kendi saatlerini belirle', start: '', end: '' },
];

export default function IFSettingsScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();

  const [active, setActive] = useState(profile?.if_active ?? false);
  const [selected, setSelected] = useState(profile?.if_window ?? '16:8');
  const [eatingStart, setEatingStart] = useState(String(profile?.if_eating_start ?? '12:00'));
  const [eatingEnd, setEatingEnd] = useState(String(profile?.if_eating_end ?? '20:00'));

  const handleSave = async () => {
    if (!user?.id) return;
    // FIX (audit regression): an IF eating window can be OVERNIGHT (e.g. 20:00–04:00) where
    // start > end lexicographically — that is VALID (intermittent fasting overnight windows are
    // common), not an error. Only a ZERO-LENGTH window (start === end) is invalid.
    if (active && eatingStart === eatingEnd) {
      haptics.error();
      Alert.alert('Geçersiz pencere', 'Yeme penceresi sıfır uzunlukta olamaz; başlangıç ve bitiş saati aynı.');
      return;
    }
    try {
      await update(user.id, {
        if_active: active,
        if_window: active ? selected : null,
        if_eating_start: active ? eatingStart : null,
        if_eating_end: active ? eatingEnd : null,
      } as never);
      haptics.success();
      Alert.alert('Kaydedildi', active ? 'IF modu aktif.' : 'IF modu kapatıldı.', [{ text: 'Tamam', onPress: () => router.back() }]);
    } catch {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'IF ayarların kaydedilemedi. Lütfen tekrar dene.');
    }
  };

  const handleSelectWindow = (w: typeof IF_WINDOWS[0]) => {
    haptics.tap();
    setSelected(w.label);
    if (w.start) setEatingStart(w.start);
    if (w.end) setEatingEnd(w.end);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* Native header (settings/_layout.tsx) already renders the Turkish "Aralıklı Oruç (IF)"
          title; the in-body heading was a redundant duplicate and has been removed. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        IF aktif olduğunda koçun tüm öğün önerilerini yeme penceresine sığdırır. Pencere dışında bildirim göndermez.
      </Text>

      {/* Periodic state conflict banner */}
      {(() => {
        const ps = profile?.periodic_state as PeriodicState | null;
        if (ps && !PERIODIC_STATE_CONFIG[ps]?.ifCompatible) {
          return (
            <Card style={{ borderColor: COLORS.error, borderWidth: 2, marginBottom: SPACING.md }}>
              <Text style={{ color: COLORS.error, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>
                IF Devre Dışı
              </Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
                Mevcut dönemsel durumun ({PERIODIC_STATE_CONFIG[ps]?.label_tr}) IF ile uyumlu değil. Dönem bitene kadar IF devre dışı kaldı.
              </Text>
            </Card>
          );
        }
        return null;
      })()}

      {/* Toggle */}
      <TouchableOpacity
        {...a11ySwitch(`IF ${active ? 'Aktif' : 'Kapalı'}`, active)}
        onPress={() => {
          const ps = profile?.periodic_state as PeriodicState | null;
          if (ps && !PERIODIC_STATE_CONFIG[ps]?.ifCompatible) {
            haptics.error();
            Alert.alert('IF Kullanılamaz', `${PERIODIC_STATE_CONFIG[ps]?.label_tr} döneminde IF uygun değil.`);
            return;
          }
          haptics.tap();
          setActive(!active);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg, minHeight: 44 }}>
        {/* FIX (audit UI-DS-03): shared <Toggle/> primitive (decorative; row owns switch role + guarded press).
            Theme-token knob (contrast over primary when active) is built into the primitive. */}
        <Toggle value={active} onToggle={() => setActive(!active)} />
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>IF {active ? 'Aktif' : 'Kapalı'}</Text>
      </TouchableOpacity>

      {active && (
        <>
          {/* Window Selection */}
          <View style={{ gap: SPACING.sm, marginBottom: SPACING.lg }}>
            {IF_WINDOWS.map(w => (
              <TouchableOpacity
                key={w.label}
                onPress={() => handleSelectWindow(w)}
                accessibilityRole="radio"
                accessibilityState={{ selected: selected === w.label }}
                accessibilityLabel={`${w.titleTr ?? w.label} oruç penceresi, ${w.eating}`}>
                <Card style={{ borderColor: selected === w.label ? COLORS.primary : COLORS.border, borderWidth: selected === w.label ? 2 : 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={{ color: selected === w.label ? COLORS.primary : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{w.titleTr ?? w.label}</Text>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{w.eating}</Text>
                    </View>
                    {w.start && <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>{w.start} - {w.end}</Text>}
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Times */}
          <Card title="Yeme Penceresi Saatleri">
            <View style={{ flexDirection: 'row', gap: SPACING.md }}>
              <View style={{ flex: 1 }}><DateTimeField label="Başlangıç" mode="time" value={eatingStart} onChange={setEatingStart} placeholder="12:00" /></View>
              <View style={{ flex: 1 }}><DateTimeField label="Bitiş" mode="time" value={eatingEnd} onChange={setEatingEnd} placeholder="20:00" /></View>
            </View>
          </Card>
        </>
      )}

      <Button title="Kaydet" onPress={handleSave} size="lg" />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
