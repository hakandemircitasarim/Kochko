import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { View, TextInput, Text, Pressable, Animated, Platform, type TextInputProps, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/** react-native-web'in tanıdığı ama RN tiplerinde olmayan değer. */
const WEB_NO_OUTLINE = { outlineStyle: 'none' } as unknown;

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  /** Renders an eye toggle to reveal/hide the entered text (for password fields). */
  secureToggle?: boolean;
}

/**
 * Metin alanı (Duolingo dili, §0-A).
 *
 * - Çerçeve her durumda 2px (durum değişince yükseklik oynamaz): boşta gri gövde (açıkta
 *   progressTrack, koyuda border — Button outline ile aynı gri), ODAKTA marka rengi, hatada
 *   kırmızı. Eski 0.5px `border` açık temada #F5F7FA zeminde neredeyse görünmüyordu ve odak
 *   hiç gösterilmiyordu: kişi hangi alana yazdığını imleçten başka bir şeyle göremiyordu.
 * - Hata İLK belirdiğinde alan kısa bir yatay sallanma yapar (Duolingo'nun "yanlış" hareketi);
 *   aynı hata kalırken ya da hata metni değişirken tekrar oynamaz. Reduce-motion → sallanma yok.
 * - Hata metni `errorText`: küçük yazı için AA'yı geçen ton (`error` beyaz kartta 3,9:1'di).
 */
export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, hint, secureToggle, style, secureTextEntry, onFocus, onBlur, ...props },
  ref,
) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const hadError = useRef(!!error);

  useEffect(() => {
    const has = !!error;
    if (has && !hadError.current && !reduceMotion) {
      shake.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -0.4, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
    hadError.current = has;
  }, [error, reduceMotion, shake]);

  // When secureToggle is on, the eye controls masking; otherwise honor the prop.
  const masked = secureToggle ? !revealed : secureTextEntry;
  const idleEdge = isDark ? colors.border : colors.progressTrack;
  const edge = error ? colors.error : focused ? colors.primary : idleEdge;

  return (
    <View style={{ marginBottom: SPACING.md }}>
      {label && (
        <Text style={{ ...TYPE.callout, color: colors.textSecondary, fontWeight: '500', marginBottom: SPACING.xs + 2 }}>
          {label}
        </Text>
      )}
      <Animated.View
        style={{
          justifyContent: 'center',
          transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) }],
        }}
      >
        <TextInput
          ref={ref}
          style={[
            {
              backgroundColor: colors.inputBg,
              borderRadius: RADIUS.md,
              paddingHorizontal: SPACING.xl,
              // 2px çerçeve eski 0.5px'e göre 1.5px/kenar yer kaplar; dikey dolgu aynı kalır.
              paddingVertical: SPACING.md,
              paddingRight: secureToggle ? SPACING.xl + 44 : SPACING.xl,
              color: colors.text,
              // You TYPE here — 13px is below the app's own reading size, so text you are actively
              // entering was smaller than text you passively read. TYPE.body is the reading step.
              ...TYPE.body,
              borderWidth: 2,
              borderColor: edge,
              // Web: tarayıcının kendi (siyah) odak çizgisi menekşe odak çerçevesinin üstüne
              // biniyordu. Odak artık çerçevenin kendisiyle görünür — çift gösterge gereksiz.
              // `outlineWidth: 0` yetmiyor: Chrome `outline: auto` halkasını genişlikten bağımsız
              // çizer (hesaplanmış stilde ölçüldü). RN tipleri 'none'u bilmez; yalnız web'de geçerli.
              ...(Platform.OS === 'web' ? (WEB_NO_OUTLINE as TextStyle) : null),
            },
            style,
          ]}
          placeholderTextColor={colors.textSecondary}
          secureTextEntry={masked}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          {...props}
          // FIX (ux-pass5, audit UX-A11-03): the visual label was only a sibling <Text> —
          // screen readers heard just the placeholder (or the bare value once filled) on
          // visually identical fields. Placed after the spread so an explicit
          // accessibilityLabel from a consumer still wins.
          accessibilityLabel={props.accessibilityLabel ?? label}
        />
        {secureToggle && (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Şifreyi gizle' : 'Şifreyi göster'}
            style={{
              position: 'absolute',
              right: SPACING.xs,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={revealed ? colors.primary : colors.textMuted}
            />
          </Pressable>
        )}
      </Animated.View>
      {/* An error message is the one line a user MUST read to recover — 11px was the smallest step
          in the app for the most important sentence on the screen. */}
      {error && <Text style={{ ...TYPE.caption, color: colors.errorText, marginTop: SPACING.xs }}>{error}</Text>}
      {hint && !error && <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.xs }}>{hint}</Text>}
    </View>
  );
});
