/**
 * Deviation reason tag for reports.
 * Shows why the user deviated from their plan.
 *
 * Duolingo dili (§0-A): sol aksan şeritli yarı saydam kutu → opak pastel HAP + konu ikonu.
 * Hap etiket gibi okunur (dokunulmaz, o yüzden gövdesiz). Metin mürekkep (colors.text): kehribar
 * ve kırmızı küçük metin açık zeminde AA sınırındaydı; renk ikon + pastel zeminde taşınıyor.
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { tint } from '@/components/reports/ReportBits';

// All deviation reasons are "slip/risk" signals, rendered with on-brand
// semantic tokens (no off-palette Material rainbow). Two tiers:
// medically relevant reasons -> `error`, the rest -> `warning`.
// The table stores the TOKEN NAME, not a resolved hex: a module-level constant
// is evaluated once at import and would freeze the dark palette into every theme.
type Icon = keyof typeof Ionicons.glyphMap;
const LABELS: Record<string, { text: string; token: keyof ThemeColors; icon: Icon }> = {
  stres: { text: 'Stres', token: 'warning', icon: 'thunderstorm-outline' },
  aclik: { text: 'Açlık Yönetimi', token: 'warning', icon: 'restaurant-outline' },
  disarida_yemek: { text: 'Dışarıda Yemek', token: 'warning', icon: 'storefront-outline' },
  plansiz_atistirma: { text: 'Plansız Atıştırma', token: 'warning', icon: 'fast-food-outline' },
  sosyal: { text: 'Sosyal Ortam', token: 'warning', icon: 'people-outline' },
  alkol: { text: 'Alkol', token: 'error', icon: 'wine-outline' },
  yorgunluk: { text: 'Yorgunluk', token: 'warning', icon: 'battery-dead-outline' },
  hastalik: { text: 'Hastalık', token: 'error', icon: 'medkit-outline' },
  yok: { text: 'Sapma Yok', token: 'success', icon: 'checkmark-circle-outline' },
};

interface Props {
  reason: string | null;
}

export function DeviationTag({ reason }: Props) {
  const { colors, isDark } = useTheme();
  if (!reason || reason === 'yok') return null;

  // Unknown reasons: textSecondary (AA-readable) instead of borderline textMuted.
  const entry = LABELS[reason];
  const info = entry
    ? { text: entry.text, color: colors[entry.token], icon: entry.icon }
    : { text: reason, color: colors.textSecondary, icon: 'help-circle-outline' as Icon };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Sapma nedeni: ${info.text}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, alignSelf: 'flex-start',
        backgroundColor: tint(info.color, colors, isDark, 1.2), borderRadius: RADIUS.pill,
        paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
      }}>
      <Ionicons name={info.icon} size={16} color={info.color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.bodyStrong, color: colors.text, fontWeight: '700' }}>{info.text}</Text>
    </View>
  );
}

/**
 * Multiple deviation tags (for weekly summary).
 */
export function DeviationTags({ reasons }: { reasons: string[] }) {
  const unique = [...new Set(reasons.filter(r => r && r !== 'yok'))];
  if (unique.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
      {unique.map((r, i) => <DeviationTag key={i} reason={r} />)}
    </View>
  );
}
