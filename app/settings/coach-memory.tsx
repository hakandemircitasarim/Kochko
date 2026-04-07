/**
 * Coach Memory Screen
 * Shows ALL Layer 2 data the AI coach has learned about the user.
 * KVKK Article 16/17: User can view, correct, and delete any data.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getAISummaryForReview, deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { logAuditEvent, logAISummaryAccess } from '@/services/audit-log.service';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

type SummaryData = NonNullable<Awaited<ReturnType<typeof getAISummaryForReview>>>;

const PATTERN_COLORS: Record<string, string> = {
  night_eating: '#E91E63', weekend_binge: '#FF9800', stress_eating: '#9C27B0',
  skipping_meals: '#FF5722', exercise_avoidance: '#607D8B', social_eating: '#2196F3',
  alcohol_pattern: '#673AB7', late_caffeine: '#795548',
};

const RISK_COLORS: Record<string, string> = {
  high: '#EF4444', medium: '#F59E0B', low: '#22C55E',
};

const HABIT_STATUS_ICON: Record<string, { icon: string; color: string }> = {
  building: { icon: 'trending-up', color: '#3B82F6' },
  established: { icon: 'checkmark-circle', color: '#22C55E' },
  struggling: { icon: 'alert-circle', color: '#F59E0B' },
  lost: { icon: 'close-circle', color: '#EF4444' },
};

const MEAL_TIME_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Ara ogun',
};

export default function CoachMemoryScreen() {
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [menstrualTracking, setMenstrualTracking] = useState(false);

  const cardStyle = {
    backgroundColor: colors.card, borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md,
    ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
  };

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);

    // Fetch AI summary + profile menstrual_tracking in parallel
    const [result, profileResult] = await Promise.all([
      getAISummaryForReview(user.id),
      supabase.from('profiles').select('menstrual_tracking').eq('id', user.id).single(),
    ]);

    setData(result);
    setMenstrualTracking(Boolean(profileResult.data?.menstrual_tracking));

    // KVKK audit: log that user viewed their AI summary
    await logAISummaryAccess(user.id, 'view');

    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user?.id]);

  const handleDeleteNote = (field: string, note: string) => {
    Alert.alert(
      'Notu Sil',
      'Bu bilgiyi kocun hafizasindan silmek istedigine emin misin?\n\nBu KVKK Madde 17 kapsaminda hakkindir.',
      [
        { text: 'Iptal' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            await deleteAISummaryNote(user.id, field, note);
            await logAuditEvent(user.id, 'ai_summary_delete', `Kullanici AI ozeti sildi: ${field}`, { field, note });
            loadData();
          }
        },
      ]
    );
  };

  const handleClearField = (field: string, label: string) => {
    Alert.alert(
      `${label} Sil`,
      `"${label}" bilgisini kocun hafizasindan tamamen silmek istedigine emin misin?\n\nKVKK Madde 17 kapsaminda hakkindir.`,
      [
        { text: 'Iptal' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            // Clear the field by setting it to null/empty
            const emptyValue = ['behavioral_patterns', 'micro_nutrient_risks', 'habit_progress', 'features_introduced'].includes(field)
              ? [] : typeof data?.[fieldToKey(field)] === 'object' ? {} : null;
            await supabase.from('ai_summary').update({ [field]: emptyValue } as never).eq('user_id', user.id);
            await logAuditEvent(user.id, 'ai_summary_delete', `Kullanici AI ozeti alani temizledi: ${field}`, { field });
            loadData();
          }
        },
      ]
    );
  };

  const handleResetAll = () => {
    Alert.alert(
      'Tum Hafizayi Sifirla',
      'Kocun senin hakkinda ogrendigi TUM bilgiler silinecek. Sifirdan ogrenmeye baslayacak.\n\nBu islem geri alinamaz.',
      [
        { text: 'Iptal' },
        {
          text: 'Hepsini Sifirla', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            await resetAISummary(user.id);
            await logAuditEvent(user.id, 'ai_summary_delete', 'Kullanici tum AI hafizasini sifirladi');
            loadData();
          }
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: 'Kocun Hafizasi', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isEmpty = !data || (
    !data.general && data.patterns.length === 0 && !data.coachingNotes &&
    Object.keys(data.portionCalibration).length === 0 &&
    !data.userPersona && !data.learnedTonePreference && !data.alcoholPattern &&
    !data.caffeineSleepNotes && !data.socialEatingNotes && !data.recoveryPattern &&
    !data.weeklyBudgetPattern && !data.menstrualNotes &&
    data.microNutrientRisks.length === 0 && data.habitProgress.length === 0 &&
    !data.learnedMealTimes && !data.seasonalNotes && !data.supplementNotes &&
    data.featuresIntroduced.length === 0
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Stack.Screen options={{ title: 'Kocun Hafizasi', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#7F77DD20', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="eye" size={24} color="#7F77DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: FONT.lg, fontWeight: '800', color: colors.text }}>Kocun Seni Nasil Taniyor</Text>
          <Text style={{ fontSize: FONT.xs, color: colors.textMuted }}>Her konusmadan ogrenilenler. Uzun basarak silebilirsin.</Text>
        </View>
      </View>

      {/* Empty state */}
      {isEmpty && (
        <View style={{ ...cardStyle, alignItems: 'center', paddingVertical: SPACING.xl }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.surfaceLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textMuted} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.xs }}>Henuz bir sey ogrenilmedi</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', lineHeight: 20 }}>
            Kocunla konustukca, seni tanimaya baslayacak. Aliskanliklarini, tercihlerini ve hedeflerini ogrenecek.
          </Text>
        </View>
      )}

      {!isEmpty && data && (
        <>
          {/* ═══════════════════════════════════════════
              SECTION: Kochko Seni Nasil Taniyor
              (persona, tone, nutrition_literacy)
              ═══════════════════════════════════════════ */}
          {(data.userPersona || data.learnedTonePreference || data.nutritionLiteracy) && (
            <>
              <CategoryTitle title="Kochko Seni Nasil Taniyor" icon="person-circle" color="#7F77DD" colors={colors} />

              {/* General Summary */}
              {data.general ? (
                <View style={cardStyle}>
                  <SectionHeader icon="document-text" color="#1D9E75" title="Genel Ozet" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleDeleteNote('general_summary', data.general)}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.general}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* User Persona */}
              {data.userPersona && (
                <View style={cardStyle}>
                  <SectionHeader icon="sparkles" color="#8B5CF6" title="Kisilik Tipi" colors={colors} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('user_persona', 'Kisilik Tipi')}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <View style={{
                      backgroundColor: '#8B5CF620', borderRadius: RADIUS.full,
                      paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
                    }}>
                      <Text style={{ color: '#8B5CF6', fontSize: FONT.sm, fontWeight: '700' }}>{data.userPersona}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              )}

              {/* Learned Tone Preference */}
              {data.learnedTonePreference && (
                <View style={cardStyle}>
                  <SectionHeader icon="chatbubbles" color="#06B6D4" title="Iletisim Tercihi" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('learned_tone_preference', 'Iletisim Tercihi')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.learnedTonePreference}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Nutrition Literacy */}
              {data.nutritionLiteracy && (
                <View style={cardStyle}>
                  <SectionHeader icon="school" color="#2F80ED" title="Beslenme Bilgi Duzeyi" colors={colors} />
                  <View style={{
                    backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md,
                    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, alignSelf: 'flex-start',
                  }}>
                    <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>
                      {data.nutritionLiteracy === 'high' ? 'Yuksek' : data.nutritionLiteracy === 'medium' ? 'Orta' : 'Dusuk'}
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Davranis Kaliplari
              ═══════════════════════════════════════════ */}
          {data.patterns.length > 0 && (
            <>
              <CategoryTitle title="Davranis Kaliplari" icon="analytics" color="#F97316" colors={colors} />

              <View style={cardStyle}>
                <SectionHeader icon="analytics" color="#F97316" title="Tespit Edilen Kaliplar" colors={colors} badge={`${data.patterns.length}`} />
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
                      {p.intervention && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>Mudahale: {p.intervention}</Text>}
                      {p.confidence != null && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <View style={{ width: 40, height: 4, backgroundColor: colors.surfaceLight, borderRadius: 2, overflow: 'hidden' }}>
                            <View style={{ width: `${(p.confidence ?? 0) * 100}%` as any, height: '100%', backgroundColor: colors.primary, borderRadius: 2 }} />
                          </View>
                          <Text style={{ fontSize: 9, color: colors.textMuted }}>%{Math.round((p.confidence ?? 0) * 100)} guven</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Beslenme Hafizasi
              (portion, meal_times, caffeine, alcohol, social_eating)
              ═══════════════════════════════════════════ */}
          {(Object.keys(data.portionCalibration).length > 0 || data.learnedMealTimes ||
            data.caffeineSleepNotes || data.alcoholPattern || data.socialEatingNotes) && (
            <>
              <CategoryTitle title="Beslenme Hafizasi" icon="nutrition" color="#22C55E" colors={colors} />

              {/* Portion Calibration */}
              {Object.keys(data.portionCalibration).length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="resize" color="#22C55E" title="Porsiyon Kalibrasyonu" colors={colors} />
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
                    Senin "1 porsiyon" dediginde ne kadar oldugunu ogrendi
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

              {/* Learned Meal Times */}
              {data.learnedMealTimes && Object.keys(data.learnedMealTimes).length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="time" color="#10B981" title="Ogrenilen Ogun Saatleri" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('learned_meal_times', 'Ogun Saatleri')}>
                    <View style={{ gap: SPACING.xs }}>
                      {Object.entries(data.learnedMealTimes).map(([meal, time]) => (
                        <View key={meal} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>{MEAL_TIME_LABELS[meal] ?? meal}</Text>
                          <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>{time}</Text>
                        </View>
                      ))}
                    </View>
                  </TouchableOpacity>
                </View>
              )}

              {/* Caffeine-Sleep Notes */}
              {data.caffeineSleepNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="cafe" color="#795548" title="Kafein-Uyku" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('caffeine_sleep_notes', 'Kafein-Uyku')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.caffeineSleepNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Alcohol Pattern */}
              {data.alcoholPattern && (
                <View style={cardStyle}>
                  <SectionHeader icon="wine" color="#673AB7" title="Alkol Kalibi" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('alcohol_pattern', 'Alkol Kalibi')}>
                    {typeof data.alcoholPattern === 'object' && data.alcoholPattern !== null ? (
                      <View style={{ gap: SPACING.xs }}>
                        {(data.alcoholPattern as Record<string, unknown>).pattern && (
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                            Kalip: <Text style={{ fontWeight: '700' }}>{String((data.alcoholPattern as Record<string, unknown>).pattern)}</Text>
                          </Text>
                        )}
                        {(data.alcoholPattern as Record<string, unknown>).frequency && (
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                            Siklik: <Text style={{ fontWeight: '700' }}>{String((data.alcoholPattern as Record<string, unknown>).frequency)}</Text>
                          </Text>
                        )}
                        {(data.alcoholPattern as Record<string, unknown>).impact && (
                          <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                            Etki: {String((data.alcoholPattern as Record<string, unknown>).impact)}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{String(data.alcoholPattern)}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Social Eating Notes */}
              {data.socialEatingNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="people" color="#2196F3" title="Sosyal Yeme" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('social_eating_notes', 'Sosyal Yeme')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.socialEatingNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Saglik & Iyilesme
              (recovery, menstrual, micro_nutrient_risks, supplement)
              ═══════════════════════════════════════════ */}
          {(data.recoveryPattern || (menstrualTracking && data.menstrualNotes) ||
            data.microNutrientRisks.length > 0 || data.supplementNotes) && (
            <>
              <CategoryTitle title="Saglik & Iyilesme" icon="heart" color="#EF4444" colors={colors} />

              {/* Recovery Pattern */}
              {data.recoveryPattern && (
                <View style={cardStyle}>
                  <SectionHeader icon="fitness" color="#F472B6" title="Toparlanma Deseni" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('recovery_pattern', 'Toparlanma Deseni')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.recoveryPattern}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Menstrual Notes - only if tracking enabled */}
              {menstrualTracking && data.menstrualNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="calendar" color="#EC4899" title="Regl Notlari" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('menstrual_notes', 'Regl Notlari')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.menstrualNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Micro Nutrient Risks */}
              {data.microNutrientRisks.length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="warning" color="#F59E0B" title="Mikro Besin Riskleri" colors={colors} badge={`${data.microNutrientRisks.length}`} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                    {data.microNutrientRisks.map((r, i) => (
                      <TouchableOpacity
                        key={i}
                        onLongPress={() => handleDeleteNote('micro_nutrient_risks', r.nutrient)}
                        style={{
                          backgroundColor: (RISK_COLORS[r.risk_level] ?? '#6B7280') + '18',
                          borderRadius: RADIUS.full,
                          paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xs + 2,
                          flexDirection: 'row', alignItems: 'center', gap: 4,
                        }}
                      >
                        <View style={{
                          width: 8, height: 8, borderRadius: 4,
                          backgroundColor: RISK_COLORS[r.risk_level] ?? '#6B7280',
                        }} />
                        <Text style={{ color: RISK_COLORS[r.risk_level] ?? '#6B7280', fontSize: FONT.sm, fontWeight: '600' }}>
                          {r.nutrient}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Supplement Notes */}
              {data.supplementNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="medkit" color="#14B8A6" title="Supplement Notlari" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('supplement_notes', 'Supplement Notlari')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.supplementNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Ilerleme
              (habits, strength, weekly_budget)
              ═══════════════════════════════════════════ */}
          {(data.habitProgress.length > 0 || Object.keys(data.strengthRecords).length > 0 || data.weeklyBudgetPattern) && (
            <>
              <CategoryTitle title="Ilerleme" icon="trending-up" color="#3B82F6" colors={colors} />

              {/* Habit Progress */}
              {data.habitProgress.length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="flame" color="#F97316" title="Aliskanlik Ilerlemesi" colors={colors} badge={`${data.habitProgress.length}`} />
                  {data.habitProgress.map((h, i) => {
                    const statusInfo = HABIT_STATUS_ICON[h.status] ?? { icon: 'ellipse', color: colors.textMuted };
                    return (
                      <TouchableOpacity
                        key={i}
                        onLongPress={() => handleDeleteNote('habit_progress', h.habit)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
                          paddingVertical: SPACING.sm,
                          ...(i < data.habitProgress.length - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
                        }}
                      >
                        <Ionicons name={statusInfo.icon as any} size={18} color={statusInfo.color} />
                        <Text style={{ color: colors.text, fontSize: FONT.sm, flex: 1 }}>{h.habit}</Text>
                        {h.streak != null && h.streak > 0 && (
                          <View style={{
                            flexDirection: 'row', alignItems: 'center', gap: 2,
                            backgroundColor: '#F9731618', borderRadius: RADIUS.full,
                            paddingHorizontal: SPACING.sm, paddingVertical: 2,
                          }}>
                            <Ionicons name="flame" size={12} color="#F97316" />
                            <Text style={{ color: '#F97316', fontSize: FONT.xs, fontWeight: '700' }}>{h.streak}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Strength Records */}
              {Object.keys(data.strengthRecords).length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="barbell" color="#1D9E75" title="Guc Kayitlari" colors={colors} />
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

              {/* Weekly Budget Pattern */}
              {data.weeklyBudgetPattern && (
                <View style={cardStyle}>
                  <SectionHeader icon="wallet" color="#8B5CF6" title="Haftalik Butce Kalibi" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('weekly_budget_pattern', 'Haftalik Butce Kalibi')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.weeklyBudgetPattern}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Sistem
              (features_introduced, seasonal, coaching_notes)
              ═══════════════════════════════════════════ */}
          {(data.featuresIntroduced.length > 0 || data.seasonalNotes || data.coachingNotes) && (
            <>
              <CategoryTitle title="Sistem" icon="settings" color="#6B7280" colors={colors} />

              {/* Features Introduced (read-only) */}
              {data.featuresIntroduced.length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="bulb" color="#FBBF24" title="Tanitilan Ozellikler" colors={colors} badge={`${data.featuresIntroduced.length}`} />
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
                    Sana daha once tanitilmis ozellikler (salt okunur)
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                    {data.featuresIntroduced.map((f, i) => (
                      <View
                        key={i}
                        style={{
                          backgroundColor: colors.surfaceLight, borderRadius: RADIUS.full,
                          paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xs + 1,
                        }}
                      >
                        <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Seasonal Notes */}
              {data.seasonalNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="leaf" color="#84CC16" title="Mevsimsel Notlar" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleClearField('seasonal_notes', 'Mevsimsel Notlar')}>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.seasonalNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Coaching Notes */}
              {data.coachingNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="journal" color="#F59E0B" title="Kocluk Notlari" colors={colors} />
                  <TouchableOpacity onLongPress={() => handleDeleteNote('coaching_notes', data.coachingNotes)}>
                    <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{data.coachingNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* Reset button */}
          <TouchableOpacity
            onPress={handleResetAll}
            style={{ alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.md }}
          >
            <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '500' }}>Tum hafizayi sifirla</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>KVKK Madde 17 - Veri silme hakki</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// ─── Helper: map field name to SummaryData key ───

function fieldToKey(field: string): keyof SummaryData {
  const map: Record<string, keyof SummaryData> = {
    user_persona: 'userPersona',
    learned_tone_preference: 'learnedTonePreference',
    alcohol_pattern: 'alcoholPattern',
    caffeine_sleep_notes: 'caffeineSleepNotes',
    social_eating_notes: 'socialEatingNotes',
    recovery_pattern: 'recoveryPattern',
    weekly_budget_pattern: 'weeklyBudgetPattern',
    menstrual_notes: 'menstrualNotes',
    learned_meal_times: 'learnedMealTimes',
    seasonal_notes: 'seasonalNotes',
    supplement_notes: 'supplementNotes',
    behavioral_patterns: 'patterns',
    micro_nutrient_risks: 'microNutrientRisks',
    habit_progress: 'habitProgress',
    features_introduced: 'featuresIntroduced',
  };
  return map[field] ?? 'general';
}

// ─── Sub-components ───

function CategoryTitle({ title, icon, color, colors }: { title: string; icon: string; color: string; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs }}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.divider, marginLeft: SPACING.xs }} />
    </View>
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
