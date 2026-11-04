/**
 * KOÇKO v4 — uygulamanın maskotu: SPORTİF KOÇ (kullanıcı seçimi, 2026-10-04).
 *
 * Yolculuk: v1 blob ve v2 robot "klişe, karaktersiz" diye reddedildi; v3 tam boy koç çıkartması
 * 22-30px'te (yazıyor balonu, sohbet başlığı, nudge) mor bir lekeye dönüşüyordu — "koç pek belli
 * olmuyor". v4, 4 bağımsız tasarım adayı arasından seçildi (A evrim, B amblem, C çizgi film, D sportif).
 *
 * Aday D "SPORTİF KOÇ": koç kelimesinin iki anlamı birden görünür — boynuzlar hayvanı,
 * turuncu ter bandı + düdük + spor ayakkabı antrenörü söyler.
 * Okunurluk (v3 şikâyeti: 22-30px'te mor leke): yüz MOR, yün açık lila, boynuzlar KREM; en geniş ve
 * en açık parça boynuz C'leri, içlerindeki boşluk zemini gösterdiği için kıvrım 24px'te kapanmaz.
 * Mor yüzde BEYAZ gözler + krem burunlukta koyu burun/ağız → az ama yüksek kontrastlı özellik.
 * size < 48 → AVATAR (yalnız kafa, kalın kontur); size >= 48 → TAM karakter: happy = başparmak +
 * pano, cheer = yumruklar havada + konfeti, sleepy = havlu + kapalı göz + Zz.
 * 2026-11-04 iki mood daha (mevcut üçünün çizimi DEĞİŞMEDİ):
 *   thinking = yükleme / AI çalışırken: gözler yukarı-yana, yamuk "hmm" ağız, el çenede,
 *              sağ üstte düşünce balonu (üç nokta). Kafa balona doğru hafif eğik.
 *   cheerup  = hata / boş durum / bağlantı yok: teselli eden koç. Gülen kapalı gözler (^ ^,
 *              sleepy'nin U'sunun tersi), kapalı yumuşak gülümseme, yanaklar, iki eliyle kalp
 *              uzatır. "Sorun değil, birlikte hallederiz" — üzgün değil, yanında duran koç.
 *   Avatar (<48) yalnız kafa olduğu için ayrım yüzde: thinking'de yukarı bakan göz + yamuk
 *   ağız, cheerup'ta ^ ^ göz + yanak (yanak avatarda yalnız cheerup'ta çizilir — 24px'te
 *   sıcaklığı taşıyan tek leke o).
 * Kimlik sabittir (tema token'ı değil): koyu kontur açık zeminde, açık dolgular koyu zeminde taşır.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { G, Path, Circle, Ellipse, Rect } from 'react-native-svg';
import { useReduceMotion } from '@/hooks/useReduceMotion';

// Geriye uyumlu genişletme: eski üç değer aynı anlamda; yeni ikisi yalnız yeni çağıranlarda.
export type MascotMood = 'happy' | 'cheer' | 'sleepy' | 'thinking' | 'cheerup';
type Mood = MascotMood;

// Sabit kimlik paleti — bilerek tema token'ı DEĞİL.
const C = {
  ink: '#221A38',
  face: '#8B5CF6', // yüz + uzuvlar (marka moru)
  wool: '#C4B5FD', // yün (açık lila)
  woolShade: '#A78BFA',
  horn: '#F2DDB0', // boynuz
  hornLine: '#C9A66B',
  muzzle: '#F7EFE3', // burunluk
  band: '#FF7A3D', // ter bandı + düdük ipi — antrenör turuncusu
  white: '#FFFFFF',
  metal: '#DDE3EC', // düdük
  cheek: '#FF9BBE',
  tongue: '#FF8FA8',
  gold: '#FFC83D',
  mint: '#5EE0C2',
  board: '#C98E55',
  heart: '#FF6F9C', // cheerup kalbi — cheek'ten bir ton doygun: yanakla aynı leke olmasın
} as const;

/** Sol yarıda çizilmiş path'i dikey eksende aynalar (yalnız mutlak M/L/C/Z — her sayı x,y çiftinin parçası). */
function mirrorX(d: string, w: number): string {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (n) => (i++ % 2 === 0 ? String(Math.round((w - parseFloat(n)) * 100) / 100) : n));
}

