/**
 * Toggle Row - reusable toggle switch row for settings screens.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (newValue: boolean) => void;
}

export function ToggleRow({ label, description, value, onToggle }: Props) {
  return (
    <TouchableOpacity
      onPress={() => onToggle(!value)}
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
      }}
    >
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{label}</Text>
        {description && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{description}</Text>}
      </View>
      <View style={{
        width: 48, height: 28, borderRadius: 14,
        backgroundColor: value ? COLORS.primary : COLORS.surfaceLight,
        justifyContent: 'center', padding: 2,
      }}>
        <View style={{
          width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
          alignSelf: value ? 'flex-end' : 'flex-start',
        }} />
      </View>
    </TouchableOpacity>
  );
}
