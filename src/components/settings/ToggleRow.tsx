/**
 * Toggle Row - reusable toggle switch row for settings screens.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { a11ySwitch } from '@/lib/accessibility'; // FIX (audit UI-PR-01)

interface Props {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean; // FIX (audit UI-PR-01): lock during async save
}

export function ToggleRow({ label, description, value, onToggle, disabled }: Props) {
  return (
    <TouchableOpacity
      onPress={() => onToggle(!value)}
      disabled={disabled} // FIX (audit UI-PR-01)
      // FIX (audit UI-PR-01 / UX-A11-02): announce as a switch with on/off state to screen readers
      {...a11ySwitch(label, value)}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
        opacity: disabled ? 0.5 : 1, // FIX (audit UI-PR-01)
      }}
    >
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{label}</Text>
        {description && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{description}</Text>}
      </View>
      {/* FIX (audit UI-PR-01): decorative track/knob hidden from screen readers; state conveyed via accessibilityState */}
      <View
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 48, height: 28, borderRadius: 14,
          backgroundColor: value ? COLORS.primary : COLORS.surfaceLight,
          justifyContent: 'center', padding: 2,
        }}
      >
        <View style={{
          width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
          alignSelf: value ? 'flex-end' : 'flex-start',
        }} />
      </View>
    </TouchableOpacity>
  );
}
