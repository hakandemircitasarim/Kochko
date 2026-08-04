/**
 * AI Insight Card - Theme-aware
 */
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';

interface Pattern { type: string; description: string; trigger?: string; intervention?: string; }
interface Props {
  generalSummary: string; patterns: Pattern[]; portionCalibration: Record<string, unknown>;
  coachingNotes: string; onDeleteNote?: (note: string) => void; onResetAll?: () => void;
}

export function InsightCard({ generalSummary, patterns, portionCalibration, coachingNotes, onDeleteNote, onResetAll }: Props) {
  const { colors, isDark } = useTheme();
  // FIX (audit insightcard-palette): tema-dışı Material tonlarını marka token'larına eşle.
  const PATTERN_COLORS: Record<string, string> = {
    night_eating: colors.purple, weekend_binge: colors.carbs, stress_eating: colors.pink,
    skipping_meals: colors.coral, exercise_avoidance: colors.textMuted, social_eating: colors.protein,
  };
  const handleDeleteNote = (note: string) => {
    Alert.alert('Notu Sil', `Bu notu silmek istediginize emin misiniz?`,
      [{ text: 'İptal' }, { text: 'Sil', style: 'destructive', onPress: () => onDeleteNote?.(note) }]);
  };

  return (
    <View style={{
      // FIX (audit radius-scale): kart yarıçapını Card primitive ile tutarlı RADIUS.md yap.
      backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md,
      // FIX (audit UI-DS-07): light branch used CARD_SHADOW (rgba(255,255,255,0.08) — an
      // invisible white border on the white light-mode card). Use colors.border in BOTH
      // themes so the elevation affordance is visible everywhere.
      borderWidth: isDark ? 1 : 0.5, borderColor: colors.border,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="eye" size={20} color={colors.primary} />
          </View>
          <Text style={{ ...TYPE.headline, color: colors.text }}>Koçun seni tanıyor</Text>
        </View>
        {onResetAll && (
          <TouchableOpacity onPress={() => Alert.alert('Sıfırla', 'Tüm notlar silinecek.', [{ text: 'İptal' }, { text: 'Sıfırla', style: 'destructive', onPress: onResetAll }])}>
            <Text style={{ ...TYPE.caption, color: colors.error, fontWeight: '600' }}>Sıfırla</Text>
          </TouchableOpacity>
        )}
      </View>

      {generalSummary ? (
        // FIX (audit destructive-delete): long-press-only yerine görünür/a11y sil butonu (chat.tsx deseni).
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.md }}>
          <TouchableOpacity style={{ flex: 1 }} onLongPress={() => handleDeleteNote(generalSummary)}>
            <Text style={{ ...TYPE.body, color: colors.text }}>{generalSummary}</Text>
          </TouchableOpacity>
          {onDeleteNote && (
            <TouchableOpacity
              onPress={() => handleDeleteNote(generalSummary)}
              accessibilityRole="button"
              accessibilityLabel="Özet notunu sil"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: SPACING.xs, marginTop: -10 }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <Text style={{ ...TYPE.body, color: colors.textMuted, marginBottom: SPACING.md }}>Henüz yeterli bilgi yok.</Text>
      )}

      {patterns.length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <Text style={{ ...TYPE.overline, color: colors.textSecondary, marginBottom: SPACING.xs }}>KALIPLAR</Text>
          {patterns.map((p, i) => (
            // FIX (audit destructive-delete): görünür/a11y sil butonu ekle, long-press kısayolu korunur.
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: SPACING.xs }}>
              <View style={{ width: 3, height: 14, backgroundColor: PATTERN_COLORS[p.type] ?? colors.textMuted, borderRadius: 2, marginTop: 3 }} />
              <TouchableOpacity style={{ flex: 1 }} onLongPress={() => handleDeleteNote(p.description)}>
                <Text style={{ ...TYPE.body, color: colors.text }}>{p.description}</Text>
                {p.intervention && <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 1 }}>Müdahale: {p.intervention}</Text>}
              </TouchableOpacity>
              {onDeleteNote && (
                <TouchableOpacity
                  onPress={() => handleDeleteNote(p.description)}
                  accessibilityRole="button"
                  accessibilityLabel="Kalıbı sil"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -12 }}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {Object.keys(portionCalibration).length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          {/* FIX (TR-i18n): textTransform bunu cihazda "PORSIYON" yapiyordu — noktali İ gerekli. */}
          <Text style={{ ...TYPE.overline, color: colors.textSecondary, marginBottom: SPACING.xs }}>PORSİYON</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
            {Object.entries(portionCalibration).map(([food, grams]) => (
              <View key={food} style={{ backgroundColor: colors.surfaceLight, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ ...TYPE.caption, color: colors.text }}>{food}: {String(grams)}g</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {coachingNotes && (
        // FIX (audit destructive-delete): başlık satırına görünür/a11y sil butonu; long-press korunur.
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ ...TYPE.overline, color: colors.textSecondary, marginBottom: SPACING.xs }}>KOÇLUK NOTLARI</Text>
            {onDeleteNote && (
              <TouchableOpacity
                onPress={() => handleDeleteNote(coachingNotes)}
                accessibilityRole="button"
                accessibilityLabel="Koçluk notlarını sil"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -12 }}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onLongPress={() => handleDeleteNote(coachingNotes)}>
            <Text style={{ ...TYPE.body, color: colors.textMuted }}>{coachingNotes}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
