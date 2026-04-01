/**
 * Rich Message Components for Chat
 * Spec 5.26: Zengin sohbet yanıtları
 * - Quick select buttons
 * - Macro donut (simplified as bar)
 * - Confirm/reject buttons
 * - Recipe card
 * - Simulation card
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

// Quick Select Buttons (2-3 options AI presents)
export function QuickSelectButtons({ options, onSelect }: {
  options: string[];
  onSelect: (option: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm }}>
      {options.map((opt, i) => (
        <TouchableOpacity key={i} onPress={() => onSelect(opt)}
          style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm }}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Macro Bar (simplified donut chart as horizontal bars)
export function MacroBar({ label, current, target, color }: {
  label: string; current: number; target: number; color: string;
}) {
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  return (
    <View style={{ marginBottom: SPACING.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>{current} / {target}g</Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

// Macro Summary (protein + carbs + fat bars together)
export function MacroSummary({ protein, carbs, fat, targets }: {
  protein: number; carbs: number; fat: number;
  targets: { protein: number; carbs: number; fat: number };
}) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.border }}>
      <MacroBar label="Protein" current={protein} target={targets.protein} color={COLORS.primary} />
      <MacroBar label="Karbonhidrat" current={carbs} target={targets.carbs} color={COLORS.success} />
      <MacroBar label="Yag" current={fat} target={targets.fat} color={COLORS.warning} />
    </View>
  );
}

// Confirm / Reject buttons for plan approval
export function ConfirmRejectButtons({ onConfirm, onReject }: {
  onConfirm: () => void; onReject: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
      <TouchableOpacity onPress={onConfirm}
        style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.success, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Onayla</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onReject}
        style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.surfaceLight, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Degistir</Text>
      </TouchableOpacity>
    </View>
  );
}

// Simulation Result Card ("sunu yesem ne olur?" response)
export function SimulationCard({ foodName, calories, remaining, weeklyImpact }: {
  foodName: string; calories: number; remaining: number; weeklyImpact: string;
}) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{foodName}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{calories}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>kcal</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: remaining >= 0 ? COLORS.success : COLORS.error, fontSize: FONT.lg, fontWeight: '700' }}>{remaining >= 0 ? remaining : `${Math.abs(remaining)} fazla`}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>kalan butce</Text>
        </View>
      </View>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.sm }}>{weeklyImpact}</Text>
    </View>
  );
}

// Recipe Card (rich recipe display in chat)
export function RecipeCard({ title, prepTime, servings, ingredients, macros }: {
  title: string;
  prepTime: number;
  servings: number;
  ingredients: { name: string; amount: string }[];
  macros: { calories: number; protein: number; carbs: number; fat: number };
}) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
        {prepTime} dk | {servings} porsiyon
      </Text>

      {/* Ingredients */}
      <View style={{ marginTop: SPACING.sm }}>
        {ingredients.map((ing, i) => (
          <Text key={i} style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>
            - {ing.amount} {ing.name}
          </Text>
        ))}
      </View>

      {/* Macro stats */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border }}>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '700' }}>{macros.calories}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>kcal</Text>
        </View>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: COLORS.success, fontSize: FONT.md, fontWeight: '700' }}>{macros.protein}g</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>protein</Text>
        </View>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '700' }}>{macros.carbs}g</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>karb</Text>
        </View>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, fontWeight: '700' }}>{macros.fat}g</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>yag</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Action Buttons (Phase 5) ───

export function ActionButtons({ actions, onAction }: {
  actions: { label: string; action: string; variant?: 'primary' | 'secondary' }[];
  onAction: (action: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm }}>
      {actions.map((a, i) => (
        <TouchableOpacity key={i} onPress={() => onAction(a.action)}
          style={{
            paddingVertical: 8, paddingHorizontal: SPACING.md, borderRadius: 8,
            backgroundColor: a.variant === 'primary' ? COLORS.primary : COLORS.surfaceLight,
            borderWidth: a.variant === 'primary' ? 0 : 1, borderColor: COLORS.border,
          }}>
          <Text style={{
            color: a.variant === 'primary' ? '#fff' : COLORS.primary,
            fontSize: FONT.sm, fontWeight: '600',
          }}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Confidence Badge (Yuksek/Orta/Dusuk)
export function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { label: 'Yuksek guven', color: COLORS.success, bg: '#E8F5E9' },
    medium: { label: 'Orta guven', color: COLORS.warning, bg: '#FFF8E1' },
    low: { label: 'Dusuk guven', color: COLORS.error, bg: '#FFEBEE' },
  };
  const c = config[level];

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 8,
      borderRadius: 12, backgroundColor: c.bg, alignSelf: 'flex-start', marginTop: SPACING.xs,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color, marginRight: 4 }} />
      <Text style={{ color: c.color, fontSize: FONT.xs, fontWeight: '600' }}>{c.label}</Text>
    </View>
  );
}

// "Make Something Else" Button (for plan/recipe cards)
export function MakeSomethingElseButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{
        paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: 8,
        backgroundColor: COLORS.surfaceLight, alignItems: 'center', marginTop: SPACING.sm,
        borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
      }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Baska bir sey oner</Text>
    </TouchableOpacity>
  );
}

// Weekly Budget Bar (inline in chat)
export function WeeklyBudgetBar({ consumed, total }: { consumed: number; total: number }) {
  const pct = total > 0 ? Math.min(1, consumed / total) : 0;
  const remaining = total - consumed;
  const color = pct > 0.9 ? COLORS.error : pct > 0.7 ? COLORS.warning : COLORS.primary;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Haftalik Butce</Text>
        <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>{consumed} / {total} kcal</Text>
      </View>
      <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 4, textAlign: 'right' }}>Kalan: {remaining} kcal</Text>
    </View>
  );
}
