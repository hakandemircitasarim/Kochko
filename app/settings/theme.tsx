/**
 * Theme Settings Screen
 * Spec 22.2: Tema tercihi - Sistem / Açık / Koyu
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';

const THEME_OPTIONS: { mode: ThemeMode; label: string; desc: string }[] = [
  { mode: 'system', label: 'Sistemi Takip Et', desc: 'Cihazin tema ayarina gore otomatik degisir' },
  { mode: 'dark', label: 'Her Zaman Koyu', desc: 'Goz yorgunlugunu azaltir, OLED pil tasarrufu' },
  { mode: 'light', label: 'Her Zaman Acik', desc: 'Aydinlik ortamlarda daha rahat okunur' },
];

export default function ThemeScreen() {
  const { mode, setMode, colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: SPACING.md }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: colors.text, marginBottom: SPACING.lg }}>Tema</Text>
      {THEME_OPTIONS.map(opt => (
        <TouchableOpacity
          key={opt.mode}
          onPress={() => setMode(opt.mode)}
          style={{
            backgroundColor: mode === opt.mode ? colors.primary + '20' : colors.card,
            borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.sm,
            borderWidth: 2, borderColor: mode === opt.mode ? colors.primary : colors.border,
          }}
        >
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>{opt.label}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{opt.desc}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
