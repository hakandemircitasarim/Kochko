import React, { type ReactNode } from 'react';
import { View, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface Props {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  style?: ViewStyle;
  accent?: string;
}

export function Card({ title, subtitle, children, style, accent }: Props) {
  const { colors, isDark } = useTheme();

  return (
    <View style={[
      {
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        marginBottom: SPACING.md,
        overflow: 'hidden',
        ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
      },
      style,
    ]}>
      {accent && <View style={{ height: 3, backgroundColor: accent, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl }} />}
      {title && (
        <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.md }}>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', letterSpacing: -0.3 }}>{title}</Text>
          {subtitle && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{subtitle}</Text>}
        </View>
      )}
      <View style={{ padding: SPACING.md }}>{children}</View>
    </View>
  );
}
