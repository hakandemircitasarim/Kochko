/**
 * AI Insight Card — "Koçun seni tanıyor" (Duolingo dili, §0-A)
 * Kart profil listeleriyle aynı yastık: RADIUS.lg + 2px gri kenar. Başlıkta soyut göz
 * ikonu yerine Koçko'nun kendisi konuşuyor (karakter); porsiyon çipleri opak pastel.
 */
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION, mix } from '@/lib/design';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';

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
      backgroundColor: colors.card, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md,
      // FIX (audit UI-DS-07): light branch used CARD_SHADOW (an invisible white border).
      // Duolingo grup kenarı: 2px gri (açıkta progressTrack, koyuda border — Button outline kuralı).
      borderWidth: 2, borderColor: isDark ? colors.border : colors.progressTrack,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: mix(colors.primary, colors.card, isDark ? 0.24 : 0.12), alignItems: 'center', justifyContent: 'center' }}
          >
            <KochkoMascot size={36} />
          </View>
          <Text style={{ ...TYPE.headline, color: colors.text }}>Koçun seni tanıyor</Text>
        </View>
        {onResetAll && (
          <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => Alert.alert('Sıfırla', 'Tüm notlar silinecek.', [{ text: 'İptal' }, { text: 'Sıfırla', style: 'destructive', onPress: onResetAll }])}>
            {/* Küçük kırmızı metin errorText (AA, kural 7). */}
            <Text style={{ ...TYPE.caption, color: colors.errorText, fontWeight: '700' }}>Sıfırla</Text>
          </TouchableOpacity>
        )}
      </View>

      {generalSummary ? (
        // FIX (audit destructive-delete): long-press-only yerine görünür/a11y sil butonu (chat.tsx deseni).
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.md }}>
          <TouchableOpacity activeOpacity={MOTION.pressOpacity} style={{ flex: 1 }} onLongPress={() => handleDeleteNote(generalSummary)}>
            <Text style={{ ...TYPE.body, color: colors.text }}>{generalSummary}</Text>
          </TouchableOpacity>
          {onDeleteNote && (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
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
              <View style={{ width: 4, height: 16, backgroundColor: PATTERN_COLORS[p.type] ?? colors.textMuted, borderRadius: 2, marginTop: 3 }} />
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} style={{ flex: 1 }} onLongPress={() => handleDeleteNote(p.description)}>
                <Text style={{ ...TYPE.body, color: colors.text }}>{p.description}</Text>
                {p.intervention && <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 1 }}>Müdahale: {p.intervention}</Text>}
              </TouchableOpacity>
              {onDeleteNote && (
                <TouchableOpacity activeOpacity={MOTION.pressOpacity}
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
              <View key={food} style={{ backgroundColor: mix(colors.protein, colors.card, isDark ? 0.22 : 0.12), borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm + 2, paddingVertical: 4 }}>
                <Text style={{ ...TYPE.caption, color: colors.text, fontWeight: '600' }}>{food}: {String(grams)}g</Text>
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
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
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
          <TouchableOpacity activeOpacity={MOTION.pressOpacity} onLongPress={() => handleDeleteNote(coachingNotes)}>
            <Text style={{ ...TYPE.body, color: colors.textMuted }}>{coachingNotes}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
