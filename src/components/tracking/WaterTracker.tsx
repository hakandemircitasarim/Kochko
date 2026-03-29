/**
 * Water Tracker Widget — Spec 2.7, 3.1
 * Always visible on dashboard, single tap +0.25L.
 * Shows progress bar, percentage, remaining, and target-reached state.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS, WATER_INCREMENT, TOUCH_TARGET } from '@/lib/constants';

interface Props {
  current: number;
  target: number;
  onAdd: () => void;
  onSubtract?: () => void;
}

export function WaterTracker({ current, target, onAdd, onSubtract }: Props) {
  const pct = target > 0 ? Math.min(1.3, current / target) : 0;
  const displayPct = Math.min(1, pct);
  const remaining = Math.max(0, target - current);
  const isComplete = current >= target;
  const barColor = isComplete ? COLORS.success : COLORS.water;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: isComplete ? COLORS.success : COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xs }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>Su</Text>
          {isComplete && <Text style={{ color: COLORS.success, fontSize: FONT.xs, fontWeight: '600' }}>Tamamlandi!</Text>}
        </View>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>
          {current.toFixed(2)}L / {target.toFixed(1)}L
        </Text>
      </View>

      {/* Progress bar */}
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{
          height: '100%',
          width: `${displayPct * 100}%`,
          backgroundColor: barColor,
          borderRadius: 5,
        }} />
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
          %{Math.round(pct * 100)}
        </Text>
        {!isComplete && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
            {remaining.toFixed(1)}L kaldi
          </Text>
        )}
      </View>

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        {onSubtract && current > 0 && (
          <TouchableOpacity
            onPress={onSubtract}
            style={{
              backgroundColor: COLORS.surfaceLight, borderRadius: RADIUS.sm,
              paddingVertical: SPACING.sm, alignItems: 'center', minHeight: TOUCH_TARGET,
              justifyContent: 'center', width: 44,
            }}
          >
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.md, fontWeight: '600' }}>-</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={onAdd}
          style={{
            flex: 1, backgroundColor: isComplete ? COLORS.surfaceLight : COLORS.primary + '20',
            borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, alignItems: 'center',
            minHeight: TOUCH_TARGET, justifyContent: 'center',
            borderWidth: 1, borderColor: isComplete ? COLORS.border : COLORS.primary + '40',
          }}
        >
          <Text style={{ color: isComplete ? COLORS.textMuted : COLORS.water, fontSize: FONT.md, fontWeight: '700' }}>
            +{WATER_INCREMENT}L
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
