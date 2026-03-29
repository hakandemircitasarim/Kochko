/**
 * Step Counter Display — Spec 3.1, 14.2
 * Shows daily steps with goal progress, source indicator, and color tiers.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  steps: number | null;
  target: number;
  source: 'manual' | 'phone' | 'wearable';
}

const SOURCE_LABELS: Record<string, string> = {
  wearable: 'Wearable',
  phone: 'Telefon',
  manual: 'Manuel',
};

export function StepCounter({ steps, target, source }: Props) {
  const current = steps ?? 0;
  const pct = target > 0 ? Math.min(1.2, current / target) : 0;
  const displayPct = Math.min(1, pct);
  const color = pct >= 1 ? COLORS.success : pct >= 0.7 ? COLORS.steps : COLORS.textMuted;
  const remaining = Math.max(0, target - current);

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: pct >= 1 ? COLORS.success : COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Adim</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: source === 'wearable' ? COLORS.success : source === 'phone' ? COLORS.primary : COLORS.textMuted }} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{SOURCE_LABELS[source]}</Text>
        </View>
      </View>

      {/* Step count + target */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xs, marginBottom: SPACING.xs }}>
        <Text style={{ color, fontSize: FONT.xxl, fontWeight: '800' }}>{current.toLocaleString('tr-TR')}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>/ {target.toLocaleString('tr-TR')}</Text>
      </View>

      {/* Progress bar */}
      <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden', marginBottom: SPACING.xs }}>
        <View style={{ height: '100%', width: `${displayPct * 100}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>

      {/* Footer */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>%{Math.round(pct * 100)}</Text>
        {pct < 1 && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{remaining.toLocaleString('tr-TR')} kaldi</Text>}
        {pct >= 1 && <Text style={{ color: COLORS.success, fontSize: FONT.xs, fontWeight: '600' }}>Hedef tamamlandi!</Text>}
      </View>
    </View>
  );
}
