/**
 * Profile Screen — Spec 2.3, 17 item 13
 * Shows user info, AI insights (Katman 2), active plan summary,
 * goal progress, profile completion, and navigation.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
import { shareStreak } from '@/services/sharing.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { ProfileCompletion } from '@/components/profile/ProfileCompletion';
import { InsightCard } from '@/components/profile/InsightCard';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const DIET_LABELS: Record<string, string> = { standard: 'Standart', low_carb: 'Dusuk Karb', keto: 'Ketojenik', high_protein: 'Yuksek Protein' };
const ACTIVITY_LABELS: Record<string, string> = { sedentary: 'Hareketsiz', light: 'Hafif', moderate: 'Orta', active: 'Aktif', very_active: 'Cok Aktif' };
const TONE_LABELS: Record<string, string> = { strict: 'Sert Koc', balanced: 'Dengeli', gentle: 'Yumusak' };
const GOAL_LABELS: Record<string, string> = { lose_weight: 'Kilo ver', gain_weight: 'Kilo al', gain_muscle: 'Kas kazan', health: 'Saglik', maintain: 'Koruma', conditioning: 'Kondisyon' };

interface GoalData { goal_type: string; target_weight_kg: number | null; }
interface PlanFocus { focus_message: string | null; }

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();
  const { profile, fetch: fetchProfile } = useProfileStore();
  const [summary, setSummary] = useState<{ general_summary?: string; behavioral_patterns?: unknown[]; [key: string]: unknown } | null>(null);
  const [streak, setStreak] = useState(0);
  const [goal, setGoal] = useState<GoalData | null>(null);
  const [todayFocus, setTodayFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchProfile(user.id);
    loadInsights().then(setSummary);
    calculateStreak(user.id).then(setStreak);

    // Load active goal
    supabase.from('goals').select('goal_type, target_weight_kg')
      .eq('user_id', user.id).eq('is_active', true).order('phase_order').limit(1).single()
      .then(({ data }) => { if (data) setGoal(data as GoalData); });

    // Load today's plan focus
    const today = new Date().toISOString().split('T')[0];
    supabase.from('daily_plans').select('focus_message')
      .eq('user_id', user.id).eq('date', today).order('version', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data) setTodayFocus((data as PlanFocus).focus_message); });
  }, [user?.id, fetchProfile]);

  const p = (profile ?? {}) as Record<string, unknown>;
  const age = p.birth_year ? new Date().getFullYear() - (p.birth_year as number) : null;
  const completionPct = profile ? calculateCompletion(p) : 0;
  const currentWeight: number | null = typeof p.weight_kg === 'number' ? p.weight_kg : null;
  const targetWeight: number | null = goal?.target_weight_kg ?? null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Profil</Text>
        <TouchableOpacity onPress={() => streak >= 2 && shareStreak(streak)}>
          <StreakBadge days={streak} />
        </TouchableOpacity>
      </View>

      {/* Today's Focus (from active plan) */}
      {todayFocus && (
        <Card>
          <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600', lineHeight: 22 }}>{todayFocus}</Text>
        </Card>
      )}

      {/* Goal Progress */}
      <GoalProgressCard goal={goal} currentWeight={currentWeight} targetWeight={targetWeight} />

      {/* Basic Info */}
      <Card>
        <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>{user?.email}</Text>
        <View style={{ gap: 4 }}>
          <InfoRow label="Yas" value={age ? `${age}` : '-'} />
          <InfoRow label="Boy" value={p.height_cm ? `${String(p.height_cm)} cm` : '-'} />
          <InfoRow label="Kilo" value={p.weight_kg ? `${String(p.weight_kg)} kg` : '-'} />
          <InfoRow label="Cinsiyet" value={String(p.gender ?? '-')} />
          <InfoRow label="Aktivite" value={ACTIVITY_LABELS[String(p.activity_level)] ?? '-'} />
          <InfoRow label="Diyet" value={DIET_LABELS[String(p.diet_mode)] ?? 'Standart'} />
          <InfoRow label="Koc Tonu" value={TONE_LABELS[String(p.coach_tone)] ?? 'Dengeli'} />
          {String(p.alcohol_frequency ?? 'never') !== 'never' ? <InfoRow label="Alkol" value={String(p.alcohol_frequency)} /> : null}
          {p.if_active ? <InfoRow label="IF" value={String(p.if_window ?? '')} /> : null}
          {p.periodic_state ? <InfoRow label="Donem" value={String(p.periodic_state)} highlight /> : null}
        </View>
      </Card>

      {/* Completion Bar */}
      <ProfileCompletion percentage={completionPct} />

      {/* Calorie Targets */}
      {p.calorie_range_training_min ? (
        <Card title="Kalori Hedefleri">
          <View style={{ gap: 4 }}>
            <InfoRow label="Antrenman gunu" value={`${String(p.calorie_range_training_min)}-${String(p.calorie_range_training_max)} kcal`} />
            <InfoRow label="Dinlenme gunu" value={`${String(p.calorie_range_rest_min)}-${String(p.calorie_range_rest_max)} kcal`} />
            <InfoRow label="Protein" value={p.protein_per_kg ? `${String(p.protein_per_kg)}g/kg (${Math.round(Number(p.weight_kg ?? 0) * Number(p.protein_per_kg))}g)` : '-'} />
            <InfoRow label="Makro" value={`P${String(p.macro_protein_pct ?? 30)}/K${String(p.macro_carb_pct ?? 40)}/Y${String(p.macro_fat_pct ?? 30)}`} />
            <InfoRow label="Su hedefi" value={p.water_target_liters ? `${String(p.water_target_liters)}L` : '-'} />
          </View>
        </Card>
      ) : null}

      {/* AI Insights (Katman 2 — KVKK compliant) */}
      {summary && (
        <View style={{ marginBottom: SPACING.md }}>
          <InsightCard
            generalSummary={String(summary.general_summary ?? '')}
            patterns={(summary.behavioral_patterns as { type: string; description: string }[]) ?? []}
            portionCalibration={(summary.portion_calibration as Record<string, unknown>) ?? {}}
            coachingNotes={String(summary.coaching_notes ?? '')}
            onDeleteNote={async (note) => {
              if (!user?.id) return;
              await deleteAISummaryNote(user.id, 'general_summary', note);
              loadInsights().then(setSummary);
            }}
            onResetAll={async () => {
              if (!user?.id) return;
              Alert.alert('Sifirla', 'AI notlarini sifirlamak istediginize emin misiniz? Bu geri alinamaz.', [
                { text: 'Iptal' },
                { text: 'Sifirla', style: 'destructive', onPress: async () => { await resetAISummary(user!.id); setSummary(null); } },
              ]);
            }}
          />
        </View>
      )}

      {/* Navigation */}
      <View style={{ gap: SPACING.sm, marginTop: SPACING.md }}>
        <Button title="Profil Duzenle" variant="outline" onPress={() => router.push('/settings/edit-profile')} />
        <Button title="Hedef Ayarlari" variant="outline" onPress={() => router.push('/settings/goals')} />
        <Button title="Yemek Tercihleri" variant="outline" onPress={() => router.push('/settings/food-preferences')} />
        <Button title="IF Ayarlari" variant="outline" onPress={() => router.push('/settings/if-settings')} />
        <Button title="Ilerleme Fotograflari" variant="outline" onPress={() => router.push('/settings/progress-photos')} />
        <Button title="Basarimlar" variant="outline" onPress={() => router.push('/settings/achievements')} />
        <Button title="Tum Ayarlar" variant="outline" onPress={() => router.push('/settings' as never)} />
      </View>

      <View style={{ marginTop: SPACING.xl }}>
        <Button title="Cikis Yap" variant="ghost" onPress={() => Alert.alert('Cikis', 'Emin misin?', [{ text: 'Iptal' }, { text: 'Cikis', style: 'destructive', onPress: signOut }])} />
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>{label}</Text>
      <Text style={{ color: highlight ? COLORS.warning : COLORS.text, fontSize: FONT.md, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

function GoalProgressCard({ goal, currentWeight, targetWeight }: { goal: GoalData | null; currentWeight: number | null; targetWeight: number | null }) {
  if (!goal || currentWeight == null || targetWeight == null) return null;
  const diff = Math.abs(currentWeight - targetWeight);
  const pct = Math.max(5, Math.min(95, 100 - (diff / Math.max(1, diff + 10) * 100)));
  return (
    <Card title={`Hedef: ${GOAL_LABELS[goal.goal_type] ?? goal.goal_type}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Simdiki: {currentWeight} kg</Text>
        <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Hedef: {targetWeight} kg</Text>
      </View>
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: COLORS.primary, borderRadius: 5 }} />
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 4 }}>{diff.toFixed(1)} kg kaldi</Text>
    </Card>
  );
}

function calculateCompletion(p: Record<string, unknown>): number {
  const fields = [
    'height_cm', 'weight_kg', 'birth_year', 'gender', 'activity_level',
    'equipment_access', 'cooking_skill', 'budget_level', 'diet_mode',
    'sleep_time', 'wake_time', 'occupation', 'training_style',
    'alcohol_frequency', 'portion_language',
  ];
  const filled = fields.filter(f => p[f] != null && p[f] !== '').length;
  return Math.round((filled / fields.length) * 100);
}
