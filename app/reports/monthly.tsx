/**
 * Monthly Report Screen
 * Spec 8.3: Aylık rapor - hedefe yaklaşma, trend, risk sinyalleri.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { ComplianceScore } from '@/components/reports/ComplianceScore';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function MonthlyReportScreen() {
  const user = useAuthStore(s => s.user);
  const [loading, setLoading] = useState(true);
  const [weeklyReports, setWeeklyReports] = useState<Record<string, unknown>[]>([]);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];

    Promise.all([
      supabase.from('weekly_reports').select('*').eq('user_id', user.id)
        .gte('week_start', fourWeeksAgo).order('week_start'),
      supabase.from('profiles').select('weight_kg, target_weight_kg').eq('id', user.id).single(),
    ]).then(([reportsRes, profileRes]) => {
      setWeeklyReports((reportsRes.data ?? []) as Record<string, unknown>[]);
      setProfile(profileRes.data);
      setLoading(false);
    });
  }, [user?.id]);

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>;
  }

  const avgCompliance = weeklyReports.length > 0
    ? Math.round(weeklyReports.reduce((s, r) => s + (r.avg_compliance as number ?? 0), 0) / weeklyReports.length)
    : 0;

  const firstWeight = weeklyReports[0]?.weight_start as number ?? null;
  const lastWeight = weeklyReports[weeklyReports.length - 1]?.weight_end as number ?? null;
  const weightChange = firstWeight && lastWeight ? lastWeight - firstWeight : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md }}>Aylik Rapor</Text>

      {/* Overall Compliance */}
      <Card title="Ortalama Uyum">
        <ComplianceScore score={avgCompliance} />
      </Card>

      {/* Weight Trend */}
      {weightChange !== null && (
        <Card title="Kilo Trendi">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Ay basi</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{firstWeight} kg</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Degisim</Text>
              <Text style={{ color: weightChange < 0 ? COLORS.success : weightChange > 0 ? COLORS.error : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
                {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1)} kg
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Ay sonu</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{lastWeight} kg</Text>
            </View>
          </View>
        </Card>
      )}

      {/* Goal Progress */}
      {profile?.target_weight_kg && lastWeight && (
        <Card title="Hedefe Kalan">
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600', textAlign: 'center' }}>
            {Math.abs(lastWeight - (profile.target_weight_kg as number)).toFixed(1)} kg
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs }}>
            Hedef: {profile.target_weight_kg as number} kg
          </Text>
        </Card>
      )}

      {/* Weekly Summaries */}
      <Card title="Haftalik Ozetler">
        {weeklyReports.map((wr, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.sm, borderBottomWidth: i < weeklyReports.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{wr.week_start as string}</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>%{wr.avg_compliance as number ?? 0}</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>{wr.weight_end ? `${wr.weight_end}kg` : '-'}</Text>
          </View>
        ))}
        {weeklyReports.length === 0 && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center' }}>Henuz haftalik rapor yok.</Text>
        )}
      </Card>
    </ScrollView>
  );
}
