/**
 * Rich Message Components for Chat — Duolingo/Yazio dili (§0-A/§0-B, 2026-11-04).
 *
 * İki tür yüzey var ve rengi BULUNDUĞU YERE göre seçilir (§0-A "iz rengi yüzeyden bağımsız
 * olmalı" tuzağı — açık temada cardElevated == card == beyaz, yani balon içindeki eski
 * kartların kenarı yoktu, yalnız içerik yüzüyordu):
 *   - Balon İÇİ yastık (`insetCushion`): MacroRing, MacroSummary, RecipeCard, PersonaCard.
 *     Beyaz/koyu balonun üstünde surfaceLight pastel, kenarsız, büyük yarıçap.
 *   - Sayfa üstü yastık (`pageCushion`): SimulationCard, WeeklyBudgetBar — balonun altında,
 *     zemin üstünde duruyor; kart yüz + 2px gri çerçeve (gövdeli yüzeylerin grisi).
 * Dolu eylemler artık ortak gövdeli `Button` (elle TouchableOpacity buton kalmadı);
 * çipler ortak `ChatChip`. İzler yüzeye göre: açıkta progressTrack, koyuda border.
 */
import { View, Text, ScrollView, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Button } from '@/components/ui/Button';
import { ChatChip } from '@/components/chat/ChatChip';
import { bodyEdge } from '@/components/chat/CoachSpeech';
import { useTheme, METRIC_COLORS, type ThemeColors } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, alpha, mix } from '@/lib/design';
import { haptics } from '@/lib/haptics';

/** Balon içi yastık: balonun yüzünden bir ton ayrışan opak pastel, kenarsız. */
function insetCushion(colors: ThemeColors): ViewStyle {
  return { backgroundColor: colors.surfaceLight, borderRadius: RADIUS.sm + 2, padding: SPACING.md, marginTop: SPACING.sm };
}
/** Zemin üstü yastık: kart yüz + 2px gri çerçeve. */
function pageCushion(colors: ThemeColors, isDark: boolean): ViewStyle {
  return {
    backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg, marginTop: SPACING.sm,
    borderWidth: 2, borderColor: bodyEdge(colors, isDark),
  };
}
/** Bir yüzeyin üstüne çizilen iz: açıkta progressTrack yeter, koyuda 0.08 alfa kaybolur → border. */
function trackOn(colors: ThemeColors, isDark: boolean): string {
  return isDark ? colors.border : colors.progressTrack;
}

// FIX (audit UX-CHT-04): accept `disabled` so the parent can lock these inline action
// chips while a send is in flight — preventing a double-tap from firing two concurrent
// sends (duplicate AI turns / duplicate side-effecting log or delete).
export function QuickSelectButtons({ options, onSelect, disabled = false }: { options: string[]; onSelect: (option: string) => void; disabled?: boolean }) {
  // Gövdeli kelime kutucuğu (Duolingo dili, §0-B) — artık sohbetin ortak ChatChip'i.
  // Yatay sıra raf (4px) için dikey pay bırakır; yoksa basılı yüz kırpılırdı.
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SPACING.sm }}>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        {options.map((opt, i) => (
          <ChatChip key={i} label={opt} disabled={disabled} onPress={() => onSelect(opt)} />
        ))}
      </View>
    </ScrollView>
  );
}

export function MacroBar({ label, current, target, color }: { label: string; current: number; target: number; color: string }) {
  const { colors, isDark } = useTheme();
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: colors.textSecondary, ...TYPE.callout }}>{label}</Text>
        <Text style={{ color: colors.text, ...TYPE.callout, fontWeight: '700' }}>{current} / {target}g</Text>
      </View>
      <ProgressBar progress={pct} color={color} height={8} trackColor={trackOn(colors, isDark)} />
    </View>
  );
}

export function MacroSummary({ protein, carbs, fat, targets }: { protein: number; carbs: number; fat: number; targets: { protein: number; carbs: number; fat: number } }) {
  const { colors } = useTheme();
  return (
    <View style={{ ...insetCushion(colors), paddingBottom: SPACING.xs }}>
      <MacroBar label="Protein" current={protein} target={targets.protein} color={METRIC_COLORS.protein} />
      <MacroBar label="Karbonhidrat" current={carbs} target={targets.carbs} color={METRIC_COLORS.carbs} />
      <MacroBar label="Yağ" current={fat} target={targets.fat} color={METRIC_COLORS.fat} />
    </View>
  );
}

/**
 * Macro ring: donut chart for daily macro progress (Spec 5.34 "makro halkasi").
 * Shows three concentric thin rings — protein, carbs, fat — with current % each.
 * Yastık kart: halka + renk noktalı lejant; halkalar 8px (6px yastık içinde iplik gibiydi).
 */
