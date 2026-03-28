/**
 * Streak Badge
 * Spec 13.1: Ardışık gün kaydı gösterimi
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  days: number;
}

export function StreakBadge({ days }: Props) {
  if (days < 2) return null;

  const color = days >= 30 ? COLORS.success : days >= 7 ? COLORS.primary : COLORS.textSecondary;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, backgroundColor: COLORS.card, borderRadius: 8, paddingVertical: 4, paddingHorizontal: SPACING.sm, borderWidth: 1, borderColor: color }}>
      <Text style={{ color, fontSize: FONT.sm, fontWeight: '700' }}>{days}</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>gun seri</Text>
    </View>
  );
}
