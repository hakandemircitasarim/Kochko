import React, { type ReactNode } from 'react';
import { View, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';

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
          {/* Card is used on 32 settings pages — its title is the heading of whatever the card
              contains, so at FONT.md/500 it barely outranked its own body text. */}
          <Text style={{ ...TYPE.headline, color: colors.text }}>{title}</Text>
          {subtitle && <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>{subtitle}</Text>}
        </View>
      )}
      <View style={{ padding: SPACING.lg }}>{children}</View>
    </View>
  );
}
