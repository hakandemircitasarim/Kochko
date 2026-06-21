/**
 * DateTimeField — tappable field that opens the native date/time picker, replacing the
 * error-prone free-text "HH:MM" / "YYYY-MM-DD" Inputs. Reads/writes plain strings so it's a
 * drop-in for the existing string state (value '' = empty).
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  label?: string;
  mode: 'time' | 'date';
  /** "HH:MM" for time, "YYYY-MM-DD" for date. */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  // FIX (audit ui-datetimefield): allow callers to bound the picker (e.g. no future dates).
  minimumDate?: Date;
  maximumDate?: Date;
}

function parse(value: string, mode: 'time' | 'date'): Date {
  const now = new Date();
  if (!value) return now;
  if (mode === 'time') {
    const m = value.match(/(\d{1,2}):(\d{2})/);
    if (m) { const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d; }
    return now;
  }
  const d = new Date(value + 'T12:00:00');
  return isNaN(d.getTime()) ? now : d;
}

function format(d: Date, mode: 'time' | 'date'): string {
  if (mode === 'time') return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DateTimeField({ label, mode, value, onChange, placeholder, minimumDate, maximumDate }: Props) {
  const { colors, isDark } = useTheme(); // FIX (audit UI-DS-08): also read isDark for native picker themeVariant
  const [show, setShow] = useState(false);
  const display = value || placeholder || (mode === 'time' ? 'Saat seç' : 'Tarih seç');

  return (
    <View style={{ marginBottom: SPACING.md }}>
      {label ? (
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.xs + 2 }}>{label}</Text>
      ) : null}
      <TouchableOpacity
        onPress={() => setShow(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? (mode === 'time' ? 'Saat' : 'Tarih')}: ${value || 'seçilmedi'}`}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: colors.inputBg, borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md,
          borderWidth: 0.5, borderColor: colors.border, minHeight: 48,
        }}
      >
        <Text style={{ color: value ? colors.text : colors.textSecondary, fontSize: FONT.sm }}>{display}</Text>
        <Ionicons name={mode === 'time' ? 'time-outline' : 'calendar-outline'} size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={parse(value, mode)}
          mode={mode}
          is24Hour
          {...(minimumDate ? { minimumDate } : {})}
          {...(maximumDate ? { maximumDate } : {})}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'} // FIX (audit UI-DS-08): match app theme instead of hardcoded dark
          onChange={(event, selected) => {
            // Android fires once and auto-dismisses; iOS keeps the spinner open until done.
            if (Platform.OS !== 'ios') setShow(false);
            if (event.type === 'set' && selected) onChange(format(selected, mode));
            else if (Platform.OS === 'ios' && event.type === 'dismissed') setShow(false);
          }}
        />
      )}
    </View>
  );
}
