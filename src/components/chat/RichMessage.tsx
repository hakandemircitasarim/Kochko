/**
 * Rich Message Components for Chat - Theme-aware
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

export function QuickSelectButtons({ options, onSelect }: { options: string[]; onSelect: (option: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm }}>
      {options.map((opt, i) => (
        <TouchableOpacity key={i} onPress={() => onSelect(opt)}
          style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary + '12', borderWidth: 1, borderColor: colors.primary + '30' }}>
          <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '600' }}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function MacroBar({ label, current, target, color }: { label: string; current: number; target: number; color: string }) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  return (
    <View style={{ marginBottom: SPACING.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: FONT.xs, fontWeight: '600' }}>{current} / {target}g</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

export function MacroSummary({ protein, carbs, fat, targets }: { protein: number; carbs: number; fat: number; targets: { protein: number; carbs: number; fat: number } }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm, ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW) }}>
      <MacroBar label="Protein" current={protein} target={targets.protein} color="#667EEA" />
      <MacroBar label="Karbonhidrat" current={carbs} target={targets.carbs} color="#F59E0B" />
      <MacroBar label="Yag" current={fat} target={targets.fat} color="#EF4444" />
    </View>
  );
}

export function ConfirmRejectButtons({ onConfirm, onReject }: { onConfirm: () => void; onReject: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
      <TouchableOpacity onPress={onConfirm}
        style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.success, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>Onayla</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onReject}
        style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.surfaceLight, alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Değiştir</Text>
      </TouchableOpacity>
    </View>
  );
}

export function SimulationCard({ foodName, calories, remaining, weeklyImpact }: { foodName: string; calories: number; remaining: number; weeklyImpact: string }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm, ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW) }}>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>{foodName}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: colors.primary, fontSize: FONT.lg, fontWeight: '800' }}>{calories}</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>kcal</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: remaining >= 0 ? colors.success : colors.error, fontSize: FONT.lg, fontWeight: '800' }}>{remaining >= 0 ? remaining : `${Math.abs(remaining)} fazla`}</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>kalan butce</Text>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.sm }}>{weeklyImpact}</Text>
    </View>
  );
}

export function RecipeCard({ title, prepTime, servings, ingredients, macros }: { title: string; prepTime: number; servings: number; ingredients: { name: string; amount: string }[]; macros: { calories: number; protein: number; carbs: number; fat: number } }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm, ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW) }}>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>{prepTime} dk | {servings} porsiyon</Text>
      <View style={{ marginTop: SPACING.sm }}>
        {ingredients.map((ing, i) => (
          <Text key={i} style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20 }}>- {ing.amount} {ing.name}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        {[
          { v: macros.calories, l: 'kcal', c: colors.primary },
          { v: `${macros.protein}g`, l: 'protein', c: '#667EEA' },
          { v: `${macros.carbs}g`, l: 'karb', c: '#F59E0B' },
          { v: `${macros.fat}g`, l: 'yag', c: '#EF4444' },
        ].map((m, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: m.c, fontSize: FONT.md, fontWeight: '700' }}>{m.v}</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{m.l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ActionButtons({ actions, onAction }: { actions: { label: string; action: string; variant?: 'primary' | 'secondary' }[]; onAction: (action: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm }}>
      {actions.map((a, i) => (
        <TouchableOpacity key={i} onPress={() => onAction(a.action)}
          style={{ paddingVertical: 8, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: a.variant === 'primary' ? colors.primary : colors.surfaceLight }}>
          <Text style={{ color: a.variant === 'primary' ? '#fff' : colors.primary, fontSize: FONT.sm, fontWeight: '600' }}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const config = { high: { label: 'Yüksek güven', color: '#22C55E' }, medium: { label: 'Orta güven', color: '#F59E0B' }, low: { label: 'Düşük güven', color: '#EF4444' } };
  const c = config[level];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 8, borderRadius: RADIUS.full, backgroundColor: c.color + '15', alignSelf: 'flex-start', marginTop: SPACING.xs }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color, marginRight: 4 }} />
      <Text style={{ color: c.color, fontSize: FONT.xs, fontWeight: '600' }}>{c.label}</Text>
    </View>
  );
}

export function MakeSomethingElseButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress}
      style={{ paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center', marginTop: SPACING.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' }}>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>Başka bir şey öner</Text>
    </TouchableOpacity>
  );
}

export function WeeklyBudgetBar({ consumed, total }: { consumed: number; total: number }) {
  const { colors, isDark } = useTheme();
  const pct = total > 0 ? Math.min(1, consumed / total) : 0;
  const remaining = total - consumed;
  const color = pct > 0.9 ? colors.error : pct > 0.7 ? '#F59E0B' : colors.primary;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm, ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>Haftalık Bütçe</Text>
        <Text style={{ color: colors.text, fontSize: FONT.xs, fontWeight: '600' }}>{consumed} / {total} kcal</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.surfaceLight, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 4, textAlign: 'right' }}>Kalan: {remaining} kcal</Text>
    </View>
  );
}
