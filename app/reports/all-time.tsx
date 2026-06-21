/**
 * All-Time Report Screen
 * Spec 8.4: Başlangıçtan bugüne toplam ilerleme.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useStreak } from '@/hooks/useStreak';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

export default function AllTimeReportScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { streak } = useStreak();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
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

  const loadStats = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    setError(false);

    Promise.all([
      supabase.from('profiles').select('weight_kg, created_at').eq('id', user.id).single(),
      supabase.from('daily_metrics').select('weight_kg, date').eq('user_id', user.id).not('weight_kg', 'is', null).order('date').limit(1).single(),
      supabase.from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_deleted', false),
      supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('daily_reports').select('compliance_score, date').eq('user_id', user.id).order('date', { ascending: true }),
      supabase.from('achievements').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]).then(([profileRes, firstWeightRes, mealsRes, workoutsRes, reportsRes, achievementsRes]) => {
      const profile = profileRes.data;
      const reports = (reportsRes.data ?? []) as { compliance_score: number; date: string }[];
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
            const prev = new Date(reports[i - 1].date).getTime();
            const curr = new Date(reports[i].date).getTime();
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
    }).catch(() => {
      // Network/auth failure must not strand the user on an infinite spinner — show a
      // recoverable error state with a retry instead (#screen-states).
      setError(true);
    }).finally(() => {
      setLoading(false);
    });
  }, [user?.id, streak]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (loading) {
    return <SkeletonScreen cards={3} />;
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, textAlign: 'center', marginBottom: SPACING.lg }}>
          Rapor yüklenemedi. İnternet bağlantını kontrol et.
        </Text>
        <TouchableOpacity
          onPress={loadStats}
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
          style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: getContrastColor(COLORS.primary), fontSize: FONT.md, fontWeight: '600' }}>Tekrar dene</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalWeightChange = stats.startWeight && stats.currentWeight
    ? stats.currentWeight - stats.startWeight : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>

      {/* Total Progress */}
      {totalWeightChange !== null && (
        <Card title="Toplam İlerleme">
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
        <StatCard label="Aktif Gün" value={`${stats.daysActive}`} />
        <StatCard label="Toplam Öğün" value={`${stats.totalMeals}`} />
        <StatCard label="Toplam Antrenman" value={`${stats.totalWorkouts}`} />
        <StatCard label="Streak" value={`${stats.longestStreak}`} />
        <StatCard label="Ort. Uyum" value={`%${stats.avgCompliance}`} />
        <StatCard label="Başarımlar" value={`${stats.achievements}`} />
      </View>

      {/* Milestones */}
      <Card title="Kilometre Taşları">
        {/* FIX (audit UI-PLN-03): gate on !== 0 (not < 0) so weight-gain / muscle-gain
            goal users (positive totalWeightChange) also see their kg milestones. */}
        {totalWeightChange !== null && totalWeightChange !== 0 && (
          <>
            {Math.abs(totalWeightChange) >= 1 && <MilestoneRow text="İlk 1 kg" done />}
            {Math.abs(totalWeightChange) >= 5 && <MilestoneRow text="5 kg" done />}
            {Math.abs(totalWeightChange) >= 10 && <MilestoneRow text="10 kg" done />}
          </>
        )}
        {stats.longestStreak >= 7 && <MilestoneRow text="7 gün streak" done />}
        {stats.longestStreak >= 30 && <MilestoneRow text="30 gün streak" done />}
        {stats.longestStreak >= 100 && <MilestoneRow text="100 gün streak" done />}
        {/* FIX (audit UI-PLN-03): only show the empty-state when there is genuinely no kg
            milestone either — otherwise a gaining user with >=1 kg saw an empty card. */}
        {(totalWeightChange === null || Math.abs(totalWeightChange) < 1) && stats.longestStreak < 7 && (
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>Henüz kilometre taşı yok. Devam et!</Text>
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
