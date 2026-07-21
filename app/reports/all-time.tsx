/**
 * All-Time Report Screen
 * Spec 8.4: Başlangıçtan bugüne toplam ilerleme.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useStreak } from '@/hooks/useStreak';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

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
    activeDays: number;
    achievements: number;
  }>({
    startWeight: null, currentWeight: null, totalMeals: 0,
    totalWorkouts: 0, longestStreak: 0, avgCompliance: 0,
    activeDays: 0, achievements: 0,
  });
  // FIX (ux-pass5): remember a successful load — loadStats re-runs when the streak hook resolves,
  // and a refresh failure must not swap already-shown stats for the full-screen error state.
  const loadedRef = useRef(false);

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
      // FIX (ux-pass5): supabase-js never rejects — offline, every result resolves as
      // { data/count: null, error }, so the .catch below never fired and the screen fabricated a
      // zeroed lifetime ("Toplam Öğün 0", "Aktif Gün 0"). Check every result's error; PGRST116
      // (.single() with 0 rows) is legit for brand-new accounts, not a failure.
      const failed = [profileRes, firstWeightRes, mealsRes, workoutsRes, reportsRes, achievementsRes]
        .some(r => r.error && r.error.code !== 'PGRST116');
      if (failed) {
        if (!loadedRef.current) setError(true); // keep already-loaded stats on a later refresh failure
        return;
      }
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

      // FIX (ux-round3 #16): "Aktif Gün" used to be tenure (days since signup) — a 60-day-idle user
      // saw "60", rewarding inactivity. Count REAL active days: distinct dates with any compliance.
      const activeDays = new Set(reports.filter(r => r.compliance_score > 0).map(r => r.date)).size;

      setStats({
        startWeight: firstWeightRes.data?.weight_kg ?? null,
        currentWeight: profile?.weight_kg ?? null,
        totalMeals: mealsRes.count ?? 0,
        totalWorkouts: workoutsRes.count ?? 0,
        longestStreak,
        avgCompliance: avgComp,
        activeDays,
        achievements: achievementsRes.count ?? 0,
      });
      loadedRef.current = true; // FIX (ux-pass5)
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

  // (refactor: shared LoadErrorState)
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <LoadErrorState title="Rapor yüklenemedi" subtitle="İnternet bağlantını kontrol et." onRetry={loadStats} />
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
            {/* FIX (ux-pass5): TR ondalık — virgül ("-4,5 kg"), nokta değil. */}
            <Text style={{ color: totalWeightChange < 0 ? COLORS.success : COLORS.error, fontSize: FONT.hero, fontWeight: '800' }}>
              {totalWeightChange > 0 ? '+' : ''}{totalWeightChange.toFixed(1).replace('.', ',')} kg
            </Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.xs }}>
              {/* FIX (ux-pass5): DB ondalıkları da virgülle ("81,5 kg → 79,5 kg"). */}
              {String(stats.startWeight).replace('.', ',')} kg → {String(stats.currentWeight).replace('.', ',')} kg
            </Text>
          </View>
        </Card>
      )}

      {/* Key Stats Grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <StatCard label="Aktif Gün" value={`${stats.activeDays}`} icon="calendar-outline" />
        {/* FIX (ux-polish): TR thousands separators for large lifetime totals (was bare "1240"). */}
        <StatCard label="Toplam Öğün" value={stats.totalMeals.toLocaleString('tr-TR')} icon="restaurant-outline" />
        <StatCard label="Toplam Antrenman" value={stats.totalWorkouts.toLocaleString('tr-TR')} icon="barbell-outline" />
        <StatCard label="Streak" value={`${stats.longestStreak}`} icon="flame-outline" />
        <StatCard label="Ort. Uyum" value={`%${stats.avgCompliance}`} icon="checkmark-circle-outline" />
        <StatCard label="Başarımlar" value={`${stats.achievements}`} icon="ribbon-outline" />
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

function StatCard({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  // FIX (ux-polish): align to the progress-tab SummaryBox — hairline (0.5) + RADIUS.md + a tinted
  // icon badge (was a 1px-border, iconless tile that read ~2× thicker than every other card).
  return (
    <View style={{ width: '47%', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border }}>
      {icon && (
        <View style={{ width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xs }}>
          <Ionicons name={icon} size={16} color={COLORS.primary} />
        </View>
      )}
      <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function MilestoneRow({ text, done }: { text: string; done: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm }}>
      {/* FIX (ux-polish): Ionicons to match the daily report's checklist (was bare ✓/○ text glyphs). */}
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? COLORS.success : COLORS.textMuted} style={{ marginRight: SPACING.sm }} />
      <Text style={{ color: done ? COLORS.success : COLORS.textMuted, fontSize: FONT.md }}>{text}</Text>
    </View>
  );
}
