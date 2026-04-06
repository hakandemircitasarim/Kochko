import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', loading, disabled, style, icon }: Props) {
  const { colors } = useTheme();
  const isOutline = variant === 'outline';
  const isGhost = variant === 'ghost';
  const isDanger = variant === 'danger';

  const bgColor = isOutline || isGhost ? 'transparent'
    : isDanger ? colors.error
    : variant === 'secondary' ? colors.secondary
    : colors.primary;

  const textColor = isGhost ? colors.primary
    : isOutline ? colors.primary
    : isDanger ? '#fff'
    : '#fff';

  const height = size === 'sm' ? 36 : size === 'lg' ? 52 : 44;
  const fontSize = size === 'sm' ? FONT.sm : size === 'lg' ? FONT.lg : FONT.md;
  const radius = size === 'sm' ? RADIUS.sm : RADIUS.md;

  return (
    <TouchableOpacity
      style={[{
        backgroundColor: bgColor,
        borderRadius: radius,
        height,
        paddingHorizontal: size === 'sm' ? SPACING.md : SPACING.lg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: SPACING.sm,
        opacity: disabled || loading ? 0.5 : 1,
        borderWidth: isOutline ? 1.5 : 0,
        borderColor: isOutline ? colors.primary : 'transparent',
      }, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon}
          <Text style={{ color: textColor, fontSize, fontWeight: '600', letterSpacing: -0.2 }}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}
