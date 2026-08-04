/**
 * EmptyState — shared empty-state primitive (icon + title + subtitle + optional CTA).
 * Replaces the ~10 hand-rolled empty states. Flat dark design, WCAG-AA copy colors.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
// FIX (audit ui-emptystate): route the CTA through the shared Button primitive so it
// inherits Button's touch-target/hitSlop + a11y policy instead of a hand-rolled button.
import { Button } from '@/components/ui/Button';

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
      <Text style={{ ...TYPE.title3, color: colors.text, marginTop: SPACING.md, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, textAlign: 'center' }}>
          {subtitle}
        </Text>
      ) : null}
      {ctaLabel && onPressCta ? (
        <View style={{ marginTop: SPACING.xl }}>
          <Button title={ctaLabel} onPress={onPressCta} />
        </View>
      ) : null}
    </View>
  );
}
