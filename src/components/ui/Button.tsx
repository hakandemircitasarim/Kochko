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

  const height = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;
  const fontSize = size === 'sm' ? FONT.xs : size === 'lg' ? FONT.lg : FONT.sm;

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
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon}
          <Text style={{ color: textColor, fontSize, fontWeight: '500' }}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}
