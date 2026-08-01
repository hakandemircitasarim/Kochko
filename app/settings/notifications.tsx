import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Alert, Linking, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNotificationPrefs, updateNotificationPrefs, requestNotificationPermissionIfNeeded, getNotificationPermissionStatus, type NotificationPreferences } from '@/services/notifications.service';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { Toggle } from '@/components/settings/ToggleRow'; // FIX (audit UI-DS-03): shared toggle primitive
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
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

// FIX (ux-round3 #15): one-line "ne yapar" for each type — opaque names ("Taahhüt takibi", "Geri
// dönüş daveti") made users toggle blindly and lose useful nudges.
const TYPE_DESCRIPTIONS: Record<string, string> = {
  morning_plan: 'Sabah günün planını özetler.',
  meal_reminder: 'Öğün saatlerinde hatırlatır.',
  workout_reminder: 'Planındaki antrenman günlerinde hatırlatır (aktif bir plan gerekir).',
  water_reminder: 'Gün içinde su içmeyi hatırlatır.',
  night_risk: 'Geç saatte atıştırma riskin arttığında uyarır.',
  daily_report: 'Gün sonunda günün değerlendirmesini gönderir.',
  weekly_report: 'Haftalık raporun hazır olunca bildirir.',
  weight_reminder: 'Haftalık tartı zamanını hatırlatır.',
  commitment_followup: 'Verdiğin sözleri takip eder.',
  achievement: 'Yeni bir başarı/rozet kazanınca kutlar.',
  challenge: 'Aktif challenge ilerlemeni hatırlatır.',
  reengagement: 'Bir süre uzak kalınca nazikçe geri çağırır.',
};

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(s => s.user?.id);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  // FIX (ux-round4 #5): if the OS permission is revoked LATER (in phone settings, after prefs
  // were saved enabled), the screen kept showing "Açık" while nothing was ever delivered. Read
  // the live OS status on mount so we can warn that notifications are silently dead.
  const [permStatus, setPermStatus] = useState<string | null>(null);

  useEffect(() => { if (userId) getNotificationPrefs(userId).then(setPrefs); }, [userId]);
  // FIX (ux-round4 #5 + review): re-check the OS status whenever the app returns to the foreground,
  // not just on mount — otherwise the "izin kapalı" banner stays up after the user grants permission
  // in system settings and comes back (the screen isn't unmounted, so a mount-only read goes stale).
  useEffect(() => {
    const check = () => { getNotificationPermissionStatus().then(setPermStatus).catch(() => {}); };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);

  if (!prefs) return null;

  // FIX (audit UX-FBK-03): updateNotificationPrefs returns false when the DB write fails.
  // Optimistically apply `updated`, then await the result; on failure roll back to `previous`
  // and signal the error (haptics.error + Alert) instead of leaving a lying toggle + success tap.
  const persistPrefs = async (previous: NotificationPreferences, updated: NotificationPreferences) => {
    setPrefs(updated);
    if (!userId) return;
    const ok = await updateNotificationPrefs(userId, updated);
    if (!ok) {
      setPrefs(previous);
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Bildirim ayarın kaydedilemedi. Lütfen tekrar dene.');
    }
  };

  const toggleType = (key: string) => {
    haptics.tap();
    const types = { ...prefs.types, [key]: !prefs.types[key as keyof typeof prefs.types] };
    const updated = { ...prefs, types };
    void persistPrefs(prefs, updated); // FIX (audit UX-FBK-03): await + rollback on failure
  };

  const toggleMain = async () => {
    haptics.tap();
    const next = !prefs.enabled;
    // FIX (audit UX-FBK-02/HIGH): enabling in-app notifications is meaningless if the OS
    // permission is off — the old toggle flipped on and saved, but nothing was ever delivered
    // and the user got no signal. When turning ON, ensure OS permission; if it can't be
    // obtained (denied/undetermined→denied), explain and offer to open system settings, and do
    // NOT flip the toggle on (it would lie about delivery).
    if (next) {
      await requestNotificationPermissionIfNeeded();
      const status = await getNotificationPermissionStatus();
      if (status !== 'granted') {
        Alert.alert(
          'Bildirim izni kapalı',
          'Bildirimleri açabilmek için telefonunun ayarlarından Kochko bildirimlerine izin vermen gerekiyor.',
          [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Ayarları aç', onPress: () => { Linking.openSettings().catch(() => {}); } },
          ],
        );
        return;
      }
    }
    const updated = { ...prefs, enabled: next };
    await persistPrefs(prefs, updated); // FIX (audit UX-FBK-03): await + rollback on failure
  };

  // P3: persist daily-limit + quiet-hours (previously only setPrefs, never saved server-side).
  const persist = (updated: NotificationPreferences) => {
    haptics.tap();
    void persistPrefs(prefs, updated); // FIX (audit UX-FBK-03): await + rollback on failure
  };
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const updateQuiet = (key: 'quietStart' | 'quietEnd', value: string) => {
    const updated = { ...prefs, [key]: value };
    // Persist (and reschedule) only once a full HH:MM is typed, to avoid thrashing per keystroke.
    // FIX (audit UX-FBK-03): when valid, route through persistPrefs (await + rollback on failure);
    // otherwise just reflect the partial input locally without a DB write.
    if (userId && TIME_RE.test(value)) {
      void persistPrefs(prefs, updated);
    } else {
      setPrefs(updated);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Koçunun sana ne zaman, ne sıklıkta mesaj göndereceğini ayarla.
      </Text>

      {/* FIX (ux-round4 #5): OS permission revoked while in-app notifications are still "on" —
          nothing gets delivered and nothing signalled it. Surface it with a one-tap route to settings. */}
      {prefs.enabled && permStatus && permStatus !== 'granted' && (
        <TouchableOpacity
          onPress={() => Linking.openSettings().catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Bildirim izni kapalı. Telefon ayarlarını açmak için dokun."
          style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.lg }}
        >
          <Ionicons name="notifications-off-outline" size={20} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.warning, fontSize: FONT.sm, fontWeight: '700' }}>Bildirim izni kapalı</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 2, lineHeight: 18 }}>
              Telefon ayarlarından izin kapalı olduğu için hiçbir bildirim gönderilemiyor. Açmak için dokun.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Main toggle */}
      <TouchableOpacity onPress={toggleMain} {...a11ySwitch(`Bildirimler ${prefs.enabled ? 'Açık' : 'Kapalı'}`, prefs.enabled)} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg, minHeight: 44 }}>
        {/* FIX (audit UI-DS-03): shared <Toggle/> primitive (decorative; row owns the switch role + press). */}
        <Toggle value={prefs.enabled} onToggle={toggleMain} />
        <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>Bildirimler {prefs.enabled ? 'Açık' : 'Kapalı'}</Text>
      </TouchableOpacity>

      {prefs.enabled && (
        <>
          {/* Daily limit */}
          <Card title="Günlük Sınır">
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Günde en fazla kaç bildirim almak istiyorsun?</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {[3, 5, 7, 10].map(n => (
                <TouchableOpacity key={n} onPress={() => persist({ ...prefs, dailyLimit: n })}
                  accessibilityRole="button"
                  accessibilityLabel={`Günde en fazla ${n} bildirim`}
                  accessibilityState={{ selected: prefs.dailyLimit === n }}
                  style={{ flex: 1, minHeight: 44, paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: prefs.dailyLimit === n ? colors.primary : colors.surfaceLight,
                    borderWidth: 1, borderColor: prefs.dailyLimit === n ? colors.primary : colors.border }}>
                  <Text style={{ color: prefs.dailyLimit === n ? getContrastColor(colors.primary) : colors.textSecondary, fontSize: FONT.md, fontWeight: '600' }}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Quiet hours */}
          <Card title="Sessiz Saatler">
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Bu saatler arasında bildirim gönderilmez.</Text>
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
              // FIX (ux-round3 #15 adversarial-review): fold the description into the switch's a11y
              // label so screen-reader users hear it too (the visible Text is otherwise suppressed
              // by the parent's explicit accessibilityLabel).
              <TouchableOpacity key={key} onPress={() => toggleType(key)}
                {...a11ySwitch(TYPE_DESCRIPTIONS[key] ? `${label}. ${TYPE_DESCRIPTIONS[key]}` : label, !!isOn)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.md, minHeight: 44, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: FONT.md }}>{label}</Text>
                  {/* FIX (ux-round3 #15): describe what the type actually does. */}
                  {TYPE_DESCRIPTIONS[key] ? (
                    <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>{TYPE_DESCRIPTIONS[key]}</Text>
                  ) : null}
                </View>
                {/* FIX (audit UI-DS-03): shared <Toggle/> primitive (decorative; row owns switch role + press). */}
                <Toggle value={!!isOn} onToggle={() => toggleType(key)} />
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
