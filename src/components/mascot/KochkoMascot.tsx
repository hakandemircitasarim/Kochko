/**
 * KOÇKO — uygulamanın maskotu (görsel dil: Yazio/Duolingo, DEVIR §0-A).
 *
 * Ter bantlı, tombul, menekşe bir koç karakteri. Bu dilde karakter en belirleyici
 * öğe ve uygulamada hiç yoktu — en büyük eksik buydu.
 *
 * Kimlik SABİTTİR: renkler temadan BAĞIMSIZ (Duo her temada yeşildir). Marka
 * menekşesinin ailesi + pembe yanak; yeşil YASAK (bkz. project-visual-language).
 *
 * mood:
 *   happy  — varsayılan; yuvarlak gözler + küçük gülümseme (idle'da göz kırpar)
 *   cheer  — kutlama; kollar havada, gülen "^ ^" gözler, açık ağız
 *   sleepy — gece; kapalı göz kapakları, sakin gülümseme
 *
 * animated: hafif nefes alma (bob) + happy'de göz kırpma. Reduce-motion açıkken
 * ikisi de durur. Küçük avatar kullanımı (nudge, liste) animated={false} bırakmalı.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useReduceMotion } from '@/hooks/useReduceMotion';

export type MascotMood = 'happy' | 'cheer' | 'sleepy';

interface Props {
  size?: number;
  mood?: MascotMood;
  animated?: boolean;
}

// Sabit kimlik paleti — tema token'ı DEĞİL, bilerek.
const C = {
  body: '#8B5CF6',
  bodyShade: '#7C4DF0',
  band: '#5B2EDC',
  belly: 'rgba(255,255,255,0.20)',
  eyeWhite: '#FFFFFF',
  ink: '#2A2140',
  cheek: 'rgba(255,143,168,0.65)',
  tongue: '#FF8FA8',
  feet: '#6D3FE0',
} as const;

export function KochkoMascot({ size = 96, mood = 'happy', animated = false }: Props) {
  const reduceMotion = useReduceMotion();
  const [blink, setBlink] = useState(false);
  const bob = useRef(new Animated.Value(0)).current;

  // Nefes alma: 0 → 1 → 0, yumuşak sinüs; yalnız animated + hareket kısıtı yokken.
  useEffect(() => {
    if (!animated || reduceMotion) { bob.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, reduceMotion, bob]);

  // Göz kırpma: yalnız happy'de; ~4 sn'de bir 140 ms. State ile — SVG düğümünü
  // Animated'e bağlamaktan çok daha ucuz ve bu ölçekte ayırt edilemez.
  useEffect(() => {
    if (!animated || reduceMotion || mood !== 'happy') { setBlink(false); return; }
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      setBlink(true);
      blinkTimer = setTimeout(() => setBlink(false), 140);
    }, 4000);
    return () => { clearInterval(interval); if (blinkTimer) clearTimeout(blinkTimer); };
  }, [animated, reduceMotion, mood]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const eyesClosed = mood === 'sleepy' || blink;

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ translateY }] }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 120 120">
        {/* Ayaklar */}
        <Rect x={38} y={99} width={17} height={11} rx={5.5} fill={C.feet} />
        <Rect x={65} y={99} width={17} height={11} rx={5.5} fill={C.feet} />

        {/* Kollar — cheer'da havada, diğerlerinde yanda */}
        {mood === 'cheer' ? (
          <>
            <Ellipse cx={15} cy={44} rx={8.5} ry={14} fill={C.bodyShade} transform="rotate(-32, 15, 44)" />
            <Ellipse cx={105} cy={44} rx={8.5} ry={14} fill={C.bodyShade} transform="rotate(32, 105, 44)" />
          </>
        ) : (
          <>
            <Ellipse cx={17} cy={74} rx={8.5} ry={13} fill={C.bodyShade} transform="rotate(18, 17, 74)" />
            <Ellipse cx={103} cy={74} rx={8.5} ry={13} fill={C.bodyShade} transform="rotate(-18, 103, 74)" />
          </>
        )}

        {/* Gövde: yastık formu — RADIUS dili gibi geniş yarıçap */}
        <Rect x={20} y={20} width={80} height={84} rx={38} fill={C.body} />
        <Ellipse cx={60} cy={84} rx={25} ry={16} fill={C.belly} />

        {/* Ter bandı */}
        <Rect x={25} y={31} width={70} height={13} rx={6.5} fill={C.band} />
        <Rect x={32} y={34} width={13} height={5} rx={2.5} fill="rgba(255,255,255,0.35)" />

        {/* Gözler */}
        {mood === 'cheer' ? (
          <>
            {/* Gülen "^ ^" gözler */}
            <Path d="M37,60 Q45,51 53,60" stroke={C.ink} strokeWidth={4} strokeLinecap="round" fill="none" />
            <Path d="M67,60 Q75,51 83,60" stroke={C.ink} strokeWidth={4} strokeLinecap="round" fill="none" />
          </>
        ) : eyesClosed ? (
          <>
            <Path d="M37,60 Q45,66 53,60" stroke={C.ink} strokeWidth={3.5} strokeLinecap="round" fill="none" />
            <Path d="M67,60 Q75,66 83,60" stroke={C.ink} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <Ellipse cx={45} cy={59} rx={10.5} ry={11.5} fill={C.eyeWhite} />
            <Ellipse cx={75} cy={59} rx={10.5} ry={11.5} fill={C.eyeWhite} />
            <Circle cx={46.5} cy={60.5} r={4.8} fill={C.ink} />
            <Circle cx={73.5} cy={60.5} r={4.8} fill={C.ink} />
            <Circle cx={48.2} cy={58.4} r={1.7} fill={C.eyeWhite} />
            <Circle cx={75.2} cy={58.4} r={1.7} fill={C.eyeWhite} />
          </>
        )}

        {/* Yanaklar */}
        <Circle cx={36} cy={72} r={4.5} fill={C.cheek} />
        <Circle cx={84} cy={72} r={4.5} fill={C.cheek} />

        {/* Ağız */}
        {mood === 'cheer' ? (
          <>
            <Path d="M50,71 Q60,85 70,71 Z" fill={C.ink} />
            <Ellipse cx={60} cy={77.5} rx={5.5} ry={3.5} fill={C.tongue} />
          </>
        ) : (
          <Path d="M53,73 Q60,79 67,73" stroke={C.ink} strokeWidth={3.5} strokeLinecap="round" fill="none" />
        )}
      </Svg>
    </Animated.View>
  );
}