// ── KAFA (0..100 koordinat; avatar doğrudan, tam karakter ölçekleyerek kullanır) ──
const HORN_L =
  'M 42 26 C 34 9, 14 6, 7 22 C 2 35, 4 53, 14 62 C 21 68, 31 67, 34 59 C 35 55, 33.5 51.5, 31.5 50 ' +
  'C 29 57.5, 22 58.5, 18.5 53 C 14.5 46, 16 34, 22 30 C 28 26, 36 30, 40 38 Z';
const HORN_R = mirrorX(HORN_L, 100);
const RIDGES_L = ['M 28 16 C 27 19.5, 27 23, 27.5 26', 'M 15.5 18 C 17 21, 18.5 24, 20.5 27', 'M 7.5 37.5 C 9.5 37.6, 11.5 38, 13.5 38.5'];
const RIDGES_R = RIDGES_L.map((d) => mirrorX(d, 100));
const TUFT =
  'M 30 42 C 23 40, 21 30, 28.5 26.5 C 26 17, 37 12, 42.5 19.5 C 44 10, 56 10, 57.5 19.5 ' +
  'C 63 12, 74 17, 71.5 26.5 C 79 30, 77 40, 70 42 Z';
const FACE = 'M 30 40 C 30 33, 70 33, 70 40 C 71.5 54, 71 66, 67 76 C 62.5 88.5, 37.5 88.5, 33 76 C 29 66, 28.5 54, 30 40 Z';
const MUZZLE = 'M 33 76 C 32.5 67, 40 63.5, 50 63.5 C 60 63.5, 67.5 67, 67 76 C 62.5 88.5, 37.5 88.5, 33 76 Z';
const BAND = 'M 29 36.5 C 40 30.5, 60 30.5, 71 36.5 L 71.5 47.5 C 60 41.5, 40 41.5, 28.5 47.5 Z';
const NOSE = 'M 45 68.5 C 45 66.3, 55 66.3, 55 68.5 C 55 71.3, 52.2 73.5, 50 73.5 C 47.8 73.5, 45 71.3, 45 68.5 Z';
const DOME_L = 'M 33.5 59 C 34 47.5, 46 47.5, 46.5 59 C 43 57.7, 37 57.7, 33.5 59 Z';
const CLOSED_L = 'M 33.8 55.5 C 36.5 60.5, 43.5 60.5, 46.2 55.5';
const BLINK_L = 'M 34 57 C 37 59, 43 59, 46 57';
const DOME_R = mirrorX(DOME_L, 100);
const CLOSED_R = mirrorX(CLOSED_L, 100);
const BLINK_R = mirrorX(BLINK_L, 100);
// cheerup: gülen kapalı göz — CLOSED_L'nin (uyuyan U) dikey tersi, ^ biçimi.
const SMILE_EYE_L = 'M 33.8 58.5 C 36.5 52.5, 43.5 52.5, 46.2 58.5';
const SMILE_EYE_R = mirrorX(SMILE_EYE_L, 100);

const HW = 6; // avatar ana kontur (24px'te ~1.45px)

