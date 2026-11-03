/**
 * ConfettiBurst — kutlama anının konfetisi (Duolingo dili, §0-A "az sayı, çok teşvik").
 *
 * Ebeveyninin ORTASINDAN bir kez patlar: parçalar yukarı-yana fırlar, yerçekimiyle döner
 * ve düşerken söner. Tek bir Animated.Value (0→1) her parçanın yolunu interpolate eder —
 * parça başına zamanlayıcı yok, hepsi native driver'da (translate/rotate/opacity).
 *
 * Kullanım: konumlanmış (relative) bir kabın içine koy; kendisi `absolute` ve dokunmayı
 * geçirir. `burstKey` değiştikçe yeniden oynar (ör. kutlama metni). Reduce-motion açıkken
 * hiçbir şey çizmez: konfeti tamamen süs, bilgi taşımaz.
 *
 * Renkler metrik paletinden (menekşe/mavi/kehribar/gül + gök mavisi "yolunda") — yeni
 * hue eklenmez; kutlama uygulamanın kendi renklerinden yapılır.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { METRIC_COLORS } from '@/lib/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

const PALETTE = [METRIC_COLORS.calories, METRIC_COLORS.water, METRIC_COLORS.steps, METRIC_COLORS.weight, '#38BDF8'];

/** Yolun örneklendiği anlar — başta sık (patlama hızlı), sonda seyrek (süzülme yavaş). */
const SAMPLES = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1];

interface Piece {
  color: string;
  w: number;
  h: number;
  round: boolean;
  xs: number[];
  ys: number[];
  spin: string;
}

interface Props {
  /** Değiştikçe patlama yeniden oynar. null/undefined → çizilmez. */
  burstKey: string | number | null | undefined;
  /** Parça sayısı. */
  count?: number;
  /** Fırlatma yarıçapı (px) — parçaların ulaştığı yaklaşık mesafe. */
  spread?: number;
  /** ms */
  duration?: number;
}

/** Patlama eğrisi: 1 - (1-p)^3 — yolun çoğu ilk anlarda alınır. */
function burstEase(p: number) {
  return 1 - Math.pow(1 - p, 3);
}

/** Tohumlu, deterministik rastgele: aynı `burstKey` aynı deseni çizer (ekran görüntüsü/test). */
function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function hashKey(k: string | number): number {
  const str = String(k);
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

export function ConfettiBurst({ burstKey, count = 32, spread = 170, duration = 1500 }: Props) {
  const reduceMotion = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;

  const pieces = useMemo<Piece[]>(() => {
    if (burstKey == null) return [];
    const rnd = seeded(hashKey(burstKey));
    return Array.from({ length: count }, (_, i) => {
      // Yukarı yarım daireye eğilimli açı (-170°…-10°) + biraz da yana/aşağı kaçak.
      const angle = (-170 + rnd() * 160) * (Math.PI / 180);
      const v = spread * (0.55 + rnd() * 0.6);
      const gravity = spread * (0.7 + rnd() * 0.5);
      // Fırlatma ease-out (ilk %20'de yolun yarısı: "patlama"), yerçekimi doğrusal-kare
      // (sona doğru hızlanan düşüş). İkisi toplanınca parça önce saçılır, sonra süzülür.
      const xs = SAMPLES.map((p) => Math.cos(angle) * v * burstEase(p));
      const ys = SAMPLES.map((p) => Math.sin(angle) * v * burstEase(p) + gravity * p * p);
      const turns = (rnd() > 0.5 ? 1 : -1) * (180 + rnd() * 540);
      const round = i % 4 === 0;
      return {
        color: PALETTE[i % PALETTE.length],
        w: round ? 8 : 6 + rnd() * 3,
        h: round ? 8 : 10 + rnd() * 5,
        round,
        xs,
        ys,
        spin: `${turns.toFixed(0)}deg`,
      };
    });
  }, [burstKey, count, spread]);

  useEffect(() => {
    if (burstKey == null || reduceMotion) return;
    t.setValue(0);
    const anim = Animated.timing(t, {
      toValue: 1,
      duration,
      easing: Easing.linear, // eğri zaten parabolün kendisinde; zaman doğrusal kalmalı
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [burstKey, reduceMotion, duration, t]);

  if (burstKey == null || reduceMotion) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
    >
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.h,
            borderRadius: p.round ? p.w / 2 : 2,
            backgroundColor: p.color,
            opacity: t.interpolate({ inputRange: [0, 0.05, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: t.interpolate({ inputRange: SAMPLES, outputRange: p.xs }) },
              { translateY: t.interpolate({ inputRange: SAMPLES, outputRange: p.ys }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.spin] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}
