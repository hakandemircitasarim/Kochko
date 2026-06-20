/**
 * Theme Settings Screen
 * Spec 22.2: Tema tercihi - Sistem / Açık / Koyu
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';

// KOCHKO is designed as a flat dark theme. Settings/Reports/auth screens still use
// the static (dark) COLORS, so light/system would render those screens dark over a
// light shell — a broken split. Until those screens are migrated to useTheme, light
// and system are gated ("Yakında") so the experience stays consistently dark (#R3-6).
const THEME_OPTIONS: { mode: ThemeMode; label: string; desc: string; comingSoon?: boolean }[] = [
  // FIX (audit diakritik)
  { mode: 'dark', label: 'Her Zaman Koyu', desc: 'Göz yorgunluğunu azaltır, OLED pil tasarrufu' },
  { mode: 'system', label: 'Sistemi Takip Et', desc: 'Cihazın tema ayarına göre otomatik değişir', comingSoon: true },
  { mode: 'light', label: 'Her Zaman Açık', desc: 'Aydınlık ortamlarda daha rahat okunur', comingSoon: true },
];

export default function ThemeScreen() {
  const { mode, setMode, colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: SPACING.md }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <View style={{ marginTop: SPACING.xs }} />
      {THEME_OPTIONS.map(opt => {
        const active = mode === opt.mode && !opt.comingSoon;
        return (
        <TouchableOpacity
          key={opt.mode}
          disabled={opt.comingSoon}
          activeOpacity={opt.comingSoon ? 1 : 0.7}
          onPress={() => { if (!opt.comingSoon) setMode(opt.mode); }}
          accessibilityRole="radio"
          accessibilityState={{ selected: active, disabled: !!opt.comingSoon }}
          accessibilityLabel={opt.label}
          style={{
            backgroundColor: active ? colors.primary + '20' : colors.card,
            borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.sm,
            borderWidth: 2, borderColor: active ? colors.primary : colors.border,
            opacity: opt.comingSoon ? 0.5 : 1,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>{opt.label}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{opt.desc}</Text>
          </View>
          {opt.comingSoon && (
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '600' }}>Yakında</Text>
          )}
        </TouchableOpacity>
        );
      })}
    </View>
  );
}
