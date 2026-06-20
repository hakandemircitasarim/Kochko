/**
 * Compliance Score Display - big number with ring/color.
 * Used in daily and weekly reports.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { CircularProgress } from '@/components/ui/CircularProgress';

/**
 * App-wide compliance color ramp (70/40 thresholds) — matches calendar,
 * daily and weekly reports so a given score reads as one consistent judgment.
 */
function getComplianceColor(score: number): string {
  return score >= 70 ? COLORS.success : score >= 40 ? COLORS.warning : COLORS.error;
}

interface Props {
  score: number;
  label?: string;
  size?: 'small' | 'large';
}

export function ComplianceScore({ score, label = 'Uyum Puanı', size = 'large' }: Props) {
  const color = getComplianceColor(score);
  const ringSize = size === 'large' ? 120 : 80;
  const ringWidth = size === 'large' ? 8 : 5;

  return (
    <View
      style={{ alignItems: 'center', paddingVertical: SPACING.md }}
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: 100 üzerinden ${score}`}
    >
      <CircularProgress
        progress={score / 100}
        value={score}
        size={ringSize}
        strokeWidth={ringWidth}
        color={color}
      />
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, marginTop: SPACING.sm }}>{label}</Text>
    </View>
  );
}

/**
 * Inline compliance badge for lists/calendar.
 */
export function ComplianceBadge({ score }: { score: number }) {
  const color = getComplianceColor(score);
  return (
    <View style={{ backgroundColor: color + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: FONT.xs, fontWeight: '700' }}>{score}</Text>
    </View>
  );
}
