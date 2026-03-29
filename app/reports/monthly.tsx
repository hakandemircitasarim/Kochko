/**
 * Monthly Report — Spec 8.3
 * Shows: goal progress, weight/waist trends, risk signals, behavioral patterns.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface MonthlyData {
  month: string;
  avg_compliance: number;
  weight_start: number | null;
  weight_end: number | null;
  total_meals_logged: number;
  total_workouts: number;
  avg_sleep: number | null;
  avg_water: number | null;
  risk_signals: string[];
}

export default function MonthlyReportScreen() {
  const user = useAuthStore(s => s.user);
  const [data, setData] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [goalText, setGoalText] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    loadMonthlyData(user.id).then(d => { setData(d); setLoading(false); });
    supabase.from('goals').select('goal_type, target_weight_kg')
      .eq('user_id', user.id).eq('is_active', true).limit(1).single()
      .then(({ data: g }) => {
        if (g) setGoalText(`${(g as { goal_type: string }).goal_type} → ${(g as { target_weight_kg: number }).target_weight_kg}kg`);
      });
  }, [user?.id]);

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Aylik Rapor</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
        {data?.month ?? 'Bu ay'}
      </Text>

      {!data ? (
        <Card><Text style={{ color: COLORS.textMuted, textAlign: 'center', paddingVertical: SPACING.lg }}>Yeterli veri yok.</Text></Card>
      ) : (
        <>
          {goalText ? <Card title="Aktif Hedef"><Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>{goalText}</Text></Card> : null}

          <Card title="Ay Ozeti">
            <StatRow label="Ortalama uyum" value={`%${data.avg_compliance}`} />
            {data.weight_start != null && data.weight_end != null && (
              <StatRow label="Kilo degisimi" value={`${data.weight_start} → ${data.weight_end} kg (${(data.weight_end - data.weight_start) > 0 ? '+' : ''}${(data.weight_end - data.weight_start).toFixed(1)})`} />
            )}
            <StatRow label="Toplam ogun kaydi" value={`${data.total_meals_logged}`} />
            <StatRow label="Toplam antrenman" value={`${data.total_workouts}`} />
            {data.avg_sleep != null && <StatRow label="Ortalama uyku" value={`${data.avg_sleep.toFixed(1)} sa/gun`} />}
            {data.avg_water != null && <StatRow label="Ortalama su" value={`${data.avg_water.toFixed(1)} L/gun`} />}
          </Card>

          {data.risk_signals.length > 0 && (
            <Card title="Risk Sinyalleri" style={{ borderColor: COLORS.warning, borderWidth: 1 }}>
              {data.risk_signals.map((r, i) => (
                <Text key={i} style={{ color: COLORS.warning, fontSize: FONT.sm, marginBottom: 4 }}>- {r}</Text>
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

async function loadMonthlyData(userId: string): Promise<MonthlyData | null> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const monthLabel = now.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  const [metricsRes, reportsRes, mealsRes, workoutsRes] = await Promise.all([
    supabase.from('daily_metrics').select('weight_kg, sleep_hours, water_liters').eq('user_id', userId).gte('date', monthStart).lte('date', monthEnd).order('date'),
    supabase.from('daily_reports').select('compliance_score').eq('user_id', userId).gte('date', monthStart).lte('date', monthEnd),
    supabase.from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('logged_for_date', monthStart).lte('logged_for_date', monthEnd).eq('is_deleted', false),
    supabase.from('workout_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('logged_for_date', monthStart).lte('logged_for_date', monthEnd),
  ]);

  const metrics = (metricsRes.data ?? []) as { weight_kg: number | null; sleep_hours: number | null; water_liters: number }[];
  const reports = (reportsRes.data ?? []) as { compliance_score: number }[];
  const weights = metrics.filter(m => m.weight_kg != null).map(m => m.weight_kg as number);
  const sleepDays = metrics.filter(m => m.sleep_hours != null);

  const risk_signals: string[] = [];
  const avgComp = reports.length > 0 ? Math.round(reports.reduce((s, r) => s + r.compliance_score, 0) / reports.length) : 0;
  if (avgComp < 50) risk_signals.push('Dusuk uyum puani — plan revizyonu gerekebilir');
  const avgSleep = sleepDays.length > 0 ? sleepDays.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepDays.length : null;
  if (avgSleep != null && avgSleep < 6) risk_signals.push('Dusuk uyku ortalamasi — metabolizma etkilenebilir');

  return {
    month: monthLabel,
    avg_compliance: avgComp,
    weight_start: weights.length > 0 ? weights[0] : null,
    weight_end: weights.length > 0 ? weights[weights.length - 1] : null,
    total_meals_logged: mealsRes.count ?? 0,
    total_workouts: workoutsRes.count ?? 0,
    avg_sleep: avgSleep,
    avg_water: metrics.length > 0 ? metrics.reduce((s, m) => s + m.water_liters, 0) / metrics.length : null,
    risk_signals,
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
