import React, { type ReactNode } from 'react';
import { View, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  style?: ViewStyle;
  accent?: string;
}

export function Card({ title, subtitle, children, style, accent }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[
      {
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.md,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: colors.border,
      },
      style,
    ]}>
      {accent && <View style={{ height: 3, backgroundColor: accent, borderTopLeftRadius: RADIUS.md, borderTopRightRadius: RADIUS.md }} />}
      {title && (
        <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '500' }}>{title}</Text>
          {subtitle && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{subtitle}</Text>}
        </View>
      )}
      <View style={{ padding: SPACING.lg }}>{children}</View>
    </View>
  );
}
