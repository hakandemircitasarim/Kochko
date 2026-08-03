/**
 * Rich Message Components for Chat — flat dark design
 */
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

// FIX (audit UX-CHT-04): accept `disabled` so the parent can lock these inline action
// chips while a send is in flight — preventing a double-tap from firing two concurrent
// sends (duplicate AI turns / duplicate side-effecting log or delete).
export function QuickSelectButtons({ options, onSelect, disabled = false }: { options: string[]; onSelect: (option: string) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SPACING.sm }}>
      <View style={{ flexDirection: 'row', gap: 6, opacity: disabled ? 0.5 : 1 }}>
        {options.map((opt, i) => (
          <TouchableOpacity key={i} disabled={disabled} onPress={() => { haptics.tap(); onSelect(opt); }}
            accessibilityRole="button" accessibilityLabel={opt} accessibilityState={{ disabled }}
            style={{ paddingVertical: 8, paddingHorizontal: SPACING.md, minHeight: 36, justifyContent: 'center', borderRadius: RADIUS.pill, backgroundColor: colors.card, borderWidth: 0.5, borderColor: colors.border }}>
            <Text style={{ ...TYPE.callout, color: colors.text }}>{opt}</Text>
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
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '500' }}>{current} / {target}g</Text>
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
      <MacroBar label="Yağ" current={fat} target={targets.fat} color={METRIC_COLORS.fat} />
    </View>
  );
}

/**
 * Macro ring: donut chart for daily macro progress (Spec 5.34 "makro halkasi").
 * Shows three concentric thin rings — protein, carbs, fat — with current % each.
 */
