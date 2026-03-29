/**
 * Meal Option Card — Spec 7.1
 * Displays a single meal suggestion from the plan.
 * Shows: name, description, full macros, prep time, difficulty indicator,
 * allergen warning if detected, and selection state.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface MealOption {
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  prep_time_min?: number;
  ingredients?: string[];
  allergen_warning?: string;
  tags?: string[]; // e.g. 'high_protein', 'quick', 'vegetarian'
}

interface Props {
  option: MealOption;
  onSelect?: () => void;
  selected?: boolean;
}

const TAG_LABELS: Record<string, { label: string; color: string }> = {
  high_protein: { label: 'Yuksek Protein', color: COLORS.protein },
  quick: { label: 'Hizli', color: COLORS.success },
  vegetarian: { label: 'Vejetaryen', color: '#4CAF50' },
  low_carb: { label: 'Dusuk Karb', color: COLORS.warning },
  meal_prep: { label: 'Onceden Hazirla', color: COLORS.info },
};

export function MealOptionCard({ option, onSelect, selected }: Props) {
  const totalMacroG = option.protein_g + option.carbs_g + option.fat_g;
  const proteinPct = totalMacroG > 0 ? Math.round((option.protein_g / totalMacroG) * 100) : 0;

  return (
    <TouchableOpacity
      onPress={onSelect}
      activeOpacity={onSelect ? 0.7 : 1}
      style={{
        backgroundColor: selected ? COLORS.primary + '10' : COLORS.card,
        borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? COLORS.primary : COLORS.border,
      }}
    >
      {/* Header: name + selected badge */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: SPACING.sm }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700' }}>{option.name}</Text>
          {option.description ? (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 2, lineHeight: 20 }}>{option.description}</Text>
          ) : null}
        </View>
        {selected && (
          <View style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>Secildi</Text>
          </View>
        )}
      </View>

      {/* Allergen warning */}
      {option.allergen_warning && (
        <View style={{ backgroundColor: COLORS.error + '15', borderRadius: RADIUS.xs, padding: SPACING.xs, marginTop: SPACING.xs }}>
          <Text style={{ color: COLORS.error, fontSize: FONT.xs, fontWeight: '600' }}>⚠ {option.allergen_warning}</Text>
        </View>
      )}

      {/* Tags */}
      {option.tags && option.tags.length > 0 && (
        <View style={{ flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.xs, flexWrap: 'wrap' }}>
          {option.tags.map(tag => {
            const config = TAG_LABELS[tag];
            if (!config) return null;
            return (
              <View key={tag} style={{ backgroundColor: config.color + '15', borderRadius: RADIUS.xs, paddingHorizontal: SPACING.xs, paddingVertical: 1 }}>
                <Text style={{ color: config.color, fontSize: 10, fontWeight: '600' }}>{config.label}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Macro bars — visual proportion */}
      <View style={{ flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: SPACING.sm, marginBottom: SPACING.xs }}>
        <View style={{ flex: option.protein_g * 4, backgroundColor: COLORS.protein, borderRadius: 2 }} />
        <View style={{ width: 1 }} />
        <View style={{ flex: option.carbs_g * 4, backgroundColor: COLORS.carbs, borderRadius: 2 }} />
        <View style={{ width: 1 }} />
        <View style={{ flex: option.fat_g * 9, backgroundColor: COLORS.fat, borderRadius: 2 }} />
      </View>

      {/* Macro numbers */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: SPACING.md }}>
          <MacroValue label="Kalori" value={`${option.calories}`} unit="kcal" color={COLORS.text} />
          <MacroValue label="Protein" value={`${option.protein_g}`} unit="g" color={COLORS.protein} />
          <MacroValue label="Karb" value={`${option.carbs_g}`} unit="g" color={COLORS.carbs} />
          <MacroValue label="Yag" value={`${option.fat_g}`} unit="g" color={COLORS.fat} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          {option.prep_time_min != null && option.prep_time_min > 0 && (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{option.prep_time_min}dk</Text>
          )}
          <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>P{proteinPct}%</Text>
        </View>
      </View>

      {/* Ingredients preview */}
      {option.ingredients && option.ingredients.length > 0 && (
        <View style={{ marginTop: SPACING.xs }}>
          <Text style={{ color: COLORS.textMuted, fontSize: 10, lineHeight: 16 }}>
            Malzemeler: {option.ingredients.slice(0, 5).join(', ')}{option.ingredients.length > 5 ? ` +${option.ingredients.length - 5}` : ''}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function MacroValue({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View>
      <Text style={{ color, fontSize: FONT.sm, fontWeight: '700' }}>{value}<Text style={{ fontSize: 10, fontWeight: '400' }}>{unit}</Text></Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 9 }}>{label}</Text>
    </View>
  );
}
