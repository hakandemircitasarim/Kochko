/**
 * Toggle Row - reusable toggle switch row for settings screens.
 *
 * Duolingo dili (§0-A/§0-B): açıkken iz MARKA menekşesi, kapalıyken Button/ChoiceTile'ın gri
 * gövdesi (açıkta progressTrack, koyuda border — eski surfaceLight açık temada #F0F2F5 idi,
 * #F5F7FA zeminde kapalı anahtar neredeyse görünmüyordu). Topuz her iki temada beyaz ve
 * altında ince bir raf var (gövdeli topuz); konum değişince yaylanarak kayar
 * (translateX, native driver). Reduce-motion → anında yerine oturur.
 */
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useTheme } from '@/lib/theme'; // FIX (audit UI-DS-03): theme-react (was static COLORS snapshot)
import { SPACING } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { a11ySwitch } from '@/lib/accessibility'; // FIX (audit UI-PR-01)

// FIX (audit UI-DS-03): single themed iOS-style toggle primitive. The 48x28 r14 track +
// 24x24 r12 knob markup was duplicated as raw inline JSX in notifications.tsx (twice),
// if-settings.tsx, and the ToggleRow body; they now all consume this one component.
interface ToggleProps {
  value: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean;
  /** When provided, the whole control is exposed as an accessible switch. Omit when an
   *  ancestor TouchableOpacity already carries the switch role/label (decorative use). */
  accessibilityLabel?: string;
}

export function Toggle({ value, onToggle, disabled, accessibilityLabel }: ToggleProps) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const travel = 48 - 24 - 4; // iz genişliği - topuz - 2x padding
  const pos = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) { pos.setValue(value ? 1 : 0); return; }
    const anim = Animated.spring(pos, { toValue: value ? 1 : 0, friction: 7, tension: 160, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [value, reduceMotion, pos]);

  // Topuz beyaz: menekşe izde de gri izde de okunur (eski kapalı topuz `colors.text` koyu
  // temada açık griydi, açık temada siyah bir nokta gibi duruyordu).
  const knobColor = '#FFFFFF';
  const offTrack = isDark ? colors.border : colors.progressTrack;

  // a11y: when this is the interactive element (label given), announce it as a switch and
  // make the track/knob the touch target. When used decoratively inside another switch row,
  // hide it from screen readers and let the parent own the gesture/role.
  const a11yProps = accessibilityLabel
    ? {
        ...a11ySwitch(accessibilityLabel, value),
        accessibilityState: { checked: value, disabled: !!disabled },
        onPress: () => onToggle(!value),
        disabled,
      }
    : { importantForAccessibility: 'no-hide-descendants' as const };

  const track = (
    <View
      style={{
        width: 48, height: 28, borderRadius: 14,
        backgroundColor: value ? colors.primary : offTrack,
        justifyContent: 'center', padding: 2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Animated.View style={{
        width: 24, height: 24, borderRadius: 12, backgroundColor: knobColor,
        // Topuzun rafı: alt kenarda koyu ince şerit — gövdeli tuş dilinin minyatürü.
        borderBottomWidth: 2, borderBottomColor: value ? colors.primaryDark : (isDark ? 'rgba(0,0,0,0.35)' : '#C3C8D2'),
        transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }],
      }} />
    </View>
  );

  if (accessibilityLabel) {
    return (
      <TouchableOpacity activeOpacity={MOTION.pressOpacity} {...a11yProps} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        {track}
      </TouchableOpacity>
    );
  }
  // Decorative: parent TouchableOpacity carries the press handler + switch role.
  return <View {...a11yProps}>{track}</View>;
}

interface Props {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean; // FIX (audit UI-PR-01): lock during async save
}

export function ToggleRow({ label, description, value, onToggle, disabled }: Props) {
  const { colors } = useTheme(); // FIX (audit UI-DS-03): react to theme changes (was static COLORS)
  return (
    <TouchableOpacity activeOpacity={MOTION.pressOpacity}
      onPress={() => onToggle(!value)}
      disabled={disabled} // FIX (audit UI-PR-01)
      // FIX (audit UI-PR-01 / UX-A11-02): announce as a switch with on/off state to screen readers
      {...a11ySwitch(label, value)}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: SPACING.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border,
        opacity: disabled ? 0.5 : 1, // FIX (audit UI-PR-01)
      }}
    >
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={{ ...TYPE.body, fontWeight: '600', color: colors.text }}>{label}</Text>
        {description && <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>{description}</Text>}
      </View>
      {/* FIX (audit UI-DS-03): shared <Toggle/> primitive (decorative; row owns the switch role). */}
      <Toggle value={value} onToggle={onToggle} disabled={disabled} />
    </TouchableOpacity>
  );
}
