/**
 * Deviation reason tag for reports.
 * Shows why the user deviated from their plan.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

// All deviation reasons are "slip/risk" signals, rendered with on-brand
// semantic tokens (no off-palette Material rainbow). Two tiers:
// medically relevant reasons -> COLORS.error, the rest -> COLORS.warning.
const LABELS: Record<string, { text: string; color: string }> = {
  stres: { text: 'Stres', color: COLORS.warning },
  aclik: { text: 'Açlık Yönetimi', color: COLORS.warning },
  disarida_yemek: { text: 'Dışarıda Yemek', color: COLORS.warning },
  plansiz_atistirma: { text: 'Plansız Atıştırma', color: COLORS.warning },
  sosyal: { text: 'Sosyal Ortam', color: COLORS.warning },
  alkol: { text: 'Alkol', color: COLORS.error },
  yorgunluk: { text: 'Yorgunluk', color: COLORS.warning },
  hastalik: { text: 'Hastalık', color: COLORS.error },
  yok: { text: 'Sapma Yok', color: COLORS.success },
};

interface Props {
  reason: string | null;
}

export function DeviationTag({ reason }: Props) {
  if (!reason || reason === 'yok') return null;

  // Unknown reasons: textSecondary (AA-readable) instead of borderline textMuted.
  const info = LABELS[reason] ?? { text: reason, color: COLORS.textSecondary };

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
      <Text style={{ color: info.color, fontSize: FONT.sm, fontWeight: '600' }}>{info.text}</Text>
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
