/**
 * Action Feedback Display - Theme-aware
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';

interface Props {
  actions: { type: string; feedback: string | null }[];
}

const ACTION_ICONS: Record<string, { icon: string; label: string }> = {
  meal_log: { icon: 'restaurant', label: 'Öğün' },
  workout_log: { icon: 'barbell', label: 'Antrenman' },
  weight_log: { icon: 'scale', label: 'Tartı' },
  water_log: { icon: 'water', label: 'Su' },
  sleep_log: { icon: 'moon', label: 'Uyku' },
  mood_log: { icon: 'happy', label: 'Mood' },
  supplement_log: { icon: 'medical', label: 'Supplement' },
  profile_update: { icon: 'person', label: 'Profil' },
  undo_last: { icon: 'arrow-undo', label: 'Geri alındı' },
};

export function ActionFeedback({ actions }: Props) {
  const { colors } = useTheme();
  const executed = actions.filter(a => a.feedback);
  if (executed.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs }}>
      {executed.map((a, i) => (
        <View key={i} style={{
          flexDirection: 'row', alignItems: 'center', gap: 4,
          backgroundColor: colors.success + '15', borderRadius: 8,
          paddingVertical: 3, paddingHorizontal: SPACING.sm,
        }}>
          <Ionicons name="checkmark-circle" size={12} color={colors.success} />
          <Text style={{ color: colors.success, fontSize: FONT.xs, fontWeight: '600' }}>
            {a.feedback ?? ACTION_ICONS[a.type]?.label ?? a.type}
          </Text>
        </View>
      ))}
    </View>
  );
}
