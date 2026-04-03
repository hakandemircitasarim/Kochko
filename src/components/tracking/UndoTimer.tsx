/**
 * Undo Timer Component
 * Spec 2.14: 10 saniyelik floating geri alma butonu
 *
 * Yemek kaydı sonrası görünür, 10 saniyede otomatik kapanır.
 * Dokunulursa son kaydı geri alır.
 */
import { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface UndoTimerProps {
  label: string; // e.g., "Ogun kaydedildi"
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number; // default 10000
}

export function UndoTimer({ label, onUndo, onDismiss, durationMs = 10000 }: UndoTimerProps) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Countdown
    const interval = setInterval(() => {
      setRemainingMs(prev => {
        if (prev <= 100) {
          clearInterval(interval);
          onDismiss();
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    // Progress bar animation
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: durationMs,
      useNativeDriver: false,
    }).start();

    // Fade out in last 2 seconds
    const fadeTimeout = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 2000,
        useNativeDriver: true,
      }).start();
    }, durationMs - 2000);

    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimeout);
    };
  }, [durationMs]);

  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <Animated.View style={{
      opacity: fadeAnim,
      position: 'absolute',
      bottom: 100,
      left: SPACING.md,
      right: SPACING.md,
      backgroundColor: COLORS.card,
      borderRadius: 12,
      padding: SPACING.md,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 5,
      borderWidth: 1,
      borderColor: COLORS.border,
    }}>
      {/* Progress bar */}
      <Animated.View style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        overflow: 'hidden',
      }}>
        <Animated.View style={{
          height: '100%',
          backgroundColor: COLORS.primary,
          width: progressAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', '100%'],
          }),
        }} />
      </Animated.View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{label}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
            {secondsLeft} saniye icinde kapanacak
          </Text>
        </View>
        <TouchableOpacity
          onPress={onUndo}
          style={{
            paddingVertical: 8,
            paddingHorizontal: SPACING.md,
            borderRadius: 8,
            backgroundColor: COLORS.error + '15',
          }}>
          <Text style={{ color: COLORS.error, fontSize: FONT.sm, fontWeight: '700' }}>Geri Al</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
