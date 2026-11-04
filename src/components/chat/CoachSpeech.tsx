/**
 * CoachSpeech — sohbetin "Koçko konuşuyor" dili (Duolingo karakter balonu, §0-A/§0-B).
 *
 * Neden ayrı dosya: koç balonu, "yazıyor" ve "düşünüyor" göstergeleri AYNI konuşmacının
 * ağzından çıkıyor. Üçü ayrı ayrı çizilince avatar boyu, kuyruk ve çerçeve kayıyordu (gösterge
 * maskotu balonun İÇİNDE, mesajlarınki DIŞINDA). Ölçüler ve parçalar burada tek kopya:
 *
 *   [avatar] ◁[ balon (2px gri çerçeve) ]
 *
 *  - Avatar yalnız ardışık koç mesajlarının SONUNCUSUNDA görünür (mesajlaşma uygulaması
 *    gruplaması); ötekilerde yer tutucu kalır ki balonlar aynı hizada dursun.
 *  - Kuyruk: çerçeveli üçgen (dış üçgen çerçeve renginde, iç üçgen yüz renginde ~2px içeride).
 *    45° döndürülmüş kare (CoachBubble) çerçeveyle dikiş veremiyordu; iki üçgen veriyor.
 *  - Çerçeve/raf grisi gövdeli yüzeylerle aynı: açıkta progressTrack, koyuda border (§0-B).
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { mix } from '@/lib/design';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';

/** Avatar plakasının çapı. */
export const COACH_AVATAR = 34;
/** Avatar + kuyruk payı: koç balonunun ve altındaki eklerin sol girintisi. */
export const COACH_SLOT = COACH_AVATAR + 10;
/** Balon yarıçapı; kuyruk köşesi küçülür ki üçgen düz kenara otursun. */
export const BUBBLE_RADIUS = 20;
export const BUBBLE_TAIL_RADIUS = 8;
/** Balon çerçeve kalınlığı (Input ve gövdeli çiplerle aynı 2px). */
export const BUBBLE_BORDER = 2;

/** Gövdeli yüzeylerin tek gri tonu (§0-B): açıkta progressTrack, koyuda border. */
export function bodyEdge(colors: ThemeColors, isDark: boolean): string {
  return isDark ? colors.border : colors.progressTrack;
}

/**
 * Koçko avatarı — tonlu yuvarlak plaka + mini kafa. Statik: 28px'te idle animasyon titrer;
 * canlılığı zaten balon girişi ve yazıyor noktaları taşıyor. `visible=false` → aynı boyda
 * boş yer tutucu (grup ortasındaki balonlar hizada kalsın diye).
 */
export function CoachAvatar({ visible = true, children }: { visible?: boolean; children?: ReactNode }) {
  const { colors } = useTheme();
  if (!visible) return <View style={{ width: COACH_AVATAR, height: COACH_AVATAR }} />;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: COACH_AVATAR, height: COACH_AVATAR, alignItems: 'center', justifyContent: 'center' }}
    >
      {children}
      <View
        style={{
          width: COACH_AVATAR, height: COACH_AVATAR, borderRadius: COACH_AVATAR / 2,
          // Opak pastel plaka (mix): zemin ne olursa olsun avatar bir "yüz" olarak okunur.
          backgroundColor: mix(colors.primary, colors.background, 0.16),
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <KochkoMascot size={28} />
      </View>
    </View>
  );
}

/**
 * Çerçeveli konuşma kuyruğu. Balonun İÇİNE mutlak konumlu çocuk olarak konur; konum
 * balonun dolgu kutusuna göredir (çerçevenin içi), bu yüzden çerçeve kalınlığı hesaba katılır.
 *  side='left'  → koç balonu, avatara bakar (çerçeveli).
 *  side='right' → kullanıcı balonu (çerçevesiz dolgu: `edge` verilmez).
 */
export function SpeechTail({ side, face, edge, border = BUBBLE_BORDER, bottom = 9 }: {
  side: 'left' | 'right';
  face: string;
  edge?: string;
  border?: number;
  bottom?: number;
}) {
  const W = 9; // üçgenin derinliği
  const H = 8; // yarı yüksekliği
  const tri = (color: string, offset: number): StyleProp<ViewStyle> => ({
    position: 'absolute',
    bottom,
    width: 0,
    height: 0,
    borderTopWidth: H,
    borderBottomWidth: H,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    ...(side === 'left'
      ? { left: -(W + border) + offset, borderRightWidth: W, borderRightColor: color }
      : { right: -(W + border) + offset, borderLeftWidth: W, borderLeftColor: color }),
  });
  // İç üçgen ~1.5×çerçeve içeri kayar: eğik kenarlarda dik kalınlık ≈ çerçeve kalınlığı,
  // ve balonun kendi çerçevesini kuyruğun ağzında örter (dikiş görünmez).
  const inset = edge ? Math.round(border * 1.5) : 0;
  return (
    <>
      {edge && <View pointerEvents="none" style={tri(edge, 0)} />}
      <View pointerEvents="none" style={tri(face, inset)} />
    </>
  );
}
