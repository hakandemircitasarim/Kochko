/**
 * Card Component — Base container for all content sections.
 * Supports: title, subtitle, pressable, loading skeleton, accent border, footer.
 */
import React, { type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, type ViewStyle } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS, SHADOW } from '@/lib/constants';

interface Props {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  loading?: boolean;
  accentColor?: string;
  footer?: ReactNode;
}

export function Card({ title, subtitle, children, style, onPress, loading, accentColor, footer }: Props) {
  const content = (
    <View style={[
      {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        borderColor: COLORS.border,
      },
      accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : undefined,
      SHADOW.sm,
      style,
    ]}>
      {(title || subtitle) && (
        <View style={{ marginBottom: SPACING.sm }}>
          {title && <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600' }}>{title}</Text>}
          {subtitle && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xxs }}>{subtitle}</Text>}
        </View>
      )}

      {loading ? (
        <View style={{ paddingVertical: SPACING.xl, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>Yukleniyor...</Text>
        </View>
      ) : (
        children
      )}

      {footer && !loading && (
        <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.sm, marginTop: SPACING.sm }}>
          {footer}
        </View>
      )}
    </View>
  );

  if (onPress) {
    return <TouchableOpacity activeOpacity={0.7} onPress={onPress}>{content}</TouchableOpacity>;
  }

  return content;
}

export function EmptyState({ message, action }: { message: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ paddingVertical: SPACING.xl, alignItems: 'center' }}>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', lineHeight: 20, maxWidth: 260 }}>{message}</Text>
      {action && (
        <TouchableOpacity onPress={action.onPress} style={{ marginTop: SPACING.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: COLORS.primary }}>
          <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function Divider({ spacing = SPACING.sm }: { spacing?: number }) {
  return <View style={{ height: 1, backgroundColor: COLORS.border, marginVertical: spacing }} />;
}

export function InfoRow({ label, value, highlight, onPress }: { label: string; value: string; highlight?: boolean; onPress?: () => void }) {
  const row = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.xs }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>{label}</Text>
      <Text style={{ color: highlight ? COLORS.warning : COLORS.text, fontSize: FONT.md, fontWeight: '500' }}>{value}</Text>
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress}>{row}</TouchableOpacity>;
  return row;
}
