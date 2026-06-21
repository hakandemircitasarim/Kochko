/**
 * Streak Badge — teal pill with flame icon (SVG/Ionicon)
 * No gradient, flat design
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';

interface Props {
  days: number;
}

export function StreakBadge({ days }: Props) {
  const { colors } = useTheme();
  if (days < 2) return null;

  // FIX (audit UI-DS-02): use theme primary + AA-safe contrast color instead of
  // hardcoded '#1D9E75'/'#fff' (3.39:1 AA fail); fontSize from FONT scale.
  const fill = colors.primary;
  const fg = getContrastColor(fill);

  return (
    <View
      // FIX (audit UX-A11-04): announce the badge as a streak (matches DeviationTag).
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${days} günlük seri`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: RADIUS.pill,
        paddingVertical: SPACING.xs + 2,
        paddingHorizontal: SPACING.sm + 4,
        backgroundColor: fill,
      }}>
      <Ionicons name="flame" size={14} color={fg} />
      <Text style={{ color: fg, fontSize: FONT.xs, fontWeight: '600' }}>{days} gün</Text>
    </View>
  );
}
