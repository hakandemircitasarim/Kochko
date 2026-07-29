/**
 * Activity Timeline - Meals and workouts in a unified timeline view.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, HERO, CARD_SHADOW } from '@/lib/constants';
import { haptics } from '@/lib/haptics';
import { mealTypeLabelTR } from '@/lib/labels';
import { showToast } from '@/components/ui/Toast';

interface MealEntry {
  id: string;
  meal_type: string;
  raw_input: string;
  calories: number;
  logged_at?: string | null;
}

interface WorkoutEntry {
  id: string;
  raw_input: string;
  duration_min: number;
  logged_at?: string | null;
}

interface Props {
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  onDeleteMeal: (id: string) => void | Promise<void>;
  onDeleteWorkout: (id: string) => void | Promise<void>;
  /** ux-defect pass: yepyeni kullanıcıda hoş-geldin kartı aynı CTA'yı zaten veriyor — üçüncü tekrar gizlenir. */
  hideEmptyCta?: boolean;
}

const MEAL_ICONS: Record<string, string> = {
  breakfast: 'sunny-outline', lunch: 'restaurant-outline',
  dinner: 'moon-outline', snack: 'cafe-outline',
};

type Activity = {
  type: 'meal' | 'workout';
  id: string;
  label: string;
  icon: string;
  text: string;
  detail: string;
  color: string;
  time: string;      // "HH:mm" — boş string ise bilinmiyor
  loggedAt: number;  // sıralama için ms epoch (bilinmiyorsa 0)
};

