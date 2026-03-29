/**
 * Compliance Score — Spec 8.1
 * Large visual display for daily/weekly compliance.
 * Ring progress, color tiers, contextual messages.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  score: number;
  label?: string;
  size?: 'small' | 'large';
  showMessage?: boolean;
}

const TIERS = [
  { min: 90, color: COLORS.success, label: 'Mukemmel', message: 'Bugün harika gecti!' },
  { min: 80, color: COLORS.success, label: 'Cok Iyi', message: 'Guzel bir gun, devam et.' },
  { min: 70, color: '#8BC34A', label: 'Iyi', message: 'Iyi gidiyorsun.' },
  { min: 60, color: COLORS.warning, label: 'Orta', message: 'Bir iki sey kacti ama felaket degil.' },
  { min: 40, color: COLORS.warning, label: 'Dusuk', message: 'Yarin daha iyi olabilir.' },
  { min: 0, color: COLORS.error, label: 'Zayif', message: 'Herkesin kotu gunu olur. Yarina odaklan.' },
];

function getTier(score: number) {
  return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];
}

export function ComplianceScore({ score, label = 'Uyum Puani', size = 'large', showMessage = false }: Props) {
  const tier = getTier(score);
  const ringSize = size === 'large' ? 130 : 80;
  const ringWidth = size === 'large' ? 10 : 6;
  const scoreFontSize = size === 'large' ? 48 : 28;

  // Progress ring: fill borders based on score quarters
  const q1 = score >= 25; // top
  const q2 = score >= 50; // right
  const q3 = score >= 75; // bottom
  const q4 = score >= 100; // left

  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
      {/* Score ring */}
      <View style={{
        width: ringSize, height: ringSize, borderRadius: ringSize / 2,
        borderWidth: ringWidth, borderColor: COLORS.surfaceLight,
        justifyContent: 'center', alignItems: 'center',
        borderTopColor: q1 ? tier.color : COLORS.surfaceLight,
        borderRightColor: q2 ? tier.color : COLORS.surfaceLight,
        borderBottomColor: q3 ? tier.color : COLORS.surfaceLight,
        borderLeftColor: q4 ? tier.color : COLORS.surfaceLight,
      }}>
        <Text style={{ color: tier.color, fontSize: scoreFontSize, fontWeight: '800' }}>{score}</Text>
      </View>

      {/* Label */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, marginTop: SPACING.sm }}>{label}</Text>

      {/* Tier label + message */}
      {size === 'large' && (
        <View style={{ alignItems: 'center', marginTop: SPACING.xs }}>
          <View style={{ backgroundColor: tier.color + '20', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 2 }}>
            <Text style={{ color: tier.color, fontSize: FONT.sm, fontWeight: '700' }}>{tier.label}</Text>
          </View>
          {showMessage && (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.xs, textAlign: 'center' }}>
              {tier.message}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Inline compliance badge for calendar/lists.
 */
export function ComplianceBadge({ score }: { score: number }) {
  const tier = getTier(score);
  return (
    <View style={{ backgroundColor: tier.color + '20', borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: tier.color, fontSize: FONT.xs, fontWeight: '700' }}>{score}</Text>
    </View>
  );
}

/**
 * Compliance mini bar — horizontal progress for compact views.
 */
export function ComplianceMiniBar({ score, width = 60 }: { score: number; width?: number }) {
  const tier = getTier(score);
  return (
    <View style={{ width, height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${Math.min(100, score)}%`, backgroundColor: tier.color, borderRadius: 3 }} />
    </View>
  );
}
