/**
 * Compliance Score Display - big number with ring/color.
 * Used in daily and weekly reports.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  score: number;
  label?: string;
  size?: 'small' | 'large';
}

export function ComplianceScore({ score, label = 'Uyum Puani', size = 'large' }: Props) {
  const color = score >= 80 ? COLORS.success : score >= 60 ? '#8BC34A' : score >= 40 ? COLORS.warning : COLORS.error;
  const fontSize = size === 'large' ? 64 : 40;
  const ringSize = size === 'large' ? 120 : 80;
  const ringWidth = size === 'large' ? 8 : 5;

  // SVG-like ring using border (simplified)
  const rotation = (score / 100) * 360;

  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
      <View style={{
        width: ringSize, height: ringSize, borderRadius: ringSize / 2,
        borderWidth: ringWidth, borderColor: COLORS.surfaceLight,
        justifyContent: 'center', alignItems: 'center',
        // Overlay colored border for progress
        borderTopColor: score >= 25 ? color : COLORS.surfaceLight,
        borderRightColor: score >= 50 ? color : COLORS.surfaceLight,
        borderBottomColor: score >= 75 ? color : COLORS.surfaceLight,
        borderLeftColor: score >= 100 ? color : COLORS.surfaceLight,
      }}>
        <Text style={{ color, fontSize, fontWeight: '800' }}>{score}</Text>
      </View>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, marginTop: SPACING.sm }}>{label}</Text>
    </View>
  );
}

/**
 * Inline compliance badge for lists/calendar.
 */
export function ComplianceBadge({ score }: { score: number }) {
  const color = score >= 80 ? COLORS.success : score >= 60 ? '#8BC34A' : score >= 40 ? COLORS.warning : COLORS.error;
  return (
    <View style={{ backgroundColor: color + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: FONT.xs, fontWeight: '700' }}>{score}</Text>
    </View>
  );
}
