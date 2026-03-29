/**
 * Undo Toast — Spec 3.2
 * Shows a 10-second "Geri Al" toast after deletion.
 * If user taps undo, calls onUndo callback.
 * Auto-dismisses after 10 seconds.
 */
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  message: string;
  visible: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  duration?: number; // ms, default 10000
}

export function UndoToast({ message, visible, onUndo, onDismiss, duration = 10000 }: Props) {
  const [opacity] = useState(new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      const timer = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => onDismiss());
      }, duration);
      return () => clearTimeout(timer);
    } else {
      opacity.setValue(0);
    }
  }, [visible, duration, onDismiss, opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={{
      position: 'absolute', bottom: 100, left: SPACING.md, right: SPACING.md,
      backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderWidth: 1, borderColor: COLORS.border,
      opacity,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
      elevation: 8,
    }}>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }}>{message}</Text>
      <TouchableOpacity
        onPress={() => { onUndo(); onDismiss(); }}
        style={{ backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, marginLeft: SPACING.sm }}
      >
        <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>Geri Al</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
