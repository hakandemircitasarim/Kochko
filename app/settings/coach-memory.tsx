/**
 * Coach Memory Screen
 * Shows what the AI coach has learned about the user.
 * KVKK Article 16/17: User can view, correct, and delete any data.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getAISummaryForReview, deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface SummaryData {
  general: string;
  patterns: { type: string; description: string; trigger?: string; intervention?: string; confidence?: number }[];
  portionCalibration: Record<string, unknown>;
  strengthRecords: Record<string, unknown>;
  coachingNotes: string;
  nutritionLiteracy: string;
}

const PATTERN_COLORS: Record<string, string> = {
  night_eating: '#E91E63', weekend_binge: '#FF9800', stress_eating: '#9C27B0',
  skipping_meals: '#FF5722', exercise_avoidance: '#607D8B', social_eating: '#2196F3',
  alcohol_pattern: '#673AB7', late_caffeine: '#795548',
};

export default function CoachMemoryScreen() {
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const cardStyle = {
    backgroundColor: colors.card, borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md,
    ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
  };

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);
    const result = await getAISummaryForReview(user.id);
    setData(result);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user?.id]);

  const handleDeleteNote = (field: string, note: string) => {
    Alert.alert(
      'Notu Sil',
      'Bu bilgiyi koçun hafızasından silmek istediğine emin misin?\n\nBu KVKK Madde 17 kapsamında hakkındır.',
      [
        { text: 'İptal' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            await deleteAISummaryNote(user.id, field, note);
            loadData();
          }
        },
      ]
    );
  };

  const handleResetAll = () => {
    Alert.alert(
      'Tüm Hafızayı Sıfırla',
      'Koçun senin hakkında öğrendiği TÜM bilgiler silinecek. Sıfırdan öğrenmeye başlayacak.\n\nBu işlem geri alınamaz.',
      [
        { text: 'İptal' },
        {
          text: 'Hepsini Sıfırla', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            await resetAISummary(user.id);
            loadData();
          }
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: 'Koçun Hafızası', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isEmpty = !data || (!data.general && data.patterns.length === 0 && !data.coachingNotes && Object.keys(data.portionCalibration).length === 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Stack.Screen options={{ title: 'Koçun Hafızası', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#7F77DD20', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="eye" size={24} color="#7F77DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: FONT.lg, fontWeight: '800', color: colors.text }}>Koçun Seni Nasıl Tanıyor</Text>
          <Text style={{ fontSize: FONT.xs, color: colors.textMuted }}>Her konuşmadan öğrenilenler. Uzun basarak silebilirsin.</Text>
        </View>
      </View>

      {/* Empty state */}
      {isEmpty && (
        <View style={{ ...cardStyle, alignItems: 'center', paddingVertical: SPACING.xl }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.surfaceLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textMuted} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.xs }}>Henüz bir şey öğrenilmedi</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', lineHeight: 20 }}>
            Koçunla konuştukça, seni tanımaya başlayacak. Alışkanlıklarını, tercihlerini ve hedeflerini öğrenecek.
          </Text>
        </View>
      )}

      {/* General Summary */}
      {data?.general ? (
        <View style={cardStyle}>
          <SectionHeader icon="document-text" color="#1D9E75" title="Genel Özet" colors={colors} />
          <TouchableOpacity onLongPress={() => handleDeleteNote('general_summary', data.general)}>
            <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.general}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Behavioral Patterns */}
      {data && data.patterns.length > 0 && (
        <View style={cardStyle}>
          <SectionHeader icon="analytics" color="#F97316" title="Davranış Kalıpları" colors={colors} badge={`${data.patterns.length}`} />
          {data.patterns.map((p, i) => (
            <TouchableOpacity
              key={i}
              onLongPress={() => handleDeleteNote('behavioral_patterns', p.description)}
              style={{
                flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
                paddingVertical: SPACING.sm,
                ...(i < data.patterns.length - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
              }}
            >
              <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: PATTERN_COLORS[p.type] ?? colors.primary, marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20 }}>{p.description}</Text>
                {p.trigger && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>Tetikleyici: {p.trigger}</Text>}
                {p.intervention && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>Müdahale: {p.intervention}</Text>}
                {p.confidence != null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <View style={{ width: 40, height: 4, backgroundColor: colors.surfaceLight, borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ width: `${(p.confidence ?? 0) * 100}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 2 }} />
                    </View>
                    <Text style={{ fontSize: 9, color: colors.textMuted }}>%{Math.round((p.confidence ?? 0) * 100)} güven</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Portion Calibration */}
      {data && Object.keys(data.portionCalibration).length > 0 && (
        <View style={cardStyle}>
          <SectionHeader icon="resize" color="#22C55E" title="Porsiyon Kalibrasyonu" colors={colors} />
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
            Senin "1 porsiyon" dediğinde ne kadar olduğunu öğrendi
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
            {Object.entries(data.portionCalibration).map(([food, grams]) => (
              <TouchableOpacity
                key={food}
                onLongPress={() => handleDeleteNote('portion_calibration', food)}
                style={{
                  backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md,
                  paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xs + 2,
                }}
              >
                <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                  {food}: <Text style={{ fontWeight: '700', color: '#22C55E' }}>{String(grams)}g</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Strength Records */}
      {data && Object.keys(data.strengthRecords).length > 0 && (
        <View style={cardStyle}>
          <SectionHeader icon="barbell" color="#1D9E75" title="Güç Kayıtları" colors={colors} />
          {Object.entries(data.strengthRecords).map(([exercise, record]) => {
            const r = record as { last_weight?: number; last_reps?: number; '1rm'?: number };
            return (
              <View key={exercise} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs + 2 }}>
                <Text style={{ color: colors.text, fontSize: FONT.sm }}>{exercise}</Text>
                <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>
                  {r.last_weight ? `${r.last_weight}kg x${r.last_reps}` : r['1rm'] ? `1RM: ${r['1rm']}kg` : '-'}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Coaching Notes */}
      {data?.coachingNotes ? (
        <View style={cardStyle}>
          <SectionHeader icon="journal" color="#F59E0B" title="Koçluk Notları" colors={colors} />
          <TouchableOpacity onLongPress={() => handleDeleteNote('coaching_notes', data.coachingNotes)}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{data.coachingNotes}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Nutrition Literacy */}
      {data?.nutritionLiteracy && (
        <View style={cardStyle}>
          <SectionHeader icon="school" color="#2F80ED" title="Beslenme Bilgi Düzeyi" colors={colors} />
          <View style={{
            backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, alignSelf: 'flex-start',
          }}>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>
              {data.nutritionLiteracy === 'high' ? 'Yüksek' : data.nutritionLiteracy === 'medium' ? 'Orta' : 'Düşük'}
            </Text>
          </View>
        </View>
      )}

      {/* Reset button */}
      {!isEmpty && (
        <TouchableOpacity
          onPress={handleResetAll}
          style={{ alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.md }}
        >
          <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '500' }}>Tüm hafızayı sıfırla</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>KVKK Madde 17 - Veri silme hakkı</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function SectionHeader({ icon, color, title, colors, badge }: { icon: string; color: string; title: string; colors: any; badge?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon as any} size={16} color={color} />
      </View>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', flex: 1 }}>{title}</Text>
      {badge && (
        <View style={{ backgroundColor: color + '18', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color, fontSize: FONT.xs, fontWeight: '700' }}>{badge}</Text>
        </View>
      )}
    </View>
  );
}
