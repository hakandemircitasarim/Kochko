/**
 * Action Feedback Display
 * Shows inline confirmation when AI executes actions from chat.
 * "Öğün kaydedildi", "Tartı kaydedildi", etc.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  actions: { type: string; feedback: string | null }[];
}

const ACTION_ICONS: Record<string, string> = {
  meal_log: 'Ogun',
  workout_log: 'Antrenman',
  weight_log: 'Tarti',
  water_log: 'Su',
  sleep_log: 'Uyku',
  mood_log: 'Mood',
  supplement_log: 'Supplement',
  commitment: 'Taahhut',
  profile_update: 'Profil',
  venue_log: 'Mekan',
  periodic_state_update: 'Donem guncellendi',
  strength_log: 'Guc kaydi',
  save_recipe: 'Tarif kaydedildi',
  undo_last: 'Geri alindi',
};

export function ActionFeedback({ actions }: Props) {
  const executed = actions.filter(a => a.feedback);
  if (executed.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs }}>
      {executed.map((a, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceLight, borderRadius: 6, paddingVertical: 2, paddingHorizontal: SPACING.sm, gap: 4 }}>
          <Text style={{ color: COLORS.success, fontSize: 10, fontWeight: '700' }}>+</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{a.feedback ?? ACTION_ICONS[a.type] ?? a.type}</Text>
        </View>
      ))}
    </View>
  );
}
