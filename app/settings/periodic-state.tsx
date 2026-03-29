import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { setPeriodicState, clearPeriodicState, PERIODIC_LABELS, type PeriodicStateType } from '@/services/periodic.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function PeriodicStateScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [selected, setSelected] = useState<PeriodicStateType | null>((profile?.periodic_state as PeriodicStateType) ?? null);
  const [endDate, setEndDate] = useState('');

  const handleActivate = async () => {
    if (!user?.id || !selected) return;
    await setPeriodicState(user.id, selected, undefined, endDate || undefined);
    Alert.alert('Aktif', `${PERIODIC_LABELS[selected]} donemi baslatildi.`, [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  const handleClear = async () => {
    if (!user?.id) return;
    await clearPeriodicState(user.id);
    setSelected(null);
    Alert.alert('Temizlendi', 'Donemsel durum kaldirildi.');
  };

  const states = Object.entries(PERIODIC_LABELS) as [PeriodicStateType, string][];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Donemsel Durum</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Ozel bir donemdeysen (Ramazan, tatil, hastalik, hamilelik vs.) bunu bildir. Kocun planlarini ve tavsiyelerini buna gore ayarlar.
      </Text>

      {profile?.periodic_state && (
        <Card style={{ borderColor: COLORS.warning, borderWidth: 2 }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '600' }}>Aktif: {PERIODIC_LABELS[profile.periodic_state as PeriodicStateType] ?? profile.periodic_state}</Text>
          <Button title="Donemi Sonlandir" variant="ghost" onPress={handleClear} style={{ marginTop: SPACING.sm }} />
        </Card>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.lg }}>
        {states.map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => setSelected(key)}
            style={{ paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: 12, borderWidth: 1,
              borderColor: selected === key ? COLORS.primary : COLORS.border,
              backgroundColor: selected === key ? COLORS.primary : 'transparent' }}>
            <Text style={{ color: selected === key ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input label="Bitis tarihi (opsiyonel)" placeholder="2024-04-10" value={endDate} onChangeText={setEndDate} />

      <Button title="Donemi Baslat" onPress={handleActivate} size="lg" disabled={!selected} />
    </ScrollView>
  );
}
