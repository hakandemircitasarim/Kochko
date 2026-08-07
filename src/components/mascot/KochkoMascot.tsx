/**
 * KOÇKO v3 — uygulamanın maskotu: KOÇ (görsel dil §0-A "karakter").
 *
 * Karakter yolculuğu: v1 blob ve v2 robot kullanıcı tarafından "aşırı klişe,
 * karakteri yok" diye reddedildi. v3'ün cevabı markanın İSMİNDE: **KOÇKO = KOÇ** —
 * Türkçede hem antrenör hem de boynuzlu, inatçı, hedefe TOSLAYAN hayvan. Kelime
 * oyunu yalnız Türkçe bir üründe çalışır; kişilik bedava gelir: kafasına koyduğunu
 * yapan, vazgeçmeyen bir tip. Kıvrık spiral boynuzlar 24px'te bile tanınan,
 * sahiplenilebilir bir silüet verir. (Kullanıcı seçimi: A gövdesi + B boynuz ölçeği.)
 *
 * Stil: kalın koyu konturlu çıkartma (kullanıcı onayı); pofuduk menekşe yün,
 * krem yüz, ter bandı (kimlik çapası), kendinden emin YARIM gülümseme + kalkık kaş.
 *
 * Kimlik SABİTTİR: renkler temadan BAĞIMSIZ (Duo her temada yeşildir).
 *
 * mood:
 *   happy  — varsayılan; pazu pozu + smirk + kalkık kaş (idle'da göz kırpar)
 *   cheer  — kutlama; iki kol havada, açık ağız + dil
 *   sleepy — gece; kapalı gözler, sarkık kollar
 *
 * animated: hafif nefes (bob) + uyanık modlarda göz kırpma. Reduce-motion'da durur.
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
  ink: '#221A38',
  wool: '#8B5CF6', // gövde yünü — marka
  woolShade: '#6D3FE0',
  face: '#F4EBDD', // krem yüz
  faceShade: '#E6D9C4',
  horn: '#EDE0CB', // boynuz
  hornLine: '#C9B896',
  band: '#6D3FE0', // ter bandı
  bandLite: '#C4B5FD',
  white: '#FFFFFF',
  hoof: '#4C27B8',
  cheek: '#FFB3C4',
  tongue: '#FF8FA8',
} as const;

const OW = 4;

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

  // Göz kırpma: uyanık modlarda; ~4 sn'de bir 140 ms.
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
        <Ellipse cx={60} cy={113} rx={26} ry={4} fill={C.ink} opacity={0.12} />

        {/* Bacaklar + toynaklar */}
        <Rect x={45} y={94} width={11} height={12} rx={4} fill={C.face} stroke={C.ink} strokeWidth={OW} />
        <Rect x={64} y={94} width={11} height={12} rx={4} fill={C.face} stroke={C.ink} strokeWidth={OW} />
        <Path d="M 42 103 L 59 103 L 59 111 L 42 111 C 40.5 108.5, 40.5 105.5, 42 103 Z" fill={C.hoof} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />
        <Path d="M 61 103 L 78 103 C 79.5 105.5, 79.5 108.5, 78 111 L 61 111 Z" fill={C.hoof} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />

        {/* Kollar: happy sağ pazu, cheer ikisi havada, sleepy sarkık */}
        {cheer ? (
          <>
            <Path d="M 40 74 C 30 70, 24 62, 24 54" stroke={C.ink} strokeWidth={12.5} fill="none" strokeLinecap="round" />
            <Path d="M 40 74 C 30 70, 24 62, 24 54" stroke={C.wool} strokeWidth={6.5} fill="none" strokeLinecap="round" />
            <Path d="M 80 74 C 90 70, 96 62, 96 54" stroke={C.ink} strokeWidth={12.5} fill="none" strokeLinecap="round" />
            <Path d="M 80 74 C 90 70, 96 62, 96 54" stroke={C.wool} strokeWidth={6.5} fill="none" strokeLinecap="round" />
            <Circle cx={24} cy={50} r={6.5} fill={C.face} stroke={C.ink} strokeWidth={OW} />
            <Circle cx={96} cy={50} r={6.5} fill={C.face} stroke={C.ink} strokeWidth={OW} />
          </>
        ) : sleepy ? (
          <>
            <Path d="M 40 74 C 35 78, 32 83, 32 88" stroke={C.ink} strokeWidth={12.5} fill="none" strokeLinecap="round" />
            <Path d="M 40 74 C 35 78, 32 83, 32 88" stroke={C.wool} strokeWidth={6.5} fill="none" strokeLinecap="round" />
            <Path d="M 80 74 C 85 78, 88 83, 88 88" stroke={C.ink} strokeWidth={12.5} fill="none" strokeLinecap="round" />
            <Path d="M 80 74 C 85 78, 88 83, 88 88" stroke={C.wool} strokeWidth={6.5} fill="none" strokeLinecap="round" />
            <Circle cx={32} cy={91} r={6} fill={C.face} stroke={C.ink} strokeWidth={OW} />
            <Circle cx={88} cy={91} r={6} fill={C.face} stroke={C.ink} strokeWidth={OW} />
          </>
        ) : (
          <>
            <Path d="M 40 74 C 31 72, 25 66, 24 58" stroke={C.ink} strokeWidth={12.5} fill="none" strokeLinecap="round" />
            <Path d="M 40 74 C 31 72, 25 66, 24 58" stroke={C.wool} strokeWidth={6.5} fill="none" strokeLinecap="round" />
            <Circle cx={24} cy={54} r={6.5} fill={C.face} stroke={C.ink} strokeWidth={OW} />
            <Path d="M 80 74 C 87 77, 90 82, 90 87" stroke={C.ink} strokeWidth={12.5} fill="none" strokeLinecap="round" />
            <Path d="M 80 74 C 87 77, 90 82, 90 87" stroke={C.wool} strokeWidth={6.5} fill="none" strokeLinecap="round" />
            <Circle cx={90} cy={89} r={6} fill={C.face} stroke={C.ink} strokeWidth={OW} />
          </>
        )}

        {/* Gövde — pofuduk yün topu (tırtıklı kontur) */}
        <Path
          d="M 40 66
             C 36 62, 38 56, 44 56
             C 42 50, 50 46, 55 50
             C 58 44, 66 44, 68 50
             C 74 46, 81 51, 78 57
             C 84 57, 86 64, 81 67
             C 86 72, 84 80, 78 82
             C 80 88, 74 94, 68 92
             C 66 97, 56 97, 53 92
             C 46 95, 39 90, 41 84
             C 34 82, 33 73, 40 66 Z"
          fill={C.wool} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round"
        />
        <Path d="M 48 84 C 52 88, 60 89, 66 86" stroke={C.woolShade} strokeWidth={3.4} strokeLinecap="round" fill="none" />
        <Path d="M 44 72 C 46 76, 50 78, 54 78" stroke={C.woolShade} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.8} />

        {/* BOYNUZLAR — kimlik silüeti; üç katman: ink taban + krem dolgu + iç spiral */}
        <Path
          d="M 44 22
             C 26 12, 9 22, 9 38
             C 9 52, 22 61, 33 56.5
             C 41 53.2, 43 43.5, 36.5 39.5
             C 31 36, 24 39.5, 25.5 45.5
             C 26.5 49.5, 31 50.2, 33 47.4"
          fill="none" stroke={C.ink} strokeWidth={13.5} strokeLinecap="round"
        />
        <Path
          d="M 44 22
             C 26 12, 9 22, 9 38
             C 9 52, 22 61, 33 56.5
             C 41 53.2, 43 43.5, 36.5 39.5
             C 31 36, 24 39.5, 25.5 45.5
             C 26.5 49.5, 31 50.2, 33 47.4"
          fill="none" stroke={C.horn} strokeWidth={7.5} strokeLinecap="round"
        />
        <Path
          d="M 40 20.5 C 27 14, 13 23, 13 37.5 C 13 49, 23 56.5, 32 53"
          fill="none" stroke={C.hornLine} strokeWidth={1.8} strokeLinecap="round" opacity={0.9}
        />
        <Path
          d="M 76 22
             C 94 12, 111 22, 111 38
             C 111 52, 98 61, 87 56.5
             C 79 53.2, 77 43.5, 83.5 39.5
             C 89 36, 96 39.5, 94.5 45.5
             C 93.5 49.5, 89 50.2, 87 47.4"
          fill="none" stroke={C.ink} strokeWidth={13.5} strokeLinecap="round"
        />
        <Path
          d="M 76 22
             C 94 12, 111 22, 111 38
             C 111 52, 98 61, 87 56.5
             C 79 53.2, 77 43.5, 83.5 39.5
             C 89 36, 96 39.5, 94.5 45.5
             C 93.5 49.5, 89 50.2, 87 47.4"
          fill="none" stroke={C.horn} strokeWidth={7.5} strokeLinecap="round"
        />
        <Path
          d="M 80 20.5 C 93 14, 107 23, 107 37.5 C 107 49, 97 56.5, 88 53"
          fill="none" stroke={C.hornLine} strokeWidth={1.8} strokeLinecap="round" opacity={0.9}
        />

        {/* Tepe yünü */}
        <Path
          d="M 42 30 C 40 22, 48 17, 54 21 C 57 15, 66 15, 68 21 C 74 17, 81 23, 78 30 Z"
          fill={C.wool} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round"
        />

        {/* Yüz */}
        <Path
          d="M 41 34 C 41 27, 79 27, 79 34 L 79 52 C 79 62, 71 67, 60 67 C 49 67, 41 62, 41 52 Z"
          fill={C.face} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round"
        />

        {/* Ter bandı (kimlik) */}
        <Path d="M 41 33 C 47 29, 73 29, 79 33 L 79 40 C 70 36.5, 50 36.5, 41 40 Z" fill={C.band} stroke={C.ink} strokeWidth={3.2} strokeLinejoin="round" />
        <Rect x={46} y={31.8} width={10} height={3.4} rx={1.7} fill={C.bandLite} opacity={0.9} />

        {/* Yanaklar */}
        <Ellipse cx={46.5} cy={54} rx={4} ry={2.6} fill={C.cheek} opacity={0.8} />
        <Ellipse cx={73.5} cy={54} rx={4} ry={2.6} fill={C.cheek} opacity={0.8} />

        {/* Gözler + kaşlar — tavır burada */}
        {eyesClosed ? (
          <>
            <Path d="M 47 49 C 49.5 52, 54 52, 56.5 49" stroke={C.ink} strokeWidth={3.4} strokeLinecap="round" fill="none" />
            <Path d="M 63.5 49 C 66 52, 70.5 52, 73 49" stroke={C.ink} strokeWidth={3.4} strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <Ellipse cx={51.5} cy={49} rx={5.2} ry={5.8} fill={C.white} stroke={C.ink} strokeWidth={2.6} />
            <Ellipse cx={68.5} cy={49} rx={5.2} ry={5.8} fill={C.white} stroke={C.ink} strokeWidth={2.6} />
            <Circle cx={52.5} cy={50} r={2.6} fill={C.ink} />
            <Circle cx={69.5} cy={50} r={2.6} fill={C.ink} />
            <Circle cx={53.5} cy={48.8} r={1} fill={C.white} />
            <Circle cx={70.5} cy={48.8} r={1} fill={C.white} />
            {cheer ? (
              <>
                <Path d="M 46 40.5 C 49 38.5, 53 38.5, 56 40" stroke={C.ink} strokeWidth={3.2} strokeLinecap="round" fill="none" />
                <Path d="M 64 40 C 67 38.5, 71 38.5, 74 40.5" stroke={C.ink} strokeWidth={3.2} strokeLinecap="round" fill="none" />
              </>
            ) : (
              <>
                {/* Sağ kaş kalkık — kendinden emin */}
                <Path d="M 46.5 42 C 49.5 41, 53 41.2, 55.5 42.2" stroke={C.ink} strokeWidth={3.2} strokeLinecap="round" fill="none" />
                <Path d="M 64 41.5 C 67 39.2, 71 39, 74 40.6" stroke={C.ink} strokeWidth={3.2} strokeLinecap="round" fill="none" />
              </>
            )}
          </>
        )}

        {/* Burun + ağız: yarım gülümseme (smirk) */}
        <Ellipse cx={60} cy={58.5} rx={7.5} ry={5} fill={C.faceShade} opacity={0.6} />
        <Circle cx={57.2} cy={57.5} r={1.1} fill={C.ink} />
        <Circle cx={62.8} cy={57.5} r={1.1} fill={C.ink} />
        {sleepy ? (
          <Path d="M 55 62.5 C 58 64.5, 62 64.5, 65 62.5" stroke={C.ink} strokeWidth={3} strokeLinecap="round" fill="none" />
        ) : cheer ? (
          <>
            <Path d="M 52 60.5 C 56 66.5, 64 66.5, 68 60.5 Z" fill={C.ink} />
            <Ellipse cx={60} cy={63.6} rx={4.4} ry={2.2} fill={C.tongue} />
          </>
        ) : (
          <Path d="M 53.5 61.5 C 57 64.3, 63 64, 66.5 60.8" stroke={C.ink} strokeWidth={3.2} strokeLinecap="round" fill="none" />
        )}
      </Svg>
    </Animated.View>
  );
}