export function MacroRing({ protein, carbs, fat, targets }: { protein: number; carbs: number; fat: number; targets: { protein: number; carbs: number; fat: number } }) {
  const { colors, isDark } = useTheme();
  const pct = (cur: number, tgt: number) => tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
  const track = trackOn(colors, isDark);
  const rows = [
    { label: 'Protein', cur: protein, tgt: targets.protein, color: METRIC_COLORS.protein },
    { label: 'Karb', cur: carbs, tgt: targets.carbs, color: METRIC_COLORS.carbs },
    { label: 'Yağ', cur: fat, tgt: targets.fat, color: METRIC_COLORS.fat },
  ];
  return (
    <View style={{ ...insetCushion(colors), flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Makro halkası. Protein %${pct(protein, targets.protein)}, karbonhidrat %${pct(carbs, targets.carbs)}, yağ %${pct(fat, targets.fat)}`}
        style={{ alignItems: 'center', justifyContent: 'center', width: 92, height: 92 }}
      >
        {rows.map((r, i) => (
          <View key={r.label} style={{ position: 'absolute' }}>
            <CircularProgress size={92 - i * 22} strokeWidth={8} progress={pct(r.cur, r.tgt) / 100} color={r.color} trackColor={track} value="" />
          </View>
        ))}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {rows.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.color }} />
            <Text style={{ ...TYPE.callout, color: colors.text, flexShrink: 1 }}>
              <Text style={{ fontWeight: '700' }}>{r.label}</Text>
              <Text style={{ color: colors.textSecondary }}> {r.cur}/{r.tgt}g · %{pct(r.cur, r.tgt)}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// FIX (audit UX-CHT-04): accept `disabled` so confirm/reject can't be double-fired
// while a send is in flight (which produced duplicate plan-confirm / verification turns).
export function ConfirmRejectButtons({ onConfirm, onReject, confirmLabel = 'Onayla', rejectLabel = 'Değiştir', disabled = false }: { onConfirm: () => void; onReject: () => void; confirmLabel?: string; rejectLabel?: string; disabled?: boolean }) {
  // Gövdeli ortak Button: onay dolu menekşe, değiştir gri gövdeli outline (Duolingo ikilisi).
  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
      <Button title={confirmLabel} onPress={() => { haptics.tap(); onConfirm(); }} disabled={disabled} style={{ flex: 1 }} />
      <Button title={rejectLabel} variant="outline" onPress={() => { haptics.tap(); onReject(); }} disabled={disabled} style={{ flex: 1 }} />
    </View>
  );
}

export function SimulationCard({ foodName, calories, remaining, weeklyImpact }: { foodName: string; calories: number; remaining: number; weeklyImpact: string }) {
  const { colors, isDark } = useTheme();
  const over = remaining < 0;
  // Sayılar ikinci plan (§0-A "az sayı, çok teşvik"): iki tonlu hap içinde, teşvik cümlesi altta.
  const stat = (value: number, label: string, color: string) => (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: mix(color, colors.card, isDark ? 0.16 : 0.1) }}>
      <Text style={{ ...TYPE.title3, color }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, ...TYPE.caption }}>{label}</Text>
    </View>
  );
  return (
    <View style={pageCushion(colors, isDark)}>
      {/* The food is what this card is ABOUT — it should read before the numbers under it. */}
      <Text style={{ ...TYPE.headline, color: colors.text }}>{foodName}</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
        {stat(calories, 'kcal', METRIC_COLORS.calories)}
        {/* FIX (ux-ideas #5): over-budget no longer paints alarm-red. For an anxious
            eater, red 'error' framing punishes every overshoot. Amber 'warning' conveys
            the same info without the error/shame signal; the label flips to 'üzeri'
            so 'kalan' doesn't sit contradictorily above a negative value. */}
        {stat(over ? Math.abs(remaining) : remaining, over ? 'üzeri' : 'kalan', over ? colors.warning : colors.primary)}
      </View>
      <Text style={{ color: colors.textSecondary, ...TYPE.body, marginTop: SPACING.sm }}>{weeklyImpact}</Text>
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
    <View style={{ ...insetCushion(colors), padding: SPACING.lg }}>
      <Text style={{ color: colors.text, ...TYPE.headline }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="time-outline" size={13} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, ...TYPE.caption }}>{prepTime} dk</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="people-outline" size={13} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, ...TYPE.caption }}>{servings} porsiyon</Text>
        </View>
      </View>
      <View style={{ marginTop: SPACING.sm, gap: 2 }}>
        {ingredients.map((ing, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: colors.primary, ...TYPE.body, fontWeight: '700' }}>•</Text>
            <Text style={{ color: colors.text, ...TYPE.body, flex: 1 }}>{ing.amount} {ing.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: SPACING.md }}>
        {[
          { v: macros.calories, l: 'kcal', c: METRIC_COLORS.calories },
          { v: `${macros.protein}g`, l: 'protein', c: METRIC_COLORS.protein },
          { v: `${macros.carbs}g`, l: 'karb', c: METRIC_COLORS.carbs },
          { v: `${macros.fat}g`, l: 'yağ', c: METRIC_COLORS.fat },
        ].map((m, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1, paddingVertical: 6, borderRadius: RADIUS.sm, backgroundColor: colors.card }}>
            <Text style={{ color: m.c, ...TYPE.headline, fontWeight: '800' }}>{m.v}</Text>
            <Text style={{ color: colors.textMuted, ...TYPE.caption }}>{m.l}</Text>
          </View>
        ))}
      </View>
      {onSave && (saved ? (
        // Kaydedildi bir DURUM, eylem değil: soluk bir buton yerine onay rozeti (a11y aynı).
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel="Tarif kaydedildi"
          accessibilityState={{ disabled: true }}
          style={{
            marginTop: SPACING.md, minHeight: 44, borderRadius: RADIUS.sm, flexDirection: 'row', gap: 6,
            alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12),
          }}
        >
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <Text style={{ color: colors.primary, ...TYPE.bodyStrong, fontWeight: '700' }}>Kaydedildi</Text>
        </View>
      ) : (
        <Button
          title="Tarifi Kaydet"
          accessibilityLabel="Tarifi kaydet"
          onPress={() => { haptics.success(); onSave(); }}
          style={{ marginTop: SPACING.md }}
        />
      ))}
    </View>
  );
}

export function ActionButtons({ actions, onAction }: { actions: { label: string; action: string; variant?: 'primary' | 'secondary' }[]; onAction: (action: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm }}>
      {actions.map((a, i) => (
        <Button key={i} title={a.label} size="sm" variant={a.variant === 'primary' ? 'primary' : 'outline'}
          onPress={() => { haptics.tap(); onAction(a.action); }} />
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
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 10, borderRadius: RADIUS.pill, backgroundColor: alpha(c.color, 0.15), alignSelf: 'flex-start', marginTop: SPACING.sm }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color, marginRight: 5 }} />
      <Text style={{ color: c.color, ...TYPE.caption, fontWeight: '700' }}>{c.label}</Text>
    </View>
  );
}

/**
 * Persona detection confirmation card (Spec 5.15).
 * Shown once, after AI detects user persona at 100-msg mark.
 * Koçun "seni tanıdım" anı: menekşe pastel yastık + gövdeli Doğru / Ben farklıyım ikilisi.
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
  const { colors, isDark } = useTheme();
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
    <View style={{
      ...insetCushion(colors), padding: SPACING.lg,
      backgroundColor: mix(colors.primary, colors.card, isDark ? 0.16 : 0.08),
      borderWidth: 2, borderColor: mix(colors.primary, colors.card, isDark ? 0.45 : 0.3),
    }}>
      <Text style={{ ...TYPE.overline, color: colors.primary }}>{'Seni tanıdım'.toLocaleUpperCase('tr-TR')}</Text>
      <Text style={{ color: colors.text, ...TYPE.title3, marginTop: 4 }}>{info.title}</Text>
      <Text style={{ color: colors.textSecondary, ...TYPE.body, marginTop: 4 }}>{info.desc}</Text>
      <Text style={{ color: colors.textMuted, ...TYPE.caption, marginTop: SPACING.sm }}>Yanlışsa söyle, ayarlarım.</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
        <Button title="Doğru" onPress={() => { haptics.tap(); onConfirm(); }} style={{ flex: 1 }} />
        <Button title="Ben farklıyım" variant="outline" onPress={() => { haptics.tap(); onReject(); }} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export function MakeSomethingElseButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      title="Başka bir şey öner"
      variant="outline"
      icon={<RefreshIcon />}
      onPress={() => { haptics.tap(); onPress(); }}
      style={{ marginTop: SPACING.sm }}
    />
  );
}
function RefreshIcon() {
  const { colors } = useTheme();
  return <Ionicons name="shuffle" size={16} color={colors.primary} />;
}

export function WeeklyBudgetBar({ consumed, total }: { consumed: number; total: number }) {
  const { colors, isDark } = useTheme();
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
    <View style={pageCushion(colors, isDark)}>
      {/* ux-pass2: gap + tr-TR thousands — this rendered as the run-together
          "Haftalık Bütçe332 / 15532 kcal" live (the dashboard shows "15.532"). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(color, 0.14) }}>
          <Ionicons name="calendar-outline" size={15} color={color} />
        </View>
        <Text style={{ color: colors.text, ...TYPE.bodyStrong, flex: 1 }}>Haftalık Bütçe</Text>
        <Text style={{ color: colors.textSecondary, ...TYPE.caption, fontWeight: '700' }}>{Math.round(consumed).toLocaleString('tr-TR')} / {Math.round(total).toLocaleString('tr-TR')} kcal</Text>
      </View>
      <ProgressBar progress={pct} color={color} height={12} trackColor={trackOn(colors, isDark)} />
      <Text style={{ color: colors.textSecondary, ...TYPE.callout, marginTop: 6, textAlign: 'right' }}>Kalan: <Text style={{ color: colors.text, fontWeight: '700' }}>{Math.round(remaining).toLocaleString('tr-TR')} kcal</Text></Text>
    </View>
  );
}
