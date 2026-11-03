import React from 'react';
import { Pressable, View, Text, ActivityIndicator, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE, BUTTON_HEIGHTS } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  /** Layout only (margin / flex / width). Applied to the outer box, so it never reaches the
   *  face — every caller passes margins or `flex: 1` (measured 2026-11-03). */
  style?: ViewStyle;
  icon?: React.ReactNode;
  // FIX (audit ui-button-primitive): expose a11y + test hooks so consumers can override.
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * GÖVDELİ BUTON (Yazio/Duolingo imzası, §0-A).
 *
 * Eski hâli tek bir TouchableOpacity'ydi: alt raf `borderBottomWidth: 4` idi ve basınca
 * buton 0.7'ye SOLUYORDU. Bir tuş gibi görünen şeyin basınca silikleşmesi kendi gövdesiyle
 * çelişiyor — Duolingo'da yüz rafın üstüne İNER. Şimdi iki katman:
 *
 *   ┌──────────────┐  yüz   (height - shelf)  ← basınca translateY(+shelf)
 *   └──────────────┘
 *    ▔▔▔▔▔▔▔▔▔▔▔▔▔▔   raf   (top: shelf → bottom: 0, rengin koyusu)
 *
 * Dış kutunun yüksekliği BUTTON_HEIGHTS'ta kalır (raf dahil — eski border de dahildi), yani
 * yerleşim bir piksel bile kaymaz. Yüz ile raf aynı yarıçapı paylaşır; basılıyken yüz rafı
 * tam örter. Hareket animasyonsuz ve anlık: fiziksel bir tuş gecikmez, ve reduce-motion
 * altında da doğru (yer değiştirme ≤ 4px, kayma/zıplama yok).
 *
 * Varyantlar:
 *   primary / secondary / danger → dolu yüz + koyu raf
 *   outline → beyaz/kart yüz, 2px gri çerçeve + aynı gri raf (Duolingo ikincil buton)
 *   ghost   → gövdesiz; basınca eskisi gibi soluklaşır (raf yokken inecek bir yer de yok)
 */
export function Button({ title, onPress, variant = 'primary', size = 'md', loading, disabled, style, icon, accessibilityLabel, accessibilityHint, testID }: Props) {
  const { colors, isDark } = useTheme();
  const isOutline = variant === 'outline';
  const isGhost = variant === 'ghost';
  const isDanger = variant === 'danger';
  const hasShelf = !isGhost;
  const inactive = !!(disabled || loading);

  const faceColor = isGhost ? 'transparent'
    : isOutline ? colors.card
    : isDanger ? colors.error
    : variant === 'secondary' ? colors.secondary
    : colors.primary;

  // Outline çerçevesi ve rafı: `border` açık temada (#E8ECF0) #F5F7FA zeminde neredeyse
  // görünmüyor; `progressTrack` (#D8DCE4) Duolingo'nun gri gövdesine denk. Koyu temada
  // `progressTrack` 0.08 alfa — fazla sessiz; orada `border` (0.16) doğru ton.
  const outlineEdge = isDark ? colors.border : colors.progressTrack;

  // Raf, dolgudan AYRIŞMALI: danger errorDark alır (errorText OLMAZ: koyu temada dolgudan
  // açıktır); primary/secondary aynı hue olduğundan ikisi de primaryDark alır.
  const shelfColor = isOutline ? outlineEdge : isDanger ? colors.errorDark : colors.primaryDark;

  // Filled variants pick the foreground that passes WCAG AA against their fill via
  // getContrastColor. Outline/ghost keep the brand label.
  const textColor = isGhost || isOutline ? colors.primary : getContrastColor(faceColor);

  // FIX (audit UI-DS-05): consume the BUTTON_HEIGHTS token map instead of inline literals.
  const height = BUTTON_HEIGHTS[size];
  const shelf = hasShelf ? MOTION.shelf : 0;
  // A button's label is the thing a user reads to decide whether to tap it.
  const labelType = size === 'sm' ? TYPE.caption : size === 'lg' ? TYPE.headline : TYPE.bodyStrong;

  // FIX (audit ui-button): sm/md visual heights are < 44dp (WCAG 2.5.5); extend the
  // effective touch target via hitSlop without shifting layout (visual height unchanged).
  const hitSlop = size === 'sm'
    ? { top: 6, bottom: 6, left: 4, right: 4 }
    : size === 'md'
      ? { top: 2, bottom: 2 }
      : undefined;

  return (
    <Pressable
      style={({ pressed }) => [
        { height, opacity: inactive ? 0.5 : isGhost && pressed ? MOTION.pressOpacity : 1 },
        style,
      ]}
      onPress={onPress}
      disabled={inactive}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      {({ pressed }) => (
        <>
          {hasShelf && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', left: 0, right: 0, top: shelf, bottom: 0,
                backgroundColor: shelfColor, borderRadius: RADIUS.md,
              }}
            />
          )}
          <View
            style={{
              height: height - shelf,
              backgroundColor: faceColor,
              borderRadius: RADIUS.md,
              borderWidth: isOutline ? 2 : 0,
              borderColor: isOutline ? outlineEdge : 'transparent',
              paddingHorizontal: size === 'sm' ? SPACING.md : SPACING.xl,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: SPACING.sm,
              transform: [{ translateY: hasShelf && pressed && !inactive ? shelf : 0 }],
            }}
          >
            {loading ? (
              <ActivityIndicator color={textColor} size="small" />
            ) : (
              <>
                {icon}
                {/* FIX (audit UI-PR-04): truncate long Turkish labels (ellipsis) and cap font
                    scaling so a raised system font size can't blow out the fixed button height. */}
                <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...labelType, color: textColor, fontWeight: '700' }}>{title}</Text>
              </>
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}
