/**
 * Coach Memory Screen
 * Shows ALL Layer 2 data the AI coach has learned about the user.
 * KVKK Article 16/17: User can view, correct, and delete any data.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
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
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const { profile, fetch: fetchProfile } = useProfileStore();
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [menstrualTracking, setMenstrualTracking] = useState(false);
  const [activeGoal, setActiveGoal] = useState<{ goal_type?: string; target_weight_kg?: number; weekly_rate?: number } | null>(null);

  const cardStyle = {
    backgroundColor: colors.card, borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md,
    ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
  };

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);

    // Fetch AI summary + profile menstrual_tracking + active goal in parallel
    const [result, profileResult, goalResult] = await Promise.all([
      getAISummaryForReview(user.id),
      supabase.from('profiles').select('menstrual_tracking').eq('id', user.id).maybeSingle(),
      supabase.from('goals').select('goal_type, target_weight_kg, weekly_rate').eq('user_id', user.id).eq('is_active', true).limit(1),
    ]);

    setData(result);
    setMenstrualTracking(Boolean(profileResult.data?.menstrual_tracking));
    setActiveGoal((goalResult.data as { goal_type?: string; target_weight_kg?: number; weekly_rate?: number }[] | null)?.[0] ?? null);
    // Make sure profile store is loaded too
    if (!profile) await fetchProfile(user.id);

    // KVKK audit: log that user viewed their AI summary
    await logAISummaryAccess(user.id, 'view');

    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user?.id]);

  const handleDeleteNote = (field: string, note: string) => {
    Alert.alert(
      'Notu Sil',
      'Bu bilgiyi Kochkonun hafizasindan silmek istedigine emin misin?\n\nBu KVKK Madde 17 kapsaminda hakkindir.',
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
      `"${label}" bilgisini Kochkonun hafizasindan tamamen silmek istedigine emin misin?\n\nKVKK Madde 17 kapsaminda hakkindir.`,
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
        <Stack.Screen options={{ title: 'Kochkonun Senin Hakkinda Bildikleri', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isAiEmpty = !data || (
    !data.general && data.patterns.length === 0 && !data.coachingNotes &&
    Object.keys(data.portionCalibration).length === 0 &&
    !data.userPersona && !data.learnedTonePreference && !data.alcoholPattern &&
    !data.caffeineSleepNotes && !data.socialEatingNotes && !data.recoveryPattern &&
    !data.weeklyBudgetPattern && !data.menstrualNotes &&
    data.microNutrientRisks.length === 0 && data.habitProgress.length === 0 &&
    !data.learnedMealTimes && !data.seasonalNotes && !data.supplementNotes &&
    data.featuresIntroduced.length === 0
  );

  // Build profile info rows (Layer 1 — static data from onboarding)
  const age = profile?.birth_year ? new Date().getFullYear() - (profile.birth_year as number) : null;
  const goalLabels: Record<string, string> = {
    lose_weight: 'Kilo vermek', gain_weight: 'Kilo almak', gain_muscle: 'Kas kazanmak',
    health: 'Sağlıklı yaşam', maintain: 'Koruma', conditioning: 'Kondisyon',
  };
  const genderLabels: Record<string, string> = { male: 'Erkek', female: 'Kadın', other: 'Diğer' };
  const activityLabels: Record<string, string> = {
    sedentary: 'Hareketsiz', light: 'Hafif', moderate: 'Orta', active: 'Aktif', very_active: 'Çok aktif',
  };
  const dietLabels: Record<string, string> = {
    standard: 'Standart', low_carb: 'Düşük karb', keto: 'Keto', high_protein: 'Yüksek protein',
  };
  const toneLabels: Record<string, string> = {
    strict: 'Sıkı', balanced: 'Dengeli', gentle: 'Nazik',
  };

  const profileRows: { label: string; value: string }[] = [];
  if (profile?.display_name) profileRows.push({ label: 'İsim', value: String(profile.display_name) });
  else if (user?.email) profileRows.push({ label: 'E-posta', value: user.email });
  if (age) profileRows.push({ label: 'Yaş', value: `${age}` });
  if (profile?.gender) profileRows.push({ label: 'Cinsiyet', value: genderLabels[profile.gender as string] ?? String(profile.gender) });
  if (profile?.height_cm) profileRows.push({ label: 'Boy', value: `${profile.height_cm} cm` });
  if (profile?.weight_kg) profileRows.push({ label: 'Mevcut kilo', value: `${profile.weight_kg} kg` });
  if (activeGoal?.target_weight_kg) profileRows.push({ label: 'Hedef kilo', value: `${activeGoal.target_weight_kg} kg` });
  if (activeGoal?.goal_type) profileRows.push({ label: 'Hedef', value: goalLabels[activeGoal.goal_type] ?? activeGoal.goal_type });
  if (activeGoal?.weekly_rate) profileRows.push({ label: 'Haftalık tempo', value: `${activeGoal.weekly_rate} kg/hafta` });
  if (profile?.activity_level) profileRows.push({ label: 'Aktivite', value: activityLabels[profile.activity_level as string] ?? String(profile.activity_level) });
  if (profile?.diet_mode) profileRows.push({ label: 'Beslenme', value: dietLabels[profile.diet_mode as string] ?? String(profile.diet_mode) });
  if (profile?.coach_tone) profileRows.push({ label: 'Koç tonu', value: toneLabels[profile.coach_tone as string] ?? String(profile.coach_tone) });
  if (profile?.tdee_calculated) profileRows.push({ label: 'Günlük kalori (TDEE)', value: `${profile.tdee_calculated} kcal` });
  if (profile?.water_target_liters) profileRows.push({ label: 'Su hedefi', value: `${profile.water_target_liters} L` });
  if (profile?.home_timezone) profileRows.push({ label: 'Zaman dilimi', value: String(profile.home_timezone) });
  if (profile?.if_active && profile?.if_eating_start && profile?.if_eating_end) {
    profileRows.push({ label: 'IF penceresi', value: `${profile.if_eating_start}-${profile.if_eating_end}` });
  }
  if (profile?.food_allergies) profileRows.push({ label: 'Alerjenler', value: String(profile.food_allergies) });
  if (profile?.periodic_state) profileRows.push({ label: 'Dönemsel durum', value: String(profile.periodic_state) });

  const isEmpty = isAiEmpty && profileRows.length === 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Stack.Screen options={{ title: 'Kochkonun Senin Hakkinda Bildikleri', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#7F77DD20', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="eye" size={24} color="#7F77DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: FONT.lg, fontWeight: '800', color: colors.text }}>Kochko Senin Hakkinda Ne Biliyor</Text>
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

      {/* ═══════════════════════════════════════════
          SECTION: Profil Bilgileri (Layer 1 — static)
          Onboarding ve profil ekranından gelen temel bilgiler
          ═══════════════════════════════════════════ */}
      {profileRows.length > 0 && (
        <>
          <CategoryTitle title="Profil Bilgileri" icon="person" color="#1D9E75" colors={colors} />
          <View style={cardStyle}>
            <SectionHeader icon="id-card" color="#1D9E75" title="Koç Senin Hakkında Bunları Biliyor" colors={colors} badge={`${profileRows.length}`} />
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
              Profilinde kayıtlı bilgiler — plan ve önerilerde kullanılıyor
            </Text>
            <View>
              {profileRows.map((row, i) => (
                <View
                  key={row.label}
                  style={{
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingVertical: SPACING.sm,
                    ...(i < profileRows.length - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
                  }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>{row.label}</Text>
                  <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '600' }}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      )}

      {!isAiEmpty && data && (
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
                        {!!(data.alcoholPattern as Record<string, unknown>).pattern && (
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                            Kalip: <Text style={{ fontWeight: '700' }}>{String((data.alcoholPattern as Record<string, unknown>).pattern)}</Text>
                          </Text>
                        )}
                        {!!(data.alcoholPattern as Record<string, unknown>).frequency && (
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                            Siklik: <Text style={{ fontWeight: '700' }}>{String((data.alcoholPattern as Record<string, unknown>).frequency)}</Text>
                          </Text>
                        )}
                        {!!(data.alcoholPattern as Record<string, unknown>).impact && (
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

      {/* ═══════════════════════════════════════════
          SECTION: Tüm Hafıza Alanları (Transparency + Debug)
          Her kategoriyi her zaman göster — AI'nın hangi alanda ne öğrendiğini
          veya henüz öğrenmediğini şeffafça görmek için.
          ═══════════════════════════════════════════ */}
      <CategoryTitle title="Tum Hafiza Alanlari (Seffaflik)" icon="list" color="#6366F1" colors={colors} />
      <View style={cardStyle}>
        <SectionHeader icon="eye-outline" color="#6366F1" title="Kocun Takip Ettigi Her Sey" colors={colors} />
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
          AI bu alanlari konusmalardan takip ediyor. Dolu olanlar: ogrendigi seyler. Bos olanlar: henuz yeterli veri yok.
        </Text>
        <View>
          {AI_SUMMARY_FIELDS.map((f, i) => {
            const rawValue = data ? (data as any)[f.key] : null;
            const display = formatFieldValue(rawValue);
            const isFilled = display !== null;
            return (
              <View
                key={f.key}
                style={{
                  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
                  paddingVertical: SPACING.sm, gap: SPACING.md,
                  ...(i < AI_SUMMARY_FIELDS.length - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '500' }}>{f.label}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 1 }}>{f.desc}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  {isFilled ? (
                    <Text style={{ color: '#22C55E', fontSize: FONT.xs, fontWeight: '600', textAlign: 'right' }} numberOfLines={3}>
                      {display}
                    </Text>
                  ) : (
                    <View style={{
                      backgroundColor: colors.surfaceLight, borderRadius: RADIUS.full,
                      paddingHorizontal: SPACING.sm, paddingVertical: 2,
                    }}>
                      <Text style={{ color: colors.textMuted, fontSize: 10 }}>Henuz ogrenilmedi</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

// ─── All ai_summary fields schema for transparency/debug view ───

const AI_SUMMARY_FIELDS: { key: string; label: string; desc: string }[] = [
  { key: 'general', label: 'Genel Ozet', desc: 'Senin hakkindaki serbest metin notu' },
  { key: 'userPersona', label: 'Kisilik Tipi', desc: 'Iletisim ve motivasyon stili' },
  { key: 'learnedTonePreference', label: 'Iletisim Tercihi', desc: 'Nasil konusulmasini sevdigin' },
  { key: 'nutritionLiteracy', label: 'Beslenme Bilgi Duzeyi', desc: 'low / medium / high' },
  { key: 'patterns', label: 'Davranis Kaliplari', desc: 'Gece yeme, stres atistirmasi vb.' },
  { key: 'portionCalibration', label: 'Porsiyon Kalibrasyonu', desc: 'Senin "1 porsiyon"un kac gram' },
  { key: 'learnedMealTimes', label: 'Ogrenilen Ogun Saatleri', desc: 'Genelde ne zaman yediginn' },
  { key: 'caffeineSleepNotes', label: 'Kafein-Uyku Notu', desc: 'Kafein uykunu nasil etkiliyor' },
  { key: 'alcoholPattern', label: 'Alkol Kalibi', desc: 'Siklik, miktar, ertesi gun etkisi' },
  { key: 'socialEatingNotes', label: 'Sosyal Yeme', desc: 'Arkadas/aile yemeklerinde kalip' },
  { key: 'recoveryPattern', label: 'Toparlanma Deseni', desc: 'Antrenman sonrasi yorgunluk/enerji' },
  { key: 'menstrualNotes', label: 'Regl Donemi Notlari', desc: 'Sadece takip aciksa' },
  { key: 'microNutrientRisks', label: 'Mikro Besin Riskleri', desc: 'Eksik olabilecek vitamin/mineraller' },
  { key: 'supplementNotes', label: 'Supplement Notlari', desc: 'Aldigin/almadigin takviyeler' },
  { key: 'habitProgress', label: 'Aliskanlik Ilerlemesi', desc: 'Olusturdugun/takip eden rutinler' },
  { key: 'strengthRecords', label: 'Guc Kayitlari', desc: 'Egzersiz PRlari' },
  { key: 'weeklyBudgetPattern', label: 'Haftalik Butce Kalibi', desc: 'Kalori butcesini nasil dagittigin' },
  { key: 'seasonalNotes', label: 'Mevsimsel Notlar', desc: 'Yaz/kis yeme aliskanliklari' },
  { key: 'featuresIntroduced', label: 'Tanitilan Ozellikler', desc: 'Sana hangi ozellikler anlatildi' },
  { key: 'coachingNotes', label: 'Kocluk Notlari', desc: 'Ic gorusme gozlemi (sistem)' },
];

function formatFieldValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    return `${v.length} kayit`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) return null;
    return `${keys.length} kayit`;
  }
  return String(v);
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
