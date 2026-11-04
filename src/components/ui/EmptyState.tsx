/**
 * EmptyState — paylaşılan boş durum: karakter + başlık + teşvik cümlesi + tek net eylem.
 *
 * Görsel dil §0-A "boş durumlar karakterin doğal sahnesi": varsayılan artık ikon değil
 * Koçko'nun TESELLİ eden hâli (`cheerup` — kalp uzatan koç). "Burada hiçbir şey yok" değil
 * "buradan birlikte başlarız" okunsun diye. `icon` AÇIKÇA verilirse eski ikon görünümü
 * korunur; `mascot` başka bir ruh hâli seçer.
 *
 * Maskot yumuşak bir menekşe halkanın üstünde durur (opak `mix` — zeminle aynı pikselde
 * pastel) ve bir kez yayla belirir (KochkoMascot `enter`). Döngü YOK:
 * boş durumda dikkat kopya + CTA'da kalmalı, sürekli kıpırdayan figür onu çalar.
 * Tek eylem `Button` (gövdeli) — touch-target/hitSlop/a11y politikası onunla gelir.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
// FIX (audit ui-emptystate): route the CTA through the shared Button primitive so it
// inherits Button's touch-target/hitSlop + a11y policy instead of a hand-rolled button.
import { Button } from '@/components/ui/Button';
import { KochkoMascot, type MascotMood } from '@/components/mascot/KochkoMascot';

interface Props {
  /** Verilirse maskot yerine bu ikon çizilir (eski görünüm). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Koçko'nun ruh hâli; ikisi de verilmezse `cheerup`. */
  mascot?: MascotMood;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onPressCta?: () => void;
}

/** Maskotun arkasındaki pastel halka + tek seferlik yay girişi (EmptyState/LoadErrorState/
 *  ErrorBoundary ortak). Halka opak `mix`: koyu temada biraz daha güçlü, yoksa siyahta kaybolur. */
export function MascotStage({ mood, size, halo }: { mood: MascotMood; size: number; halo: number }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={{ width: halo, height: halo, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute', width: halo, height: halo, borderRadius: halo / 2,
          backgroundColor: mix(colors.primary, colors.background, isDark ? 0.2 : 0.12),
        }}
      />
      <KochkoMascot size={size} mood={mood} enter />
    </View>
  );
}

export function EmptyState({ icon, mascot, title, subtitle, ctaLabel, onPressCta }: Props) {
  const { colors } = useTheme();
  const showIcon = !!icon && !mascot;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xxl }}>
      {showIcon ? (
        <Ionicons name={icon} size={48} color={colors.textMuted} />
      ) : (
        <MascotStage mood={mascot ?? 'cheerup'} size={112} halo={136} />
      )}
      <Text style={{ ...TYPE.title3, color: colors.text, marginTop: SPACING.lg, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, textAlign: 'center', maxWidth: 320 }}>
          {subtitle}
        </Text>
      ) : null}
      {ctaLabel && onPressCta ? (
        <View style={{ marginTop: SPACING.xl, width: '100%', maxWidth: 320 }}>
          <Button title={ctaLabel} onPress={onPressCta} size="lg" />
        </View>
      ) : null}
    </View>
  );
}
