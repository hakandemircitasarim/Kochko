/**
 * AI Insight Card - displays what the coach has learned about the user.
 * Spec 2.3: "Koçun Seni Nasıl Tanıyor" + edit/delete right (KVKK M.16/17)
 */
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Pattern {
  type: string;
  description: string;
  trigger?: string;
  intervention?: string;
}

interface Props {
  generalSummary: string;
  patterns: Pattern[];
  portionCalibration: Record<string, unknown>;
  coachingNotes: string;
  onDeleteNote?: (note: string) => void;
  onResetAll?: () => void;
}

const PATTERN_COLORS: Record<string, string> = {
  night_eating: '#E91E63',
  weekend_binge: '#FF9800',
  stress_eating: '#9C27B0',
  skipping_meals: '#FF5722',
  exercise_avoidance: '#607D8B',
  alcohol_pattern: '#673AB7',
  late_caffeine: '#795548',
  social_eating: '#2196F3',
};

export function InsightCard({ generalSummary, patterns, portionCalibration, coachingNotes, onDeleteNote, onResetAll }: Props) {
  const handleDeleteNote = (note: string) => {
    Alert.alert(
      'Notu Sil',
      `"${note.substring(0, 50)}..." notunu silmek istediginize emin misiniz? Bu KVKK Madde 17 kapsaminda hakkinizdir.`,
      [
        { text: 'Iptal' },
        { text: 'Sil', style: 'destructive', onPress: () => onDeleteNote?.(note) },
      ]
    );
  };

  const handleResetAll = () => {
    Alert.alert(
      'Tum Notlari Sifirla',
      'Kocun seni tanima notlarinin TAMAMI silinecek. Sifirdan ogrenmeye baslayacak. Bu islemi geri alamazsiniz.',
      [
        { text: 'Iptal' },
        { text: 'Hepsini Sifirla', style: 'destructive', onPress: onResetAll },
      ]
    );
  };

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600' }}>Kocun Seni Nasil Taniyor</Text>
        {onResetAll && (
          <TouchableOpacity onPress={handleResetAll}>
            <Text style={{ color: COLORS.error, fontSize: FONT.xs }}>Sifirla</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.md }}>
        Her konusmandan ogrenilenler. Yanlis olan varsa uzun basarak silebilirsin (KVKK M.16/17).
      </Text>

      {/* General summary */}
      {generalSummary ? (
        <TouchableOpacity onLongPress={() => handleDeleteNote(generalSummary)}>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.md }}>{generalSummary}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.md }}>Henuz yeterli bilgi yok. Kocunla konusarak onu tanit!</Text>
      )}

      {/* Patterns */}
      {patterns.length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>Tespit Edilen Kaliplar</Text>
          {patterns.map((p, i) => (
            <TouchableOpacity key={i} onLongPress={() => handleDeleteNote(p.description)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: SPACING.xs }}>
              <View style={{ width: 3, height: 14, backgroundColor: PATTERN_COLORS[p.type] ?? COLORS.textMuted, borderRadius: 2, marginTop: 3 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{p.description}</Text>
                {p.intervention && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 1 }}>Mudahale: {p.intervention}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Portion calibration */}
      {Object.keys(portionCalibration).length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>Porsiyon Kalibrasyonu</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
            {Object.entries(portionCalibration).map(([food, grams]) => (
              <View key={food} style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.xs }}>{food}: {String(grams)}g</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Coaching notes */}
      {coachingNotes && (
        <TouchableOpacity onLongPress={() => handleDeleteNote(coachingNotes)}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>Kocluk Notlari</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 18 }}>{coachingNotes}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