function Head({ mood, blink, full }: { mood: Mood; blink: boolean; full: boolean }) {
  const sleepy = mood === 'sleepy';
  const cheer = mood === 'cheer';
  const thinking = mood === 'thinking';
  const cheerup = mood === 'cheerup';
  return (
    <G>
      {/* Boynuzlar — kimliğin silüeti */}
      <Path d={HORN_L} fill={C.horn} stroke={C.ink} strokeWidth={HW} strokeLinejoin="round" />
      <Path d={HORN_R} fill={C.horn} stroke={C.ink} strokeWidth={HW} strokeLinejoin="round" />
      {[...RIDGES_L, ...RIDGES_R].map((d, i) => (
        <Path key={i} d={d} stroke={C.hornLine} strokeWidth={3.5} strokeLinecap="round" fill="none" />
      ))}
      {/* Tepe yünü */}
      <Path d={TUFT} fill={C.wool} stroke={C.ink} strokeWidth={HW} strokeLinejoin="round" />
      {/* Yüz + burunluk; kontur burunluğun üstüne ikinci kez çizilir */}
      <Path d={FACE} fill={C.face} />
      <Path d={MUZZLE} fill={C.muzzle} />
      <Path d={FACE} fill="none" stroke={C.ink} strokeWidth={HW} strokeLinejoin="round" />
      {/* Ter bandı (antrenör) */}
      <Path d={BAND} fill={C.band} stroke={C.ink} strokeWidth={3.5} strokeLinejoin="round" />
      {(full || cheerup) && (
        <>
          <Ellipse cx={34.5} cy={65} rx={4} ry={2.6} fill={C.cheek} opacity={cheerup ? 0.9 : 0.75} />
          <Ellipse cx={65.5} cy={65} rx={4} ry={2.6} fill={C.cheek} opacity={cheerup ? 0.9 : 0.75} />
        </>
      )}
      {/* Gözler */}
      {sleepy ? (
        <>
          <Path d={CLOSED_L} stroke={C.ink} strokeWidth={5.5} strokeLinecap="round" fill="none" />
          <Path d={CLOSED_R} stroke={C.ink} strokeWidth={5.5} strokeLinecap="round" fill="none" />
        </>
      ) : cheerup ? (
        // Kapalı göz kırpmaz; blink dalından ÖNCE.
        <>
          <Path d={SMILE_EYE_L} stroke={C.ink} strokeWidth={5.5} strokeLinecap="round" fill="none" />
          <Path d={SMILE_EYE_R} stroke={C.ink} strokeWidth={5.5} strokeLinecap="round" fill="none" />
        </>
      ) : blink ? (
        <>
          <Path d={BLINK_L} stroke={C.ink} strokeWidth={5} strokeLinecap="round" fill="none" />
          <Path d={BLINK_R} stroke={C.ink} strokeWidth={5} strokeLinecap="round" fill="none" />
        </>
      ) : cheer ? (
        <>
          <Path d={DOME_L} fill={C.white} stroke={C.ink} strokeWidth={2.5} strokeLinejoin="round" />
          <Path d={DOME_R} fill={C.white} stroke={C.ink} strokeWidth={2.5} strokeLinejoin="round" />
        </>
      ) : thinking ? (
        // Bebekler yukarı-sağa (balona) kaçık: "bir düşüneyim" bakışı. Ak aynı, yalnız bebek kayar.
        <>
          <Ellipse cx={40} cy={55.5} rx={6.8} ry={7.8} fill={C.white} stroke={C.ink} strokeWidth={2.5} />
          <Ellipse cx={60} cy={55.5} rx={6.8} ry={7.8} fill={C.white} stroke={C.ink} strokeWidth={2.5} />
          <Circle cx={42.4} cy={52.4} r={4.3} fill={C.ink} />
          <Circle cx={62.4} cy={52.4} r={4.3} fill={C.ink} />
          <Circle cx={44} cy={50.8} r={1.5} fill={C.white} />
          <Circle cx={64} cy={50.8} r={1.5} fill={C.white} />
        </>
      ) : (
        <>
          <Ellipse cx={40} cy={55.5} rx={6.8} ry={7.8} fill={C.white} stroke={C.ink} strokeWidth={2.5} />
          <Ellipse cx={60} cy={55.5} rx={6.8} ry={7.8} fill={C.white} stroke={C.ink} strokeWidth={2.5} />
          {/* Göz bebekleri yana (sağa) kaçık: "şaşkın" değil, kendinden emin bakış */}
          <Circle cx={42.3} cy={56.2} r={4.5} fill={C.ink} />
          <Circle cx={62.3} cy={56.2} r={4.5} fill={C.ink} />
          <Circle cx={44} cy={54.4} r={1.6} fill={C.white} />
          <Circle cx={64} cy={54.4} r={1.6} fill={C.white} />
        </>
      )}
      {/* Burun + ağız */}
      <Path d={NOSE} fill={C.ink} />
      {cheer ? (
        <>
          <Path d="M 41.5 75.5 C 43 86.5, 57 86.5, 58.5 75.5 Z" fill={C.ink} stroke={C.ink} strokeWidth={2} strokeLinejoin="round" />
          <Ellipse cx={50} cy={81.6} rx={5} ry={2.5} fill={C.tongue} />
        </>
      ) : sleepy ? (
        <Path d="M 46 78 C 48.5 79.6, 51.5 79.6, 54 78" stroke={C.ink} strokeWidth={4} strokeLinecap="round" fill="none" />
      ) : thinking ? (
        // Yamuk "hmm": sağa doğru hafif yükselen kısa çizgi — gülümseme de değil, somurtma da.
        <Path d="M 44.5 78.6 C 48 78.4, 52 77.4, 56.5 75.6" stroke={C.ink} strokeWidth={4.5} strokeLinecap="round" fill="none" />
      ) : cheerup ? (
        // Kapalı, yumuşak, simetrik gülümseme — happy'ninkinden geniş ve ortalı (teselli eden yüz).
        <Path d="M 42.5 76 C 45.5 81.6, 54.5 81.6, 57.5 76" stroke={C.ink} strokeWidth={4.5} strokeLinecap="round" fill="none" />
      ) : (
        <Path d="M 43.5 77 C 46.5 80.8, 53 81.2, 57.5 76.2" stroke={C.ink} strokeWidth={4.5} strokeLinecap="round" fill="none" />
      )}
    </G>
  );
}

