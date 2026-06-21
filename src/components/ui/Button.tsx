import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
  // FIX (audit ui-button-primitive): expose a11y + test hooks so consumers can override.
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', loading, disabled, style, icon, accessibilityLabel, accessibilityHint, testID }: Props) {
  const { colors } = useTheme();
  const isOutline = variant === 'outline';
  const isGhost = variant === 'ghost';
  const isDanger = variant === 'danger';

  const bgColor = isOutline || isGhost ? 'transparent'
    : isDanger ? colors.error
    : variant === 'secondary' ? colors.secondary
    : colors.primary;

  // Filled variants (primary / secondary / danger) pick the foreground that
  // passes WCAG AA against their fill via getContrastColor (yields black on
  // teal/secondary/error — all >= 5:1). Outline/ghost keep the teal label.
  const textColor = isGhost ? colors.primary
    : isOutline ? colors.primary
    : getContrastColor(bgColor);

  const height = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;
  const fontSize = size === 'sm' ? FONT.xs : size === 'lg' ? FONT.lg : FONT.sm;

  // FIX (audit ui-button): sm/md visual heights are < 44dp (WCAG 2.5.5); extend the
  // effective touch target via hitSlop without shifting layout (visual height unchanged).
  const hitSlop = size === 'sm'
    ? { top: 6, bottom: 6, left: 4, right: 4 }
    : size === 'md'
      ? { top: 2, bottom: 2 }
      : undefined;

  return (
    <TouchableOpacity
      style={[{
        backgroundColor: bgColor,
        borderRadius: RADIUS.sm,
        height,
        paddingHorizontal: size === 'sm' ? SPACING.md : SPACING.xl,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: SPACING.sm,
        opacity: disabled || loading ? 0.5 : 1,
        borderWidth: isOutline ? 0.5 : 0,
        borderColor: isOutline ? colors.primary : 'transparent',
      }, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon}
          {/* FIX (audit UI-PR-04): truncate long Turkish labels (ellipsis) and cap font
              scaling so a raised system font size can't blow out the fixed button height. */}
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: textColor, fontSize, fontWeight: '500' }}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}
