/**
 * Single meal card for the diet plan full view. Shows meal name, time,
 * items list (collapsible), totals. Optional highlighted state (600ms
 * border glow when the meal just changed in a new snapshot).
 *
 * DUOLINGO DİLİ (2026-11-04, §0-A/§0-B):
 *  - Her öğün KENDİ RENGİNİ taşır (kahvaltı kehribar, öğle mavi, atıştırma gül, akşam menekşe):
 *    pastel opak yüz + aynı tonun çerçevesi/rafı + dolu "yastık" ikon rozeti. Önceden dört öğün de
 *    aynı beyaz kutuydu; yalnız 36px'lik soluk ikon kutusu ayırıyordu.
 *  - Kart GÖVDELİ: başlığa basınca yüz rafa iner (solmaz). ShelfPressable doğrudan
 *    kullanılamıyor — o, kartın TAMAMINI tek bir Pressable yapar; ama başlıktaki "+" ve açık
 *    gövdedeki çipler AYRI düğmeler (ekran okuyucu için kardeş, iç içe değil — ux-ideas #2'nin
 *    bilerek yaptığı ayrım). Aynı iskelet (MOTION.shelf raf + translateY yüz) burada elle,
 *    basılı hâli başlık Pressable'ının onPressIn/Out'u sürüyor.
 *  - "Bunu yedim" / "Bu öğünü değiştir" çipleri gövdeli küçük tuşlar (ShelfPressable).
 *
 * Bu dosya planın görsel yardımcılarını da dışa verir (MEAL_TONES, shade, PlanTileBadge):
 * PlanDayAccordion / PlanActiveView / ExerciseCard aynı rozet ve ton dilini kullanır; en alt
 * seviye bileşen burası olduğu için döngüsel import olmadan paylaşılıyor.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, Animated, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, MOTION, mix } from '@/lib/design';
import { MEAL_TYPE_LABELS_TR } from '@/lib/labels';
import { getContrastColor } from '@/lib/accessibility';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { type DietMeal } from '@/services/plan.service';

// FIX (ux-round2 #13): enable LayoutAnimation on Android (iOS is on by default) so the meal
// accordion expand/collapse eases instead of snapping — a core daily surface tapped many times.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ───────────── Paylaşılan plan görsel dili ───────────── */

/** StatStrip'in mürekkebi (§0-A): kehribar/gül dolgu üstünde beyaz WCAG altında kalıyor. */
export const PLATE_INK = '#2A2140';

/**
 * Öğün başına ton — metrik paletinden (yeni hue yok), temadan BAĞIMSIZ (yalnız dolgu/çerçeve
 * olarak kullanılır, metin rengi olarak asla: açık temada kehribar metin 2:1'e düşer).
 * `fg` dolu rozetin üstündeki ikonun rengi: kehribar + gül mürekkep, mavi + menekşe beyaz.
 */
export const MEAL_TONES: Record<DietMeal['meal_type'], { tone: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  breakfast: { tone: METRIC_COLORS.steps, fg: PLATE_INK, icon: 'sunny' },
  lunch: { tone: METRIC_COLORS.water, fg: '#FFFFFF', icon: 'restaurant' },
  snack: { tone: METRIC_COLORS.weight, fg: PLATE_INK, icon: 'cafe' },
  dinner: { tone: METRIC_COLORS.sleep, fg: '#FFFFFF', icon: 'moon' },
};

/** Bir tonun koyusu — gövdeli yüzeyin rafı (Button'ın primary→primaryDark ilişkisi). */
export function shade(hex: string, k = 0.76): string {
  return mix(hex, '#000000', k);
}

/** Pastel opak yüz + aynı tonun kenarı (çerçeve ve raf). Yüz opak olmalı (§0-B). */
export function pastel(tone: string, card: string, isDark: boolean) {
  return {
    face: mix(tone, card, isDark ? 0.16 : 0.09),
    edge: mix(tone, card, isDark ? 0.55 : 0.4),
  };
}

