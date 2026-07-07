/**
 * Coach Memory Screen
 * Shows ALL Layer 2 data the AI coach has learned about the user.
 * KVKK Article 16/17: User can view, correct, and delete any data.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { getAISummaryForReview, deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { logAuditEvent, logAISummaryAccess } from '@/services/audit-log.service';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW, COLORS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { SkeletonScreen } from '@/components/ui/Skeleton';

type SummaryData = NonNullable<Awaited<ReturnType<typeof getAISummaryForReview>>>;

const PATTERN_COLORS: Record<string, string> = {
  night_eating: COLORS.pink, weekend_binge: COLORS.warning, stress_eating: COLORS.purple,
  skipping_meals: COLORS.coral, exercise_avoidance: COLORS.textMuted, social_eating: COLORS.protein,
  alcohol_pattern: COLORS.purple, late_caffeine: COLORS.coral,
};

const RISK_COLORS: Record<string, string> = {
  high: COLORS.error, medium: COLORS.warning, low: COLORS.success,
};

const HABIT_STATUS_ICON: Record<string, { icon: string; color: string }> = {
  building: { icon: 'trending-up', color: COLORS.protein },
  established: { icon: 'checkmark-circle', color: COLORS.success },
  struggling: { icon: 'alert-circle', color: COLORS.warning },
  lost: { icon: 'close-circle', color: COLORS.error },
};

const MEAL_TIME_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara öğün',
};

export default function CoachMemoryScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const { profile, fetch: fetchProfile } = useProfileStore();
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [menstrualTracking, setMenstrualTracking] = useState(false);
  const [activeGoal, setActiveGoal] = useState<{ goal_type?: string; target_weight_kg?: number; weekly_rate?: number } | null>(null);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [healthFacts, setHealthFacts] = useState<{ kind: string; subject: string; text: string; severity: string | null }[]>([]);

  const cardStyle = {
    backgroundColor: colors.card, borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md,
    ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
  };

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(false);

    try {
      // Fetch AI summary + profile menstrual_tracking + active goal + allergens in parallel
      const [result, profileResult, goalResult, allergenResult, healthResult] = await Promise.all([
        getAISummaryForReview(user.id),
        supabase.from('profiles').select('menstrual_tracking').eq('id', user.id).maybeSingle(),
        supabase.from('goals').select('goal_type, target_weight_kg, weekly_rate').eq('user_id', user.id).eq('is_active', true).limit(1),
        supabase.from('food_preferences').select('food_name').eq('user_id', user.id).eq('is_allergen', true),
        // FIX (memory-continuity audit): surface the canonical health spine — a saved surgery /
        // chronic condition / injury was previously INVISIBLE here (screen only showed recovery/
        // supplement notes), so the user's "sağlık geçmişimden haber yok" complaint. Read the deduped
        // user_constraints, not the append-only health_events.
        supabase.from('user_constraints').select('kind, subject, note, severity').eq('user_id', user.id).eq('active', true).in('kind', ['surgery', 'condition', 'injury', 'medication']),
      ]);

      setData(result);
      setMenstrualTracking(Boolean(profileResult.data?.menstrual_tracking));
      setActiveGoal((goalResult.data as { goal_type?: string; target_weight_kg?: number; weekly_rate?: number }[] | null)?.[0] ?? null);
      setAllergens(((allergenResult.data as { food_name: string }[] | null) ?? []).map(a => a.food_name));
      setHealthFacts(((healthResult.data as { kind: string; subject: string; note: string | null; severity: string | null }[] | null) ?? [])
        .map(h => ({ kind: h.kind, subject: h.subject, text: ((h.note || h.subject) ?? '').trim(), severity: h.severity }))
        .filter(h => h.text));
      // Make sure profile store is loaded too
      if (!profile) await fetchProfile(user.id);

      // KVKK audit: log that user viewed their AI summary
      await logAISummaryAccess(user.id, 'view');
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [user?.id]);

  const handleDeleteNote = (field: string, note: string) => {
    Alert.alert(
      'Notu Sil',
      'Bu bilgiyi Koçko\'nun hafızasından silmek istediğine emin misin?\n\nBu KVKK Madde 17 kapsamında hakkındır.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            try {
              await deleteAISummaryNote(user.id, field, note);
              await logAuditEvent(user.id, 'ai_summary_delete', `Kullanici AI ozeti sildi: ${field}`, { field, note });
              haptics.success();
            } catch {
              haptics.error();
              Alert.alert('Silinemedi', 'Bilgi silinirken bir sorun oluştu. Lütfen tekrar dene.');
              return;
            }
            loadData();
          }
        },
      ]
    );
  };

  const handleClearField = (field: string, label: string) => {
    Alert.alert(
      `${label} Sil`,
      `"${label}" bilgisini Koçko'nun hafızasından tamamen silmek istediğine emin misin?\n\nKVKK Madde 17 kapsamında hakkındır.`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            // Clear the field by setting it to null/empty
            const emptyValue = ['behavioral_patterns', 'micro_nutrient_risks', 'habit_progress', 'features_introduced'].includes(field)
              ? [] : typeof data?.[fieldToKey(field)] === 'object' ? {} : null;
            // .select() so a 0-row result (RLS no-op) is detectable — a KVKK Madde 17
            // delete must never silently fail and leave the data in place.
            const { data: upd, error } = await supabase.from('ai_summary')
              .update({ [field]: emptyValue } as never).eq('user_id', user.id).select('user_id');
            if (error || !upd || upd.length === 0) {
              haptics.error();
              Alert.alert('Silinemedi', 'Bilgi silinirken bir sorun oluştu. Lütfen tekrar dene.');
              return;
            }
            await logAuditEvent(user.id, 'ai_summary_delete', `Kullanici AI ozeti alani temizledi: ${field}`, { field });
            haptics.success();
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
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Hepsini Sıfırla', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            try {
              await resetAISummary(user.id);
              // "TÜM bilgiler silinecek" must be truthful: also deactivate the health/safety spine
              // (surgery/condition/injury/allergen), otherwise the Sağlık Geçmişi card survives a
              // reset that promised total, irreversible erasure (KVKK Madde 17).
              await supabase.from('user_constraints').update({ active: false }).eq('user_id', user.id).eq('active', true);
            } catch {
              haptics.error();
              Alert.alert('Sıfırlanamadı', 'Hafıza sıfırlanırken bir sorun oluştu. Lütfen tekrar dene.');
              return;
            }
            await logAuditEvent(user.id, 'ai_summary_delete', 'Kullanici tum AI hafizasini sifirladi');
            haptics.success();
            loadData();
          }
        },
      ]
    );
  };

  // KVKK Madde 17: a health fact (surgery/condition/injury) must be individually removable — the
  // surface previously had NO delete path for it. Deactivates the canonical constraint row.
  const handleDeleteConstraint = (kind: string, subject: string, label: string) => {
    Alert.alert(
      'Sağlık Kaydını Sil',
      `"${label}" bilgisini kaldırmak istediğine emin misin?\n\nKoç bundan sonra bunu planlarında dikkate almayacak. KVKK Madde 17.`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            const { data: upd, error } = await supabase.from('user_constraints')
              .update({ active: false }).eq('user_id', user.id).eq('kind', kind).eq('subject', subject).eq('active', true).select('id');
            if (error || !upd || upd.length === 0) {
              haptics.error();
              Alert.alert('Silinemedi', 'Bilgi silinirken bir sorun oluştu. Lütfen tekrar dene.');
              return;
            }
            await logAuditEvent(user.id, 'ai_summary_delete', `Kullanici saglik kaydini sildi: ${kind}/${subject}`, { kind, subject });
            haptics.success();
            loadData();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: 'Kochko\'nun Senin Hakkında Bildikleri', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
        <SkeletonScreen cards={4} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: SPACING.xl }}>
        <Stack.Screen options={{ title: 'Kochko\'nun Senin Hakkında Bildikleri', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
        <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', marginTop: SPACING.md, textAlign: 'center' }}>
          Yüklenemedi
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, textAlign: 'center', lineHeight: 20 }}>
          Bilgilerin yüklenirken bir sorun oluştu. Bağlantını kontrol edip tekrar dene.
        </Text>
        <TouchableOpacity
          onPress={loadData}
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
          style={{ marginTop: SPACING.lg, backgroundColor: colors.primary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm + 2 }}
        >
          <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>Tekrar dene</Text>
        </TouchableOpacity>
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
  if (allergens.length) profileRows.push({ label: 'Alerjenler', value: allergens.join(', ') });
  if (profile?.periodic_state) profileRows.push({ label: 'Dönemsel durum', value: String(profile.periodic_state) });

  const isEmpty = isAiEmpty && profileRows.length === 0 && healthFacts.length === 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit UI-SET-02): dropped redundant per-screen `title` override that silently
          shadowed _layout.tsx and conflicted with the body H1 (and used a different brand spelling).
          Header title now falls through to _layout.tsx ('Koçko Senin Hakkında Ne Biliyor'),
          matching the body H1 below. */}
      <Stack.Screen options={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.purple + '20', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="eye" size={24} color={colors.purple} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: FONT.lg, fontWeight: '800', color: colors.text }}>Koçko Senin Hakkında Ne Biliyor</Text>
          <Text style={{ fontSize: FONT.xs, color: colors.textSecondary }}>Her konuşmadan öğrenilenler. Çöp ikonuna dokunarak veya uzun basarak silebilirsin.</Text>
        </View>
      </View>

      {/* Empty state */}
      {isEmpty && (
        <View style={{ ...cardStyle, alignItems: 'center', paddingVertical: SPACING.xl }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.surfaceLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textMuted} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.xs }}>Henüz bir şey öğrenilmedi</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center', lineHeight: 20 }}>
            Koçunla konuştukça, seni tanımaya başlayacak. Alışkanlıklarını, tercihlerini ve hedeflerini öğrenecek.
          </Text>
        </View>
      )}

      {/* ═══════════════════════════════════════════
          SECTION: Profil Bilgileri (Layer 1 — static)
          Onboarding ve profil ekranından gelen temel bilgiler
          ═══════════════════════════════════════════ */}
      {profileRows.length > 0 && (
        <>
          <CategoryTitle title="Profil Bilgileri" icon="person" color={colors.success} colors={colors} />
          <View style={cardStyle}>
            <SectionHeader icon="id-card" color={colors.success} title="Koç Senin Hakkında Bunları Biliyor" colors={colors} badge={`${profileRows.length}`} />
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

      {/* Health history — the canonical safety spine (surgery / chronic condition / injury /
          medication). Previously NOT shown here at all, so a saved surgery looked forgotten. */}
      {healthFacts.length > 0 && (
        <>
          <CategoryTitle title="Sağlık Geçmişi" icon="medkit" color={colors.error} colors={colors} />
          <View style={cardStyle}>
            <SectionHeader icon="medkit" color={colors.error} title="Ameliyat / Durum / Sakatlık" colors={colors} badge={`${healthFacts.length}`} />
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
              Koç bu bilgileri her öneride dikkate alır
            </Text>
            <View>
              {healthFacts.map((h, i) => {
                const KIND_LABEL: Record<string, string> = { surgery: 'Ameliyat', condition: 'Kronik durum', injury: 'Sakatlık', medication: 'İlaç' };
                return (
                  <TouchableOpacity
                    key={i}
                    onLongPress={() => handleDeleteConstraint(h.kind, h.subject, h.text)}
                    accessibilityRole="button"
                    accessibilityLabel={`${KIND_LABEL[h.kind] ?? h.kind}: ${h.text} — silmek için uzun bas`}
                    style={{
                      flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingVertical: SPACING.sm,
                      ...(i < healthFacts.length - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
                    }}
                  >
                    <View style={{ backgroundColor: colors.error + '18', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginTop: 1 }}>
                      <Text style={{ color: colors.error, fontSize: FONT.xs, fontWeight: '700' }}>{KIND_LABEL[h.kind] ?? h.kind}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: FONT.sm, flex: 1, lineHeight: 20 }}>{h.text}{h.severity ? ` (${h.severity})` : ''}</Text>
                  </TouchableOpacity>
                );
              })}
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
              <CategoryTitle title="Koçko Seni Nasıl Tanıyor" icon="person-circle" color={colors.purple} colors={colors} />

              {/* General Summary */}
              {data.general ? (
                <View style={cardStyle}>
                  <SectionHeader icon="document-text" color={colors.success} title="Genel Özet" colors={colors} deletable onDelete={() => handleDeleteNote('general_summary', data.general)} />
                  <TouchableOpacity
                    onLongPress={() => handleDeleteNote('general_summary', data.general)}
                    accessibilityRole="button"
                    accessibilityLabel="Genel Özet — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.general}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* User Persona */}
              {data.userPersona && (
                <View style={cardStyle}>
                  <SectionHeader icon="sparkles" color={colors.purple} title="Kişilik Tipi" colors={colors} deletable onDelete={() => handleClearField('user_persona', 'Kişilik Tipi')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('user_persona', 'Kişilik Tipi')}
                    accessibilityRole="button"
                    accessibilityLabel="Kişilik Tipi — silmek için uzun bas"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <View style={{
                      backgroundColor: colors.purple + '20', borderRadius: RADIUS.full,
                      paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
                    }}>
                      <Text style={{ color: colors.purple, fontSize: FONT.sm, fontWeight: '700' }}>{data.userPersona}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              )}

              {/* Learned Tone Preference */}
              {data.learnedTonePreference && (
                <View style={cardStyle}>
                  <SectionHeader icon="chatbubbles" color={colors.protein} title="İletişim Tercihi" colors={colors} deletable onDelete={() => handleClearField('learned_tone_preference', 'İletişim Tercihi')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('learned_tone_preference', 'İletişim Tercihi')}
                    accessibilityRole="button"
                    accessibilityLabel="İletişim Tercihi — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.learnedTonePreference}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Nutrition Literacy */}
              {data.nutritionLiteracy && (
                <View style={cardStyle}>
                  <SectionHeader icon="school" color={colors.protein} title="Beslenme Bilgi Düzeyi" colors={colors} />
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
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Davranis Kaliplari
              ═══════════════════════════════════════════ */}
          {data.patterns.length > 0 && (
            <>
              <CategoryTitle title="Davranış Kalıpları" icon="analytics" color={colors.coral} colors={colors} />

              <View style={cardStyle}>
                <SectionHeader icon="analytics" color={colors.coral} title="Tespit Edilen Kalıplar" colors={colors} badge={`${data.patterns.length}`} deletable onDelete={() => handleClearField('behavioral_patterns', 'Tespit Edilen Kalıplar')} />
                {data.patterns.map((p, i) => (
                  <TouchableOpacity
                    key={i}
                    onLongPress={() => handleDeleteNote('behavioral_patterns', p.description)}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.description} — silmek için uzun bas`}
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
                            <View style={{ width: `${(p.confidence ?? 0) * 100}%` as any, height: '100%', backgroundColor: colors.primary, borderRadius: 2 }} />
                          </View>
                          <Text style={{ fontSize: FONT.xs, color: colors.textMuted }}>%{Math.round((p.confidence ?? 0) * 100)} güven</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ═══════════════════════════════════════════
              SECTION: Beslenme Hafızası
              (portion, meal_times, caffeine, alcohol, social_eating)
              ═══════════════════════════════════════════ */}
          {(Object.keys(data.portionCalibration).length > 0 || data.learnedMealTimes ||
            data.caffeineSleepNotes || data.alcoholPattern || data.socialEatingNotes) && (
            <>
              <CategoryTitle title="Beslenme Hafızası" icon="nutrition" color={colors.success} colors={colors} />

              {/* Portion Calibration */}
              {Object.keys(data.portionCalibration).length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="resize" color={colors.success} title="Porsiyon Kalibrasyonu" colors={colors} deletable onDelete={() => handleClearField('portion_calibration', 'Porsiyon Kalibrasyonu')} />
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
                    Senin "1 porsiyon" dediğinde ne kadar olduğunu öğrendi
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                    {Object.entries(data.portionCalibration).map(([food, grams]) => (
                      <TouchableOpacity
                        key={food}
                        onLongPress={() => handleDeleteNote('portion_calibration', food)}
                        accessibilityRole="button"
                        accessibilityLabel={`${food} porsiyonu — silmek için uzun bas`}
                        style={{
                          backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md,
                          paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xs + 2,
                        }}
                      >
                        <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                          {food}: <Text style={{ fontWeight: '700', color: colors.success }}>{String(grams)}g</Text>
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Learned Meal Times */}
              {data.learnedMealTimes && Object.keys(data.learnedMealTimes).length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="time" color={colors.success} title="Öğrenilen Öğün Saatleri" colors={colors} deletable onDelete={() => handleClearField('learned_meal_times', 'Öğün Saatleri')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('learned_meal_times', 'Öğün Saatleri')}
                    accessibilityRole="button"
                    accessibilityLabel="Öğün Saatleri — silmek için uzun bas"
                  >
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
                  <SectionHeader icon="cafe" color={colors.coral} title="Kafein-Uyku" colors={colors} deletable onDelete={() => handleClearField('caffeine_sleep_notes', 'Kafein-Uyku')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('caffeine_sleep_notes', 'Kafein-Uyku')}
                    accessibilityRole="button"
                    accessibilityLabel="Kafein-Uyku notu — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.caffeineSleepNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Alcohol Pattern */}
              {data.alcoholPattern && (
                <View style={cardStyle}>
                  <SectionHeader icon="wine" color={colors.purple} title="Alkol Kalıbı" colors={colors} deletable onDelete={() => handleClearField('alcohol_pattern', 'Alkol Kalıbı')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('alcohol_pattern', 'Alkol Kalıbı')}
                    accessibilityRole="button"
                    accessibilityLabel="Alkol Kalıbı — silmek için uzun bas"
                  >
                    {typeof data.alcoholPattern === 'object' && data.alcoholPattern !== null ? (
                      <View style={{ gap: SPACING.xs }}>
                        {!!(data.alcoholPattern as Record<string, unknown>).pattern && (
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                            Kalıp: <Text style={{ fontWeight: '700' }}>{String((data.alcoholPattern as Record<string, unknown>).pattern)}</Text>
                          </Text>
                        )}
                        {!!(data.alcoholPattern as Record<string, unknown>).frequency && (
                          <Text style={{ color: colors.text, fontSize: FONT.sm }}>
                            Sıklık: <Text style={{ fontWeight: '700' }}>{String((data.alcoholPattern as Record<string, unknown>).frequency)}</Text>
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
                  <SectionHeader icon="people" color={colors.protein} title="Sosyal Yeme" colors={colors} deletable onDelete={() => handleClearField('social_eating_notes', 'Sosyal Yeme')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('social_eating_notes', 'Sosyal Yeme')}
                    accessibilityRole="button"
                    accessibilityLabel="Sosyal Yeme notu — silmek için uzun bas"
                  >
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
              <CategoryTitle title="Sağlık & İyileşme" icon="heart" color={colors.error} colors={colors} />

              {/* Recovery Pattern */}
              {data.recoveryPattern && (
                <View style={cardStyle}>
                  <SectionHeader icon="fitness" color={colors.pink} title="Toparlanma Deseni" colors={colors} deletable onDelete={() => handleClearField('recovery_pattern', 'Toparlanma Deseni')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('recovery_pattern', 'Toparlanma Deseni')}
                    accessibilityRole="button"
                    accessibilityLabel="Toparlanma Deseni — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.recoveryPattern}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Menstrual Notes - only if tracking enabled */}
              {menstrualTracking && data.menstrualNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="calendar" color={colors.pink} title="Regl Notları" colors={colors} deletable onDelete={() => handleClearField('menstrual_notes', 'Regl Notları')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('menstrual_notes', 'Regl Notları')}
                    accessibilityRole="button"
                    accessibilityLabel="Regl Notları — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.menstrualNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Micro Nutrient Risks */}
              {data.microNutrientRisks.length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="warning" color={colors.warning} title="Mikro Besin Riskleri" colors={colors} badge={`${data.microNutrientRisks.length}`} deletable onDelete={() => handleClearField('micro_nutrient_risks', 'Mikro Besin Riskleri')} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                    {data.microNutrientRisks.map((r, i) => (
                      <TouchableOpacity
                        key={i}
                        onLongPress={() => handleDeleteNote('micro_nutrient_risks', r.nutrient)}
                        accessibilityRole="button"
                        accessibilityLabel={`${r.nutrient} riski — silmek için uzun bas`}
                        style={{
                          backgroundColor: (RISK_COLORS[r.risk_level] ?? colors.textMuted) + '18',
                          borderRadius: RADIUS.full,
                          paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xs + 2,
                          flexDirection: 'row', alignItems: 'center', gap: 4,
                        }}
                      >
                        <View style={{
                          width: 8, height: 8, borderRadius: 4,
                          backgroundColor: RISK_COLORS[r.risk_level] ?? colors.textMuted,
                        }} />
                        <Text style={{ color: RISK_COLORS[r.risk_level] ?? colors.textMuted, fontSize: FONT.sm, fontWeight: '600' }}>
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
                  <SectionHeader icon="medkit" color={colors.primary} title="Supplement Notları" colors={colors} deletable onDelete={() => handleClearField('supplement_notes', 'Supplement Notları')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('supplement_notes', 'Supplement Notları')}
                    accessibilityRole="button"
                    accessibilityLabel="Supplement Notları — silmek için uzun bas"
                  >
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
              <CategoryTitle title="İlerleme" icon="trending-up" color={colors.protein} colors={colors} />

              {/* Habit Progress */}
              {data.habitProgress.length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="flame" color={colors.coral} title="Alışkanlık İlerlemesi" colors={colors} badge={`${data.habitProgress.length}`} deletable onDelete={() => handleClearField('habit_progress', 'Alışkanlık İlerlemesi')} />
                  {data.habitProgress.map((h, i) => {
                    const statusInfo = HABIT_STATUS_ICON[h.status] ?? { icon: 'ellipse', color: colors.textMuted };
                    return (
                      <TouchableOpacity
                        key={i}
                        onLongPress={() => handleDeleteNote('habit_progress', h.habit)}
                        accessibilityRole="button"
                        accessibilityLabel={`${h.habit} — silmek için uzun bas`}
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
                            backgroundColor: colors.coral + '18', borderRadius: RADIUS.full,
                            paddingHorizontal: SPACING.sm, paddingVertical: 2,
                          }}>
                            <Ionicons name="flame" size={12} color={colors.coral} />
                            <Text style={{ color: colors.coral, fontSize: FONT.xs, fontWeight: '700' }}>{h.streak}</Text>
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
                  <SectionHeader icon="barbell" color={colors.success} title="Güç Kayıtları" colors={colors} />
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
                  <SectionHeader icon="wallet" color={colors.purple} title="Haftalık Bütçe Kalıbı" colors={colors} deletable onDelete={() => handleClearField('weekly_budget_pattern', 'Haftalık Bütçe Kalıbı')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('weekly_budget_pattern', 'Haftalık Bütçe Kalıbı')}
                    accessibilityRole="button"
                    accessibilityLabel="Haftalık Bütçe Kalıbı — silmek için uzun bas"
                  >
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
              <CategoryTitle title="Sistem" icon="settings" color={colors.textMuted} colors={colors} />

              {/* Features Introduced (read-only) */}
              {data.featuresIntroduced.length > 0 && (
                <View style={cardStyle}>
                  <SectionHeader icon="bulb" color={colors.warning} title="Tanıtılan Özellikler" colors={colors} badge={`${data.featuresIntroduced.length}`} />
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
                    Sana daha önce tanıtılmış özellikler (salt okunur)
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
                  <SectionHeader icon="leaf" color={colors.success} title="Mevsimsel Notlar" colors={colors} deletable onDelete={() => handleClearField('seasonal_notes', 'Mevsimsel Notlar')} />
                  <TouchableOpacity
                    onLongPress={() => handleClearField('seasonal_notes', 'Mevsimsel Notlar')}
                    accessibilityRole="button"
                    accessibilityLabel="Mevsimsel Notlar — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 22 }}>{data.seasonalNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Coaching Notes */}
              {data.coachingNotes && (
                <View style={cardStyle}>
                  <SectionHeader icon="journal" color={colors.warning} title="Koçluk Notları" colors={colors} deletable onDelete={() => handleDeleteNote('coaching_notes', data.coachingNotes)} />
                  <TouchableOpacity
                    onLongPress={() => handleDeleteNote('coaching_notes', data.coachingNotes)}
                    accessibilityRole="button"
                    accessibilityLabel="Koçluk Notları — silmek için uzun bas"
                  >
                    <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{data.coachingNotes}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* Reset button */}
          <TouchableOpacity
            onPress={handleResetAll}
            accessibilityRole="button"
            accessibilityLabel="Tüm hafızayı sıfırla"
            accessibilityHint="Koçun senin hakkında öğrendiği tüm bilgiler silinir"
            style={{ alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.md }}
          >
            <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '500' }}>Tüm hafızayı sıfırla</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>KVKK Madde 17 - Veri silme hakkı</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ═══════════════════════════════════════════
          SECTION: Tüm Hafıza Alanları (Transparency + Debug)
          Her kategoriyi her zaman göster — AI'nın hangi alanda ne öğrendiğini
          veya henüz öğrenmediğini şeffafça görmek için.
          ═══════════════════════════════════════════ */}
      <CategoryTitle title="Tüm Hafıza Alanları (Şeffaflık)" icon="list" color={colors.purple} colors={colors} />
      <View style={cardStyle}>
        <SectionHeader icon="eye-outline" color={colors.purple} title="Koçun Takip Ettiği Her Şey" colors={colors} />
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
          AI bu alanları konuşmalardan takip ediyor. Dolu olanlar: öğrendiği şeyler. Boş olanlar: henüz yeterli veri yok.
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
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>{f.desc}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  {isFilled ? (
                    <Text style={{ color: colors.success, fontSize: FONT.xs, fontWeight: '600', textAlign: 'right' }} numberOfLines={3}>
                      {display}
                    </Text>
                  ) : (
                    <View style={{
                      backgroundColor: colors.surfaceLight, borderRadius: RADIUS.full,
                      paddingHorizontal: SPACING.sm, paddingVertical: 2,
                    }}>
                      <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>Henüz öğrenilmedi</Text>
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
  { key: 'general', label: 'Genel Özet', desc: 'Senin hakkındaki serbest metin notu' },
  { key: 'userPersona', label: 'Kişilik Tipi', desc: 'İletişim ve motivasyon stili' },
  { key: 'learnedTonePreference', label: 'İletişim Tercihi', desc: 'Nasıl konuşulmasını sevdiğin' },
  { key: 'nutritionLiteracy', label: 'Beslenme Bilgi Düzeyi', desc: 'low / medium / high' },
  { key: 'patterns', label: 'Davranış Kalıpları', desc: 'Gece yeme, stres atıştırması vb.' },
  { key: 'portionCalibration', label: 'Porsiyon Kalibrasyonu', desc: 'Senin "1 porsiyon"un kaç gram' },
  { key: 'learnedMealTimes', label: 'Öğrenilen Öğün Saatleri', desc: 'Genelde ne zaman yediğin' },
  { key: 'caffeineSleepNotes', label: 'Kafein-Uyku Notu', desc: 'Kafein uykunu nasıl etkiliyor' },
  { key: 'alcoholPattern', label: 'Alkol Kalıbı', desc: 'Sıklık, miktar, ertesi gün etkisi' },
  { key: 'socialEatingNotes', label: 'Sosyal Yeme', desc: 'Arkadaş/aile yemeklerinde kalıp' },
  { key: 'recoveryPattern', label: 'Toparlanma Deseni', desc: 'Antrenman sonrası yorgunluk/enerji' },
  { key: 'menstrualNotes', label: 'Regl Dönemi Notları', desc: 'Sadece takip açıksa' },
  { key: 'microNutrientRisks', label: 'Mikro Besin Riskleri', desc: 'Eksik olabilecek vitamin/mineraller' },
  { key: 'supplementNotes', label: 'Supplement Notları', desc: 'Aldığın/almadığın takviyeler' },
  { key: 'habitProgress', label: 'Alışkanlık İlerlemesi', desc: 'Oluşturduğun/takip eden rutinler' },
  { key: 'strengthRecords', label: 'Güç Kayıtları', desc: 'Egzersiz PRları' },
  { key: 'weeklyBudgetPattern', label: 'Haftalık Bütçe Kalıbı', desc: 'Kalori bütçesini nasıl dağıttığın' },
  { key: 'seasonalNotes', label: 'Mevsimsel Notlar', desc: 'Yaz/kış yeme alışkanlıkları' },
  { key: 'featuresIntroduced', label: 'Tanıtılan Özellikler', desc: 'Sana hangi özellikler anlatıldı' },
  { key: 'coachingNotes', label: 'Koçluk Notları', desc: 'İç görüşme gözlemi (sistem)' },
];

function isMeaningful(item: unknown): boolean {
  if (item == null) return false;
  if (typeof item === 'string') return item.trim() !== '';
  if (typeof item === 'object') return Object.keys(item as Record<string, unknown>).length > 0;
  return true;
}

function formatFieldValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (Array.isArray(v)) {
    // Filter empty entries so an array of empty objects (e.g. micro_nutrient_risks
    // stored as [{}]) reads as "not learned yet" instead of a misleading "1 kayit"
    // / blank row (#R3-16/#R3-20).
    const nonEmpty = v.filter(isMeaningful);
    if (nonEmpty.length === 0) return null;
    return `${nonEmpty.length} kayıt`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) return null;
    return `${keys.length} kayıt`;
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

function SectionHeader({ icon, color, title, colors, badge, deletable, onDelete }: { icon: string; color: string; title: string; colors: any; badge?: string; deletable?: boolean; onDelete?: () => void }) {
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
      {/* FIX (audit ui-destructive-delete): dekoratif trash ikonu gerçek onPress'li görünür/erişilebilir sil butonuna çevrildi. */}
      {deletable && onDelete ? (
        <TouchableOpacity
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`${title} sil`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ padding: SPACING.xs }}
        >
          <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
