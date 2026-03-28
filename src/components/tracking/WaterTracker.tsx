/**
 * Water Tracker Widget
 * Spec 2.7, 3.1: Always visible, single tap +0.25L
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT, WATER_INCREMENT } from '@/lib/constants';

interface Props {
  current: number;
  target: number;
  onAdd: () => void;
}

export function WaterTracker({ current, target, onAdd }: Props) {
  const pct = target > 0 ? Math.min(1, current / target) : 0;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>Su</Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{current.toFixed(1)} / {target.toFixed(1)}L</Text>
      </View>
      {/* Progress bar */}
      <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: pct >= 1 ? COLORS.success : COLORS.primary, borderRadius: 4 }} />
      </View>
      <TouchableOpacity
        onPress={onAdd}
        style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingVertical: SPACING.sm, alignItems: 'center' }}
      >
        <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>+{WATER_INCREMENT}L</Text>
      </TouchableOpacity>
    </View>
  );
}
