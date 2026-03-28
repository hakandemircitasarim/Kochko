/**
 * Deviation reason tag for reports.
 * Shows why the user deviated from their plan.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const LABELS: Record<string, { text: string; color: string }> = {
  stres: { text: 'Stres', color: '#E91E63' },
  aclik: { text: 'Aclik Yonetimi', color: '#FF5722' },
  disarida_yemek: { text: 'Disarida Yemek', color: '#FF9800' },
  plansiz_atistirma: { text: 'Plansiz Atistirma', color: '#FFC107' },
  sosyal: { text: 'Sosyal Ortam', color: '#9C27B0' },
  alkol: { text: 'Alkol', color: '#673AB7' },
  yorgunluk: { text: 'Yorgunluk', color: '#607D8B' },
  hastalik: { text: 'Hastalik', color: '#795548' },
  yok: { text: 'Sapma Yok', color: COLORS.success },
};

interface Props {
  reason: string | null;
}

export function DeviationTag({ reason }: Props) {
  if (!reason || reason === 'yok') return null;

  const info = LABELS[reason] ?? { text: reason, color: COLORS.textMuted };

  return (
    <View style={{
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
