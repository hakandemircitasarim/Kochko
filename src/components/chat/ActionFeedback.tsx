/**
 * Action Feedback Display — Spec 5.2
 * Shows inline confirmation when AI executes actions from chat.
 * Grouped by type, with emoji icons and macro details.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface ActionItem {
  type: string;
  feedback: string | null;
}

interface Props {
  actions: ActionItem[];
}

const ACTION_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  meal_log: { label: 'Ogun kaydedildi', emoji: '🍽️', color: COLORS.success },
  workout_log: { label: 'Antrenman kaydedildi', emoji: '💪', color: COLORS.primary },
  weight_log: { label: 'Tarti kaydedildi', emoji: '⚖️', color: COLORS.info },
  water_log: { label: 'Su kaydedildi', emoji: '💧', color: COLORS.water },
  sleep_log: { label: 'Uyku kaydedildi', emoji: '😴', color: COLORS.sleep },
  mood_log: { label: 'Mood kaydedildi', emoji: '😊', color: COLORS.mood },
  supplement_log: { label: 'Takviye kaydedildi', emoji: '💊', color: COLORS.warning },
  commitment: { label: 'Taahhut olusturuldu', emoji: '🎯', color: COLORS.primary },
  profile_update: { label: 'Profil guncellendi', emoji: '📝', color: COLORS.info },
  venue_log: { label: 'Mekan ogrenildi', emoji: '📍', color: COLORS.warning },
};

export function ActionFeedback({ actions }: Props) {
  const executed = actions.filter(a => a.feedback);
  if (executed.length === 0) return null;

  return (
    <View style={{ marginTop: SPACING.xs, gap: SPACING.xxs }}>
      {executed.map((a, i) => {
        const config = ACTION_CONFIG[a.type] ?? { label: a.type, emoji: '✓', color: COLORS.success };

        return (
          <View key={i} style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: config.color + '12', borderRadius: RADIUS.sm,
            paddingVertical: SPACING.xxs, paddingHorizontal: SPACING.sm, gap: SPACING.xs,
          }}>
            <Text style={{ fontSize: 14 }}>{config.emoji}</Text>
            <Text style={{ color: config.color, fontSize: FONT.xs, fontWeight: '600', flex: 1 }}>
              {a.feedback ?? config.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
