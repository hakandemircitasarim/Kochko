/**
 * Meal Option Card - displays a single meal suggestion from the plan.
 * Shows name, description, macros, prep time, and "use this" action.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface MealOption {
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  prep_time_min?: number;
}

interface Props {
  option: MealOption;
  onSelect?: () => void;
  selected?: boolean;
}

export function MealOptionCard({ option, onSelect, selected }: Props) {
  return (
    <TouchableOpacity
      onPress={onSelect}
      style={{
        backgroundColor: selected ? COLORS.surfaceLight : COLORS.card,
        borderRadius: 12,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? COLORS.primary : COLORS.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: SPACING.sm }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{option.name}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 2, lineHeight: 20 }}>{option.description}</Text>
        </View>
        {selected && (
          <View style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '600' }}>Secildi</Text>
          </View>
        )}
      </View>

      {/* Macros row */}
      <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm }}>
        <MacroPill label="Kal" value={`${option.calories}`} color={COLORS.primary} />
        <MacroPill label="Pro" value={`${option.protein_g}g`} color="#4CAF50" />
        <MacroPill label="Karb" value={`${option.carbs_g}g`} color="#FF9800" />
        <MacroPill label="Yag" value={`${option.fat_g}g`} color="#F44336" />
        {option.prep_time_min && <MacroPill label="" value={`${option.prep_time_min}dk`} color={COLORS.textMuted} />}
      </View>
    </TouchableOpacity>
  );
}

function MacroPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {label ? <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>{label}</Text> : null}
      <Text style={{ color, fontSize: FONT.xs, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}
