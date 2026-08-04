/**
 * Theme Settings Screen
 * Spec 22.2: Tema tercihi - Sistem / Açık / Koyu
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';

// Açık tema (LIGHT_COLORS) ve sağlayıcı en baştan yazılmıştı; kilit yalnızca 47 ekranın
// hâlâ statik (koyu) COLORS'ı import etmesindendi — açık seçilince kabuk aydınlanır, o
// ekranlar koyu kalır, arayüz ikiye bölünürdü. O 47 dosya useTheme()'e taşındı (uygulama
// genelinde SIFIR statik COLORS kaldı), yani bölünme kaynağı ortadan kalktı: kilit açıldı.
const THEME_OPTIONS: { mode: ThemeMode; label: string; desc: string; comingSoon?: boolean }[] = [
  // FIX (audit diakritik)
  { mode: 'dark', label: 'Her Zaman Koyu', desc: 'Göz yorgunluğunu azaltır, OLED pil tasarrufu' },
  { mode: 'system', label: 'Sistemi Takip Et', desc: 'Cihazın tema ayarına göre otomatik değişir' },
  { mode: 'light', label: 'Her Zaman Açık', desc: 'Aydınlık ortamlarda daha rahat okunur' },
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
            <Text style={{ color: colors.text, ...TYPE.headline }}>{opt.label}</Text>
            <Text style={{ color: colors.textSecondary, ...TYPE.body, marginTop: 2 }}>{opt.desc}</Text>
          </View>
          {opt.comingSoon && (
            <Text style={{ color: colors.textMuted, ...TYPE.caption, fontWeight: '600' }}>Yakında</Text>
          )}
        </TouchableOpacity>
        );
      })}
    </View>
  );
}
