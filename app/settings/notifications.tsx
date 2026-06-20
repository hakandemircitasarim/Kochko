import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNotificationPrefs, updateNotificationPrefs, type NotificationPreferences } from '@/services/notifications.service';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { a11ySwitch, getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

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
    haptics.tap();
    const types = { ...prefs.types, [key]: !prefs.types[key as keyof typeof prefs.types] };
    const updated = { ...prefs, types };
    setPrefs(updated);
    if (userId) updateNotificationPrefs(userId, updated);
  };

  const toggleMain = () => {
    haptics.tap();
    const updated = { ...prefs, enabled: !prefs.enabled };
    setPrefs(updated);
    if (userId) updateNotificationPrefs(userId, updated);
  };

  // P3: persist daily-limit + quiet-hours (previously only setPrefs, never saved server-side).
  const persist = (updated: NotificationPreferences) => {
    haptics.tap();
    setPrefs(updated);
    if (userId) updateNotificationPrefs(userId, updated);
  };
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const updateQuiet = (key: 'quietStart' | 'quietEnd', value: string) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    // Persist (and reschedule) only once a full HH:MM is typed, to avoid thrashing per keystroke.
    if (userId && TIME_RE.test(value)) updateNotificationPrefs(userId, updated);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Bildirimler</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Koçunun sana ne zaman, ne sıklıkta mesaj göndereceğini ayarla.
      </Text>

      {/* Main toggle */}
      <TouchableOpacity onPress={toggleMain} {...a11ySwitch(`Bildirimler ${prefs.enabled ? 'Açık' : 'Kapalı'}`, prefs.enabled)} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg, minHeight: 44 }}>
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
                <TouchableOpacity key={n} onPress={() => persist({ ...prefs, dailyLimit: n })}
                  accessibilityRole="button"
                  accessibilityLabel={`Günde en fazla ${n} bildirim`}
                  accessibilityState={{ selected: prefs.dailyLimit === n }}
                  style={{ flex: 1, minHeight: 44, paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: prefs.dailyLimit === n ? COLORS.primary : COLORS.surfaceLight,
                    borderWidth: 1, borderColor: prefs.dailyLimit === n ? COLORS.primary : COLORS.border }}>
                  <Text style={{ color: prefs.dailyLimit === n ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.md, fontWeight: '600' }}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Quiet hours */}
          <Card title="Sessiz Saatler">
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Bu saatler arasında bildirim gönderilmez.</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.md }}>
              <View style={{ flex: 1 }}><DateTimeField label="Başlangıç" mode="time" value={prefs.quietStart} onChange={v => updateQuiet('quietStart', v)} placeholder="23:00" /></View>
              <View style={{ flex: 1 }}><DateTimeField label="Bitiş" mode="time" value={prefs.quietEnd} onChange={v => updateQuiet('quietEnd', v)} placeholder="07:00" /></View>
            </View>
          </Card>

          {/* Type toggles */}
          <Card title="Bildirim Türleri">
            {Object.entries(TYPE_LABELS).map(([key, label]) => {
              const isOn = prefs.types[key as keyof typeof prefs.types];
              return (
              <TouchableOpacity key={key} onPress={() => toggleType(key)}
                {...a11ySwitch(label, !!isOn)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{label}</Text>
                <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: isOn ? COLORS.primary : COLORS.surfaceLight, justifyContent: 'center', padding: 2 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: isOn ? 'flex-end' : 'flex-start' }} />
                </View>
              </TouchableOpacity>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
