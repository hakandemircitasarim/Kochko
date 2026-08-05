/**
 * A card-sized tappable that acknowledges the press with BOTH dim and a slight shrink.
 *
 * `MOTION.pressOpacity` (0.7) is already on every tappable in the app via TouchableOpacity's
 * `activeOpacity`. That is the right feedback for a chip, a row or an icon button. But a card
 * is a large surface: dimming a whole card reads as "the screen changed", while shrinking it a
 * couple of percent reads as "you pushed this thing". `MOTION.pressScale` (0.98) exists for
 * exactly that and had zero call sites.
 *
 * TouchableOpacity cannot do scale — hence Pressable, whose style callback gets `pressed`.
 * Two consequences worth knowing before swapping one in:
 *   - `activeOpacity` does nothing here; the opacity comes from the style callback below.
 *   - Pressable has no `activeOpacity`-style default, so a component that forgets this wrapper
 *     gets NO feedback at all rather than the wrong amount.
 *
 * Use it for cards. Leave rows, chips and icon buttons on TouchableOpacity.
 */
import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type ViewStyle, type StyleProp } from 'react-native';
import { MOTION } from '@/lib/design';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function PressableCard({ style, children, ...rest }: Props) {
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [
        style,
        pressed && {
          opacity: MOTION.pressOpacity,
          transform: [{ scale: MOTION.pressScale }],
        },
      ]}
    >
      {children}
    </Pressable>
  );
}