/**
 * Dolu "yastık" rozet — Duolingo ders düğümünün küçük kardeşi: dolu renk + 3px koyu alt
 * kalınlık. Dokunulmaz (süs), o yüzden basınca inmez; kalınlık yalnız hacim hissi.
 */
export function PlanTileBadge({ tone, size = 40, children }: { tone: string; size?: number; children: ReactNode }) {
  const depth = 3;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size + depth, borderRadius: size * 0.32, backgroundColor: shade(tone) }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.32,
          backgroundColor: tone,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * Küçük gövdeli eylem çipi ("Bunu yedim", "Bunu yaptım", "Bu öğünü değiştir").
 * `filled` → marka dolgusu + primaryDark raf (birincil, Button primary ile aynı ilişki);
 * değilse kart yüz + gri gövde (ikincil). Dolgu bilerek öğün tonu DEĞİL: 13px etiket mavi
 * (#4C8DFF) üstünde beyazla 3,2:1, menekşe tonda mürekkeple 3,6:1 — ikisi de AA altı.
 * `done` → gök mavisi "yolunda" tonu; o hâlde zaten devre dışı (tekrar kayıt yok).
 */
export function PlanActionChip({
  label, icon, filled, done, saving, onPress, accessibilityLabel, accessibilityState,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  filled?: boolean;
  done?: boolean;
  saving?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityState?: { disabled?: boolean; busy?: boolean };
}) {
  const { colors, isDark } = useTheme();
  const grey = isDark ? colors.border : colors.progressTrack;
  const face = done ? mix(colors.success, colors.card, isDark ? 0.22 : 0.14) : filled ? colors.primary : colors.card;
  const edge = done ? mix(colors.success, colors.card, 0.6) : filled ? colors.primaryDark : grey;
  const fg = done ? colors.success : filled ? getContrastColor(colors.primary) : colors.textSecondary;
  return (
    <ShelfPressable
      onPress={onPress}
      disabled={done || saving}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      // FIX (ux-pass5): chip was ~23px tall with no hitSlop — flagship one-tap
      // logging kept missing. ~36px visual + hitSlop → ≥44px effective.
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      radius={RADIUS.pill}
      shelfColor={edge}
      style={{ alignSelf: 'flex-start' }}
      faceStyle={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minHeight: 34,
        paddingHorizontal: SPACING.md,
        backgroundColor: face,
        borderWidth: filled && !done ? 0 : 2,
        borderColor: edge,
      }}
    >
      {saving ? (
        <ActivityIndicator size="small" color={fg} style={{ transform: [{ scale: 0.7 }] }} />
      ) : (
        <Ionicons name={done ? 'checkmark-circle' : icon} size={15} color={fg} />
      )}
      {/* Kept in lockstep across MealCard / ExerciseCard — same control, same spec. 11px is
          the scale's "never for anything you must read to act" step, and this is the
          flagship one-tap action on both plan cards. */}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, fontWeight: '800', color: fg }}>
        {label}
      </Text>
    </ShelfPressable>
  );
}

/* ───────────── MealCard ───────────── */

interface Props {
  meal: DietMeal;
  highlighted?: boolean;      // just-changed flag — triggers border glow
  expanded: boolean;
  onToggle: () => void;
  onEditPress?: () => void;   // opens chat with prefill "X'i değiştir"
  // 'Bunu yedim' — one-tap plan→diary (fix-pass 07-12, item 9). Only the ACTIVE
  // plan's TODAY section passes these; drafts/history render without the button.
  onLogPress?: () => void;
  logStatus?: 'saving' | 'done';
}

