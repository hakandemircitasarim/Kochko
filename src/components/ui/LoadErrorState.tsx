/**
 * LoadErrorState — shared "load failed + retry" primitive (cloud-offline icon +
 * title + subtitle + retry). Replaces the ~20 hand-rolled copies of the pattern
 * (canonical: plan/diet.tsx error branch / reports/daily.tsx).
 *
 * Variants:
 * - full (default): centered flex card for full-screen error states (icon 48, Button lg).
 *   Review fix: arka planını KENDİ sağlar (colors.background) — eski "sarmalayıcı verir"
 *   sözleşmesi 4-satırlık wrapper View kopyasını ~10 sahaya geri getirmişti.
 * - embedded: Card içine gömülü orta boy blok (settings liste ekranları; icon 40, Button sm).
 * - compact: tek dokunulabilir satır-kart — tüm satır retry (dashboard slotları).
 *   Not: compact retryLabel'i buton metni olarak KULLANMAZ (satırın kendisi retry) —
 *   erişilebilirlik etiketine eklenir.
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { Button } from '@/components/ui/Button';

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
  subtitle = 'Bağlantını kontrol edip tekrar dene.',
  onRetry,
  retryLabel = 'Tekrar dene',
  compact,
  embedded,
}: Props) {
  const { colors } = useTheme();

  if (compact) {
    return (
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subtitle}. ${retryLabel}.`}
        style={{
          backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md,
          borderWidth: 0.5, borderColor: colors.border,
          flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={22} color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          {/* An error state is read under stress — it is the worst place in the app for the
              smallest type. Inline variant stays compact but climbs to the reading ladder. */}
          <Text style={{ ...TYPE.bodyStrong, color: colors.text }}>{title}</Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }}>{subtitle}</Text>
        </View>
        <Ionicons name="refresh" size={16} color={colors.primary} />
      </TouchableOpacity>
    );
  }

  if (embedded) {
    return (
      <View accessibilityRole="alert" style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
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
      <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
      <Text style={{ ...TYPE.title3, color: colors.text, marginTop: SPACING.md, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, textAlign: 'center' }}>
        {subtitle}
      </Text>
      <Button title={retryLabel} onPress={onRetry} size="lg" />
    </View>
  );
}
