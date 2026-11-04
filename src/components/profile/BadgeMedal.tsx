/**
 * BadgeMedal — rozet madalyonu + başarım kataloğu (Duolingo rozet vitrini dili, §0-A).
 *
 * Başarımlar ekranı eskiden kazanılanları tek tip menekşe çerçeveli satırlar olarak
 * diziyordu; kazanılmamış hiçbir şey görünmüyordu — kullanıcı neyin peşinden koşacağını
 * bilmiyordu. Duolingo vitrininde ise:
 *   - kazanılan rozet CANLI renkli ve gövdeli (alt raf = rengin koyusu),
 *   - kazanılmayan rozet GRİ SİLÜET (aynı biçim, gri gövde, kilit işareti).
 *
 * Madalyon dokunulabilir değil (statik nesne) ama gövdesi var: raf + yüz katmanı
 * ShelfPressable'ın statik kopyası (dış kutu `paddingBottom: shelf`). Yüz OPAK.
 *
 * Ön plan rengi: kehribar/gül dolgu üstünde MÜREKKEP (#2A2140, StatStrip PLATE_INK kuralı —
 * beyaz kehribarda 1,8:1); menekşe/mavi dolguda beyaz.
 *
 * BADGE_CATALOG yalnız SUNUM: başlıklar achievements.service.checkMilestones (kilo/seri/
 * bakım) ve ai-chat'in 'pr' ödülüyle aynı türleri listeler — kazanılmamış rozetlerin
 * silüetini çizmek için. Kazanılmış bir rozetin başlığı/açıklaması her zaman VERİDEN gelir.
 */
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { MOTION, mix } from '@/lib/design';

type IconName = keyof typeof Ionicons.glyphMap;

export const MEDAL_INK = '#2A2140';

/** Rozet aileleri — paletin üç hue'su + marka (yeni renk yok). */
export const BADGE_FAMILY = {
  weight: { color: METRIC_COLORS.weight, ink: MEDAL_INK },   // gül
  streak: { color: METRIC_COLORS.streak, ink: MEDAL_INK },   // kehribar
  pr: { color: METRIC_COLORS.workout, ink: '#FFFFFF' },      // menekşe
  maintenance: { color: METRIC_COLORS.water, ink: '#FFFFFF' }, // mavi
} as const;
export type BadgeFamily = keyof typeof BADGE_FAMILY;

export interface BadgeDef {
  type: string;
  title: string;
  /** Kilitliyken "nasıl kazanılır" ipucu. */
  hint: string;
  icon: IconName;
  family: BadgeFamily;
}

export const BADGE_CATALOG: BadgeDef[] = [
  { type: 'streak_7', title: '7 Gün Seri', hint: '7 gün arka arkaya kayıt', icon: 'flame-outline', family: 'streak' },
  { type: 'streak_30', title: '30 Gün Seri', hint: '1 ay kesintisiz kayıt', icon: 'flame', family: 'streak' },
  { type: 'streak_100', title: '100 Gün Seri', hint: '100 gün arka arkaya', icon: 'bonfire', family: 'streak' },
  { type: 'first_kg', title: 'İlk Kilo', hint: 'Hedefine doğru ilk 1 kg', icon: 'trending-down-outline', family: 'weight' },
  { type: 'five_kg', title: '5 Kilo', hint: 'Hedefine doğru 5 kg', icon: 'trending-down', family: 'weight' },
  { type: 'half_goal', title: 'Yarı Yolda', hint: 'Hedefinin yarısı', icon: 'flag-outline', family: 'weight' },
  { type: 'goal_reached', title: 'Hedefe Ulaştın', hint: 'Hedef kilona ulaş', icon: 'trophy', family: 'weight' },
  { type: 'pr', title: 'Kişisel Rekor', hint: 'Antrenmanda yeni rekor', icon: 'barbell', family: 'pr' },
  { type: 'maintenance_1m', title: '1 Ay Bakımda', hint: 'Hedef kilonda 1 ay', icon: 'shield-checkmark-outline', family: 'maintenance' },
  { type: 'maintenance_3m', title: '3 Ay Bakımda', hint: 'Hedef kilonda 3 ay', icon: 'shield-checkmark', family: 'maintenance' },
  { type: 'maintenance_6m', title: '6 Ay Bakımda', hint: 'Hedef kilonda 6 ay', icon: 'shield', family: 'maintenance' },
];

export function badgeDef(type: string): BadgeDef | undefined {
  return BADGE_CATALOG.find(b => b.type === type);
}

interface Props {
  icon: IconName;
  family: BadgeFamily;
  earned: boolean;
  size?: number;
}

export function BadgeMedal({ icon, family, earned, size = 64 }: Props) {
  const { colors, isDark } = useTheme();
  const shelf = size >= 56 ? MOTION.shelf : MOTION.shelf / 2;
  const { color, ink } = BADGE_FAMILY[family];
  // Kilitli: Button/ChoiceTile gri gövdesi (açıkta progressTrack, koyuda border) + silik ikon.
  const greyEdge = isDark ? colors.border : colors.progressTrack;
  const face = earned ? color : colors.surfaceLight;
  const shelfColor = earned ? mix(color, '#000000', 0.72) : greyEdge;
  const iconColor = earned ? ink : colors.textMuted;
  // İç halka: madalyon "basılmış metal" gibi okunsun (Duolingo rozetinin iç kenarı).
  const ring = earned ? mix('#FFFFFF', color, 0.35) : greyEdge;

  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size + shelf, paddingBottom: shelf }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: shelf, bottom: 0, borderRadius: size / 2, backgroundColor: shelfColor }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: face, alignItems: 'center', justifyContent: 'center', borderWidth: earned ? 0 : 2, borderColor: greyEdge }}>
        <View style={{ position: 'absolute', top: size * 0.09, left: size * 0.09, right: size * 0.09, bottom: size * 0.09, borderRadius: size, borderWidth: Math.max(2, Math.round(size / 26)), borderColor: ring, opacity: earned ? 0.9 : 0.6 }} />
        <Ionicons name={icon} size={Math.round(size * 0.44)} color={iconColor} />
      </View>
      {!earned && (
        <View style={{ position: 'absolute', right: -2, bottom: shelf - 2, width: size * 0.36, height: size * 0.36, borderRadius: size, backgroundColor: colors.card, borderWidth: 2, borderColor: greyEdge, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="lock-closed" size={Math.round(size * 0.18)} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}
