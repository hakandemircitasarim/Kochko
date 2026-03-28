import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const IF_WINDOWS = [
  { label: '16:8', eating: '8 saat yeme, 16 saat oruc', start: '12:00', end: '20:00' },
  { label: '18:6', eating: '6 saat yeme, 18 saat oruc', start: '12:00', end: '18:00' },
  { label: '20:4', eating: '4 saat yeme, 20 saat oruc', start: '14:00', end: '18:00' },
  { label: 'Ozel', eating: 'Kendi saatlerini belirle', start: '', end: '' },
];

export default function IFSettingsScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();

  const [active, setActive] = useState(profile?.if_active ?? false);
  const [selected, setSelected] = useState(profile?.if_window ?? '16:8');
  const [eatingStart, setEatingStart] = useState(String(profile?.if_eating_start ?? '12:00'));
  const [eatingEnd, setEatingEnd] = useState(String(profile?.if_eating_end ?? '20:00'));

  const handleSave = async () => {
    if (!user?.id) return;
    await update(user.id, {
      if_active: active,
      if_window: active ? selected : null,
      if_eating_start: active ? eatingStart : null,
      if_eating_end: active ? eatingEnd : null,
    } as never);
    Alert.alert('Kaydedildi', active ? 'IF modu aktif.' : 'IF modu kapatildi.', [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  const handleSelectWindow = (w: typeof IF_WINDOWS[0]) => {
    setSelected(w.label);
    if (w.start) setEatingStart(w.start);
    if (w.end) setEatingEnd(w.end);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Aralikli Oruc (IF)</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        IF aktif oldugunda kocun tum ogun onerilerini yeme penceresine sigdirir. Pencere disinda bildirim gondermez.
      </Text>

      {/* Toggle */}
      <TouchableOpacity onPress={() => setActive(!active)} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg }}>
        <View style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: active ? COLORS.primary : COLORS.surfaceLight, justifyContent: 'center', padding: 2 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignSelf: active ? 'flex-end' : 'flex-start' }} />
        </View>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>IF {active ? 'Aktif' : 'Kapali'}</Text>
      </TouchableOpacity>

      {active && (
        <>
          {/* Window Selection */}
          <View style={{ gap: SPACING.sm, marginBottom: SPACING.lg }}>
            {IF_WINDOWS.map(w => (
              <TouchableOpacity key={w.label} onPress={() => handleSelectWindow(w)}>
                <Card style={{ borderColor: selected === w.label ? COLORS.primary : COLORS.border, borderWidth: selected === w.label ? 2 : 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={{ color: selected === w.label ? COLORS.primary : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{w.label}</Text>
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
              <View style={{ flex: 1 }}><Input label="Baslangic" value={eatingStart} onChangeText={setEatingStart} placeholder="12:00" /></View>
              <View style={{ flex: 1 }}><Input label="Bitis" value={eatingEnd} onChangeText={setEatingEnd} placeholder="20:00" /></View>
            </View>
          </Card>
        </>
      )}

      <Button title="Kaydet" onPress={handleSave} size="lg" />
    </ScrollView>
  );
}
