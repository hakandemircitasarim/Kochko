/**
 * Button Component — Multi-variant, multi-size with loading, disabled, icon, full-width.
 * Spec 22.1: Minimum touch target 44px.
 */
import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View, type ViewStyle } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS, TOUCH_TARGET } from '@/lib/constants';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: string; // Unicode icon displayed before title
  fullWidth?: boolean;
}

const VARIANT_STYLES = {
  primary: { bg: COLORS.primary, border: 'transparent', text: '#fff' },
  secondary: { bg: COLORS.secondary, border: 'transparent', text: '#fff' },
  outline: { bg: 'transparent', border: COLORS.primary, text: COLORS.primary },
  ghost: { bg: 'transparent', border: 'transparent', text: COLORS.primary },
  danger: { bg: COLORS.error, border: 'transparent', text: '#fff' },
};

const SIZE_STYLES = {
  sm: { py: SPACING.sm, px: SPACING.md, fontSize: FONT.sm, minH: 36 },
  md: { py: SPACING.md - 2, px: SPACING.lg, fontSize: FONT.md, minH: TOUCH_TARGET },
  lg: { py: SPACING.md, px: SPACING.xl, fontSize: FONT.lg, minH: 52 },
};

export function Button({ title, onPress, variant = 'primary', size = 'md', loading, disabled, style, icon, fullWidth }: Props) {
  const v = VARIANT_STYLES[variant];
  const s = SIZE_STYLES[size];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[{
        backgroundColor: v.bg,
        borderColor: v.border,
        borderWidth: variant === 'outline' ? 1.5 : 0,
        borderRadius: RADIUS.md,
        paddingVertical: s.py,
        paddingHorizontal: s.px,
        minHeight: s.minH,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: SPACING.sm,
        opacity: isDisabled ? 0.5 : 1,
      }, fullWidth && { width: '100%' }, style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          {icon && <Text style={{ color: v.text, fontSize: s.fontSize }}>{icon}</Text>}
          <Text style={{ color: v.text, fontSize: s.fontSize, fontWeight: '600' }}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
