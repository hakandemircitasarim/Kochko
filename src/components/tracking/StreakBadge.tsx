/**
 * Streak Badge — gün serisi rozeti (Duolingo dili, §0-A).
 *
 * Eskiden markanın menekşesinde düz bir hapdı: seri, ekrandaki diğer menekşe dolgulardan
 * (butonlar, kahraman halka) ayırt edilmiyordu ve alevin "sıcaklığı" yoktu. Şimdi:
 *   - Dolgu `METRIC_COLORS.streak` (kehribar) — paletin içinden, yeni hue yok.
 *   - Ön plan MÜREKKEP (#2A2140): beyaz kehribarda 1,8:1 (WCAG altı); mürekkep ≥ 7:1.
 *     StatStrip'teki plaka kuralıyla aynı ton.
 *   - Alt raf (koyu kehribar, MOTION.shelf'in yarısı): rozet de gövdeli bir nesne.
 *   - Alev hafifçe titrer (ölçek + açı döngüsü). Yalnız `animated` iken — çağıran odak
 *     dışında kapatır (sekmeler monte kalır, döngü arka planda dönmesin). Reduce-motion → sabit.
 */
import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { METRIC_COLORS } from '@/lib/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

const STREAK_FILL = METRIC_COLORS.streak;
/** Kehribarın koyusu — rozetin rafı. */
const STREAK_SHELF = '#D98C00';
const STREAK_INK = '#2A2140';

interface Props {
  days: number;
}

export function StreakBadge({ days }: Props) {
  const isFocused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const flicker = useRef(new Animated.Value(0)).current;
  const visible = days >= 2;
  const animate = visible && isFocused && !reduceMotion;

  useEffect(() => {
    if (!animate) { flicker.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: -1, duration: 640, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0, duration: 480, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, flicker]);

  if (!visible) return null;

  return (
    <View
      // FIX (audit UX-A11-04): announce the badge as a streak (matches DeviationTag).
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${days} günlük seri`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: RADIUS.pill,
        paddingVertical: SPACING.xs + 1,
        paddingHorizontal: SPACING.sm + 4,
        backgroundColor: STREAK_FILL,
        borderBottomWidth: MOTION.shelf / 2,
        borderBottomColor: STREAK_SHELF,
      }}>
      <Animated.View
        style={{
          transform: [
            { scale: flicker.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.94, 1, 1.12] }) },
            { rotate: flicker.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] }) },
          ],
        }}
      >
        <Ionicons name="flame" size={15} color={STREAK_INK} />
      </Animated.View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: STREAK_INK, fontWeight: '800' }}>{days} gün</Text>
    </View>
  );
}
