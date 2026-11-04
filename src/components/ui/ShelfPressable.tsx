/**
 * ShelfPressable — her "gövdeli tuş"un ortak iskeleti (Duolingo dili, §0-A).
 *
 * Button, ChoiceTile ve StatCard aynı kalıbı kendi içinde taşıyor; yeni yüzeyler (kayıt
 * ekranının su hapları ve kutucukları…) için bu tek kopya kullanılsın:
 *
 *   dış kutu  paddingBottom: shelf      ← yerleşim boyu sabit, basış hiçbir şeyi kaydırmaz
 *   raf       absolute, top: shelf → 0  ← `shelfColor` (yüz renginin koyusu / gri gövde)
 *   yüz       `faceStyle`               ← basılıyken translateY(shelf): rafa iner
 *
 * Yüz OPAK olmalı: yarı saydam bir yüz rafı içinden gösterir (ChoiceTile'da yakalandı) —
 * pastel ton için `mix()` kullan. `style` yalnız dış kutunun yerleşimi (width/flex/margin/opacity).
 */
import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { MOTION } from '@/lib/design';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  shelfColor: string;
  radius: number;
  style?: StyleProp<ViewStyle>;
  faceStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function ShelfPressable({ shelfColor, radius, style, faceStyle, children, disabled, ...rest }: Props) {
  const shelf = MOTION.shelf;
  return (
    <Pressable {...rest} disabled={disabled} style={[{ paddingBottom: shelf }, style]}>
      {({ pressed }) => (
        <>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, top: shelf, bottom: 0, borderRadius: radius, backgroundColor: shelfColor }}
          />
          <View style={[{ borderRadius: radius, flexGrow: 1 }, faceStyle, { transform: [{ translateY: pressed && !disabled ? shelf : 0 }] }]}>
            {children}
          </View>
        </>
      )}
    </Pressable>
  );
}
