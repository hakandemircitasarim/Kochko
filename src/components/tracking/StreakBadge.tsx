/**
 * Streak Badge — teal pill with flame icon (SVG/Ionicon)
 * No gradient, flat design
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  days: number;
}

export function StreakBadge({ days }: Props) {
  if (days < 2) return null;

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: RADIUS.pill,
      paddingVertical: SPACING.xs + 2,
      paddingHorizontal: SPACING.sm + 4,
      backgroundColor: '#1D9E75',
    }}>
      <Ionicons name="flame" size={14} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{days} gun</Text>
    </View>
  );
}
