/**
 * Water Tracker Widget — flat design
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';

interface Props {
  current: number;
  target: number;
  onAdd: () => void;
}

export function WaterTracker({ current, target, onAdd }: Props) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const completed = pct >= 1;

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.md,
      padding: SPACING.lg,
      borderWidth: 0.5,
      borderColor: colors.border,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 }}>
          <View style={{
            width: 36, height: 36, borderRadius: RADIUS.sm,
            backgroundColor: METRIC_COLORS.water + '18',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="water" size={18} color={METRIC_COLORS.water} />
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
              {current.toFixed(1)}L
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              / {target.toFixed(1)}L hedef
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={onAdd}
          activeOpacity={0.7}
          style={{
            backgroundColor: completed ? colors.primary : METRIC_COLORS.water,
            borderRadius: RADIUS.sm,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Ionicons name={completed ? 'checkmark' : 'add'} size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>
            {completed ? 'Tamam' : `+${WATER_INCREMENT}L`}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{
        height: 6,
        backgroundColor: colors.progressTrack,
        borderRadius: 3,
        overflow: 'hidden',
        marginTop: SPACING.sm + 2,
      }}>
        <View style={{
          height: '100%',
          width: `${pct * 100}%`,
          backgroundColor: completed ? colors.primary : METRIC_COLORS.water,
          borderRadius: 3,
        }} />
      </View>
    </View>
  );
}
