/**
 * Day Boundary Settings — Spec 2.8
 * Gece geç kayıtlarının hangi güne ait olduğunu belirler.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const HOUR_OPTIONS = [3, 4, 5, 6];

export default function DayBoundaryScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const p = (profile ?? {}) as Record<string, unknown>;
  const [selectedHour, setSelectedHour] = useState(4);

  useEffect(() => {
    if (p.day_boundary_hour != null) setSelectedHour(Number(p.day_boundary_hour));
  }, [p.day_boundary_hour]);

  const handleSave = async () => {
    if (!user?.id) return;
    await update(user.id, { day_boundary_hour: selectedHour } as never);
    Alert.alert('Kaydedildi', `Gun siniri ${String(selectedHour).padStart(2, '0')}:00 olarak ayarlandi.`);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Gun Siniri</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Bu saatten once yapilan kayitlar onceki gune, sonrakiler yeni gune aittir.
        Gun sonu raporu, streak, haftalik butce ve IF penceresi bu sinira gore calisir.
      </Text>

      <Card title="Gun Siniri Saati">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          {HOUR_OPTIONS.map(h => (
            <TouchableOpacity key={h} onPress={() => setSelectedHour(h)}
              style={{
                flex: 1, paddingVertical: SPACING.md, borderRadius: 12, alignItems: 'center',
                backgroundColor: selectedHour === h ? COLORS.primary : COLORS.inputBg,
                borderWidth: 1, borderColor: selectedHour === h ? COLORS.primary : COLORS.border,
              }}>
              <Text style={{ color: selectedHour === h ? '#fff' : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
                {String(h).padStart(2, '0')}:00
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
          Ornek: Gun siniri 04:00 ise, gece 03:30'da yapilan kayit onceki gune, 04:15'te yapilan yeni gune aittir.
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>
          Varsayilan: 04:00 · Gece cok gec yatan kullanicilar icin 05:00 veya 06:00 secenegi vardir.
        </Text>
      </Card>

      <Button title="Kaydet" onPress={handleSave} style={{ marginTop: SPACING.md }} />
    </ScrollView>
  );
}
