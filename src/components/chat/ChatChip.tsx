/**
 * ChatChip — sohbetin gövdeli çipi (Duolingo kelime kutucuğu, §0-B).
 *
 * Sohbette dokunulan küçük seçenekler (hızlı cevap, plan değiştirme nedeni, ek tepsisi,
 * görev rayı, geri bildirim…) her biri kendi TouchableOpacity hapını elle yazıyordu: 0.5px
 * çerçeve, basınca 0.7'ye solma, her birinde farklı dolgu. QuickSelectButtons'a gelen gövdeli
 * kutucuk dilinin tek kopyası burada: kart yüz + 2px gri çerçeve + aynı gri raf, basınca rafa
 * iner (ShelfPressable), solmaz.
 *
 * Tonlar (yüz OPAK — mix(): yarı saydam yüz rafı içinden gösterir):
 *   neutral → kart yüz, gri gövde, ana metin
 *   brand   → menekşe pastel yüz + menekşe gövde (etkin/açık durum, "devam" eylemi)
 *   warning → kehribar pastel (geri al, geçmiş tarih etkin)
 */
import type { ComponentProps } from 'react';
import { Text, View, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { bodyEdge } from '@/components/chat/CoachSpeech';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Props {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** Nötr tonda ikon rengi (varsayılan marka). */
  iconColor?: string;
  tone?: 'neutral' | 'brand' | 'warning';
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Etiketin kırpılacağı genişlik (yatay kaydırmalı sıralarda uzun başlık için). */
  maxLabelWidth?: number;
  /** Dış kutunun yerleşimi (margin / alignSelf). */
  style?: StyleProp<ViewStyle>;
  /** false → dokunuşta titreşim yok (çağıran kendi titreşimini çalıyorsa). */
  haptic?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
}

export function ChatChip({
  label, onPress, icon, iconColor, tone = 'neutral', size = 'md', disabled = false, maxLabelWidth, style,
  haptic = true, accessibilityLabel, accessibilityHint, accessibilityState,
}: Props) {
  const { colors, isDark } = useTheme();
  const edge = bodyEdge(colors, isDark);
  const toned = tone === 'brand' ? colors.primary : tone === 'warning' ? colors.warning : null;
  const face = toned ? mix(toned, colors.card, isDark ? 0.2 : 0.1) : colors.card;
  const rim = toned ? mix(toned, colors.card, isDark ? 0.55 : 0.4) : edge;
  // Koyu temada parlak menekşe, kendi koyu pastelinin üstünde ~3.6:1 kalıyordu; etiketi
  // metin rengine doğru açınca okunur oluyor (kehribar koyuda zaten açık).
  const ink = !toned ? colors.text : tone === 'brand' && isDark ? mix(colors.primary, colors.text, 0.5) : toned;
  const sm = size === 'sm';
  return (
    <ShelfPressable
      onPress={() => { if (haptic) haptics.tap(); onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      hitSlop={sm ? { top: 6, bottom: 6, left: 4, right: 4 } : undefined}
      radius={RADIUS.pill}
      shelfColor={rim}
      style={[{ opacity: disabled ? 0.5 : 1 }, style]}
      faceStyle={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        minHeight: sm ? 30 : 36, justifyContent: 'center',
        paddingVertical: sm ? 4 : 7, paddingHorizontal: sm ? SPACING.sm + 2 : SPACING.md,
        backgroundColor: face, borderWidth: 2, borderColor: rim,
      }}
    >
      {icon && <Ionicons name={icon} size={sm ? 13 : 15} color={toned ? ink : iconColor ?? colors.primary} />}
      <View style={{ flexShrink: 1 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{ ...(sm ? TYPE.caption : TYPE.callout), color: ink, fontWeight: '700', maxWidth: maxLabelWidth }}
        >
          {label}
        </Text>
      </View>
    </ShelfPressable>
  );
}