// FIX (ux-pass2 #14): her satırda saat göster + kronolojik sıralama için ms değeri.
const fmtTime = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};
const toMs = (iso?: string | null): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function ActivityTimeline({ meals, workouts, onDeleteMeal, onDeleteWorkout, hideEmptyCta }: Props) {
  const { colors, isDark } = useTheme();

  // FIX (ux-pass2 #14): antrenmanlar öğünlerin arkasına körlemesine ekleniyordu —
  // artık iki tür logged_at'e göre TEK kronolojik zaman çizelgesinde birleşir.
  const activities: Activity[] = [
    ...meals.map(m => ({
      type: 'meal' as const,
      id: m.id,
      label: mealTypeLabelTR(m.meal_type),
      icon: MEAL_ICONS[m.meal_type] ?? 'restaurant-outline',
      text: m.raw_input,
      detail: `${m.calories} kcal`,
      color: METRIC_COLORS.calories,
      time: fmtTime(m.logged_at),
      loggedAt: toMs(m.logged_at),
    })),
    ...workouts.map(w => ({
      type: 'workout' as const,
      id: w.id,
      label: 'Antrenman',
      icon: 'barbell-outline',
      text: w.raw_input,
      detail: w.duration_min > 0 ? `${w.duration_min} dk` : '',
      color: METRIC_COLORS.workout,
      time: fmtTime(w.logged_at),
      loggedAt: toMs(w.logged_at),
    })),
  ].sort((a, b) => a.loggedAt - b.loggedAt);

  const totalActivities = activities.length;

  // FIX (ux-pass5): silme ağ turu boyunca satırda hiçbir gösterge yoktu — satır 1-3 sn
  // dokunulmamış görünüp 'silinmedi' hissi veriyor, tekrar dokunuş akışı yeniden başlatıyordu.
  // Silinen satır devre dışı + spinner; eşzamanlı ikinci silme de kilitlenir.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const runDelete = async (activity: Activity) => {
    if (deletingId) return;
    setDeletingId(activity.id);
    try {
      await (activity.type === 'meal' ? onDeleteMeal(activity.id) : onDeleteWorkout(activity.id));
      haptics.success();
      // FIX (ux-ideas #15): visible confirmation for a delete (was haptic-only) via the shared toast.
      showToast(activity.type === 'meal' ? 'Öğün silindi' : 'Antrenman silindi', { variant: 'info' });
    } catch (err) {
      haptics.error();
      // FIX (ux-round2 #18): delete can't be queued offline (the store throws 'offline: …'). The
      // old generic 'tekrar dene' sent the user into a retry loop that failed identically — tell
      // the real reason so they know to reconnect, not re-tap.
      const offline = err instanceof Error && err.message.startsWith('offline:');
      Alert.alert('Silinemedi', offline
        ? 'Çevrimdışısın — silmek için internet gerekiyor. Bağlanınca tekrar dene.'
        : 'Bir şeyler ters gitti, lütfen tekrar dene.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        <Text style={{ fontSize: FONT.md, fontWeight: '700', color: colors.text }}>Aktiviteler</Text>
        {totalActivities > 0 && (
          /* FIX (ux-polish): label the count so a screen reader says "3 aktivite", not a bare "3". */
          <View accessible accessibilityLabel={`${totalActivities} aktivite`} style={{ backgroundColor: colors.primary + '18', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '700' }}>{totalActivities}</Text>
          </View>
        )}
      </View>

      {/* Empty state — FIX (ux-pass2 #13): eylemsiz View'dı; artık sohbeti açan gerçek CTA. */}
      {totalActivities === 0 && !hideEmptyCta && (
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/chat' as never)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Bugün henüz kayıt yok. Koçuna ne yediğini yazmak için dokun"
          style={{ alignItems: 'center', paddingVertical: SPACING.xl }}
        >
          <View style={{
            width: 56, height: 56, borderRadius: 18,
            backgroundColor: colors.surfaceLight,
            alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm,
          }}>
            <Ionicons name="restaurant-outline" size={28} color={colors.textMuted} />
          </View>
          <Text style={{ color: colors.textMuted, fontSize: FONT.sm }}>Bugün henüz kayıt yok</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '600' }}>Koçuna ne yediğini yaz</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </View>
        </TouchableOpacity>
      )}

      {/* Timeline */}
      {totalActivities > 0 && (
        <View style={{ paddingLeft: 24 }}>
          {/* Vertical line */}
          <View style={{
            position: 'absolute', left: 8, top: 8, bottom: 8,
            width: HERO.TIMELINE_LINE_WIDTH,
            backgroundColor: colors.border,
            borderRadius: 1,
          }} />

          {activities.map((activity, idx) => (
            <TouchableOpacity
              key={activity.id}
              activeOpacity={0.7}
              // FIX (ux-pass5): silme sürerken satır devre dışı — çift tetikleme ve
              // 'ölü satır' yeniden-dokunuşları engellenir.
              disabled={deletingId === activity.id}
              // FIX (ux-pass5): etkileşimli satırlar rolsüz/etiketsizdi — ekran okuyucu
              // eylemsiz metin olarak okuyordu; sil/detay yolu keşfedilemezdi.
              accessibilityRole="button"
              accessibilityLabel={[activity.label, activity.text, activity.detail, activity.time ? `saat ${activity.time}` : '']
                .filter(Boolean).join(', ')}
              accessibilityHint="Detayı görmek için dokun, silmek için basılı tut"
              // FIX (ux-pass2 #14): satırlar dokunulabilir görünüyordu ama yalnız gizli
              // long-press'e cevap veriyordu — tap artık saat + detay gösteren ve 'Sil'
              // sunan gerçek bir eylem.
              onPress={() => {
                haptics.tap(); // FIX (ux-pass5): kardeş dokunuşlarla (log.tsx satırları) tutarlı dokunsal onay.
                const metaLine = [activity.time ? `Saat: ${activity.time}` : null, activity.detail || null]
                  .filter(Boolean).join(' · ');
                Alert.alert(
                  activity.label,
                  metaLine ? `${activity.text}\n\n${metaLine}` : activity.text,
                  [
                    { text: 'Kapat', style: 'cancel' },
                    // FIX (ux-ideas #22): a mis-parsed log ("2 yumurta" → "3 yumurta") no longer
                    // forces a full delete + re-entry. "Düzenle" opens the coach prefilled to
                    // correct THIS entry — the AI-first way to fix a quantity/calorie.
                    { text: 'Düzenle', onPress: () => { haptics.tap(); router.push({ pathname: '/(tabs)/chat', params: { prefill: `"${activity.text}" kaydımı düzeltmek istiyorum: `, taskNonce: String(Date.now()) } }); } },
                    { text: 'Sil', style: 'destructive', onPress: () => runDelete(activity) },
                  ],
                );
              }}
              onLongPress={() => {
                haptics.tap(); // FIX (ux-pass5): long-press'e de dokunsal onay.
                // FIX (audit UX-FBK-01/HIGH): a long-press used to delete the meal/workout
                // INSTANTLY with no confirmation and no undo (workout delete is a hard delete) —
                // far too easy to wipe a log by accident. Require an explicit destructive confirm.
                const isMeal = activity.type === 'meal';
                Alert.alert(
                  isMeal ? 'Öğünü sil' : 'Antrenmanı sil',
                  `"${activity.label}" kaydını silmek istediğine emin misin? Bu işlem geri alınamaz.`,
                  [
                    { text: 'Vazgeç', style: 'cancel' },
                    { text: 'Sil', style: 'destructive', onPress: () => runDelete(activity) },
                  ],
                );
              }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: SPACING.sm,
                // FIX (ux-pass5): silinen satır soluklaşır — işlemde olduğu görünür.
                opacity: deletingId === activity.id ? 0.5 : 1,
                ...(idx < totalActivities - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
              }}
            >
              {/* Dot */}
              <View style={{
                position: 'absolute', left: -20,
                width: HERO.TIMELINE_DOT_SIZE, height: HERO.TIMELINE_DOT_SIZE,
                borderRadius: HERO.TIMELINE_DOT_SIZE / 2,
                backgroundColor: activity.color,
                borderWidth: 2, borderColor: colors.background,
              }} />

              {/* Icon */}
              <View style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: activity.color + '12',
                alignItems: 'center', justifyContent: 'center',
                marginRight: SPACING.sm,
              }}>
                <Ionicons name={activity.icon as any} size={16} color={activity.color} />
              </View>

              {/* Content */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: FONT.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {activity.label}
                </Text>
                <Text style={{ fontSize: FONT.sm, color: colors.text, marginTop: 1 }} numberOfLines={1}>{activity.text}</Text>
              </View>

              {/* FIX (ux-pass2 #14): satır başına HH:mm */}
              {activity.time ? (
                <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginRight: activity.detail ? SPACING.sm : 0 }}>
                  {activity.time}
                </Text>
              ) : null}

              {/* Detail — FIX (ux-pass5): silme sürerken rozet yerine spinner. */}
              {deletingId === activity.id ? (
                <ActivityIndicator size="small" color={activity.color} />
              ) : activity.detail ? (
                <View style={{ backgroundColor: activity.color + '12', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: FONT.xs, color: activity.color, fontWeight: '700' }}>{activity.detail}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