// ── TAM KARAKTER (0..120) ──
const OW = 4.4; // = HW × kafa ölçeği, gövde konturu kafayla aynı kalınlıkta
const HEAD_T = 'translate(23 -2.4) scale(0.74)';

/** Kalın kontur içinde renkli uzuv (kol) — ink taban + dolgu. */
function Limb({ d }: { d: string }) {
  return (
    <>
      <Path d={d} stroke={C.ink} strokeWidth={12} strokeLinecap="round" fill="none" />
      <Path d={d} stroke={C.face} strokeWidth={6.5} strokeLinecap="round" fill="none" />
    </>
  );
}

/** Bilekte turuncu bileklik: (x1,y1)→(x2,y2) kol yönünde kısa parça. */
function Cuff({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const sx = (x2 - x1) * 0.3;
  const sy = (y2 - y1) * 0.3;
  return (
    <>
      <Path d={`M ${x1} ${y1} L ${x2} ${y2}`} stroke={C.ink} strokeWidth={13} strokeLinecap="butt" fill="none" />
      <Path d={`M ${mx - sx} ${my - sy} L ${mx + sx} ${my + sy}`} stroke={C.band} strokeWidth={8.5} strokeLinecap="butt" fill="none" />
    </>
  );
}

function Hand({ cx, cy, r = 6.5 }: { cx: number; cy: number; r?: number }) {
  return <Circle cx={cx} cy={cy} r={r} fill={C.face} stroke={C.ink} strokeWidth={3.6} />;
}

function Whistle() {
  return (
    <G>
      <Rect x={48} y={80.5} width={12.5} height={5} rx={1.5} fill={C.metal} stroke={C.ink} strokeWidth={2.6} />
      <Circle cx={62} cy={85} r={6.2} fill={C.metal} stroke={C.ink} strokeWidth={2.6} />
      <Path d="M 58.4 82.4 C 59.2 80.6, 61 79.8, 62.8 80" stroke={C.white} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <Circle cx={62.4} cy={85.6} r={1.9} fill={C.ink} />
    </G>
  );
}

const CORD_L = 'M 52 60 C 53 69, 55.5 75.5, 57.5 80.5';
const CORD_R = 'M 68 60 C 67 69, 64.5 75.5, 62 79';
// Spor ayakkabı (toynak yerine — sportif koç): burnu dışa bakan beyaz sneaker.
const SHOE_L = 'M 52 102.5 L 59.5 102.5 L 59.5 111.5 L 43.5 111.5 C 41.4 111.5, 40.8 109.3, 41.6 107.6 C 42.8 105.2, 45.5 104, 49 104 Z';
const SHOE_R = mirrorX(SHOE_L, 120);
// Havlu (sleepy): boynun arkasından dolanıp göğse iki uçla sarkar — sol uç uzun, sağ uç kısa;
// mesai bitti, düdük havlunun altında kalır.
const TOWEL_L = 'M 45 61.5 C 48.5 60.5, 53 60.5, 56.5 61.5 C 56 70, 56.5 80, 56.5 89.5 C 52.8 91.2, 48.4 91.2, 44.5 89.5 C 44.5 80, 45.5 70, 45 61.5 Z';
const TOWEL_R = 'M 63.5 61.5 C 67 60.5, 71.5 60.5, 75 61.5 C 75 68, 74.5 75, 75.5 81.5 C 71.8 83.2, 67.4 83.2, 63.5 81.5 C 64 75, 63.5 68, 63.5 61.5 Z';
const TOWEL_STRIPES = 'M 44.6 82 L 56.4 82 M 44.6 85.5 L 56.5 85.5 M 63.8 74 L 74.8 74 M 63.7 77.5 L 75.1 77.5';
const TOWEL_FRINGE = 'M 47 91 L 47 93.5 M 50.5 91.5 L 50.5 94 M 54 91 L 54 93.5 M 66 83 L 66 85.5 M 69.5 83.5 L 69.5 86 M 73 83 L 73 85.5';

// cheerup kalbi — göğüs ortasında (60, ~83), düdüğü örter.
const HEART =
  'M 60 93 C 49.5 86.5, 48 79, 51.5 75.8 C 54.6 73, 58.6 74.2, 60 77.4 ' +
  'C 61.4 74.2, 65.4 73, 68.5 75.8 C 72 79, 70.5 86.5, 60 93 Z';
// thinking düşünce bulutu (sağ üst köşe; boynuzun dışında kalır).
const THOUGHT =
  'M 92.5 22 C 89 22, 88.5 15.5, 92.5 14 C 92.5 9, 98.5 7, 101.5 9.5 C 104 5.5, 111 6, 112.5 10 ' +
  'C 117.5 10, 118.5 16.5, 115.5 18.5 C 117.5 22.5, 113.5 26, 110 24.5 C 107 27.5, 100 27.5, 98 24.5 ' +
  'C 96 25.5, 93 24.5, 92.5 22 Z';

const BODY =
  'M 52 54 L 68 54 L 69 58 C 76 56, 83 61, 80.5 68.5 C 87 71.5, 88 82, 82 85.5 C 86 92, 80 100, 72.5 98.5 ' +
  'C 69.5 104, 60.5 105, 57.5 100.5 C 53.5 104.5, 45 103, 44.5 97.5 C 37.5 99.5, 32.5 91.5, 38 85.5 ' +
  'C 32 82, 33 71.5, 39.5 68.5 C 37 61, 44 56, 51 58 Z';

function FullBody({ mood, blink }: { mood: Mood; blink: boolean }) {
  const cheer = mood === 'cheer';
  const sleepy = mood === 'sleepy';
  const thinking = mood === 'thinking';
  const cheerup = mood === 'cheerup';
  const happy = !cheer && !sleepy && !thinking && !cheerup;
  // Kafa eğimi: sleepy sola düşer (mevcut); thinking balona doğru sağa; cheerup "dinliyorum"
  // eğimi — sola, sleepy'den az.
  const headTilt = sleepy ? -7 : thinking ? 6 : cheerup ? -5 : 0;
  return (
    <>
      {/* Zemin gölgesi */}
      <Ellipse cx={60} cy={113.5} rx={24} ry={3.6} fill={C.ink} opacity={0.12} />

      {/* Bacaklar + spor ayakkabı */}
      <Rect x={48} y={96} width={10} height={11} rx={3} fill={C.face} stroke={C.ink} strokeWidth={OW} />
      <Rect x={62} y={96} width={10} height={11} rx={3} fill={C.face} stroke={C.ink} strokeWidth={OW} />
      <Path d={SHOE_L} fill={C.white} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />
      <Path d={SHOE_R} fill={C.white} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />
      <Path d="M 46.5 107.3 L 56.5 107.3 M 63.5 107.3 L 73.5 107.3" stroke={C.band} strokeWidth={2.2} strokeLinecap="round" fill="none" />

      {/* Yün gövde */}
      <Path d={BODY} fill={C.wool} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />

      {/* Düdük + turuncu ip; sleepy'de yerine havlu */}
      {sleepy ? (
        <>
          <Path d={TOWEL_FRINGE} stroke={C.ink} strokeWidth={1.8} strokeLinecap="round" fill="none" />
          <Path d={TOWEL_L} fill={C.white} stroke={C.ink} strokeWidth={3.2} strokeLinejoin="round" />
          <Path d={TOWEL_R} fill={C.white} stroke={C.ink} strokeWidth={3.2} strokeLinejoin="round" />
          <Path d={TOWEL_STRIPES} stroke={C.band} strokeWidth={2} fill="none" />
        </>
      ) : (
        <>
          <Path d={CORD_L} stroke={C.ink} strokeWidth={4.6} strokeLinecap="round" fill="none" />
          <Path d={CORD_R} stroke={C.ink} strokeWidth={4.6} strokeLinecap="round" fill="none" />
          <Path d={CORD_L} stroke={C.band} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Path d={CORD_R} stroke={C.band} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Whistle />
        </>
      )}

      {/* Kollar */}
      {happy && (
        <>
          {/* Sol: koltuk altında antrenman panosu */}
          <G transform="rotate(-10 30 84)">
            <Rect x={21} y={71} width={19} height={25} rx={2.5} fill={C.board} stroke={C.ink} strokeWidth={3.4} />
            <Rect x={24} y={75} width={13} height={18} rx={1} fill={C.white} />
            <Path d="M 26.5 80 L 34.5 80 M 26.5 84 L 34.5 84 M 26.5 88 L 31.5 88" stroke={C.woolShade} strokeWidth={1.8} strokeLinecap="round" fill="none" />
            <Rect x={26} y={68.5} width={9} height={5} rx={1.5} fill={C.metal} stroke={C.ink} strokeWidth={2.4} />
          </G>
          <Limb d="M 40.5 74 C 37 79, 35.5 84, 37 88" />
          <Hand cx={37.5} cy={89} r={6} />
          {/* Sağ: başparmak yukarı */}
          <Limb d="M 79.5 74 C 88 75, 94 72, 97 66" />
          <Cuff x1={93.3} y1={71.2} x2={96.4} y2={67.6} />
          <Rect x={94.5} y={53} width={6.5} height={11} rx={3.2} fill={C.face} stroke={C.ink} strokeWidth={3.2} />
          <Rect x={91} y={61} width={13} height={12} rx={5} fill={C.face} stroke={C.ink} strokeWidth={3.6} />
          <Path d="M 93.5 66.5 L 99 66.5" stroke={C.ink} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {cheer && (
        <>
          <Limb d="M 40.5 74 C 30 71, 22 62, 19 52" />
          <Limb d="M 79.5 74 C 90 71, 98 62, 101 52" />
          <Cuff x1={21.5} y1={58} x2={19.6} y2={54} />
          <Cuff x1={98.5} y1={58} x2={100.4} y2={54} />
          <Hand cx={18.5} cy={47} r={7} />
          <Hand cx={101.5} cy={47} r={7} />
        </>
      )}
      {sleepy && (
        <>
          <Limb d="M 40.5 74 C 36.5 79, 34.5 85, 34.5 91" />
          <Limb d="M 79.5 74 C 83.5 79, 85.5 85, 85.5 91" />
          <Hand cx={34.5} cy={93} r={6} />
          <Hand cx={85.5} cy={93} r={6} />
        </>
      )}
      {thinking && (
        // Sol kol sarkık (sleepy'nin sol kolu), sağ el çeneye — kafadan SONRA çizilir (aşağıda).
        <>
          <Limb d="M 40.5 74 C 36.5 79, 34.5 85, 34.5 91" />
          <Hand cx={34.5} cy={93} r={6} />
        </>
      )}
      {cheerup && (
        // İki el göğüs önünde kalbi tutar; kalp düdüğün üstüne biner (düdük yine altında duruyor).
        <>
          <Limb d="M 40.5 74 C 39.5 80, 42.5 84, 47.5 84.5" />
          <Limb d="M 79.5 74 C 80.5 80, 77.5 84, 72.5 84.5" />
          <Path d={HEART} fill={C.heart} stroke={C.ink} strokeWidth={OW} strokeLinejoin="round" />
          <Path d="M 53.6 77.6 C 54.6 76.4, 56.2 76.2, 57.3 77.2" stroke={C.white} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Hand cx={49.5} cy={84.5} r={5.6} />
          <Hand cx={70.5} cy={84.5} r={5.6} />
        </>
      )}

      {/* Kafa */}
      <G transform={headTilt ? `rotate(${headTilt} 60 62) ${HEAD_T}` : HEAD_T}>
        <Head mood={mood} blink={blink} full />
      </G>

      {/* thinking: sağ kol çeneye — kafanın ÜSTÜNE çizilir ki el burunluğun altını örtsün. */}
      {thinking && (
        <>
          <Limb d="M 79.5 74 C 84 84, 72 85, 64.5 69" />
          <Hand cx={63} cy={64.5} r={6.2} />
          {/* Düşünce balonu: kafadan yukarı-sağa büyüyen iki kabarcık + üç noktalı bulut. */}
          <Circle cx={97} cy={45} r={2.4} fill={C.white} stroke={C.ink} strokeWidth={2.2} />
          <Circle cx={102.5} cy={36} r={3.6} fill={C.white} stroke={C.ink} strokeWidth={2.4} />
          <Path d={THOUGHT} fill={C.white} stroke={C.ink} strokeWidth={2.8} strokeLinejoin="round" />
          <Circle cx={98} cy={16.5} r={2} fill={C.face} />
          <Circle cx={104.5} cy={16.5} r={2} fill={C.face} />
          <Circle cx={111} cy={16.5} r={2} fill={C.face} />
        </>
      )}

      {/* Konfeti (cheer) */}
      {cheer && (
        <>
          <Rect x={7} y={14} width={4} height={8} rx={1} fill={C.band} stroke={C.ink} strokeWidth={1.6} transform="rotate(-25 9 18)" />
          <Circle cx={21} cy={7} r={2.4} fill={C.gold} stroke={C.ink} strokeWidth={1.6} />
          <Rect x={4.5} y={31} width={3.6} height={7} rx={1} fill={C.mint} stroke={C.ink} strokeWidth={1.6} transform="rotate(30 6.3 34.5)" />
          <Rect x={108} y={12} width={4} height={8} rx={1} fill={C.gold} stroke={C.ink} strokeWidth={1.6} transform="rotate(25 110 16)" />
          <Circle cx={99} cy={7} r={2.4} fill={C.band} stroke={C.ink} strokeWidth={1.6} />
          <Rect x={111.5} y={31} width={3.6} height={7} rx={1} fill={C.cheek} stroke={C.ink} strokeWidth={1.6} transform="rotate(-30 113.3 34.5)" />
          <Circle cx={9} cy={64} r={2} fill={C.mint} stroke={C.ink} strokeWidth={1.4} />
          <Circle cx={111} cy={64} r={2} fill={C.gold} stroke={C.ink} strokeWidth={1.4} />
        </>
      )}

      {/* Zz (sleepy) */}
      {sleepy && (
        <>
          <Path d="M 98 16 L 107 16 L 98 25 L 107 25" stroke={C.ink} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M 98 16 L 107 16 L 98 25 L 107 25" stroke={C.wool} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M 108 4 L 114 4 L 108 10 L 114 10" stroke={C.ink} strokeWidth={4.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M 108 4 L 114 4 L 108 10 L 114 10" stroke={C.wool} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      )}
    </>
  );
}

interface Props {
  size?: number;
  mood?: MascotMood;
  animated?: boolean;
  /** Mount'ta bir kez yayla belirir (küçükten büyür + hafif yükselir) — giriş/boş durum
   *  karşılaması için. Döngü değil; `animated`'dan bağımsız. Reduce-motion → anında yerinde. */
  enter?: boolean;
}

export function KochkoMascot({ size = 96, mood = 'happy', animated = false, enter = false }: Props) {
  const reduceMotion = useReduceMotion();
  const [blink, setBlink] = useState(false);
  const bob = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(enter ? 0 : 1)).current;
  const avatar = size < 48;

  // Giriş yayı: yalnız mount'ta. Bayrak sonradan true'ya dönerse cleanup durdurur, bu dal
  // son duruma oturtur (yarı küçük takılı kalmaz).
  useEffect(() => {
    if (!enter || reduceMotion) { entrance.setValue(1); return; }
    const a = Animated.spring(entrance, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // Nefes: 0 → 1 → 0 yumuşak sinüs; yalnız animated + hareket kısıtı yokken.
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

  // Göz kırpma: açık gözlü modlarda ~4 sn'de bir 140 ms (sleepy/cheerup gözleri zaten kapalı).
  useEffect(() => {
    if (!animated || reduceMotion || mood === 'sleepy' || mood === 'cheerup') { setBlink(false); return; }
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      setBlink(true);
      blinkTimer = setTimeout(() => setBlink(false), 140);
    }, 4000);
    return () => { clearInterval(interval); if (blinkTimer) clearTimeout(blinkTimer); };
  }, [animated, reduceMotion, mood]);

  // Avatar küçük olduğu için bob oranı da küçük (boyutun ~%4'ü, en çok 3px).
  const lift = Math.min(3, size * 0.04);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] });
  const enterY = entrance.interpolate({ inputRange: [0, 1], outputRange: [size * 0.12, 0] });
  const enterScale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  // Yay 1'i aşıp geri döner; opaklık ilk %40'ta tamamlanır ki aşma anında saydam kalmasın.
  const enterOpacity = entrance.interpolate({ inputRange: [0, 0.4, 2], outputRange: [0, 1, 1] });

  return (
    <Animated.View
      style={{
        width: size, height: size, opacity: enterOpacity,
        transform: [{ translateY }, { translateY: enterY }, { scale: enterScale }],
      }}
      // Dekoratif (v3 ile aynı): her yerleşimin yanında zaten metin var; görseli de okutmak
      // ekran okuyucuya "Koçko"yu iki kez söyletiyordu.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {avatar ? (
        <Svg width={size} height={size} viewBox="0 -1.5 100 100">
          <Head mood={mood} blink={blink} full={false} />
        </Svg>
      ) : (
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <FullBody mood={mood} blink={blink} />
        </Svg>
      )}
    </Animated.View>
  );
}
