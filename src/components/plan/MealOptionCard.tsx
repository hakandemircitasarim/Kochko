/**
 * Meal Option Card - Theme-aware modern design
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface MealOption {
  name: string; description: string; calories: number;
  protein_g: number; carbs_g: number; fat_g: number; prep_time_min?: number;
}

interface Props { option: MealOption; onSelect?: () => void; selected?: boolean; }

export function MealOptionCard({ option, onSelect, selected }: Props) {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity onPress={onSelect} activeOpacity={0.7}
      style={{
        backgroundColor: selected ? colors.primary + '08' : colors.card,
        borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.sm,
        borderWidth: selected ? 2 : 0, borderColor: selected ? colors.primary : 'transparent',
        ...(isDark ? (selected ? {} : { borderWidth: 1, borderColor: colors.border }) : CARD_SHADOW),
      }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: SPACING.sm }}>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>{option.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2, lineHeight: 20 }}>{option.description}</Text>
        </View>
        {selected && (
          <View style={{ backgroundColor: colors.primary, borderRadius: RADIUS.full, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm }}>
        <MacroPill value={`${option.calories}`} unit="kcal" color={colors.primary} colors={colors} />
        <MacroPill value={`${option.protein_g}g`} unit="pro" color="#667EEA" colors={colors} />
        <MacroPill value={`${option.carbs_g}g`} unit="karb" color="#F59E0B" colors={colors} />
        <MacroPill value={`${option.fat_g}g`} unit="yag" color="#EF4444" colors={colors} />
        {option.prep_time_min && <MacroPill value={`${option.prep_time_min}`} unit="dk" color={colors.textMuted} colors={colors} />}
      </View>
    </TouchableOpacity>
  );
}

function MacroPill({ value, unit, color, colors }: { value: string; unit: string; color: string; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
      <Text style={{ color, fontSize: FONT.sm, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 9 }}>{unit}</Text>
    </View>
  );
}
