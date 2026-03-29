/**
 * Profile Completion Bar — Spec 2.2
 * Shows completion percentage with contextual messages,
 * missing field hints, and color-coded progress.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  percentage: number;
  missingFields?: string[];
  onPress?: () => void;
}

const MESSAGES: { threshold: number; message: string }[] = [
  { threshold: 0, message: 'Kocunla konusarak veya Profil Duzenle\'den profilini doldur!' },
  { threshold: 20, message: 'Baslangic guzel. Ne kadar doldurursan oneriler o kadar iyi.' },
  { threshold: 40, message: 'Ilerliyorsun! Birkaç alan daha kocunun onerilerini iyilestirir.' },
  { threshold: 60, message: 'Iyi gidiyorsun. Uyku ve meslek bilgisi onerilerini kisisellestir.' },
  { threshold: 80, message: 'Neredeyse tamam! Detaylar kocunun seni daha iyi tanimasini saglar.' },
  { threshold: 95, message: 'Mukemmel! Profil tamamlandi. Kocun seni cok iyi taniyor.' },
];

const FIELD_LABELS: Record<string, string> = {
  height_cm: 'Boy', weight_kg: 'Kilo', birth_year: 'Dogum yili', gender: 'Cinsiyet',
  activity_level: 'Aktivite', equipment_access: 'Ekipman', cooking_skill: 'Yemek becerisi',
  budget_level: 'Butce', diet_mode: 'Diyet modu', sleep_time: 'Uyku saati',
  wake_time: 'Kalkis saati', occupation: 'Meslek', training_style: 'Antrenman stili',
  alcohol_frequency: 'Alkol tercihi', portion_language: 'Porsiyon dili',
};

export function ProfileCompletion({ percentage, missingFields, onPress }: Props) {
  const color = percentage >= 90 ? COLORS.success : percentage >= 70 ? COLORS.primary : percentage >= 40 ? COLORS.warning : COLORS.error;
  const message = MESSAGES.filter(m => m.threshold <= percentage).pop()?.message ?? MESSAGES[0].message;

  const content = (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Profil Tamamlanma</Text>
        <Text style={{ color, fontSize: FONT.lg, fontWeight: '800' }}>%{Math.round(percentage)}</Text>
      </View>

      {/* Progress bar */}
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${Math.min(100, percentage)}%`, backgroundColor: color, borderRadius: 5 }} />
      </View>

      {/* Message */}
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, lineHeight: 18 }}>{message}</Text>

      {/* Missing fields hint */}
      {missingFields && missingFields.length > 0 && percentage < 90 && (
        <View style={{ marginTop: SPACING.sm, flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Eksik:</Text>
          {missingFields.slice(0, 4).map(f => (
            <View key={f} style={{ backgroundColor: COLORS.surfaceLight, borderRadius: RADIUS.xs, paddingHorizontal: SPACING.sm, paddingVertical: 2 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 10 }}>{FIELD_LABELS[f] ?? f}</Text>
            </View>
          ))}
          {missingFields.length > 4 && (
            <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>+{missingFields.length - 4} daha</Text>
          )}
        </View>
      )}
    </View>
  );

  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  return content;
}
