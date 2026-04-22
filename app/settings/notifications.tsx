import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNotificationPrefs, updateNotificationPrefs, type NotificationPreferences } from '@/services/notifications.service';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const TYPE_LABELS: Record<string, string> = {
  morning_plan: 'Sabah planı',
  meal_reminder: 'Öğün hatırlatma',
  workout_reminder: 'Antrenman hatırlatma',
  water_reminder: 'Su hatırlatma',
  night_risk: 'Gece atıştırma uyarısı',
  daily_report: 'Gün sonu raporu',
  weekly_report: 'Haftalık rapor',
  weight_reminder: 'Tartı hatırlatma',
  commitment_followup: 'Taahhüt takibi',
  achievement: 'Başarım bildirimi',
  challenge: 'Challenge hatırlatma',
  reengagement: 'Geri dönüş daveti',
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(s => s.user?.id);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);

  useEffect(() => { if (userId) getNotificationPrefs(userId).then(setPrefs); }, [userId]);

  if (!prefs) return null;

  const toggleType = (key: string) => {
    const types = { ...prefs.types, [key]: !prefs.types[key as keyof typeof prefs.types] };
    const updated = { ...prefs, types };
    setPrefs(updated);
    if (userId) updateNotificationPrefs(userId, updated);
  };

  const toggleMain = () => {
    const updated = { ...prefs, enabled: !prefs.enabled };
    setPrefs(updated);
    if (userId) updateNotificationPrefs(userId, updated);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Bildirimler</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Koçunun sana ne zaman, ne sıklıkta mesaj göndereceğini ayarla.
      </Text>

      {/* Main toggle */}
      <TouchableOpacity onPress={toggleMain} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg }}>
        <View style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: prefs.enabled ? COLORS.primary : COLORS.surfaceLight, justifyContent: 'center', padding: 2 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignSelf: prefs.enabled ? 'flex-end' : 'flex-start' }} />
        </View>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>Bildirimler {prefs.enabled ? 'Açık' : 'Kapalı'}</Text>
      </TouchableOpacity>

      {prefs.enabled && (
        <>
          {/* Daily limit */}
          <Card title="Günlük Sınır">
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Günde en fazla kaç bildirim almak istiyorsun?</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {[3, 5, 7, 10].map(n => (
                <TouchableOpacity key={n} onPress={() => { setPrefs(p => p ? { ...p, dailyLimit: n } : p); }}
                  style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center',
                    backgroundColor: prefs.dailyLimit === n ? COLORS.primary : COLORS.surfaceLight,
                    borderWidth: 1, borderColor: prefs.dailyLimit === n ? COLORS.primary : COLORS.border }}>
                  <Text style={{ color: prefs.dailyLimit === n ? '#fff' : COLORS.textSecondary, fontSize: FONT.md, fontWeight: '600' }}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Quiet hours */}
          <Card title="Sessiz Saatler">
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Bu saatler arasında bildirim gönderilmez.</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.md }}>
              <View style={{ flex: 1 }}><Input label="Başlangıç" value={prefs.quietStart} onChangeText={v => setPrefs(p => p ? { ...p, quietStart: v } : p)} placeholder="23:00" /></View>
              <View style={{ flex: 1 }}><Input label="Bitiş" value={prefs.quietEnd} onChangeText={v => setPrefs(p => p ? { ...p, quietEnd: v } : p)} placeholder="07:00" /></View>
            </View>
          </Card>

          {/* Type toggles */}
          <Card title="Bildirim Türleri">
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <TouchableOpacity key={key} onPress={() => toggleType(key)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{label}</Text>
                <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: prefs.types[key as keyof typeof prefs.types] ? COLORS.primary : COLORS.surfaceLight, justifyContent: 'center', padding: 2 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: prefs.types[key as keyof typeof prefs.types] ? 'flex-end' : 'flex-start' }} />
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
