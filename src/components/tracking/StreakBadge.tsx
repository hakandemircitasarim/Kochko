/**
 * Streak Badge - Modern gradient pill
 * Spec 13.1: Ardisik gun kaydi gosterimi
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GRADIENTS } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  days: number;
}

export function StreakBadge({ days }: Props) {
  if (days < 2) return null;

  return (
    <LinearGradient
      colors={GRADIENTS.streak}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: RADIUS.full,
        paddingVertical: SPACING.xs + 2,
        paddingHorizontal: SPACING.sm + 4,
      }}
    >
      <Ionicons name="flame" size={16} color="#fff" />
      <Text style={{ color: '#fff', fontSize: FONT.md, fontWeight: '800' }}>{days}</Text>
    </LinearGradient>
  );
}
