/**
 * Rich Message Components for Chat — flat dark design
 */
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';

export function QuickSelectButtons({ options, onSelect }: { options: string[]; onSelect: (option: string) => void }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SPACING.sm }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {options.map((opt, i) => (
          <TouchableOpacity key={i} onPress={() => onSelect(opt)}
            style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: colors.card, borderWidth: 0.5, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontSize: 12 }}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

export function MacroBar({ label, current, target, color }: { label: string; current: number; target: number; color: string }) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  return (
    <View style={{ marginBottom: SPACING.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 11, fontWeight: '500' }}>{current} / {target}g</Text>
      </View>
      <View style={{ height: 4, backgroundColor: colors.progressTrack, borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

export function MacroSummary({ protein, carbs, fat, targets }: { protein: number; carbs: number; fat: number; targets: { protein: number; carbs: number; fat: number } }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.cardElevated, borderRadius: RADIUS.sm, padding: SPACING.md, marginTop: SPACING.sm }}>
      <MacroBar label="Protein" current={protein} target={targets.protein} color={METRIC_COLORS.protein} />
      <MacroBar label="Karbonhidrat" current={carbs} target={targets.carbs} color={METRIC_COLORS.carbs} />
      <MacroBar label="Yag" current={fat} target={targets.fat} color={METRIC_COLORS.fat} />
    </View>
  );
}

export function ConfirmRejectButtons({ onConfirm, onReject }: { onConfirm: () => void; onReject: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
      <TouchableOpacity onPress={onConfirm}
        style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>Onayla</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onReject}
        style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>Değiştir</Text>
      </TouchableOpacity>
    </View>
  );
}

export function SimulationCard({ foodName, calories, remaining, weeklyImpact }: { foodName: string; calories: number; remaining: number; weeklyImpact: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg, marginTop: SPACING.sm, borderWidth: 0.5, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{foodName}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: METRIC_COLORS.fat, fontSize: 16, fontWeight: '700' }}>{calories}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>kcal</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: remaining >= 0 ? colors.primary : colors.error, fontSize: 16, fontWeight: '700' }}>
            {remaining >= 0 ? remaining : `${Math.abs(remaining)} fazla`}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>kalan</Text>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: SPACING.sm }}>{weeklyImpact}</Text>
    </View>
  );
}

export function RecipeCard({ title, prepTime, servings, ingredients, macros }: {
  title: string; prepTime: number; servings: number;
  ingredients: { name: string; amount: string }[];
  macros: { calories: number; protein: number; carbs: number; fat: number };
}) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.cardElevated, borderRadius: RADIUS.sm, padding: SPACING.lg, marginTop: SPACING.sm }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{title}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{prepTime} dk | {servings} porsiyon</Text>
      <View style={{ marginTop: SPACING.sm }}>
        {ingredients.map((ing, i) => (
          <Text key={i} style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>- {ing.amount} {ing.name}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 0.5, borderTopColor: colors.border }}>
        {[
          { v: macros.calories, l: 'kcal', c: colors.primary },
          { v: `${macros.protein}g`, l: 'protein', c: METRIC_COLORS.protein },
          { v: `${macros.carbs}g`, l: 'karb', c: METRIC_COLORS.carbs },
          { v: `${macros.fat}g`, l: 'yag', c: METRIC_COLORS.fat },
        ].map((m, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: m.c, fontSize: 14, fontWeight: '600' }}>{m.v}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>{m.l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ActionButtons({ actions, onAction }: { actions: { label: string; action: string; variant?: 'primary' | 'secondary' }[]; onAction: (action: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm }}>
      {actions.map((a, i) => (
        <TouchableOpacity key={i} onPress={() => onAction(a.action)}
          style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: a.variant === 'primary' ? colors.primary : colors.surfaceLight }}>
          <Text style={{ color: a.variant === 'primary' ? '#fff' : colors.primary, fontSize: 13, fontWeight: '500' }}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { label: 'Yüksek güven', color: '#1D9E75' },
    medium: { label: 'Orta güven', color: '#EF9F27' },
    low: { label: 'Düşük güven', color: '#D85A30' },
  };
  const c = config[level];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 8, borderRadius: RADIUS.pill, backgroundColor: c.color + '15', alignSelf: 'flex-start', marginTop: SPACING.xs }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color, marginRight: 4 }} />
      <Text style={{ color: c.color, fontSize: 11, fontWeight: '500' }}>{c.label}</Text>
    </View>
  );
}

export function MakeSomethingElseButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress}
      style={{ paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center', marginTop: SPACING.sm }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Başka bir şey öner</Text>
    </TouchableOpacity>
  );
}

export function WeeklyBudgetBar({ consumed, total }: { consumed: number; total: number }) {
  const { colors } = useTheme();
  const pct = total > 0 ? Math.min(1, consumed / total) : 0;
  const remaining = total - consumed;
  const color = pct > 0.9 ? colors.error : pct > 0.7 ? colors.warning : colors.primary;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 0.5, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>Haftalık Bütçe</Text>
        <Text style={{ color: colors.text, fontSize: 11, fontWeight: '500' }}>{consumed} / {total} kcal</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.progressTrack, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4, textAlign: 'right' }}>Kalan: {remaining} kcal</Text>
    </View>
  );
}
