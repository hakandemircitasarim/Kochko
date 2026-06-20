/**
 * EmptyState — shared empty-state primitive (icon + title + subtitle + optional CTA).
 * Replaces the ~10 hand-rolled empty states. Flat dark design, WCAG-AA copy colors.
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

interface Props {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onPressCta?: () => void;
}

export function EmptyState({ icon = 'sparkles-outline', title, subtitle, ctaLabel, onPressCta }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xxl }}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, textAlign: 'center', lineHeight: 20 }}>
          {subtitle}
        </Text>
      ) : null}
      {ctaLabel && onPressCta ? (
        <TouchableOpacity
          onPress={onPressCta}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={{ marginTop: SPACING.xl, backgroundColor: colors.primary, paddingHorizontal: SPACING.xxl, paddingVertical: SPACING.md, borderRadius: RADIUS.md }}
        >
          <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
