/**
 * Water Tracker Widget - Modern design with wave-like progress
 * Spec 2.7, 3.1: Always visible, single tap +0.25L
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, GRADIENTS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW, WATER_INCREMENT } from '@/lib/constants';
import { GradientCard } from '@/components/ui/GradientCard';

interface Props {
  current: number;
  target: number;
  onAdd: () => void;
}

export function WaterTracker({ current, target, onAdd }: Props) {
  const { colors, isDark } = useTheme();
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const completed = pct >= 1;

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.xxl,
      padding: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Left: icon + info */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 }}>
          <View style={{
            width: 44, height: 44, borderRadius: 14,
            backgroundColor: GRADIENTS.water[0] + '20',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="water" size={22} color={GRADIENTS.water[0]} />
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '800' }}>
              {current.toFixed(1)}L
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
              / {target.toFixed(1)}L hedef
            </Text>
          </View>
        </View>

        {/* Right: add button */}
        <TouchableOpacity
          onPress={onAdd}
          activeOpacity={0.7}
          style={{
            backgroundColor: completed ? colors.success : GRADIENTS.water[1],
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.sm + 2,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Ionicons name={completed ? 'checkmark' : 'add'} size={18} color="#fff" />
          <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>
            {completed ? 'Tamam' : `+${WATER_INCREMENT}L`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={{
        height: 8,
        backgroundColor: colors.surfaceLight,
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: SPACING.sm + 2,
      }}>
        <View style={{
          height: '100%',
          width: `${pct * 100}%`,
          backgroundColor: completed ? colors.success : GRADIENTS.water[0],
          borderRadius: 4,
        }} />
      </View>
    </View>
  );
}
