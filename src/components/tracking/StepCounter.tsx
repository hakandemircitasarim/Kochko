/**
 * Step Counter Display
 * Spec 3.1, 14.2: Telefon sensöründen otomatik adım, wearable öncelikli.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  steps: number | null;
  target: number;
  source: 'manual' | 'phone' | 'wearable';
}

export function StepCounter({ steps, target, source }: Props) {
  const current = steps ?? 0;
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const color = pct >= 1 ? COLORS.success : pct >= 0.7 ? COLORS.primary : COLORS.textMuted;

  const sourceLabel = source === 'wearable' ? 'Wearable' : source === 'phone' ? 'Telefon' : 'Manuel';

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Adim</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{sourceLabel}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xs }}>
        <Text style={{ color, fontSize: FONT.xxl, fontWeight: '800' }}>{current.toLocaleString('tr-TR')}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>/ {target.toLocaleString('tr-TR')}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden', marginTop: SPACING.sm }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}
