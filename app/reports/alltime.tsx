/**
 * All-Time Report — Spec 8.4
 * Shows: total progress since start, longest streak, milestones, behavioral evolution.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { getAchievements, calculateStreak } from '@/services/achievements.service';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function AllTimeReportScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    totalDays: number; currentStreak: number; longestStreak: number;
    totalMeals: number; totalWorkouts: number; weightStart: number | null; weightNow: number | null;
    milestones: { title: string; date: string }[];
  } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    loadAllTimeData(user.id).then(d => { setStats(d); setLoading(false); });
  }, [user?.id]);

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const p = (profile ?? {}) as Record<string, unknown>;
  const startDate = p.created_at ? new Date(p.created_at as string).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Tum Zamanlar</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Baslangictan bugune yolculugun.</Text>

      {!stats ? (
        <Card><Text style={{ color: COLORS.textMuted, textAlign: 'center', paddingVertical: SPACING.lg }}>Yeterli veri yok.</Text></Card>
      ) : (
        <>
          <Card title="Genel Bakis">
            <StatRow label="Kayit tarihi" value={startDate} />
            <StatRow label="Aktif gun sayisi" value={`${stats.totalDays}`} />
            <StatRow label="Mevcut seri" value={`${stats.currentStreak} gun`} />
            <StatRow label="En uzun seri" value={`${stats.longestStreak} gun`} />
            <StatRow label="Toplam ogun kaydi" value={`${stats.totalMeals.toLocaleString('tr-TR')}`} />
            <StatRow label="Toplam antrenman" value={`${stats.totalWorkouts.toLocaleString('tr-TR')}`} />
          </Card>

          {stats.weightStart != null && stats.weightNow != null && (
            <Card title="Kilo Yolculugu">
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: SPACING.md }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Baslangic</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.xl, fontWeight: '700' }}>{stats.weightStart} kg</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: COLORS.primary, fontSize: FONT.xxl, fontWeight: '800' }}>→</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Simdi</Text>
                  <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{stats.weightNow} kg</Text>
                </View>
              </View>
              <Text style={{ color: COLORS.success, fontSize: FONT.md, fontWeight: '600', textAlign: 'center' }}>
                Toplam: {(stats.weightStart - stats.weightNow) > 0 ? '-' : '+'}{Math.abs(stats.weightStart - stats.weightNow).toFixed(1)} kg
              </Text>
            </Card>
          )}

          {stats.milestones.length > 0 && (
            <Card title="Kilometre Taslari">
              {stats.milestones.map((m, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: i < stats.milestones.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '500' }}>{m.title}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{new Date(m.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

async function loadAllTimeData(userId: string) {
  const [mealsRes, workoutsRes, weightsRes, achievementsData, streak] = await Promise.all([
    supabase.from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_deleted', false),
    supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('weight_history').select('weight_kg, recorded_at').eq('user_id', userId).order('recorded_at'),
    getAchievements(),
    calculateStreak(userId),
  ]);

  const weights = (weightsRes.data ?? []) as { weight_kg: number; recorded_at: string }[];

  // Calculate total active days (days with at least 1 log)
  const { count: activeDays } = await supabase
    .from('daily_reports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Longest streak from achievements
  const streakAchievements = achievementsData.filter(a => a.achievement_type.startsWith('streak_'));
  const longestStreak = streakAchievements.length > 0
    ? Math.max(...streakAchievements.map(a => parseInt(a.achievement_type.replace('streak_', '')) || 0))
    : streak;

  return {
    totalDays: activeDays ?? 0,
    currentStreak: streak,
    longestStreak: Math.max(longestStreak, streak),
    totalMeals: mealsRes.count ?? 0,
    totalWorkouts: workoutsRes.count ?? 0,
    weightStart: weights.length > 0 ? weights[0].weight_kg : null,
    weightNow: weights.length > 0 ? weights[weights.length - 1].weight_kg : null,
    milestones: achievementsData.map(a => ({ title: a.title, date: a.achieved_at })),
  };
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}
