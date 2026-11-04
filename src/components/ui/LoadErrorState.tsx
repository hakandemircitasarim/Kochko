/**
 * LoadErrorState — shared "load failed + retry" primitive (cloud-offline icon +
 * title + subtitle + retry). Replaces the ~20 hand-rolled copies of the pattern
 * (canonical: plan/diet.tsx error branch / reports/daily.tsx).
 *
 * Karakter (2026-11-04): bulut-ikon yerine Koçko'nun TESELLİ eden hâli (`cheerup`, kalp uzatan
 * koç). Hata anı stresli okunur — "bozuldu" değil "sorun değil, bir daha deneyelim" demeli.
 * Varsayılan alt metin de koçun ağzından ("…bir daha deneyelim"). Tek eylem: gövdeli Button.
 *
 * Variants:
 * - full (default): ortalanmış tam ekran (maskot 112 + halka, Button lg).
 *   Review fix: arka planını KENDİ sağlar (colors.background) — eski "sarmalayıcı verir"
 *   sözleşmesi 4-satırlık wrapper View kopyasını ~10 sahaya geri getirmişti.
 * - embedded: Card içine gömülü orta boy blok (settings liste ekranları; maskot 64, Button sm).
 * - compact: tek dokunulabilir satır-kart — tüm satır retry (dashboard slotları). Gövdeli
 *   (ShelfPressable: kart yüz + 2px gri çerçeve + gri raf, §0-B) — basınca rafa iner, solmaz;
 *   solda 32px cheerup avatarı, sağda yenile rozeti.
 *   Not: compact retryLabel'i buton metni olarak KULLANMAZ (satırın kendisi retry) —
 *   erişilebilirlik etiketine eklenir.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
import { Button } from '@/components/ui/Button';
import { getContrastColor } from '@/lib/accessibility';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
import { MascotStage } from '@/components/ui/EmptyState';

interface Props {
  title?: string;
  subtitle?: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Tek satırlık dokunulabilir satır-kart (compact, embedded'dan öncelikli). */
  compact?: boolean;
  /** Card içine gömülü orta boy blok — flex:1 yok, liste/kart içinde çökmez. */
  embedded?: boolean;
}

export function LoadErrorState({
  title = 'Veriler yüklenemedi',
  subtitle = 'Bağlantını kontrol et, sonra bir daha deneyelim.',
  onRetry,
  retryLabel = 'Tekrar dene',
  compact,
  embedded,
}: Props) {
  const { colors, isDark } = useTheme();

  if (compact) {
    // Gri gövde tek ton (§0-B): açıkta progressTrack, koyuda border.
    const edge = isDark ? colors.border : colors.progressTrack;
    return (
      <ShelfPressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subtitle}. ${retryLabel}.`}
        shelfColor={edge}
        radius={RADIUS.md}
        faceStyle={{
          backgroundColor: colors.card, padding: SPACING.md,
          borderWidth: 2, borderColor: edge,
          flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
        }}
      >
        <KochkoMascot size={32} mood="cheerup" />
        <View style={{ flex: 1 }}>
          {/* An error state is read under stress — it is the worst place in the app for the
              smallest type. Inline variant stays compact but climbs to the reading ladder. */}
          <Text style={{ ...TYPE.bodyStrong, color: colors.text }}>{title}</Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }}>{subtitle}</Text>
        </View>
        {/* Yenile rozeti: satırın tamamı dokunulabilir; rozet yalnız "buraya bas" ipucu. */}
        <View
          style={{
            width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
            backgroundColor: mix(colors.primary, colors.card, 0.14),
          }}
        >
          <Ionicons name="refresh" size={18} color={colors.primary} />
        </View>
      </ShelfPressable>
    );
  }

  if (embedded) {
    return (
      <View accessibilityRole="alert" style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
        <KochkoMascot size={64} mood="cheerup" />
        <Text style={{ ...TYPE.headline, color: colors.text, marginTop: SPACING.sm, textAlign: 'center' }}>
          {title}
        </Text>
        <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.md, textAlign: 'center' }}>
          {subtitle}
        </Text>
        <Button title={retryLabel} size="sm" onPress={onRetry} />
      </View>
    );
  }

  return (
    <View accessibilityRole="alert" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, backgroundColor: colors.background }}>
      <MascotStage mood="cheerup" size={112} halo={136} />
      <Text style={{ ...TYPE.title3, color: colors.text, marginTop: SPACING.lg, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.xl, textAlign: 'center', maxWidth: 320 }}>
        {subtitle}
      </Text>
      <View style={{ width: '100%', maxWidth: 320 }}>
        <Button
          title={retryLabel}
          onPress={onRetry}
          size="lg"
          // Etiketle aynı renk: Button dolgu üstü metni getContrastColor ile seçer.
          icon={<Ionicons name="refresh" size={18} color={getContrastColor(colors.primary)} />}
        />
      </View>
    </View>
  );
}