export function MealCard({ meal, highlighted, expanded, onToggle, onEditPress, onLogPress, logStatus }: Props) {
  const { colors, isDark } = useTheme();
  const glow = useRef(new Animated.Value(0)).current;
  const [pressed, setPressed] = useState(false);

  // LLM JSON'da bilinmeyen bir meal_type gelirse öğle tonuna düş — kart çökmesin.
  const t = MEAL_TONES[meal.meal_type] ?? MEAL_TONES.lunch;
  const { face, edge } = pastel(t.tone, colors.card, isDark);

  useEffect(() => {
    if (highlighted) {
      glow.setValue(1);
      // Renk geçişi: native driver renk desteklemez; 600ms'lik tek seferlik vurgu.
      Animated.timing(glow, { toValue: 0, duration: 600, useNativeDriver: false }).start();
    }
  }, [highlighted, glow]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [edge, colors.success],
  });

  const shelf = MOTION.shelf;
  const done = logStatus === 'done';

  return (
    <View style={{ paddingBottom: shelf, marginBottom: SPACING.sm }}>
      {/* Raf — yüzün tonunun koyusu; basılınca yüz bunun üstüne iner. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: shelf, bottom: 0, borderRadius: RADIUS.lg, backgroundColor: edge }}
      />
      <Animated.View
        style={{
          backgroundColor: face,
          borderRadius: RADIUS.lg,
          borderWidth: 2,
          borderColor,
          padding: SPACING.md,
          transform: [{ translateY: pressed ? shelf : 0 }],
        }}
      >
        {/* Header */}
        {/* FIX (ux-pass5): expandable header announced as a button with expanded state
            (matches PlanDayAccordion) — was a text blob to TalkBack, hiding the actions inside. */}
        {/* FIX (ux-ideas #2): the 'Bunu yedim' one-tap log now also lives on the COLLAPSED
            header (compact + button), so the day's most-repeated action no longer requires
            expanding each meal first. The full labelled chip still renders in the expanded body.
            Split into a toggle + a sibling button (not nested) so the log tap and the expand tap
            never contend for the same touch responder. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <Pressable
            onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); onToggle(); }}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            accessibilityRole="button"
            accessibilityLabel={`${MEAL_TYPE_LABELS_TR[meal.meal_type]}, ${meal.name}, ${Math.round(meal.total_kcal)} kalori, ${expanded ? 'açık' : 'aç'}`}
            accessibilityState={{ expanded }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}
          >
            <PlanTileBadge tone={t.tone}>
              <Ionicons name={t.icon} size={20} color={t.fg} />
            </PlanTileBadge>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ ...TYPE.overline, color: colors.textSecondary }}>
                  {MEAL_TYPE_LABELS_TR[meal.meal_type]?.toLocaleUpperCase('tr-TR')}
                </Text>
                {meal.time ? (
                  <Text style={{ ...TYPE.footnote, color: colors.textMuted }}>· {meal.time}</Text>
                ) : null}
              </View>
              {/* The meal's name is what this card IS — reading step, not a 13px caption. */}
              {/* Two lines when collapsed, not one. Raising the name to the reading step made it
                  truncate in the ACTIVE plan view — those rows carry an extra "+" control, so the
                  name has less room there than in the draft view where the same names fit. Driven on
                  a device: "Peynirli tost ve yo…", "Kıymalı kuru fasu…". Giving the name a second
                  line is the honest fix; shrinking it back would trade legibility for a layout
                  constraint that only exists on one of the two surfaces. */}
              <Text style={{ ...TYPE.headline, color: colors.text, marginTop: 2 }} numberOfLines={expanded ? 0 : 2}>
                {meal.name}
              </Text>
              {/* Az sayı, çok teşvik: kcal + makrolar ad'ın ALTINDA tek ikincil satır. Önceden sağda
                  kendi sütunlarıydı ve adla aynı ağırlıkta yarışıyordu; ayrıca adın genişliğini
                  yiyordu. FIX (audit UI-PLN-02): ham LLM ondalıkları yuvarlanır. */}
              <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{Math.round(meal.total_kcal)} kcal</Text>
                {`  ·  P${Math.round(meal.total_protein)} K${Math.round(meal.total_carbs)} Y${Math.round(meal.total_fat)}`}
              </Text>
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textMuted}
            />
          </Pressable>

          {/* Compact one-tap log — only on the active plan's TODAY (onLogPress present) and while
              collapsed; expanding reveals the full labelled chip below. Icon-only gövdeli yuvarlak
              tuş (öğünün kendi tonunda), with a full-intent a11y label. Reflects saving / done. */}
          {onLogPress && !expanded ? (
            <ShelfPressable
              onPress={onLogPress}
              disabled={!!logStatus}
              accessibilityRole="button"
              accessibilityLabel={done ? `${meal.name} günlüğe eklendi` : logStatus === 'saving' ? 'Ekleniyor' : `${meal.name}, bunu yedim, günlüğe ekle`}
              accessibilityState={{ disabled: !!logStatus, busy: logStatus === 'saving' }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              radius={20}
              shelfColor={done ? mix(colors.success, colors.card, 0.6) : shade(t.tone)}
              faceStyle={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: done ? mix(colors.success, colors.card, isDark ? 0.22 : 0.14) : t.tone,
              }}
            >
              {logStatus === 'saving' ? (
                <ActivityIndicator size="small" color={t.fg} style={{ transform: [{ scale: 0.7 }] }} />
              ) : (
                <Ionicons name={done ? 'checkmark' : 'add'} size={22} color={done ? colors.success : t.fg} />
              )}
            </ShelfPressable>
          ) : null}
        </View>

        {/* Expanded: items + notes + edit */}
        {expanded && (
          <View style={{ marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 2, borderTopColor: edge }}>
            {(Array.isArray(meal.items) ? meal.items : []).map((it, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 4,
                }}
              >
                {/* Ingredient list — the actual food a person is meant to shop for and eat. */}
                <Text style={{ ...TYPE.callout, color: colors.text, flex: 1 }} numberOfLines={1}>
                  {it.name}{' '}
                  <Text style={{ color: colors.textMuted }}>
                    ({it.grams ? `${it.grams}g` : it.portion ?? '-'})
                  </Text>
                </Text>
                {/* FIX (audit UI-PLN-02): round per-item kcal (raw LLM JSON may carry decimals) */}
                <Text style={{ ...TYPE.caption, color: colors.textMuted }}>{Math.round(it.kcal)} kcal</Text>
              </View>
            ))}

            {/* Same step as ExerciseCard's note line — one spec for "the coach's aside about this item". */}
            {meal.notes ? (
              <Text
                style={{
                  ...TYPE.caption,
                  color: colors.textSecondary,
                  fontStyle: 'italic',
                  marginTop: SPACING.xs,
                }}
              >
                {meal.notes}
              </Text>
            ) : null}

            {(onEditPress || onLogPress) ? (
              <View style={{ marginTop: SPACING.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.sm }}>
                {onLogPress ? (
                  <PlanActionChip
                    label={done ? 'Günlüğe eklendi' : logStatus === 'saving' ? 'Ekleniyor...' : 'Bunu yedim'}
                    icon="add-circle"
                    filled
                    done={done}
                    saving={logStatus === 'saving'}
                    onPress={onLogPress}
                    accessibilityLabel={done ? 'Günlüğe eklendi' : 'Bunu yedim, günlüğe ekle'}
                    accessibilityState={{ disabled: !!logStatus, busy: logStatus === 'saving' }}
                  />
                ) : null}
                {onEditPress ? (
                  // FIX (ux-pass5): same undersized target as the log chip + TalkBack read it
                  // as plain text — role/label + ≥44px effective (PlanActionChip hitSlop).
                  <PlanActionChip
                    label="Bu öğünü değiştir"
                    icon="create-outline"
                    onPress={onEditPress}
                    accessibilityLabel={`${meal.name} öğününü değiştir`}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        )}
      </Animated.View>
    </View>
  );
}
