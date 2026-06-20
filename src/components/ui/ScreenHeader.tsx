/**
 * ScreenHeader — shared top bar for the tab/full-screen surfaces that hand-roll their own
 * header (Ana Sayfa, Kochko, Raporlar, Quick Log). Unifies title weight/size + an optional
 * colored status dot, and owns the safe-area top inset. (Stack-routed screens keep their
 * native header instead.)
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';

interface Props {
  title: string;
  /** Small line under the title (e.g. "Aktif sohbetin var"). */
  subtitle?: string;
  /** When set, renders a colored status dot before the subtitle. */
  statusColor?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, statusColor, left, right }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingTop: insets.top + SPACING.sm,
        paddingHorizontal: SPACING.xl,
        paddingBottom: SPACING.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
        backgroundColor: colors.background,
      }}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: FONT.xl2, fontWeight: '700' }} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            {statusColor ? <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: statusColor }} /> : null}
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>{subtitle}</Text>
          </View>
        ) : null}
      </View>
      {right}
    </View>
  );
}
