/**
 * ChoiceTile + ChipSelect — tek seçimli, gövdeli seçenek kutucukları (Duolingo cevap kutucuğu).
 *
 * Eskiden onboarding ve profil düzenlemede iki ayrı kopya vardı: ince çerçeveli hap, seçilince
 * düz menekşe dolgu, basınca soluklaşma. Duolingo dilinde seçenek de bir TUŞ:
 *   - Seçili değil: kart yüz + 2px gri çerçeve + aynı gri raf.
 *   - Seçili: açık menekşe yüz + menekşe çerçeve + koyu menekşe raf, etiket menekşe/kalın.
 *     (Tam dolgu yerine tint: seçim belli ama bir "gönder" butonu gibi bağırmıyor — ekranın
 *     tek dolu butonu "Devam".)
 *   - Basınca yüz rafa iner (Button ile aynı MOTION.shelf; yerleşim kaymaz).
 *   - Seçildiği anda küçük bir yaylanma (0.94 → 1). Reduce-motion → yaylanma yok.
 *
 * Raf + yüz katmanı içeriğe göre boyutlanır: dış kutu `paddingBottom: shelf`, raf ondan
 * `shelf` aşağıda başlayan mutlak bir katman — sabit yükseklik gerekmez (flexWrap hapları).
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, MOTION, alpha } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { useReduceMotion } from '@/hooks/useReduceMotion';

interface TileProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Ekran okuyucu etiketi (ör. "Cinsiyet: Kadın"). */
  accessibilityLabel?: string;
}

export function ChoiceTile({ label, selected, onPress, accessibilityLabel }: TileProps) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const wasSelected = useRef(selected);

  // Yalnız GERÇEK seçilme anında (false → true) yaylan; ilk çizimde ve seçim kalkarken değil.
  useEffect(() => {
    if (selected && !wasSelected.current && !reduceMotion) {
      pop.setValue(0.94);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }).start();
    }
    wasSelected.current = selected;
  }, [selected, reduceMotion, pop]);

  // Button'ın outline kuralıyla aynı gri: açıkta progressTrack, koyuda border (bkz. Button.tsx).
  const idleEdge = isDark ? colors.border : colors.progressTrack;
  const edge = selected ? colors.primary : idleEdge;
  const shelfColor = selected ? colors.primaryDark : idleEdge;
  // Seçili ton yarı saydam: doğrudan yüze verilirse arkadaki koyu raf içinden görünür ve
  // menekşe etiket menekşe zeminde kaybolur (lab'da yakalandı). Yüz opak kart kalır, ton
  // onun İÇİNDE ayrı bir katman.
  const tint = selected ? alpha(colors.primary, isDark ? 0.22 : 0.1) : null;
  const shelf = MOTION.shelf;

  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      <Pressable
        onPress={() => { haptics.tap(); onPress(); }}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
        accessibilityRole="radio"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ selected, checked: selected }}
        style={{ paddingBottom: shelf }}
      >
        {({ pressed }) => (
          <>
            <View
              pointerEvents="none"
              style={{ position: 'absolute', left: 0, right: 0, top: shelf, bottom: 0, backgroundColor: shelfColor, borderRadius: RADIUS.sm }}
            />
            <View
              style={{
                minHeight: 44 - shelf,
                justifyContent: 'center',
                paddingVertical: SPACING.sm,
                paddingHorizontal: SPACING.md,
                borderRadius: RADIUS.sm,
                borderWidth: 2,
                borderColor: edge,
                backgroundColor: colors.card,
                overflow: 'hidden',
                transform: [{ translateY: pressed ? shelf : 0 }],
              }}
            >
              {tint && (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: tint }} />
              )}
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{ ...TYPE.bodyStrong, color: selected ? colors.primary : colors.textSecondary, fontWeight: selected ? '800' : '600' }}
              >
                {label}
              </Text>
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

interface SelectProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (v: string) => void;
}

/** Başlık + sarmalanan ChoiceTile satırı. Onboarding ve profil düzenleme ortak kullanır. */
export function ChipSelect({ label, options, selected, onChange }: SelectProps) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: SPACING.md }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {/* Field labels tell the user what they are being asked. TYPE.callout, not the smallest step. */}
      <Text style={{ ...TYPE.callout, color: colors.textSecondary, marginBottom: SPACING.sm, fontWeight: '500' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {options.map((opt) => (
          <ChoiceTile
            key={opt.value}
            label={opt.label}
            selected={selected === opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityLabel={`${label}: ${opt.label}`}
          />
        ))}
      </View>
    </View>
  );
}
