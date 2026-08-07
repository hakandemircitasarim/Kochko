/**
 * Reveal — bölümlerin sayfaya "yerleşme" animasyonu (fade + hafif yükselme).
 *
 * Kural: yalnız MOUNT'ta, bir kez oynar. Sekmeler monte kaldığı için bu pratikte
 * "uygulama açılışında bir kez" demek — her focus'ta tekrar oynayıp yormaz.
 * Kademelendirme `delay` ile (ör. 0/60/120…): göz sırayla aşağı iner, ekran
 * "kuruluyormuş" gibi değil "karşılıyormuş" gibi okunur. Reduce-motion → anında.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { MOTION } from '@/lib/design';
import { useReduceMotion } from '@/hooks/useReduceMotion';

interface Props {
  children: React.ReactNode;
  /** ms — kademelendirme için. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function Reveal({ children, delay = 0, style }: Props) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  // Reduce-motion asenkron çözülür; animasyon başladıktan sonra gelirse kesmeyelim,
  // yalnız İLK karardan önce yakalanırsa atlansın diye başlangıcı tek seferlik tutuyoruz.
  const started = useRef(false);

  useEffect(() => {
    // Bayrak animasyon ortasında true'ya dönerse cleanup animasyonu durdurur;
    // bu dal son duruma oturtur — yarı-görünür takılı kalma olmaz.
    if (reduceMotion) { anim.setValue(1); return; }
    if (started.current) return;
    started.current = true;
    const t = Animated.timing(anim, {
      toValue: 1,
      duration: MOTION.slow,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    t.start();
    return () => t.stop();
  }, [anim, delay, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
