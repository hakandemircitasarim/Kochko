import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';

// The "day boundary" is the local hour at which a new day starts for streaks,
// the daily calorie budget and IF windows. Late-night logs before this hour count
// toward the PREVIOUS day. Realistic range is early morning (0-6); default 4.
const HOURS = [0, 1, 2, 3, 4, 5, 6];

export default function DayBoundaryScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const [selected, setSelected] = useState<number>(((profile?.day_boundary_hour as number) ?? 4));
  const [saving, setSaving] = useState(false);
  // FIX (ux-audit device-fix): sync ONCE if the profile loads after mount, so the default (4) can't
  // fire a false unsaved prompt or clobber the real saved hour on Kaydet.
  const hydratedRef = useRef(profile?.day_boundary_hour != null);
  useEffect(() => {
    if (!hydratedRef.current && profile?.day_boundary_hour != null) {
      hydratedRef.current = true;
      setSelected(profile.day_boundary_hour as number);
    }
  }, [profile?.day_boundary_hour]);
  // FIX (ux-round3 #8): confirm before discarding an unsaved day-boundary change.
  useUnsavedGuard(selected !== ((profile?.day_boundary_hour as number) ?? 4));

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await update(user.id, { day_boundary_hour: selected } as never);
      Alert.alert('Kaydedildi', `Gün dönümü saati ${String(selected).padStart(2, '0')}:00 olarak ayarlandı.`, [
        { text: 'Tamam', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Hata', 'Kaydedilemedi, tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): native header (settings/_layout.tsx) zaten "Gün Dönümü"
          başlığını gösteriyor; gövdedeki H1 çift başlıktı, kaldırıldı. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Senin için "yeni gün" hangi saatte başlasın? Bu saatten önce yaptığın kayıtlar (gece atıştırması gibi) bir önceki güne sayılır. Streak, günlük kalori bütçen ve oruç penceresi bu saate göre hesaplanır.
      </Text>

      <Card style={{ marginBottom: SPACING.lg }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm, fontWeight: '600' }}>Gün dönümü saati</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {HOURS.map(h => (
            <TouchableOpacity
              key={h}
              onPress={() => setSelected(h)}
              // FIX (audit a11y): seçim rolü/durumu + min 44dp dokunma hedefi
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === h }}
              accessibilityLabel={`Gün dönümü saati ${String(h).padStart(2, '0')}:00`}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingVertical: 10,
                paddingHorizontal: SPACING.md,
                borderRadius: RADIUS.pill,
                borderWidth: selected === h ? 2 : 1,
                borderColor: selected === h ? COLORS.primary : COLORS.border,
                backgroundColor: selected === h ? COLORS.primary : 'transparent',
              }}
            >
              {/* FIX (audit theme-token): sabit #fff yerine kontrast token'ı */}
              <Text style={{ color: selected === h ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.md, fontWeight: '700' }}>
                {String(h).padStart(2, '0')}:00
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.md, lineHeight: 18 }}>
          Çoğu kişi için 04:00 idealdir — gece geç saatlerde yenenler doğru güne düşer.
        </Text>
      </Card>

      <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" />
    </ScrollView>
  );
}
