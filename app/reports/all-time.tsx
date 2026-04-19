/**
 * All-Time Report Screen
 * Spec 8.4: Başlangıçtan bugüne toplam ilerleme.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useStreak } from '@/hooks/useStreak';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function AllTimeReportScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { streak } = useStreak();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    startWeight: number | null;
    currentWeight: number | null;
    totalMeals: number;
    totalWorkouts: number;
    longestStreak: number;
    avgCompliance: number;
    daysActive: number;
    achievements: number;
  }>({
    startWeight: null, currentWeight: null, totalMeals: 0,
    totalWorkouts: 0, longestStreak: 0, avgCompliance: 0,
    daysActive: 0, achievements: 0,
  });

  useEffect(() => {
    if (!user?.id) return;

    Promise.all([
      supabase.from('profiles').select('weight_kg, created_at').eq('id', user.id).single(),
      supabase.from('daily_metrics').select('weight_kg, date').eq('user_id', user.id).not('weight_kg', 'is', null).order('date').limit(1).single(),
      supabase.from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_deleted', false),
      supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('daily_reports').select('compliance_score, report_date').eq('user_id', user.id).order('report_date', { ascending: true }),
      supabase.from('achievements').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]).then(([profileRes, firstWeightRes, mealsRes, workoutsRes, reportsRes, achievementsRes]) => {
      const profile = profileRes.data;
      const reports = (reportsRes.data ?? []) as { compliance_score: number; report_date: string }[];
      const avgComp = reports.length > 0
        ? Math.round(reports.reduce((s, r) => s + r.compliance_score, 0) / reports.length) : 0;

      // Calculate longest streak from consecutive days with compliance_score > 0
      let longestStreak = 0;
      let currentRun = 0;
      for (let i = 0; i < reports.length; i++) {
        if (reports[i].compliance_score > 0) {
          if (i === 0) {
            currentRun = 1;
          } else {
            const prev = new Date(reports[i - 1].report_date).getTime();
            const curr = new Date(reports[i].report_date).getTime();
            const diffDays = Math.round((curr - prev) / 86400000);
            currentRun = diffDays === 1 ? currentRun + 1 : 1;
          }
          if (currentRun > longestStreak) longestStreak = currentRun;
        } else {
          currentRun = 0;
        }
      }
      // Ensure current streak is also considered
      if (streak > longestStreak) longestStreak = streak;

      const createdAt = profile?.created_at ? new Date(profile.created_at) : new Date();
      const daysActive = Math.floor((Date.now() - createdAt.getTime()) / 86400000);

      setStats({
        startWeight: firstWeightRes.data?.weight_kg ?? null,
        currentWeight: profile?.weight_kg ?? null,
        totalMeals: mealsRes.count ?? 0,
        totalWorkouts: workoutsRes.count ?? 0,
        longestStreak,
        avgCompliance: avgComp,
        daysActive,
        achievements: achievementsRes.count ?? 0,
      });
      setLoading(false);
    });
  }, [user?.id, streak]);

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>;
  }

  const totalWeightChange = stats.startWeight && stats.currentWeight
    ? stats.currentWeight - stats.startWeight : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md }}>Tum Zamanlar</Text>

      {/* Total Progress */}
      {totalWeightChange !== null && (
        <Card title="Toplam Ilerleme">
          <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
            <Text style={{ color: totalWeightChange < 0 ? COLORS.success : COLORS.error, fontSize: FONT.hero, fontWeight: '800' }}>
              {totalWeightChange > 0 ? '+' : ''}{totalWeightChange.toFixed(1)} kg
            </Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.xs }}>
              {stats.startWeight} kg → {stats.currentWeight} kg
            </Text>
          </View>
        </Card>
      )}

      {/* Key Stats Grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <StatCard label="Aktif Gun" value={`${stats.daysActive}`} />
        <StatCard label="Toplam Ogun" value={`${stats.totalMeals}`} />
        <StatCard label="Toplam Antrenman" value={`${stats.totalWorkouts}`} />
        <StatCard label="Streak" value={`${stats.longestStreak}`} />
        <StatCard label="Ort. Uyum" value={`%${stats.avgCompliance}`} />
        <StatCard label="Basarimlar" value={`${stats.achievements}`} />
      </View>

      {/* Milestones */}
      <Card title="Kilometre Taslari">
        {totalWeightChange !== null && totalWeightChange < 0 && (
          <>
            {Math.abs(totalWeightChange) >= 1 && <MilestoneRow text="Ilk 1 kg" done />}
            {Math.abs(totalWeightChange) >= 5 && <MilestoneRow text="5 kg" done />}
            {Math.abs(totalWeightChange) >= 10 && <MilestoneRow text="10 kg" done />}
          </>
        )}
        {stats.longestStreak >= 7 && <MilestoneRow text="7 gun streak" done />}
        {stats.longestStreak >= 30 && <MilestoneRow text="30 gun streak" done />}
        {stats.longestStreak >= 100 && <MilestoneRow text="100 gun streak" done />}
        {stats.totalMeals === 0 && stats.longestStreak < 7 && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center' }}>Henuz kilometre tasi yok. Devam et!</Text>
        )}
      </Card>
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '47%', backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function MilestoneRow({ text, done }: { text: string; done: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm }}>
      <Text style={{ fontSize: FONT.md, marginRight: SPACING.sm }}>{done ? '✓' : '○'}</Text>
      <Text style={{ color: done ? COLORS.success : COLORS.textMuted, fontSize: FONT.md }}>{text}</Text>
    </View>
  );
}
