/**
 * Profile Completion Bar
 * Spec 2.2: "Ne kadar doldurursan o kadar iyi sonuç alırsın"
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  percentage: number;
}

export function ProfileCompletion({ percentage }: Props) {
  const color = percentage >= 80 ? COLORS.success : percentage >= 50 ? COLORS.primary : COLORS.warning;

  const messages: Record<number, string> = {
    0: 'Kocunla konusarak profilini doldur!',
    25: 'Iyi baslangic! Devam et.',
    50: 'Yarisina geldin. Detaylar kocunun seni daha iyi tanimasini saglar.',
    75: 'Cok iyi! Neredeyse tamam.',
    100: 'Profil tamamlandi. Kocun seni cok iyi taniyor.',
  };

  const nearestKey = Object.keys(messages).map(Number).filter(k => k <= percentage).pop() ?? 0;
  const message = messages[nearestKey];

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Profil Tamamlanma</Text>
        <Text style={{ color, fontSize: FONT.md, fontWeight: '700' }}>%{percentage}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${percentage}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{message}</Text>
    </View>
  );
}
