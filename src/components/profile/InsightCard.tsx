/**
 * AI Insight Card - Theme-aware
 */
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface Pattern { type: string; description: string; trigger?: string; intervention?: string; }
interface Props {
  generalSummary: string; patterns: Pattern[]; portionCalibration: Record<string, unknown>;
  coachingNotes: string; onDeleteNote?: (note: string) => void; onResetAll?: () => void;
}

const PATTERN_COLORS: Record<string, string> = {
  night_eating: '#E91E63', weekend_binge: '#FF9800', stress_eating: '#9C27B0',
  skipping_meals: '#FF5722', exercise_avoidance: '#607D8B', social_eating: '#2196F3',
};

export function InsightCard({ generalSummary, patterns, portionCalibration, coachingNotes, onDeleteNote, onResetAll }: Props) {
  const { colors, isDark } = useTheme();
  const handleDeleteNote = (note: string) => {
    Alert.alert('Notu Sil', `Bu notu silmek istediginize emin misiniz?`,
      [{ text: 'İptal' }, { text: 'Sil', style: 'destructive', onPress: () => onDeleteNote?.(note) }]);
  };

  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="eye" size={20} color={colors.primary} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>Koçun Seni Tanıyor</Text>
        </View>
        {onResetAll && (
          <TouchableOpacity onPress={() => Alert.alert('Sıfırla', 'Tüm notlar silinecek.', [{ text: 'İptal' }, { text: 'Sıfırla', style: 'destructive', onPress: onResetAll }])}>
            <Text style={{ color: colors.error, fontSize: FONT.xs }}>Sıfırla</Text>
          </TouchableOpacity>
        )}
      </View>

      {generalSummary ? (
        <TouchableOpacity onLongPress={() => handleDeleteNote(generalSummary)}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.md }}>{generalSummary}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: colors.textMuted, fontSize: FONT.sm, marginBottom: SPACING.md }}>Henüz yeterli bilgi yok.</Text>
      )}

      {patterns.length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '700', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>Kalıplar</Text>
          {patterns.map((p, i) => (
            <TouchableOpacity key={i} onLongPress={() => handleDeleteNote(p.description)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: SPACING.xs }}>
              <View style={{ width: 3, height: 14, backgroundColor: PATTERN_COLORS[p.type] ?? colors.textMuted, borderRadius: 2, marginTop: 3 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20 }}>{p.description}</Text>
                {p.intervention && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>Müdahale: {p.intervention}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {Object.keys(portionCalibration).length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '700', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>Porsiyon</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
            {Object.entries(portionCalibration).map(([food, grams]) => (
              <View key={food} style={{ backgroundColor: colors.surfaceLight, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: colors.text, fontSize: FONT.xs }}>{food}: {String(grams)}g</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {coachingNotes && (
        <TouchableOpacity onLongPress={() => handleDeleteNote(coachingNotes)}>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '700', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>Koçluk Notları</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.sm, lineHeight: 18 }}>{coachingNotes}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
