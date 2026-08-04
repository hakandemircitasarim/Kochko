/**
 * Toggle Row - reusable toggle switch row for settings screens.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '@/lib/theme'; // FIX (audit UI-DS-03): theme-react (was static COLORS snapshot)
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { a11ySwitch, getContrastColor } from '@/lib/accessibility'; // FIX (audit UI-PR-01)

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
  const { colors } = useTheme();

  // Knob color: contrast token over primary when ON, theme text when OFF (theme-aware,
  // generalizes the old hard-coded #fff while preserving the if-settings contrast fix).
  const knobColor = value ? getContrastColor(colors.primary) : colors.text;

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
        backgroundColor: value ? colors.primary : colors.surfaceLight,
        justifyContent: 'center', padding: 2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{
        width: 24, height: 24, borderRadius: 12, backgroundColor: knobColor,
        alignSelf: value ? 'flex-end' : 'flex-start',
      }} />
    </View>
  );

  if (accessibilityLabel) {
    return (
      <TouchableOpacity {...a11yProps} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
    <TouchableOpacity
      onPress={() => onToggle(!value)}
      disabled={disabled} // FIX (audit UI-PR-01)
      // FIX (audit UI-PR-01 / UX-A11-02): announce as a switch with on/off state to screen readers
      {...a11ySwitch(label, value)}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border,
        opacity: disabled ? 0.5 : 1, // FIX (audit UI-PR-01)
      }}
    >
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={{ ...TYPE.body, color: colors.text }}>{label}</Text>
        {description && <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>{description}</Text>}
      </View>
      {/* FIX (audit UI-DS-03): shared <Toggle/> primitive (decorative; row owns the switch role). */}
      <Toggle value={value} onToggle={onToggle} disabled={disabled} />
    </TouchableOpacity>
  );
}
