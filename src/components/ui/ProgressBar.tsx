/**
 * ProgressBar — uygulamanın tek doğrusal ilerleme çubuğu (Duolingo dili, §0-A).
 *
 * Önceden yedi ayrı yerde elle yazılmıştı (iz View'ı + yüzde genişlikli dolgu): hepsi
 * anında, düz ve parıltısız çiziliyordu; ilerleme bir "ödül" değil bir ölçüm gibi okunuyordu.
 * Bu bileşen üç şeyi tek yerde yapar:
 *   1. DOLARAK GELİR: dolgu önceki değerden yenisine ease-out ile akar (ilk çizimde 0'dan).
 *      Genişlik animasyonu native driver'da çalışmaz; JS sürücüsü küçük bir çubuk için ucuz.
 *      Reduce-motion → son değere anında oturur.
 *   2. PARLAK ŞERİT: dolgunun üst üçte birinde beyaz-alfa bir şerit — Duolingo çubuğunun
 *      "ışık alan plastik" hissi. Yalnız ≥ 6px çubuklarda (ince çubukta çizgi gibi okunur).
 *   3. KÜÇÜK DEĞER YUVARLAK KALIR: ilerleme > 0 iken dolgu en az çubuk yüksekliği kadardır;
 *      %2'lik bir dolgu kırık bir piksel sütunu değil, küçük bir hap olarak görünür.
 *
 * İz rengi çağırandan gelir: iz YÜZEYE ve TEMAYA göre seçilmeli (DEVIR §0-A tuzağı — iki kez
 * kaybolan iz). Verilmezse `colors.progressTrack`.
 *
 * Erişilebilirlik çağıranda: bu bileşen `accessible={false}`; değer/etiket zaten çubuğun
 * yanındaki metinde ya da çağıranın a11yProgress sarmalayıcısında.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

interface Props {
  /** 0–1; dışı kırpılır. */
  progress: number;
  color: string;
  height?: number;
  trackColor?: string;
  /** Yalnız yerleşim (margin / width / flex). */
  style?: StyleProp<ViewStyle>;
  /** ms — dolma süresi. */
  duration?: number;
}

export function ProgressBar({ progress, color, height = 8, trackColor, style, duration = 650 }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const target = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const fill = useRef(new Animated.Value(reduceMotion ? target : 0)).current;

  useEffect(() => {
    if (reduceMotion) { fill.setValue(target); return; }
    const anim = Animated.timing(fill, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // genişlik: native driver desteklemez
    });
    anim.start();
    return () => anim.stop();
  }, [target, reduceMotion, duration, fill]);

  const radius = height / 2;
  const shine = height >= 6;
  const shineInset = Math.min(radius + 2, 8);

  return (
    <View
      accessible={false}
      style={[{ height, backgroundColor: trackColor ?? colors.progressTrack, borderRadius: radius, overflow: 'hidden' }, style]}
    >
      <Animated.View
        style={{
          height: '100%',
          width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          minWidth: target > 0 ? height : 0,
          backgroundColor: color,
          borderRadius: radius,
        }}
      >
        {shine && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: Math.max(1, Math.round(height * 0.18)),
              left: shineInset,
              right: shineInset,
              height: Math.max(2, Math.round(height * 0.26)),
              borderRadius: height,
              backgroundColor: 'rgba(255,255,255,0.35)',
            }}
          />
        )}
      </Animated.View>
    </View>
  );
}
