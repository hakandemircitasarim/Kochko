/**
 * Activity Timeline - Meals and workouts in a unified timeline view.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, HERO, CARD_SHADOW } from '@/lib/constants';

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
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara',
};

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

export function ActivityTimeline({ meals, workouts, onDeleteMeal, onDeleteWorkout }: Props) {
  const { colors, isDark } = useTheme();

  // FIX (ux-pass2 #14): antrenmanlar öğünlerin arkasına körlemesine ekleniyordu —
  // artık iki tür logged_at'e göre TEK kronolojik zaman çizelgesinde birleşir.
  const activities: Activity[] = [
    ...meals.map(m => ({
      type: 'meal' as const,
      id: m.id,
      label: MEAL_LABELS[m.meal_type] ?? m.meal_type,
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

  const runDelete = async (activity: Activity) => {
    try {
      await (activity.type === 'meal' ? onDeleteMeal(activity.id) : onDeleteWorkout(activity.id));
    } catch {
      Alert.alert('Silinemedi', 'Bir şeyler ters gitti, lütfen tekrar dene.');
    }
  };

  return (
    <View>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        <Text style={{ fontSize: FONT.md, fontWeight: '700', color: colors.text }}>Aktiviteler</Text>
        {totalActivities > 0 && (
          <View style={{ backgroundColor: colors.primary + '18', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '700' }}>{totalActivities}</Text>
          </View>
        )}
      </View>

      {/* Empty state — FIX (ux-pass2 #13): eylemsiz View'dı; artık sohbeti açan gerçek CTA. */}
      {totalActivities === 0 && (
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
              // FIX (ux-pass2 #14): satırlar dokunulabilir görünüyordu ama yalnız gizli
              // long-press'e cevap veriyordu — tap artık saat + detay gösteren ve 'Sil'
              // sunan gerçek bir eylem.
              onPress={() => {
                const metaLine = [activity.time ? `Saat: ${activity.time}` : null, activity.detail || null]
                  .filter(Boolean).join(' · ');
                Alert.alert(
                  activity.label,
                  metaLine ? `${activity.text}\n\n${metaLine}` : activity.text,
                  [
                    { text: 'Kapat', style: 'cancel' },
                    { text: 'Sil', style: 'destructive', onPress: () => runDelete(activity) },
                  ],
                );
              }}
              onLongPress={() => {
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

              {/* Detail */}
              {activity.detail ? (
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
