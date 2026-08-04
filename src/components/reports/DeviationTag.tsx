/**
 * Deviation reason tag for reports.
 * Shows why the user deviated from their plan.
 */
import { View, Text } from 'react-native';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme, type ThemeColors } from '@/lib/theme';

// All deviation reasons are "slip/risk" signals, rendered with on-brand
// semantic tokens (no off-palette Material rainbow). Two tiers:
// medically relevant reasons -> `error`, the rest -> `warning`.
// The table stores the TOKEN NAME, not a resolved hex: a module-level constant
// is evaluated once at import and would freeze the dark palette into every theme.
const LABELS: Record<string, { text: string; token: keyof ThemeColors }> = {
  stres: { text: 'Stres', token: 'warning' },
  aclik: { text: 'Açlık Yönetimi', token: 'warning' },
  disarida_yemek: { text: 'Dışarıda Yemek', token: 'warning' },
  plansiz_atistirma: { text: 'Plansız Atıştırma', token: 'warning' },
  sosyal: { text: 'Sosyal Ortam', token: 'warning' },
  alkol: { text: 'Alkol', token: 'error' },
  yorgunluk: { text: 'Yorgunluk', token: 'warning' },
  hastalik: { text: 'Hastalık', token: 'error' },
  yok: { text: 'Sapma Yok', token: 'success' },
};

interface Props {
  reason: string | null;
}

export function DeviationTag({ reason }: Props) {
  const { colors } = useTheme();
  if (!reason || reason === 'yok') return null;

  // Unknown reasons: textSecondary (AA-readable) instead of borderline textMuted.
  const entry = LABELS[reason];
  const info = entry
    ? { text: entry.text, color: colors[entry.token] }
    : { text: reason, color: colors.textSecondary };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Sapma nedeni: ${info.text}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
        backgroundColor: info.color + '15', borderRadius: 8,
        paddingHorizontal: SPACING.sm, paddingVertical: 4,
        borderLeftWidth: 3, borderLeftColor: info.color,
      }}>
      <Text style={{ ...TYPE.caption, color: info.color, fontWeight: '600' }}>{info.text}</Text>
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
