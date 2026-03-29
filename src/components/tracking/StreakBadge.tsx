/**
 * Streak Badge — Spec 13.1
 * Shows consecutive day count with tier-based coloring.
 * Tiers: 100+ (gold), 30+ (green), 7+ (purple), 2+ (gray).
 * Hidden when streak < 2.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  days: number;
  compact?: boolean;
}

const TIERS = [
  { min: 100, color: '#FFD700', bg: '#FFD70020', label: 'Efsane Seri', emoji: '🏆' },
  { min: 30, color: COLORS.success, bg: COLORS.success + '20', label: 'Harika Seri', emoji: '🔥' },
  { min: 7, color: COLORS.primary, bg: COLORS.primary + '20', label: 'Iyi Gidiyorsun', emoji: '⚡' },
  { min: 2, color: COLORS.textSecondary, bg: COLORS.surfaceLight, label: 'Seri', emoji: '' },
];

export function StreakBadge({ days, compact }: Props) {
  if (days < 2) return null;

  const tier = TIERS.find(t => days >= t.min) ?? TIERS[TIERS.length - 1];

  if (compact) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs }}>
        <Text style={{ color: tier.color, fontSize: FONT.sm, fontWeight: '800' }}>{days}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>gun</Text>
      </View>
    );
  }

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
      backgroundColor: tier.bg, borderRadius: RADIUS.sm,
      paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
      borderWidth: 1, borderColor: tier.color + '40',
    }}>
      {tier.emoji ? <Text style={{ fontSize: 14 }}>{tier.emoji}</Text> : null}
      <Text style={{ color: tier.color, fontSize: FONT.md, fontWeight: '800' }}>{days}</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>gun seri</Text>
    </View>
  );
}
