/**
 * KOÇKO v2 — uygulamanın maskotu: ROBOT ATLET (görsel dil §0-A "karakter").
 *
 * v1 ("tombul menekşe blob") kullanıcı tarafından "çok dandik" bulundu; kullanıcının
 * verdiği referans (kalın konturlu, vizörlü robot koç çıkartması) menekşeye çevrilerek
 * yeniden çizildi. Kavramsal olarak da doğru: KOCHKO bir AI koç — vizörlü yüz "AI"yı,
 * bandana + K forması "koç"u anlatıyor. Yeşil YASAK: forma/bandana marka menekşesi,
 * göz ışığı "yolunda" gök mavisi (success ailesi).
 *
 * Kimlik SABİTTİR: renkler temadan BAĞIMSIZ (Duo her temada yeşildir).
 *
 * mood:
 *   happy  — varsayılan; pazu sıkan kol + gülümseme (idle'da göz kırpar)
 *   cheer  — kutlama; iki kol havada, iri gözler, geniş gülüş
 *   sleepy — gece; anten düşük, gözler kapalı ışık kavisleri, kollar sarkık
 *
 * animated: hafif nefes (bob) + happy/cheer'de göz kırpma. Reduce-motion'da durur.
 * Mini avatar kullanımı (nudge, başlık, typing) animated={false} bırakmalı.
 *
 * ⚠ Idle animasyon uiautomator dump'ın idle beklemesini doyurmaz — maskotlu ekranda
 * dump "could not get idle state" verebilir (DEVIR §2 notu).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect } from 'react-native-svg';
import { useReduceMotion } from '@/hooks/useReduceMotion';

export type MascotMood = 'happy' | 'cheer' | 'sleepy';

interface Props {
  size?: number;
  mood?: MascotMood;
  animated?: boolean;
}

// Sabit kimlik paleti — tema token'ı DEĞİL, bilerek.
const C = {
  ink: '#221A38', // kontur + vizör
  shell: '#EDE9F7', // kask/gövde gümüşü
  shellShade: '#CFC7E8', // gümüş alt tonu
  jersey: '#8B5CF6', // forma
  band: '#6D3FE0', // bandana + botlar
  bandLite: '#C4B5FD', // bandana parlaması
  glow: '#38BDF8', // göz ışığı (success gök mavisi)
  white: '#FFFFFF',
  antenna: '#A78BFA',
} as const;

const OW = 4.2; // kontur kalınlığı

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

  // Göz kırpma: uyanık modlarda; ~4 sn'de bir 140 ms. State ile — SVG düğümünü
  // Animated'e bağlamaktan çok daha ucuz ve bu ölçekte ayırt edilemez.
  useEffect(() => {
    if (!animated || reduceMotion || mood === 'sleepy') { setBlink(false); return; }
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      setBlink(true);
      blinkTimer = setTimeout(() => setBlink(false), 140);
    }, 4000);
    return () => { clearInterval(interval); if (blinkTimer) clearTimeout(blinkTimer); };
  }, [animated, reduceMotion, mood]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const cheer = mood === 'cheer';
  const sleepy = mood === 'sleepy';
  const eyesClosed = sleepy || blink;

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ translateY }] }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 120 120">
        {/* Zemin gölgesi */}
        <Ellipse cx={60} cy={112} rx={26} ry={4} fill={C.ink} opacity={0.12} />

        {/* Anten — sleepy'de sağa doğru düşer */}
        {sleepy ? (
          <>
            <Path d="M 62 20 C 66 15, 74 13, 79 17" stroke={C.ink} strokeWidth={OW} fill="none" strokeLinecap="round" />
            <Circle cx={81} cy={19} r={5} fill={C.antenna} stroke={C.ink} strokeWidth={OW} />
          </>
        ) : (
          <>
            <Path d="M 60 20 C 60 14, 63 10, 68 8" stroke={C.ink} strokeWidth={OW} fill="none" strokeLinecap="round" />
            <Circle cx={70} cy={7} r={5} fill={C.antenna} stroke={C.ink} strokeWidth={OW} />
          </>
        )}

        {/* Bacaklar + botlar */}
        <Rect x={44} y={88} width={10} height={12} fill={C.shell} stroke={C.ink} strokeWidth={OW} rx={4} />
        <Rect x={66} y={88} width={10} height={12} fill={C.shell} stroke={C.ink} strokeWidth={OW} rx={4} />
        <Path d="M 38 97 L 58 97 C 59.5 100.5, 59.5 105, 58 108 L 38 108 C 36 105, 36 100.5, 38 97 Z" fill={C.band} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />
        <Path d="M 62 97 L 82 97 C 84 100.5, 84 105, 82 108 L 62 108 C 60.5 105, 60.5 100.5, 62 97 Z" fill={C.band} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />

        {/* Kollar */}
        {cheer ? (
          <>
            <Path d="M 42 70 C 32 66, 26 58, 26 50" stroke={C.ink} strokeWidth={13} fill="none" strokeLinecap="round" />
            <Path d="M 42 70 C 32 66, 26 58, 26 50" stroke={C.shell} strokeWidth={7} fill="none" strokeLinecap="round" />
            <Path d="M 78 70 C 88 66, 94 58, 94 50" stroke={C.ink} strokeWidth={13} fill="none" strokeLinecap="round" />
            <Path d="M 78 70 C 88 66, 94 58, 94 50" stroke={C.shell} strokeWidth={7} fill="none" strokeLinecap="round" />
            <Circle cx={26} cy={46} r={7} fill={C.shell} stroke={C.ink} strokeWidth={OW} />
            <Circle cx={94} cy={46} r={7} fill={C.shell} stroke={C.ink} strokeWidth={OW} />
          </>
        ) : sleepy ? (
          <>
            <Path d="M 42 70 C 36 74, 33 80, 33 86" stroke={C.ink} strokeWidth={13} fill="none" strokeLinecap="round" />
            <Path d="M 42 70 C 36 74, 33 80, 33 86" stroke={C.shell} strokeWidth={7} fill="none" strokeLinecap="round" />
            <Path d="M 78 70 C 84 74, 87 80, 87 86" stroke={C.ink} strokeWidth={13} fill="none" strokeLinecap="round" />
            <Path d="M 78 70 C 84 74, 87 80, 87 86" stroke={C.shell} strokeWidth={7} fill="none" strokeLinecap="round" />
            <Circle cx={33} cy={89} r={6.5} fill={C.shell} stroke={C.ink} strokeWidth={OW} />
            <Circle cx={87} cy={89} r={6.5} fill={C.shell} stroke={C.ink} strokeWidth={OW} />
          </>
        ) : (
          <>
            {/* happy: sol kol pazu sıkar — yumruk yukarıda; sağ kol belde */}
            <Path d="M 42 70 C 33 68, 27 62, 26 54" stroke={C.ink} strokeWidth={13} fill="none" strokeLinecap="round" />
            <Path d="M 42 70 C 33 68, 27 62, 26 54" stroke={C.shell} strokeWidth={7} fill="none" strokeLinecap="round" />
            <Circle cx={26} cy={50} r={7} fill={C.shell} stroke={C.ink} strokeWidth={OW} />
            <Path d="M 78 70 C 85 73, 88 79, 88 84" stroke={C.ink} strokeWidth={13} fill="none" strokeLinecap="round" />
            <Path d="M 78 70 C 85 73, 88 79, 88 84" stroke={C.shell} strokeWidth={7} fill="none" strokeLinecap="round" />
            <Circle cx={88} cy={86} r={6.5} fill={C.shell} stroke={C.ink} strokeWidth={OW} />
          </>
        )}

        {/* Gövde/forma + K */}
        <Path
          d="M 42 62 L 78 62 C 82 70, 83 82, 81 92 L 39 92 C 37 82, 38 70, 42 62 Z"
          fill={C.jersey} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round"
        />
        <Path d="M 47 62 C 50 66, 54 68, 60 68 C 66 68, 70 66, 73 62" stroke={C.ink} strokeWidth={3} fill="none" />
        <Path d="M 55 73 L 55 87" stroke={C.white} strokeWidth={4} strokeLinecap="round" />
        <Path d="M 55 80 L 64 73" stroke={C.white} strokeWidth={4} strokeLinecap="round" />
        <Path d="M 57.5 78.2 L 65 87" stroke={C.white} strokeWidth={4} strokeLinecap="round" />

        {/* Kask + bandana + vizör */}
        <Path
          d="M 30 46 C 30 26, 43 15, 60 15 C 77 15, 90 26, 90 46 C 90 57, 83 63, 60 63 C 37 63, 30 57, 30 46 Z"
          fill={C.shell} stroke={C.ink} strokeWidth={OW}
        />
        <Path d="M 33 50 C 36 58, 45 61.5, 60 61.5 C 75 61.5, 84 58, 87 50 C 84 56.5, 74 59.5, 60 59.5 C 46 59.5, 36 56.5, 33 50 Z" fill={C.shellShade} />
        <Path
          d="M 31 34 C 40 27, 80 27, 89 34 C 89.8 36.6, 90 39, 90 41.5 C 80 35.5, 40 35.5, 30 41.5 C 30 39, 30.2 36.6, 31 34 Z"
          fill={C.band} stroke={C.ink} strokeWidth={3.4} strokeLinejoin="round"
        />
        <Rect x={38} y={31.5} width={12} height={4} rx={2} fill={C.bandLite} opacity={0.9} />
        <Path
          d="M 37 44 C 37 40, 40 38, 46 38 L 74 38 C 80 38, 83 40, 83 44 L 83 52 C 83 58, 78 60.5, 60 60.5 C 42 60.5, 37 58, 37 52 Z"
          fill={C.ink}
        />

        {/* Gözler + ağız (vizör içinde) */}
        {eyesClosed ? (
          <>
            <Path d="M 44 49 C 47 52.5, 52 52.5, 55 49" stroke={C.glow} strokeWidth={3.4} strokeLinecap="round" fill="none" />
            <Path d="M 65 49 C 68 52.5, 73 52.5, 76 49" stroke={C.glow} strokeWidth={3.4} strokeLinecap="round" fill="none" />
            <Path d="M 55 56.5 C 58 58, 62 58, 65 56.5" stroke={C.shell} strokeWidth={2.6} strokeLinecap="round" fill="none" opacity={0.9} />
          </>
        ) : (
          <>
            <Circle cx={49.5} cy={47.5} r={cheer ? 6.2 : 5.4} fill={C.glow} />
            <Circle cx={70.5} cy={47.5} r={cheer ? 6.2 : 5.4} fill={C.glow} />
            <Circle cx={51.5} cy={45.5} r={1.9} fill={C.white} />
            <Circle cx={72.5} cy={45.5} r={1.9} fill={C.white} />
            {cheer ? (
              <Path d="M 53 55.5 C 56.5 59.5, 63.5 59.5, 67 55.5" stroke={C.shell} strokeWidth={3} strokeLinecap="round" fill="none" />
            ) : (
              <Path d="M 55 56 C 58 58.2, 62 58.2, 65 56" stroke={C.shell} strokeWidth={3} strokeLinecap="round" fill="none" />
            )}
          </>
        )}
      </Svg>
    </Animated.View>
  );
}
