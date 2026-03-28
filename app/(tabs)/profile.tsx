import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
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

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();
  const { profile, fetch: fetchProfile } = useProfileStore();
  const [summary, setSummary] = useState<{ general_summary?: string; behavioral_patterns?: unknown[]; [key: string]: unknown } | null>(null);
  const [streak, setStreak] = useState(0);
  const [goalText, setGoalText] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchProfile(user.id);
    loadInsights().then(setSummary);
    calculateStreak(user.id).then(setStreak);
    supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).single()
      .then(({ data }) => {
        if (data) setGoalText(`${(data as { goal_type: string }).goal_type} → ${(data as { target_weight_kg: number }).target_weight_kg}kg`);
      });
  }, [user?.id, fetchProfile]);

  const age = profile?.birth_year ? new Date().getFullYear() - (profile.birth_year as number) : null;
  const completionPct = profile ? calculateCompletion(profile) : 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Profil</Text>
        <StreakBadge days={streak} />
      </View>

      {/* Basic Info */}
      <Card>
        <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>{user?.email}</Text>
        <View style={{ gap: 4 }}>
          <InfoRow label="Yas" value={age ? `${age}` : '-'} />
          <InfoRow label="Boy" value={profile?.height_cm ? `${profile.height_cm} cm` : '-'} />
          <InfoRow label="Kilo" value={profile?.weight_kg ? `${profile.weight_kg} kg` : '-'} />
          <InfoRow label="Cinsiyet" value={String(profile?.gender ?? '-')} />
          <InfoRow label="Aktivite" value={ACTIVITY_LABELS[String(profile?.activity_level)] ?? '-'} />
          <InfoRow label="Diyet" value={DIET_LABELS[String(profile?.diet_mode)] ?? 'Standart'} />
          <InfoRow label="Koc Tonu" value={TONE_LABELS[String(profile?.coach_tone)] ?? 'Dengeli'} />
          {profile?.if_active && <InfoRow label="IF" value={`${profile.if_window} (${profile.if_eating_start}-${profile.if_eating_end})`} />}
          {profile?.periodic_state && <InfoRow label="Donem" value={String(profile.periodic_state)} highlight />}
          {goalText && <InfoRow label="Hedef" value={goalText} />}
        </View>
      </Card>

      {/* Completion Bar */}
      <ProfileCompletion percentage={completionPct} />

      {/* Calorie Targets */}
      {profile?.calorie_range_training_min && (
        <Card title="Kalori Hedefleri">
          <View style={{ gap: 4 }}>
            <InfoRow label="Antrenman gunu" value={`${profile.calorie_range_training_min}-${profile.calorie_range_training_max} kcal`} />
            <InfoRow label="Dinlenme gunu" value={`${profile.calorie_range_rest_min}-${profile.calorie_range_rest_max} kcal`} />
            <InfoRow label="Protein" value={profile.protein_per_kg ? `${profile.protein_per_kg}g/kg (${Math.round(Number(profile.weight_kg ?? 0) * Number(profile.protein_per_kg))}g)` : '-'} />
            <InfoRow label="Su hedefi" value={profile.water_target_liters ? `${profile.water_target_liters}L` : '-'} />
          </View>
        </Card>
      )}

      {/* AI Summary */}
      {/* AI Insights with KVKK-compliant edit/delete */}
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
              await resetAISummary(user.id);
              setSummary(null);
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

function calculateCompletion(profile: Record<string, unknown>): number {
  const fields = ['height_cm', 'weight_kg', 'birth_year', 'gender', 'activity_level', 'equipment_access', 'cooking_skill', 'budget_level', 'diet_mode', 'sleep_time', 'wake_time'];
  const filled = fields.filter(f => profile[f] != null).length;
  return Math.round((filled / fields.length) * 100);
}