export function MacroRing({ protein, carbs, fat, targets }: { protein: number; carbs: number; fat: number; targets: { protein: number; carbs: number; fat: number } }) {
  const { colors } = useTheme();
  const pct = (cur: number, tgt: number) => tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
  return (
    <View style={{ backgroundColor: colors.cardElevated, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Makro halkası. Protein %${pct(protein, targets.protein)}, karbonhidrat %${pct(carbs, targets.carbs)}, yağ %${pct(fat, targets.fat)}`}
        style={{ alignItems: 'center', justifyContent: 'center', width: 96, height: 96 }}
      >
        <View style={{ position: 'absolute' }}>
          <CircularProgress size={96} strokeWidth={6} progress={pct(protein, targets.protein) / 100} color={METRIC_COLORS.protein} trackColor={colors.progressTrack} value="" />
        </View>
        <View style={{ position: 'absolute' }}>
          <CircularProgress size={76} strokeWidth={6} progress={pct(carbs, targets.carbs) / 100} color={METRIC_COLORS.carbs} trackColor={colors.progressTrack} value="" />
        </View>
        <View style={{ position: 'absolute' }}>
          <CircularProgress size={56} strokeWidth={6} progress={pct(fat, targets.fat) / 100} color={METRIC_COLORS.fat} trackColor={colors.progressTrack} value="" />
        </View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: METRIC_COLORS.protein }} />
          <Text style={{ ...TYPE.callout, color: colors.text }}>Protein {protein}/{targets.protein}g · %{pct(protein, targets.protein)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: METRIC_COLORS.carbs }} />
          <Text style={{ ...TYPE.callout, color: colors.text }}>Karb {carbs}/{targets.carbs}g · %{pct(carbs, targets.carbs)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: METRIC_COLORS.fat }} />
          <Text style={{ ...TYPE.callout, color: colors.text }}>Yağ {fat}/{targets.fat}g · %{pct(fat, targets.fat)}</Text>
        </View>
      </View>
    </View>
  );
}

// FIX (audit UX-CHT-04): accept `disabled` so confirm/reject can't be double-fired
// while a send is in flight (which produced duplicate plan-confirm / verification turns).
export function ConfirmRejectButtons({ onConfirm, onReject, confirmLabel = 'Onayla', rejectLabel = 'Değiştir', disabled = false }: { onConfirm: () => void; onReject: () => void; confirmLabel?: string; rejectLabel?: string; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm, opacity: disabled ? 0.5 : 1 }}>
      <TouchableOpacity disabled={disabled} onPress={() => { haptics.tap(); onConfirm(); }}
        accessibilityRole="button" accessibilityLabel={confirmLabel} accessibilityState={{ disabled }}
        style={{ flex: 1, paddingVertical: SPACING.md, minHeight: 44, justifyContent: 'center', borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}>
        <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>{confirmLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={disabled} onPress={() => { haptics.tap(); onReject(); }}
        accessibilityRole="button" accessibilityLabel={rejectLabel} accessibilityState={{ disabled }}
        style={{ flex: 1, paddingVertical: SPACING.md, minHeight: 44, justifyContent: 'center', borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>{rejectLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function SimulationCard({ foodName, calories, remaining, weeklyImpact }: { foodName: string; calories: number; remaining: number; weeklyImpact: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg, marginTop: SPACING.sm, borderWidth: 0.5, borderColor: colors.border }}>
      {/* The food is what this card is ABOUT — it should read before the numbers under it. */}
      <Text style={{ ...TYPE.headline, color: colors.text }}>{foodName}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ ...TYPE.title2, color: METRIC_COLORS.calories }}>{calories}</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>kcal</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          {/* FIX (ux-ideas #5): over-budget no longer paints alarm-red. For an anxious
              eater, red 'error' framing punishes every overshoot. Amber 'warning' conveys
              the same info without the error/shame signal; the label flips to 'üzeri'
              so 'kalan' doesn't sit contradictorily above a negative value. */}
          <Text style={{ ...TYPE.title2, color: remaining >= 0 ? colors.primary : colors.warning }}>
            {remaining >= 0 ? remaining : Math.abs(remaining)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{remaining >= 0 ? 'kalan' : 'üzeri'}</Text>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.sm }}>{weeklyImpact}</Text>
    </View>
  );
}

export function RecipeCard({ title, prepTime, servings, ingredients, macros, onSave, saved }: {
  title: string; prepTime: number; servings: number;
  ingredients: { name: string; amount: string }[];
  macros: { calories: number; protein: number; carbs: number; fat: number };
  onSave?: () => void;
  saved?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.cardElevated, borderRadius: RADIUS.sm, padding: SPACING.lg, marginTop: SPACING.sm }}>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '500' }}>{title}</Text>
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{prepTime} dk | {servings} porsiyon</Text>
      <View style={{ marginTop: SPACING.sm }}>
        {ingredients.map((ing, i) => (
          <Text key={i} style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20 }}>- {ing.amount} {ing.name}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 0.5, borderTopColor: colors.border }}>
        {[
          { v: macros.calories, l: 'kcal', c: colors.primary },
          { v: `${macros.protein}g`, l: 'protein', c: METRIC_COLORS.protein },
          { v: `${macros.carbs}g`, l: 'karb', c: METRIC_COLORS.carbs },
          { v: `${macros.fat}g`, l: 'yağ', c: METRIC_COLORS.fat },
        ].map((m, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: m.c, fontSize: FONT.md, fontWeight: '600' }}>{m.v}</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{m.l}</Text>
          </View>
        ))}
      </View>
      {onSave && (
        <TouchableOpacity
          onPress={saved ? undefined : () => { haptics.success(); onSave(); }}
          disabled={saved}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Tarif kaydedildi' : 'Tarifi kaydet'}
          accessibilityState={{ disabled: !!saved }}
          style={{
            marginTop: SPACING.sm, paddingVertical: SPACING.md, minHeight: 44, justifyContent: 'center', borderRadius: RADIUS.sm,
            backgroundColor: saved ? colors.surfaceLight : colors.primary,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: saved ? colors.primary : getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>
            {saved ? '✓ Kaydedildi' : 'Tarifi Kaydet'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function ActionButtons({ actions, onAction }: { actions: { label: string; action: string; variant?: 'primary' | 'secondary' }[]; onAction: (action: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm }}>
      {actions.map((a, i) => (
        <TouchableOpacity key={i} onPress={() => { haptics.tap(); onAction(a.action); }}
          accessibilityRole="button" accessibilityLabel={a.label}
          style={{ paddingVertical: 10, paddingHorizontal: SPACING.md, minHeight: 40, justifyContent: 'center', borderRadius: RADIUS.sm, backgroundColor: a.variant === 'primary' ? colors.primary : colors.surfaceLight }}>
          <Text style={{ color: a.variant === 'primary' ? getContrastColor(colors.primary) : colors.primary, fontSize: FONT.sm, fontWeight: '500' }}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const { colors } = useTheme();
  const config = {
    high: { label: 'Yüksek güven', color: colors.success },
    medium: { label: 'Orta güven', color: colors.warning },
    low: { label: 'Düşük güven', color: colors.fat },
  };
  const c = config[level];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 8, borderRadius: RADIUS.pill, backgroundColor: c.color + '26', alignSelf: 'flex-start', marginTop: SPACING.xs }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color, marginRight: 4 }} />
      <Text style={{ color: c.color, fontSize: FONT.xs, fontWeight: '600' }}>{c.label}</Text>
    </View>
  );
}

/**
 * Persona detection confirmation card (Spec 5.15).
 * Shown once, after AI detects user persona at 100-msg mark.
 */
export function PersonaCard({
  persona,
  onConfirm,
  onReject,
}: {
  persona: string;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const { colors } = useTheme();
  const LABELS: Record<string, { title: string; desc: string }> = {
    weekday_disciplined: { title: 'Hafta içi disiplinli', desc: 'Hafta içi sıkı, hafta sonu esnek yaklaşım' },
    data_driven: { title: 'Veri odaklı', desc: 'Sayılarla, grafiklerle motive olan tip' },
    motivation_dependent: { title: 'Motivasyon bağımlısı', desc: 'Destek ve kutlamaya yanıt veren tip' },
    disciplinli: { title: 'Disiplinli', desc: 'Kesin kurallara uyan, hedef odaklı' },
    minimalist: { title: 'Minimalist', desc: 'Kısa ve öz açıklama tercih eden' },
    veri_odakli: { title: 'Veri odaklı', desc: 'Sayılarla, grafiklerle motive olan tip' },
    motivasyon_bagimlisi: { title: 'Motivasyon bağımlısı', desc: 'Destek ve kutlamaya yanıt veren tip' },
  };
  const info = LABELS[persona] ?? { title: persona, desc: 'Koçluk tarzını buna göre ayarladım.' };
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg, marginTop: SPACING.sm, borderWidth: 0.5, borderColor: colors.primary }}>
      <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '600', letterSpacing: 0.3 }}>SENİ TANIDIM</Text>
      <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '600', marginTop: 4 }}>{info.title}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 18 }}>{info.desc}</Text>
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>Yanlışsa söyle, ayarlarım.</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
        <TouchableOpacity
          onPress={() => { haptics.tap(); onConfirm(); }}
          accessibilityRole="button" accessibilityLabel="Doğru"
          style={{ flex: 1, paddingVertical: SPACING.md, minHeight: 44, justifyContent: 'center', borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}
        >
          <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>Doğru</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { haptics.tap(); onReject(); }}
          accessibilityRole="button" accessibilityLabel="Ben farklıyım"
          style={{ flex: 1, paddingVertical: SPACING.md, minHeight: 44, justifyContent: 'center', borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Ben farklıyım</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function MakeSomethingElseButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={() => { haptics.tap(); onPress(); }}
      accessibilityRole="button" accessibilityLabel="Başka bir şey öner"
      style={{ paddingVertical: SPACING.md, minHeight: 44, justifyContent: 'center', paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center', marginTop: SPACING.sm }}>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>Başka bir şey öner</Text>
    </TouchableOpacity>
  );
}

export function WeeklyBudgetBar({ consumed, total }: { consumed: number; total: number }) {
  const { colors } = useTheme();
  // FIX (audit UI-CHT-02): render nothing when there is no real weekly budget
  // (total <= 0). Users with no plan / no weekly budget previously got a broken,
  // alarming card showing "{consumed} / 0 kcal" and a negative "Kalan: -X kcal".
  if (!(total > 0)) return null;
  const pct = total > 0 ? Math.min(1, consumed / total) : 0;
  const remaining = total - consumed;
  // FIX (ux-ideas #5): never alarm-red. Amber once the budget is nearly/fully used —
  // a heads-up, not an 'error'. Weekly banking means a near-full bar is normal, not a failure.
  const color = pct > 0.9 ? colors.warning : colors.primary;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 0.5, borderColor: colors.border }}>
      {/* ux-pass2: gap + tr-TR thousands — this rendered as the run-together
          "Haftalık Bütçe332 / 15532 kcal" live (the dashboard shows "15.532"). */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm, marginBottom: SPACING.xs }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>Haftalık Bütçe</Text>
        <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '500' }}>{Math.round(consumed).toLocaleString('tr-TR')} / {Math.round(total).toLocaleString('tr-TR')} kcal</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.progressTrack, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4, textAlign: 'right' }}>Kalan: {Math.round(remaining).toLocaleString('tr-TR')} kcal</Text>
    </View>
  );
}
