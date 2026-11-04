/**
 * Rapor ekranlarının ortak küçük parçaları (Duolingo dili, DEVIR §0-A/§0-B).
 *
 * Rapor ekranları (progress sekmesi + app/reports/*) aynı birkaç kalıbı kendi içinde ayrı ayrı
 * elle yazıyordu: düz '<' '>' karakterinden ay seçici, ikonlu-gri boş durum kartı, çıplak
 * metinli "git" bağlantıları. Hepsi tek yerde, ortak primitiflerin (ShelfPressable,
 * KochkoMascot) üstüne kuruldu — ekranlar aynı dili konuşsun:
 *   - `MonthNav`   : ay başlığı + iki GÖVDELİ yuvarlak ok tuşu (basınca rafa iner, solmaz).
 *   - `ReportEmpty`: maskotlu boş durum — kart içinde Koçko + başlık + teşvik + isteğe bağlı CTA.
 *   - `ReportTile` : rapor ekranlarına giden gövdeli kutucuk (renkli plaka + mürekkep ikon).
 *   - `tint()`     : pastel ama OPAK yüzey (mix) — yarı saydam ton rafı içinden gösterir.
 */
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { KochkoMascot, type MascotMood } from '@/components/mascot/KochkoMascot';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
import { haptics } from '@/lib/haptics';

/** Kehribar/gül/mavi dolgu üstündeki ön plan — StatStrip PLATE_INK ile aynı mürekkep. */
export const PLATE_INK = '#2A2140';
/** Kehribarın (METRIC_COLORS.streak) koyusu — alev/kupa/rozet plakalarının yarım rafı (StreakBadge tonu). */
export const STREAK_SHELF = '#D98C00';

/** Gri gövde (çerçeve + raf): açıkta progressTrack, koyuda border — Button/ChoiceTile kuralı. */
export function idleEdge(colors: ThemeColors, isDark: boolean) {
  return isDark ? colors.border : colors.progressTrack;
}

/** Bir metrik renginin kart üstündeki opak pastel tonu. Koyuda biraz daha dolu (koyu kart yutar). */
export function tint(color: string, colors: ThemeColors, isDark: boolean, strength = 1) {
  return mix(color, colors.card, (isDark ? 0.24 : 0.14) * strength);
}

/* ───────────────────────────── MonthNav ───────────────────────────── */

function ArrowKey({ dir, onPress, disabled, label }: { dir: 'back' | 'forward'; onPress: () => void; disabled?: boolean; label: string }) {
  const { colors, isDark } = useTheme();
  const edge = idleEdge(colors, isDark);
  return (
    <ShelfPressable
      onPress={() => { haptics.tap(); onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      shelfColor={edge}
      radius={RADIUS.full}
      style={{ opacity: disabled ? 0.45 : 1 }}
      faceStyle={{
        width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.card, borderWidth: 2, borderColor: edge,
      }}
    >
      <Ionicons name={dir === 'back' ? 'chevron-back' : 'chevron-forward'} size={20} color={disabled ? colors.textMuted : colors.primary} />
    </ShelfPressable>
  );
}

/** Ay seçici: önceki/sonraki ay gövdeli yuvarlak tuşlar, ortada ay adı. */
export function MonthNav({ title, onPrev, onNext, nextDisabled }: { title: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
      <ArrowKey dir="back" onPress={onPrev} label="Önceki ay" />
      <Text accessibilityRole="header" style={{ ...TYPE.title3, color: colors.text, fontWeight: '800' }}>{title}</Text>
      <ArrowKey dir="forward" onPress={onNext} disabled={nextDisabled} label="Sonraki ay" />
    </View>
  );
}

/* ───────────────────────────── ReportEmpty ───────────────────────────── */

/**
 * Boş rapor durumu: Koçko + kısa başlık + teşvik cümlesi (+ CTA çocuk olarak).
 * Maskot statik (`animated` yok): boş durumda dikkat kopyada ve CTA'da kalmalı (EmptyState ilkesi).
 */
export function ReportEmpty({ mood = 'happy', title, subtitle, size = 88, children, card = true }: {
  mood?: MascotMood; title: string; subtitle?: string; size?: number; children?: ReactNode; card?: boolean;
}) {
  const { colors } = useTheme();
  const body = (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm }}>
      <KochkoMascot size={size} mood={mood} />
      <Text style={{ ...TYPE.title3, color: colors.text, textAlign: 'center', marginTop: SPACING.sm }}>{title}</Text>
      {subtitle ? (
        <Text style={{ ...TYPE.body, color: colors.textSecondary, textAlign: 'center', marginTop: SPACING.xs }}>{subtitle}</Text>
      ) : null}
      {children ? <View style={{ alignSelf: 'stretch', marginTop: SPACING.lg }}>{children}</View> : null}
    </View>
  );
  if (!card) return body;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, marginBottom: SPACING.md }}>
      {body}
    </View>
  );
}

/* ───────────────────────────── ReportTile ───────────────────────────── */

/**
 * Rapor ekranına giden gövdeli kutucuk. Eskiden kart içinde ince ayraçlı bir liste satırıydı —
 * sekmenin asıl "kapıları" metin bağlantısı gibi görünüyordu. Şimdi Duolingo ders kutucuğu:
 * gri gövde + 2px çerçeve, solda metrik renkli dolu plaka + MÜREKKEP ikon (kehribar/gül üstünde
 * beyaz WCAG altında kalıyor), başlık + kısa alt satır.
 */
export function ReportTile({ label, sub, icon, color, onPress, a11yLabel, wide }: {
  label: string; sub?: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; a11yLabel: string; wide?: boolean;
}) {
  const { colors, isDark } = useTheme();
  const edge = idleEdge(colors, isDark);
  return (
    <ShelfPressable
      onPress={() => { haptics.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      shelfColor={edge}
      radius={RADIUS.md}
      style={wide ? { width: '100%' } : { flexBasis: '46%', flexGrow: 1 }}
      faceStyle={{
        backgroundColor: colors.card, borderWidth: 2, borderColor: edge,
        padding: SPACING.md, minHeight: wide ? 0 : 108,
        flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start', gap: wide ? SPACING.md : SPACING.sm,
      }}
    >
      <View style={{ width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={21} color={PLATE_INK} />
      </View>
      <View style={{ flex: wide ? 1 : undefined }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.headline, color: colors.text, fontWeight: '700' }}>{label}</Text>
        {sub ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {wide && <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
    </ShelfPressable>
  );
}
