/**
 * Timezone Settings Screen — Spec 2.5
 * Shows home vs active timezone, travel detection.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { detectTimezoneChange, getTravelContext } from '@/services/timezone.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function TimezoneScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const [tzInfo, setTzInfo] = useState<{ homeTimezone: string; activeTimezone: string; isTraveling: boolean; offsetHours: number } | null>(null);
  const [homeInput, setHomeInput] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    detectTimezoneChange(user.id).then(info => {
      setTzInfo(info);
      setHomeInput(info.homeTimezone);
    });
  }, [user?.id]);

  const saveHome = async () => {
    if (!user?.id || !homeInput.trim()) return;
    await update(user.id, { home_timezone: homeInput.trim() } as never);
    Alert.alert('Kaydedildi', 'Ev saat dilimi guncellendi.');
  };

  const travelCtx = tzInfo?.activeTimezone ? getTravelContext(tzInfo.activeTimezone) : '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Saat Dilimi</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
        Ogun saatleri, bildirimler ve IF penceresi saat dilimine gore ayarlanir.
      </Text>

      <Card title="Mevcut Durum">
        <InfoRow label="Ev timezone" value={tzInfo?.homeTimezone ?? '-'} />
        <InfoRow label="Aktif timezone" value={tzInfo?.activeTimezone ?? '-'} />
        <InfoRow label="Fark" value={tzInfo ? `${tzInfo.offsetHours >= 0 ? '+' : ''}${tzInfo.offsetHours} saat` : '-'} />
        {tzInfo?.isTraveling && (
          <View style={{ backgroundColor: COLORS.warning, borderRadius: 8, padding: SPACING.sm, marginTop: SPACING.sm }}>
            <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Seyahatte gorunuyorsun</Text>
            <Text style={{ color: '#fff', fontSize: FONT.xs, marginTop: 2 }}>Ogun ve bildirim saatleri aktif timezone'a gore ayarlanir.</Text>
          </View>
        )}
      </Card>

      {travelCtx ? (
        <Card title="Seyahat Bilgisi">
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{travelCtx}</Text>
        </Card>
      ) : null}

      <Card title="Ev Saat Dilimi">
        <Input label="Timezone (IANA)" value={homeInput} onChangeText={setHomeInput} placeholder="Europe/Istanbul" />
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
          Ornek: Europe/Istanbul, America/New_York, Asia/Tokyo
        </Text>
        <Button title="Kaydet" onPress={saveHome} size="sm" />
      </Card>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}
